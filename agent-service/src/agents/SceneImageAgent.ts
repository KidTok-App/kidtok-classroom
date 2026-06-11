/**
 * SceneImageAgent — for each scene sequentially:
 *   sanitize prompt (legacy sanitizer) → Vertex Gemini image (legacy URL
 *   builder + inlineData parser) → visual safety gate → upload PNG to Cloud
 *   Storage → public URL.
 *
 * Retry policy per the spec: ONE retry max per scene (the retry runs the
 * legacy LLM prompt-safety rewriter + progressive simplification); on the
 * second failure the scene gets a styled placeholder and is marked degraded.
 */

import { trace } from "@opentelemetry/api";
import {
  buildImagePromptForAttempt,
  buildLlmSanitizerUserMessage,
  sanitizeImagePrompt,
  SANITIZER_RESPONSE_SCHEMA,
  SANITIZER_SYSTEM_PROMPT,
} from "../legacy/promptSanitizer.js";
import { renderPlaceholderPng } from "../lib/placeholderPng.js";
import { withSpan, SPAN_KIND_ATTR, SPAN_KINDS } from "../tracing.js";
import type {
  AssetStorage,
  ImageGen,
  TextLlm,
  VisualSafetyClassifier,
} from "../clients/interfaces.js";
import type { PlannedScene } from "../types.js";

export interface SceneImageResult {
  index: number;
  imageUrl: string;
  degraded: boolean;
  retried: boolean;
}

export class SceneImageAgent {
  constructor(
    private readonly imageGen: ImageGen,
    private readonly visualSafety: VisualSafetyClassifier,
    private readonly llm: TextLlm,
    private readonly storage: AssetStorage,
  ) {}

  async run(input: {
    episodeId: string;
    topic: string;
    ageBand: number;
    scenes: PlannedScene[];
  }): Promise<{ images: SceneImageResult[]; totalRetries: number }> {
    const tracer = trace.getTracer("kidtok-classroom");
    const images: SceneImageResult[] = [];
    let totalRetries = 0;

    for (let index = 0; index < input.scenes.length; index++) {
      const scene = input.scenes[index];
      if (!scene) continue;
      const result = await withSpan(
        tracer,
        `SceneImageAgent.scene[${index}]`,
        {
          [SPAN_KIND_ATTR]: SPAN_KINDS.TOOL,
          episodeId: input.episodeId,
          "scene.index": index,
        },
        async (span) => {
          const out = await this.generateOneScene(input.episodeId, input.topic, input.ageBand, index, scene);
          span.setAttribute("scene.retried", out.retried);
          span.setAttribute("scene.degraded", out.degraded);
          return out;
        },
      );
      if (result.retried) totalRetries += 1;
      images.push(result);
    }

    return { images, totalRetries };
  }

  private async generateOneScene(
    episodeId: string,
    topic: string,
    ageBand: number,
    index: number,
    scene: PlannedScene,
  ): Promise<SceneImageResult> {
    const objectPath = `episodes/${episodeId}/scene-${index}.png`;

    // Attempt 0 — deterministic legacy people-noun scrub.
    const quick = sanitizeImagePrompt(scene.imagePrompt);
    if (quick.wasSanitized) {
      console.log(
        `[SceneImageAgent] episode=${episodeId} scene=${index} deterministic sanitizer removed: ${quick.removedPatterns.join(", ")}`,
      );
    }
    const attempt0 = await this.tryGenerate(
      buildImagePromptForAttempt(quick.text, topic, 0),
      episodeId,
      topic,
      ageBand,
      index,
    );
    if (attempt0) {
      const imageUrl = await this.storage.uploadBuffer(objectPath, attempt0.data, attempt0.mimeType);
      return { index, imageUrl, degraded: false, retried: false };
    }

    // Attempt 1 (the single allowed retry) — legacy LLM prompt-safety
    // rewriter + progressive simplification.
    let retryPrompt = buildImagePromptForAttempt(quick.text, topic, 1);
    try {
      const rewrite = await this.llm.generateJson<{
        sanitized_prompt: string;
        removed_concepts: string[];
        was_changed: boolean;
      }>({
        spanName: "prompt-llm-sanitizer",
        system: SANITIZER_SYSTEM_PROMPT,
        user: buildLlmSanitizerUserMessage(retryPrompt),
        schema: SANITIZER_RESPONSE_SCHEMA,
        temperature: 0.2,
        maxOutputTokens: 4096,
        safetyMode: "analysis",
      });
      if (rewrite.sanitized_prompt?.trim()) {
        retryPrompt = rewrite.sanitized_prompt.trim();
        if (rewrite.was_changed) {
          console.log(
            `[SceneImageAgent] episode=${episodeId} scene=${index} LLM sanitizer rewrote prompt (removed: ${rewrite.removed_concepts.join(", ") || "n/a"})`,
          );
        }
      }
    } catch (err) {
      console.warn(
        `[SceneImageAgent] episode=${episodeId} scene=${index} LLM sanitizer failed (${err instanceof Error ? err.message : err}); retrying with simplified prompt`,
      );
    }

    const attempt1 = await this.tryGenerate(retryPrompt, episodeId, topic, ageBand, index);
    if (attempt1) {
      const imageUrl = await this.storage.uploadBuffer(objectPath, attempt1.data, attempt1.mimeType);
      return { index, imageUrl, degraded: false, retried: true };
    }

    // Second failure → styled placeholder, scene marked degraded.
    console.warn(`[SceneImageAgent] episode=${episodeId} scene=${index} degraded to styled placeholder`);
    const placeholder = renderPlaceholderPng({
      from: [255, 214, 165],
      to: [183, 216 + ((index * 7) % 24), 230],
    });
    const imageUrl = await this.storage.uploadBuffer(objectPath, placeholder, "image/png");
    return { index, imageUrl, degraded: true, retried: true };
  }

  /** One generate+gate attempt. Returns null on any recoverable failure. */
  private async tryGenerate(
    prompt: string,
    episodeId: string,
    topic: string,
    ageBand: number,
    sceneIndex: number,
  ): Promise<{ data: Buffer; mimeType: string } | null> {
    try {
      const image = await this.imageGen.generatePng(prompt);
      if (!image) return null;
      const verdict = await this.visualSafety.classify(image.data, image.mimeType, {
        topic,
        ageBand,
        episodeId,
        sceneIndex,
      });
      if (!verdict.safe) {
        console.warn(
          `[SceneImageAgent] episode=${episodeId} scene=${sceneIndex} UNSAFE image (categories: ${verdict.categories.join(", ")}) — discarding`,
        );
        return null;
      }
      return image;
    } catch (err) {
      console.warn(
        `[SceneImageAgent] episode=${episodeId} scene=${sceneIndex} generation attempt failed: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }
}
