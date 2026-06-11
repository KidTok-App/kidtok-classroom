/**
 * Express HTTP layer. Auth-free demo API, CORS open, PORT from env.
 * Contract matches the frontend module src/lib/agentApi.ts at the repo root:
 *   POST /episodes { topic, ageBand } → 201 { id, episodeId }
 *   GET  /episodes/:id → Episode (404 when unknown)
 *   GET  /episodes → Episode[] (newest first)
 *   GET  /healthz
 */

import crypto from "node:crypto";
import express, { type Express } from "express";
import type { EpisodeStore } from "./clients/interfaces.js";
import type { ServiceConfig } from "./config.js";
import { toPublicEpisode, type EpisodeDoc } from "./types.js";

export interface ServerDeps {
  cfg: ServiceConfig;
  store: EpisodeStore;
  startEpisode: (doc: EpisodeDoc) => void;
  /** Set in fake-provider mode: serve uploaded assets from local disk. */
  localAssetsDir?: string;
}

/**
 * Lightweight in-process parser for Google ID Tokens (JWT) and Dev mock tokens.
 * Extracts the user sub claim (id) and name safely.
 */
function parseAuthToken(authHeader?: string): { id: string; name: string } | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7).trim();
  if (!token) return null;

  // 1. Mock token support (for dev selector bypass)
  if (token.startsWith("mock-token-")) {
    const id = token.substring("mock-token-".length);
    // Capitalize and format name
    const name = id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return { id, name };
  }

  // 2. Google JWT decoding
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payloadB64 = parts[1] || "";
    const payloadStr = Buffer.from(payloadB64, "base64").toString("utf8");
    const payload = JSON.parse(payloadStr);

    if (payload.exp && typeof payload.exp === "number") {
      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec > payload.exp) {
        console.warn("[auth] Google JWT token expired");
        return null;
      }
    }

    if (!payload.sub) return null;
    return {
      id: payload.sub,
      name: payload.name || payload.given_name || "Google User",
    };
  } catch (err) {
    console.error("[auth] Failed to parse JWT:", err);
    return null;
  }
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
      const authHeader = req.headers.authorization;
      const caller = parseAuthToken(authHeader);

      const body = (req.body ?? {}) as { topic?: unknown; ageBand?: unknown; generationMode?: unknown };
      const topic = typeof body.topic === "string" ? body.topic.trim() : "";
      const ageBand = Number(body.ageBand);
      const generationMode = body.generationMode === "video" ? "video" : "slides";

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
        ...(caller ? { ownerId: caller.id } : {}),
      };
      await deps.store.create(doc);
      deps.startEpisode(doc); // pipeline runs async in-process
      res.status(201).json({ id: doc.id, episodeId: doc.id });
    } catch (err) {
      console.error("[api] POST /episodes failed:", err);
      res.status(500).json({ error: "failed to create episode" });
    }
  });

  app.get("/episodes/:id", async (req, res) => {
    try {
      const doc = await deps.store.get(req.params.id);
      if (!doc) {
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
      const authHeader = req.headers.authorization;
      const caller = parseAuthToken(authHeader);

      // Return only episodes owned by this caller if authenticated
      const ownerId = caller ? caller.id : undefined;
      const docs = await deps.store.list(ownerId, 50);
      res.json(docs.map(toPublicEpisode));
    } catch (err) {
      console.error("[api] GET /episodes failed:", err);
      res.status(500).json({ error: "failed to list episodes" });
    }
  });

  return app;
}
