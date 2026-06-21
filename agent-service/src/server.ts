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
import { createClient } from "@supabase/supabase-js";
import type { EpisodeStore, PhoenixMcp } from "./clients/interfaces.js";
import type { ServiceConfig } from "./config.js";
import { childScopedPromptName } from "./lib/promptScoping.js";
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
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  }
}) : null;

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

  // 2. Supabase JWT Token validation.
  if (!supabase) {
    console.error("[auth] Supabase client not initialized — cannot verify tokens");
    return null;
  }
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      if (error) {
        console.warn("[auth] Supabase token verification error:", error.message);
      }
      return null;
    }
    const user = data.user;
    return {
      id: user.id,
      name: user.user_metadata?.full_name || user.user_metadata?.name || user.email || "Supabase User",
      email: user.email,
    };
  } catch (err) {
    console.warn("[auth] Supabase token verification failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function requireCaller(req: Request, cfg: ServiceConfig): Promise<Caller | null> {
  const caller = await parseAuthToken(req.headers.authorization, cfg);
  if (caller) return caller;
  if (cfg.fakeProviders) {
    return { id: "demo-parent", name: "Demo Parent", email: "wiktor@kidtok.co" };
  }
  return null;
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
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
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
      const baseName = deps.cfg.scenePromptName;
      const rawChild = typeof req.query.child === "string" ? req.query.child.trim() : "";
      const child = rawChild.slice(0, 60);
      let scope: "child" | "global" = "global";
      let history = await deps.phoenix.getPromptHistory(baseName);
      if (child) {
        const scopedName = childScopedPromptName(baseName, child, caller.id);
        if (scopedName !== baseName) {
          const scoped = await deps.phoenix.getPromptHistory(scopedName);
          if (scoped.length > 0) {
            // Per-child lineage starts from the shared baseline, then adds
            // the child's own reviewer-published versions on top.
            history = [...history, ...scoped];
            scope = "child";
          }
        }
      }
      res.json({ history, scope });
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

  // Retroactively tag (or untag) an existing episode with a child profile.
  // Owner-only. Used by the Self-Improvement page to assign legacy/untagged
  // cartoons to a child so per-child stats reflect reality.
  app.patch("/episodes/:id", async (req, res) => {
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
      if (doc.ownerId && doc.ownerId !== caller.id) {
        res.status(404).json({ error: "episode not found" });
        return;
      }
      const body = (req.body ?? {}) as { childProfile?: unknown };
      const nextProfile = sanitizeChildProfile(body.childProfile);
      if (!nextProfile) {
        res.status(400).json({ error: "childProfile must be a valid profile object" });
        return;
      }
      await deps.store.update(req.params.id, { childProfile: nextProfile });
      const updated = await deps.store.get(req.params.id);
      res.json(updated ? toPublicEpisode(updated) : { id: req.params.id });
    } catch (err) {
      console.error("[api] PATCH /episodes/:id failed:", err);
      res.status(500).json({ error: "failed to update episode" });
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
