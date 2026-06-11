/**
 * ClassroomOrchestrator — THE single central coordinator. Runs the six
 * sub-agents strictly sequentially; sub-agents never call each other — every
 * hand-off flows through this class:
 *
 *   ScriptAgent → ScenePlannerAgent → SceneImageAgent → NarrationAgent →
 *   AssemblyAgent → QualityReviewerAgent
 *
 * Statuses: scripting → planning_scenes → generating_images → narrating →
 * reviewing → ready | failed.
 *
 * The whole run is instrumented with OpenInference/OpenTelemetry exporting to
 * Phoenix; the root span carries the `episodeId` attribute so the
 * QualityReviewerAgent can pull this exact run back out via Phoenix MCP.
 */

import type { Tracer } from "@opentelemetry/api";
import { EPISODE_ID_ATTR, SPAN_KIND_ATTR, SPAN_KINDS, withSpan } from "../tracing.js";
import { ScriptAgent } from "../agents/ScriptAgent.js";
import { ScenePlannerAgent } from "../agents/ScenePlannerAgent.js";
import { SceneImageAgent } from "../agents/SceneImageAgent.js";
import { NarrationAgent } from "../agents/NarrationAgent.js";
import { AssemblyAgent } from "../agents/AssemblyAgent.js";
import { QualityReviewerAgent } from "../agents/QualityReviewerAgent.js";
import type { Providers } from "../clients/interfaces.js";
import type { ServiceConfig } from "../config.js";
import type { EpisodeDoc } from "../types.js";

export class ClassroomOrchestrator {
  private readonly scriptAgent: ScriptAgent;
  private readonly scenePlannerAgent: ScenePlannerAgent;
  private readonly sceneImageAgent: SceneImageAgent;
  private readonly narrationAgent: NarrationAgent;
  private readonly assemblyAgent: AssemblyAgent;
  private readonly qualityReviewerAgent: QualityReviewerAgent;

  constructor(
    private readonly providers: Providers,
    private readonly cfg: ServiceConfig,
    private readonly tracer: Tracer,
  ) {
    this.scriptAgent = new ScriptAgent(providers.textLlm);
    this.scenePlannerAgent = new ScenePlannerAgent(
      providers.textLlm,
      providers.phoenix,
      cfg.scenePromptName,
    );
    this.sceneImageAgent = new SceneImageAgent(
      providers.imageGen,
      providers.visualSafety,
      providers.textLlm,
      providers.storage,
    );
    this.narrationAgent = new NarrationAgent(providers.tts, providers.storage, {
      voiceName: cfg.ttsVoiceName,
      speakingRate: cfg.ttsSpeakingRate,
      pitch: cfg.ttsPitch,
    });
    this.assemblyAgent = new AssemblyAgent(providers.store);
    this.qualityReviewerAgent = new QualityReviewerAgent(
      providers.textLlm,
      providers.phoenix,
      providers.store,
      providers.forceFlushTracing,
      cfg.scenePromptName,
    );
  }

  /** Fire-and-forget entrypoint used by POST /episodes. */
  startEpisode(doc: EpisodeDoc): void {
    void this.runEpisode(doc).catch((err) => {
      console.error(`[orchestrator] episode=${doc.id} crashed outside stage handling:`, err);
    });
  }

  async runEpisode(doc: EpisodeDoc): Promise<void> {
    const { store } = this.providers;
    const stageDurationsMs: Record<string, number> = {};
    const startedAt = Date.now();

    await withSpan(
      this.tracer,
      "ClassroomOrchestrator.runEpisode",
      {
        [SPAN_KIND_ATTR]: SPAN_KINDS.CHAIN,
        [EPISODE_ID_ATTR]: doc.id,
        topic: doc.topic,
        ageBand: doc.ageBand,
        engine: this.providers.textLlm.engine,
      },
      async () => {
        try {
          // ---- 1. ScriptAgent (status: scripting — set at creation) -------
          const scriptOut = await this.stage(doc.id, "ScriptAgent", stageDurationsMs, () =>
            this.scriptAgent.run({ episodeId: doc.id, topic: doc.topic, ageBand: doc.ageBand }),
          );

          // ---- 2. ScenePlannerAgent --------------------------------------
          await store.update(doc.id, { status: "planning_scenes" });
          const planOut = await this.stage(doc.id, "ScenePlannerAgent", stageDurationsMs, () =>
            this.scenePlannerAgent.run({
              episodeId: doc.id,
              topic: doc.topic,
              ageBand: doc.ageBand,
              script: scriptOut.script,
            }),
          );

          // ---- 3. SceneImageAgent ----------------------------------------
          await store.update(doc.id, { status: "generating_images" });
          const imageOut = await this.stage(doc.id, "SceneImageAgent", stageDurationsMs, () =>
            this.sceneImageAgent.run({
              episodeId: doc.id,
              topic: doc.topic,
              ageBand: doc.ageBand,
              scenes: planOut.scenes,
            }),
          );

          // ---- 4. NarrationAgent -----------------------------------------
          await store.update(doc.id, { status: "narrating" });
          const narrationOut = await this.stage(doc.id, "NarrationAgent", stageDurationsMs, () =>
            this.narrationAgent.run({ episodeId: doc.id, scenes: scriptOut.script.scenes }),
          );

          // ---- 5. AssemblyAgent (sets status: reviewing) -------------------
          const scenes = await this.stage(doc.id, "AssemblyAgent", stageDurationsMs, () =>
            this.assemblyAgent.run({
              episodeId: doc.id,
              script: scriptOut.script,
              images: imageOut.images,
              narrations: narrationOut,
            }),
          );

          // Persist run metrics before review so the reviewer sees them too.
          await store.update(doc.id, {
            metrics: {
              stageDurationsMs,
              imageRetries: imageOut.totalRetries,
              degradedScenes: imageOut.images.filter((i) => i.degraded).length,
              safetyVerdict: scriptOut.safetyVerdict,
              scenePromptVersion: planOut.promptVersionId,
            },
          });

          // ---- 6. QualityReviewerAgent (sets status: ready) ----------------
          await this.stage(doc.id, "QualityReviewerAgent", stageDurationsMs, () =>
            this.qualityReviewerAgent.run({
              episodeId: doc.id,
              script: scriptOut.script,
              scenes,
              imageRetries: imageOut.totalRetries,
              promptVersionUsed: planOut.promptVersionId,
              templateUsed: planOut.templateUsed,
              templateFellBack: planOut.templateFellBack,
              safetyVerdict: scriptOut.safetyVerdict,
            }),
          );

          console.log(
            `[orchestrator] episode=${doc.id} ready in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[orchestrator] episode=${doc.id} FAILED: ${message}`);
          await store
            .update(doc.id, { status: "failed", error: message.substring(0, 500) })
            .catch((updateErr) =>
              console.error(`[orchestrator] episode=${doc.id} failed to record failure:`, updateErr),
            );
          throw err; // keep the root span status = ERROR
        }
      },
    ).catch(() => {
      /* failure already persisted + logged; never reject the fire-and-forget chain */
    });
  }

  private async stage<T>(
    episodeId: string,
    name: string,
    durations: Record<string, number>,
    fn: () => Promise<T>,
  ): Promise<T> {
    const t0 = Date.now();
    try {
      return await withSpan(
        this.tracer,
        name,
        { [SPAN_KIND_ATTR]: SPAN_KINDS.AGENT, [EPISODE_ID_ATTR]: episodeId },
        fn,
      );
    } finally {
      durations[name] = Date.now() - t0;
    }
  }
}
