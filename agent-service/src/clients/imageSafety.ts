/**
 * Visual-asset safety gate — Gemini multimodal classification of generated
 * scene images.
 *
 * Gate semantics ported from agent-service/legacy-reference/visualSafetyGate.ts
 * and visualAssetSafetyClient.ts:
 *   - NEVER fail-closed on classifier infrastructure errors → fall back to
 *     `safe:true` with `error` set (the orchestrator's placeholder fallback is
 *     the curated-asset equivalent).
 *   - Hard-fail verdicts ONLY come from a positive Gemini classification.
 *   - MIME sniffing via magic bytes (detectMime, verbatim port).
 *
 * The legacy remote classifier endpoint was replaced by a direct Vertex
 * Gemini multimodal call (Google-only runtime mandate).
 */

import { GoogleAuth } from "google-auth-library";
import { buildVertexUrl, getThinkingPayload } from "../legacy/vertexRouting.js";
import {
  VISUAL_SAFETY_SYSTEM_PROMPT,
  VISUAL_SAFETY_RESPONSE_SCHEMA,
} from "../legacy/scenePromptTemplate.js";
import type { VisualSafetyClassifier, VisualSafetyVerdict } from "./interfaces.js";

/** Ported verbatim from visualSafetyGate.ts. */
export function detectMime(bytes: Buffer): "image/png" | "image/jpeg" | "image/webp" {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return "image/png";
}

export class VisualAssetUnsafeError extends Error {
  constructor(
    public readonly categories: string[],
    public readonly reasons: string[],
    public readonly sceneIndex: number,
  ) {
    super(`UNSAFE_VISUAL_ASSET scene=${sceneIndex} categories=${categories.join(",")}`);
    this.name = "VisualAssetUnsafeError";
  }
}

const SAFE_FALLBACK = (error: string): VisualSafetyVerdict => ({
  safe: true,
  reasons: [`classifier_${error}`],
  categories: [],
  soft_categories: [],
  error,
});

export class GeminiVisualSafetyClassifier implements VisualSafetyClassifier {
  constructor(
    private readonly auth: GoogleAuth,
    private readonly projectId: string,
    private readonly region: string,
    private readonly model: string,
    private readonly enabled: boolean,
  ) {}

  async classify(
    imageBytes: Buffer,
    mimeHint: string,
    context: { topic: string; ageBand: number; episodeId: string; sceneIndex: number },
  ): Promise<VisualSafetyVerdict> {
    if (!this.enabled) return SAFE_FALLBACK("disabled");

    const mime =
      mimeHint === "image/png" || mimeHint === "image/jpeg" || mimeHint === "image/webp"
        ? mimeHint
        : detectMime(imageBytes);

    try {
      const token = await this.auth.getAccessToken();
      if (!token) return SAFE_FALLBACK("auth_failed");
      const endpoint = buildVertexUrl(this.model, this.projectId, this.region, true, ":generateContent");
      const thinkingCfg = getThinkingPayload(this.model);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      let resp: Response;
      try {
        resp = await fetch(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: `Classify this generated scene image for a children's episode. Topic: "${context.topic}". Audience age: ${context.ageBand}.`,
                  },
                  { inlineData: { mimeType: mime, data: imageBytes.toString("base64") } },
                ],
              },
            ],
            systemInstruction: { parts: [{ text: VISUAL_SAFETY_SYSTEM_PROMPT }] },
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: VISUAL_SAFETY_RESPONSE_SCHEMA,
              temperature: 0,
              maxOutputTokens: 1024,
              ...(thinkingCfg ? { thinkingConfig: thinkingCfg } : {}),
            },
          }),
        });
      } finally {
        clearTimeout(timer);
      }

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        console.warn(
          `[visual-safety] HTTP ${resp.status} for episode=${context.episodeId} scene=${context.sceneIndex}: ${body.substring(0, 200)}`,
        );
        return SAFE_FALLBACK(`http_${resp.status}`);
      }

      const json = (await resp.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      if (!text) return SAFE_FALLBACK("empty_response");

      const verdict = JSON.parse(text) as Partial<VisualSafetyVerdict>;
      if (typeof verdict.safe !== "boolean" || !Array.isArray(verdict.categories) || !Array.isArray(verdict.reasons)) {
        return SAFE_FALLBACK("bad_shape");
      }
      return {
        safe: verdict.safe,
        reasons: verdict.reasons,
        categories: verdict.categories,
        soft_categories: Array.isArray(verdict.soft_categories) ? verdict.soft_categories : [],
      };
    } catch (e) {
      console.warn(
        `[visual-safety] classifier error for episode=${context.episodeId} scene=${context.sceneIndex}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return SAFE_FALLBACK("network_error");
    }
  }
}
