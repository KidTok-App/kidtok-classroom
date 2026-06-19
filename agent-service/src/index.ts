/**
 * KidTok Classroom agent service — bootstrap.
 *
 * Wires config → tracing → providers (real Google/Phoenix, or fakes when
 * KIDTOK_FAKE_PROVIDERS=1) → ClassroomOrchestrator → Express API.
 */

import "./instrumentation.js";
import { tracingHandle } from "./instrumentation.js";
import path from "node:path";
import { GoogleAuth } from "google-auth-library";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { ClassroomOrchestrator } from "./orchestrator/ClassroomOrchestrator.js";
import type { Providers, TextLlm } from "./clients/interfaces.js";
import { VertexAuth, VertexGeminiImageGen, VertexRestTextLlm } from "./clients/gemini.js";
import { GeminiVisualSafetyClassifier } from "./clients/imageSafety.js";
import { FirestoreEpisodeStore, GcsAssetStorage, GoogleSpeechSynth, FirestoreUserIndex, IndexedEpisodeStore } from "./clients/google.js";
import { ElevenLabsSpeechSynth } from "./clients/elevenlabs.js";
import { PhoenixMcpClient } from "./clients/phoenixMcp.js";
import {
  FakeImageGen,
  FakePhoenixMcp,
  FakeSpeechSynth,
  FakeTextLlm,
  FakeVisualSafety,
  InMemoryEpisodeStore,
  LocalDirStorage,
  FakeVideoGen,
  FakeUserIndex,
} from "./clients/fakes.js";
import { KieOmniVideoGenerator } from "./clients/videoGen.js";

export interface BootResult {
  cfg: ReturnType<typeof loadConfig>;
  providers: Providers;
  orchestrator: ClassroomOrchestrator;
  app: ReturnType<typeof createServer>;
  shutdown: () => Promise<void>;
}

export async function boot(env: NodeJS.ProcessEnv = process.env): Promise<BootResult> {
  const cfg = loadConfig(env);
  const tracing = tracingHandle;

  let providers: Providers;
  let localAssetsDir: string | undefined;

  if (cfg.fakeProviders) {
    console.log("[boot] KIDTOK_FAKE_PROVIDERS=1 — running with in-process fakes (TEST-ONLY mode)");
    localAssetsDir = path.resolve("local-assets");
    if (!tracing.memoryExporter) throw new Error("fake mode requires the in-memory span exporter");
    providers = {
      textLlm: new FakeTextLlm(),
      imageGen: new FakeImageGen(env.KIDTOK_FAKE_FAIL_IMAGE_CALL ? Number(env.KIDTOK_FAKE_FAIL_IMAGE_CALL) : null),
      visualSafety: new FakeVisualSafety(),
      tts: new FakeSpeechSynth(),
      storage: new LocalDirStorage(localAssetsDir, `http://localhost:${cfg.port}/assets`),
      store: new IndexedEpisodeStore(new InMemoryEpisodeStore(), new FakeUserIndex()),
      phoenix: new FakePhoenixMcp(tracing.memoryExporter),
      videoGen: new FakeVideoGen(),
      forceFlushTracing: tracing.forceFlush,
    };
  } else {
    const vertexAuth = new VertexAuth();
    const gateAuth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

    let textLlm: TextLlm;
    if (cfg.orchestratorEngine === "adk") {
      // PRIMARY: Google ADK agent definitions (see clients/adkLlm.ts).
      const { AdkTextLlm } = await import("./clients/adkLlm.js");
      textLlm = new AdkTextLlm(cfg.textModel);
    } else {
      // DOCUMENTED FALLBACK: plain Vertex REST pipeline.
      textLlm = new VertexRestTextLlm(vertexAuth, cfg.projectId, cfg.region, cfg.textModel);
    }
    console.log(`[boot] orchestrator engine=${cfg.orchestratorEngine} textModel=${cfg.textModel} imageModel=${cfg.imageModel}`);

    const firestoreStore = new FirestoreEpisodeStore(cfg.projectId, cfg.firestoreCollection);
    const userIndexRoot = env.FIRESTORE_USER_INDEX_ROOT || "users";
    const userIndex = new FirestoreUserIndex(firestoreStore.db, userIndexRoot);

    providers = {
      textLlm,
      imageGen: new VertexGeminiImageGen(vertexAuth, cfg.projectId, cfg.region, cfg.imageModel),
      visualSafety: new GeminiVisualSafetyClassifier(
        gateAuth,
        cfg.projectId,
        cfg.region,
        cfg.textModel,
        cfg.enableVisualSafety,
      ),
      tts: cfg.elevenlabsApiKey ? new ElevenLabsSpeechSynth(cfg.elevenlabsApiKey) : new GoogleSpeechSynth(),
      storage: new GcsAssetStorage(cfg.projectId, cfg.gcsBucket),
      store: new IndexedEpisodeStore(firestoreStore, userIndex),
      phoenix: new PhoenixMcpClient({
        phoenixHost: cfg.phoenixHost,
        phoenixApiKey: cfg.phoenixApiKey,
        phoenixProject: cfg.phoenixProject,
        commandOverride: cfg.phoenixMcpCommand,
        promptModelName: cfg.textModel,
      }),
      videoGen: new KieOmniVideoGenerator(cfg.kieApiKey, false),
      forceFlushTracing: tracing.forceFlush,
    };
  }

  const orchestrator = new ClassroomOrchestrator(providers, cfg, tracing.tracer);
  const app = createServer({
    cfg,
    store: providers.store,
    startEpisode: (doc) => orchestrator.startEpisode(doc),
    phoenix: providers.phoenix,
    localAssetsDir,
  });

  const shutdown = async (): Promise<void> => {
    await providers.phoenix.close().catch(() => {});
    await tracing.forceFlush().catch(() => {});
    await tracing.shutdown().catch(() => {});
  };

  return { cfg, providers, orchestrator, app, shutdown };
}

// Only start listening when executed directly (the smoke test imports boot()).
const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  boot()
    .then(({ cfg, app, shutdown }) => {
      const server = app.listen(cfg.port, () => {
        console.log(`[boot] kidtok-agent-service listening on :${cfg.port}`);
      });
      for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.on(signal, () => {
          console.log(`[boot] ${signal} — shutting down`);
          server.close(() => {
            void shutdown().finally(() => process.exit(0));
          });
        });
      }
    })
    .catch((err) => {
      console.error("[boot] fatal:", err);
      process.exit(1);
    });
}
