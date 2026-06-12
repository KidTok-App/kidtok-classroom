/**
 * Express HTTP layer. Auth-enforced API, CORS scoped, PORT from env.
 * Contract matches the frontend module src/lib/agentApi.ts at the repo root:
 *   POST /episodes { topic, ageBand } → 201 { id, episodeId } (auth required)
 *   GET  /episodes/:id → Episode (404 when unknown, owner-only)
 *   GET  /episodes → Episode[] (newest first, owner-only, auth required)
 *   GET  /healthz
 */

import crypto from "node:crypto";
import express, { type Express, type Request } from "express";
import { OAuth2Client } from "google-auth-library";
import type { EpisodeStore, PhoenixMcp } from "./clients/interfaces.js";
import type { ServiceConfig } from "./config.js";
import { toPublicEpisode, type EpisodeDoc } from "./types.js";

export interface ServerDeps {
  cfg: ServiceConfig;
  store: EpisodeStore;
  startEpisode: (doc: EpisodeDoc) => void;
  phoenix: PhoenixMcp;
  /** Set in fake-provider mode: serve uploaded assets from local disk. */
  localAssetsDir?: string;
}

type Caller = { id: string; name: string; email?: string };

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// Omni video allowlist enforced server-side. Keep aligned with the UI list.
const OMNI_ALLOWED_EMAILS = new Set(["wiktor@kidtok.co"]);
const OMNI_ALLOWED_DOMAINS = ["@kidtokai.com", "@kidtok.co"];
function emailCanUseOmni(email: string | undefined | null): boolean {
  if (!email) return false;
  const lower = email.toLowerCase();
  if (OMNI_ALLOWED_EMAILS.has(lower)) return true;
  return OMNI_ALLOWED_DOMAINS.some((d) => lower.endsWith(d));
}

/**
 * Cryptographically verifies a bearer token. Returns the authenticated caller
 * or null if the token is missing/invalid/expired.
 *
 * Mock tokens (`mock-token-<id>`) are accepted ONLY when KIDTOK_FAKE_PROVIDERS
 * is enabled — never in production.
 */
async function parseAuthToken(
  authHeader: string | undefined,
  cfg: ServiceConfig,
): Promise<Caller | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7).trim();
  if (!token) return null;

  // 1. Mock token — dev/fake-provider mode ONLY.
  if (token.startsWith("mock-token-")) {
    if (!cfg.fakeProviders) {
      console.warn("[auth] rejected mock token in non-fake-providers mode");
      return null;
    }
    const id = token.substring("mock-token-".length);
    if (!id) return null;
    const name = id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const email = id.includes("@") ? id : `${id}@kidtok.co`;
    return { id, name, email };
  }

  // 2. Google ID Token — full signature/issuer/audience/exp verification via JWKS.
  if (!googleClient) {
    console.error("[auth] GOOGLE_CLIENT_ID not configured — cannot verify Google ID tokens");
    return null;
  }
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.sub) return null;
    return {
      id: payload.sub,
      name: payload.name || payload.given_name || "Google User",
      email: payload.email,
    };
  } catch (err) {
    console.warn("[auth] Google ID token verification failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function requireCaller(req: Request, cfg: ServiceConfig): Promise<Caller | null> {
  return parseAuthToken(req.headers.authorization, cfg);
}

// Hard server-side cap on free-form steerage to limit prompt-injection blast radius.
const USER_STEERAGE_MAX = 500;
// Suspicious tokens commonly used for prompt-injection / template poisoning attempts.
const STEERAGE_BLOCKLIST = /\b(ignore (?:all |the )?(?:previous|prior|above) (?:instructions?|prompts?)|system\s*prompt|you are now|disregard (?:all |the )?instructions?)\b/i;

function sanitizeShortString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/[`]/g, "'").replace(/\s+/g, " ");
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

function sanitizeChildProfile(value: unknown): EpisodeDoc["childProfile"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const name = sanitizeShortString(raw.name, 60);
  // Only name + a valid ageBand are required. interests / artStyle are
  // optional so the front-end never accidentally creates an untagged episode
  // just because the parent left those fields blank.
  if (!name) return undefined;
  const ageBand = Number(raw.ageBand);
  if (!Number.isInteger(ageBand) || ageBand < 5 || ageBand > 8) return undefined;
  const interests = sanitizeShortString(raw.interests, 200) ?? "";
  const artStyle = sanitizeShortString(raw.artStyle, 80) ?? "crayon sketch";
  return { name, interests, artStyle, ageBand };
}

export function createServer(deps: ServerDeps): Express {
  const app = express();
  
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      let isAllowed = false;
      if (origin === "http://localhost:5173" || origin === "http://localhost:8080") {
        isAllowed = true;
      } else if (origin.startsWith("https://")) {
        const hostname = origin.slice(8);
        if (hostname === "lovable.app" || hostname === "lovableproject.com" || hostname.endsWith(".lovable.app") || hostname.endsWith(".lovableproject.com")) {
          isAllowed = true;
        }
      }

      if (isAllowed) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.setHeader("Access-Control-Max-Age", "86400");
        res.setHeader("Access-Control-Allow-Credentials", "true");
      }
    }

    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }

    next();
  });

  app.use(express.json({ limit: "256kb" }));

  if (deps.localAssetsDir) {
    app.use("/assets", express.static(deps.localAssetsDir));
  }

  app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      service: "kidtok-agent-service",
      mode: deps.cfg.fakeProviders ? "fake-providers" : "production",
      engine: deps.cfg.orchestratorEngine,
    });
  });

  app.post("/episodes", async (req, res) => {
    try {
      const caller = await requireCaller(req, deps.cfg);
      if (!caller) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const body = (req.body ?? {}) as { topic?: unknown; ageBand?: unknown; generationMode?: unknown; userSteerage?: unknown; childProfile?: unknown };
      const topic = typeof body.topic === "string" ? body.topic.trim() : "";
      const ageBand = Number(body.ageBand);
      let generationMode: "video" | "slides" = body.generationMode === "video" ? "video" : "slides";

      // Server-side enforcement of Omni allowlist — never trust the client.
      if (generationMode === "video" && !emailCanUseOmni(caller.email)) {
        generationMode = "slides";
      }

      // Length-capped + content-filtered steerage to mitigate prompt injection
      // and shared-template poisoning.
      let userSteerage: string | undefined;
      if (typeof body.userSteerage === "string") {
        const trimmed = body.userSteerage.trim();
        if (trimmed.length > USER_STEERAGE_MAX) {
          res.status(400).json({ error: `userSteerage must be ${USER_STEERAGE_MAX} characters or fewer` });
          return;
        }
        if (trimmed && STEERAGE_BLOCKLIST.test(trimmed)) {
          res.status(400).json({ error: "userSteerage contains disallowed instructions" });
          return;
        }
        if (trimmed) userSteerage = trimmed;
      }

      const childProfile = sanitizeChildProfile(body.childProfile);

      if (!topic || topic.length > 300) {
        res.status(400).json({ error: "topic is required (non-empty string, max 300 chars)" });
        return;
      }
      if (!Number.isInteger(ageBand) || ageBand < 5 || ageBand > 8) {
        res.status(400).json({ error: "ageBand must be 5, 6, 7 or 8" });
        return;
      }

      const doc: EpisodeDoc = {
        id: crypto.randomUUID(),
        topic,
        ageBand,
        createdAt: new Date().toISOString(),
        status: "scripting",
        generationMode,
        ownerId: caller.id,
        ...(userSteerage ? { userSteerage } : {}),
        ...(childProfile ? { childProfile } : {}),
      };
      await deps.store.create(doc);
      deps.startEpisode(doc); // pipeline runs async in-process
      res.status(201).json({ id: doc.id, episodeId: doc.id });
    } catch (err) {
      console.error("[api] POST /episodes failed:", err);
      res.status(500).json({ error: "failed to create episode" });
    }
  });

  app.get("/prompts/history", async (req, res) => {
    try {
      const caller = await requireCaller(req, deps.cfg);
      if (!caller) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      const history = await deps.phoenix.getPromptHistory("kidtok-scene-prompt");
      res.json(history);
    } catch (err) {
      console.error("[api] GET /prompts/history failed:", err);
      res.status(500).json({ error: "failed to load prompt history" });
    }
  });

  app.get("/episodes/:id", async (req, res) => {
    try {
      const caller = await requireCaller(req, deps.cfg);
      if (!caller) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      const doc = await deps.store.get(req.params.id);
      if (!doc) {
        res.status(404).json({ error: "episode not found" });
        return;
      }
      // Owner-only access: do not leak other users' child PII.
      if (doc.ownerId && doc.ownerId !== caller.id) {
        res.status(404).json({ error: "episode not found" });
        return;
      }
      res.json(toPublicEpisode(doc));
    } catch (err) {
      console.error("[api] GET /episodes/:id failed:", err);
      res.status(500).json({ error: "failed to load episode" });
    }
  });

  app.get("/episodes", async (req, res) => {
    try {
      const caller = await requireCaller(req, deps.cfg);
      if (!caller) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      // Always scope to the authenticated caller — never return cross-user episodes.
      const docs = await deps.store.list(caller.id, 50);
      res.json(docs.map(toPublicEpisode));
    } catch (err) {
      console.error("[api] GET /episodes failed:", err);
      res.status(500).json({ error: "failed to list episodes" });
    }
  });

  return app;
}
