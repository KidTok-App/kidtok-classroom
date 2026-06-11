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
      const body = (req.body ?? {}) as { topic?: unknown; ageBand?: unknown };
      const topic = typeof body.topic === "string" ? body.topic.trim() : "";
      const ageBand = Number(body.ageBand);

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

  app.get("/episodes", async (_req, res) => {
    try {
      const docs = await deps.store.list(50);
      res.json(docs.map(toPublicEpisode));
    } catch (err) {
      console.error("[api] GET /episodes failed:", err);
      res.status(500).json({ error: "failed to list episodes" });
    }
  });

  return app;
}
