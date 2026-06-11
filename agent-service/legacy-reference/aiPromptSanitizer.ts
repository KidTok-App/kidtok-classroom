/**
 * AI Prompt Sanitizer
 *
 * Vertex Gemini–powered prompt rewriter used by BOTH:
 *
 *   1. The Dev Panel "Generate (AI-sanitized prompt)" test action — proactive
 *      rewrite of the raw prompt BEFORE the first Veo/Imagen call so a dev
 *      user can compare raw-vs-sanitized output quality side-by-side.
 *
 *   2. The production safety-fallback chain in `veoClient.ts` and
 *      `imageProviderClient.ts` — REACTIVE rewrite that fires only after a
 *      raw generation attempt failed under the existing safety-failure
 *      condition (`VeoSafetyBlockError` for Veo; any thrown error for the
 *      image provider). The original two deterministic sanitizers
 *      (`simplifyVeoPromptForRetry`, `buildImagePromptForAttempt`) remain
 *      in place as the LAST-RESORT extreme fallback if this Gemini rewrite
 *      also fails. See mem://architecture/ai-asset-generation-pipeline-failure-modes.
 *
 * The Gemini rewrite:
 *   - Removes wording that trips Vertex RAI safety classifiers (people-noun
 *     phrasing, body parts, depictions of children, etc.).
 *   - Preserves the lesson's visual intent (topic, style, motion, palette).
 *   - Returns the rewritten prompt + the list of concepts the model removed.
 *
 * Built on the SAME infrastructure `assetPromptPlanner.ts` already uses
 * (`getGeminiAccessToken()` reading `GOOGLE_SERVICE_ACCOUNT_GEMINI_JSON`
 *  + Vertex `gemini-2.5-flash` + structured output) — extending the existing
 * AI module surface rather than introducing a new dependency or HTTP client.
 *
 * The Dev Panel test path bypasses the `ENABLE_VIDEO_COST_SAVINGS` gate
 * intentionally (proactive comparison). The production reactive path
 * RESPECTS that gate via the Veo retry-loop collapse — when cost savings is
 * on, the loop runs a single attempt and never invokes this rewriter.
 */

import { getGeminiAccessToken } from '../../lib/googleAuth.js';
import { resolveModel } from '../../lib/vertexRouting.js';
import { logger, type LogContext } from '../../logger.js';

/**
 * Standalone union of the asset-type labels recognized by this sanitizer.
 *
 * Mirrors the seven keys in `ASSET_TYPE_GUIDANCE` below. Exported so
 * production callers (`veoClient`, `imageProviderClient`) can narrow their
 * `assetTypeForStats` strings to this union without importing
 * `TestAiAssetJobPayload` from the test-only `asset/types.ts` module.
 *
 * Kept structurally identical to `TestAiAssetJobPayload['asset_type']`
 * (which itself enumerates the same seven labels), so the existing test
 * caller (`testAiAssetProcessor.ts`) continues to type-check unchanged.
 */
export type AiAssetType =
  | 'loop'
  | 'motif'
  | 'background'
  | 'character_overlay'
  | 'character_animation'
  | 'scene_object_overlay'
  | 'scene_object_animation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SanitizeAiPromptResult {
  /** Rewritten prompt safe to send to Veo / Imagen. Always non-empty. */
  sanitized_prompt: string;
  /** True when the sanitizer changed any wording vs the input. */
  was_changed: boolean;
  /**
   * Model-reported list of concepts the sanitizer removed or rephrased
   * (e.g. ["child holding hand", "girl smiling", "close-up of face"]).
   * Surfaced in the worker log so dev users can see what changed.
   */
  removed_concepts: string[];
  /** Wall-clock latency of the Vertex Gemini call in ms. */
  gemini_ms: number;
}

/**
 * Thrown when the Gemini sanitizer fails (network, timeout, HTTP error,
 * malformed JSON, missing fields). Caught by the test processor and surfaced
 * to the Dev Panel UI as a clean toast — the raw button remains usable.
 */
export class AiPromptSanitizationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'AiPromptSanitizationError';
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 20_000;

/**
 * Per-asset-type guidance appended to the sanitizer system prompt so the
 * rewrite preserves length and tone appropriate to the downstream generator.
 *
 *   - Image asset types (background, character_overlay, scene_object_overlay)
 *     allow longer, more visually-detailed descriptions.
 *   - Video asset types (loop, motif, character_animation, scene_object_animation)
 *     require shorter, motion-focused descriptions because Veo prompts have
 *     stricter length sweet-spots and the Veo safety classifier reacts more
 *     aggressively to people-noun phrasing.
 */
const ASSET_TYPE_GUIDANCE: Record<AiAssetType, string> = {
  loop: 'Target asset: a 6–8 second seamless ambient background loop video. Keep the rewrite focused on abstract motion, drifting particles, color shifts, and atmosphere. NEVER include people, characters, faces, hands, or anatomical details.',
  motif: 'Target asset: a short 2D particle / accent video overlay. Keep the rewrite focused on abstract shapes, sparkles, energy bursts, or topic-themed icons drifting across the frame. NEVER include people.',
  background: 'Target asset: a static illustrated background image (no characters). Keep the rewrite focused on environment, setting, props, and atmospheric details. NEVER include people, characters, or faces.',
  character_overlay: 'Target asset: a single friendly cartoon mascot character on a clean background. Allow stylized cartoon character description (mascot, animal, magical creature, or anthropomorphic object). AVOID realistic human depictions, photorealism, real children, faces with detailed features, or anatomical body parts.',
  character_animation:
    'Target asset: a short 2–4 second video of a stylized cartoon mascot performing a SIMPLE, GENTLE idle motion. ' +
    'Allow cartoon character description tied to the lesson. AVOID realistic humans, real children, photorealistic faces, or anatomical detail. ' +
    'Focus the rewrite on the motion verb and the cartoon style. ' +
    'CRITICAL ACTION-VERB SCRUBBING (Veo safety classifier reacts strongly to high-energy, contact, or impact verbs even on cartoon mascots — ' +
    'see incident 2026-05-04 idle-shutdown / character-animation safety-block exhaustion): ' +
    'REPLACE high-risk verbs — "run", "running", "chase", "chasing", "jump on", "hit", "punch", "kick", "smash", "crash", "throw", "throwing", ' +
    '"grab", "grabbing", "hold", "holding", "fight", "shoot", "shooting", "blast", "explode", "fall", "falling", "trip", "scream", "cry", "fear", "scared" — ' +
    'with CALM mood-based motion: "gentle sway", "soft bob", "slow drift", "calm float", "gentle nod", "slight tilt", "soft glow pulse", ' +
    '"calm wave", "slow spin", "gentle bounce in place", "soft idle breathing motion". ' +
    'PREFER stationary or low-amplitude motion verbs over locomotion. NEVER describe the mascot interacting with another character, ' +
    'NEVER describe contact with objects (no "touching", "holding", "grabbing", "carrying"), and NEVER describe distress emotions.',
  scene_object_overlay: 'Target asset: a single illustrated prop or sticker (lesson-relevant object) on a clean background. NEVER include people, characters, hands holding the object, or faces.',
  scene_object_animation: 'Target asset: a short 2–4 second video of a single prop performing a simple animation (rotate, bounce, glow). NEVER include people, hands, or characters interacting with the prop.',
};

const SYSTEM_PROMPT_BASE = `You are a prompt-safety rewriter for a children's educational video platform that generates assets via Google Vertex AI (Veo for video, Imagen / Gemini for images).

Your job: take a production-built generation prompt that Google's safety filters are likely to reject, and rewrite it into a SAFE prompt that:
  1. PRESERVES the lesson topic, visual style, color palette, motion description, and overall composition intent.
  2. REMOVES or REPHRASES wording that commonly trips Vertex RAI safety classifiers:
     - People-noun phrasing ("child", "kid", "boy", "girl", "person", "adult", "teacher", "parent").
     - Body-part references (faces, hands, eyes, smiling, holding).
     - Anything that could read as a depiction of a real human child.
     - Realistic / photographic / photorealistic descriptors when applied to human-like figures.
  3. KEEPS the prompt the same approximate LENGTH and STYLE as the input (do not shorten dramatically — the goal is comparison, not collapse).
  4. KEEPS scene composition details: camera framing, aspect ratio mentions, technical Veo / Imagen directives (safety prefix, audio_clause, etc.).

Replacement strategy:
  - Replace people nouns with abstract substitutes that fit the lesson topic
    (e.g. "a friendly cartoon mascot", "a glowing shape", "an animated icon").
  - Replace body-part references with "no characters, abstract shapes only" guidance.
  - Replace realistic-style adjectives with "stylized cartoon, flat illustration".
  - PRESERVE all directives, prefixes, suffixes, and technical instructions verbatim.

Return JSON with these exact fields:
  - sanitized_prompt (string): the rewritten prompt, ready to send to Vertex.
  - removed_concepts (string[]): short labels for each concept removed or rephrased
    (e.g. ["child holding hand", "smiling face", "photorealistic boy"]).
    Empty array when nothing needed changing.
  - was_changed (boolean): true when sanitized_prompt differs meaningfully from the input.

If the input prompt is ALREADY safe, return it unchanged with was_changed=false and removed_concepts=[].`;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Rewrite `rawPrompt` into a safety-friendly version via Vertex Gemini.
 * Throws `AiPromptSanitizationError` on any failure — caller surfaces the
 * error message in the UI and leaves the original `effective_prompt`
 * untouched so the dev user can see exactly where the sanitizer broke.
 */
export async function sanitizeAiPromptViaGemini(
  rawPrompt: string,
  assetType: AiAssetType,
  context: LogContext,
): Promise<SanitizeAiPromptResult> {
  if (typeof rawPrompt !== 'string' || rawPrompt.trim().length === 0) {
    throw new AiPromptSanitizationError('AI_PROMPT_SANITIZER_EMPTY_INPUT: rawPrompt is empty');
  }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  if (!projectId) {
    throw new AiPromptSanitizationError(
      'AI_PROMPT_SANITIZER_CONFIG_MISSING: GOOGLE_CLOUD_PROJECT_ID is not set',
    );
  }

  const systemInstruction = `${SYSTEM_PROMPT_BASE}\n\n${ASSET_TYPE_GUIDANCE[assetType]}`;

  const geminiModel = resolveModel({ role: 'prompt-builder' });

  // Vertex routing — we pin to the same us-central1 endpoint the asset
  // prompt planner uses (this is the proven path for Lyria-account Gemini
  // calls in this worker; expanding to multi-region failover is out of scope
  // for a Dev-Panel-only test action).
  const endpoint =
    `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}` +
    `/locations/us-central1/publishers/google/models/${geminiModel}:generateContent`;

  const startMs = Date.now();
  let accessToken: string;
  try {
    accessToken = await getGeminiAccessToken();
  } catch (err) {
    throw new AiPromptSanitizationError(
      `AI_PROMPT_SANITIZER_AUTH_FAILED: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Rewrite this prompt to pass Vertex RAI safety filters. Asset type: ${assetType}.\n\n=== ORIGINAL PROMPT ===\n${rawPrompt}\n=== END ORIGINAL PROMPT ===`,
              },
            ],
          },
        ],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              sanitized_prompt: { type: 'STRING' },
              removed_concepts: { type: 'ARRAY', items: { type: 'STRING' } },
              was_changed: { type: 'BOOLEAN' },
            },
            required: ['sanitized_prompt', 'removed_concepts', 'was_changed'],
          },
          temperature: 0.2,
          // Allow enough room for full rewrite of the longest production
          // prompts (current scaffolds top out around ~1500 tokens; 4096
          // gives generous headroom for any rewrite + the JSON envelope).
          maxOutputTokens: 4096,
        },
        // BLOCK_NONE matches assetPromptPlanner.ts — this Gemini call
        // analyses prompt text, not generated media, so RAI restrictions
        // would only cause spurious failures here.
        safetySettings: [
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        ],
      }),
    });
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('abort')) {
      throw new AiPromptSanitizationError(
        `AI_PROMPT_SANITIZER_TIMEOUT: Vertex Gemini did not respond within ${TIMEOUT_MS}ms`,
      );
    }
    throw new AiPromptSanitizationError(`AI_PROMPT_SANITIZER_FETCH_FAILED: ${msg}`, err);
  }
  clearTimeout(timeout);

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new AiPromptSanitizationError(
      `AI_PROMPT_SANITIZER_HTTP_${response.status}: ${errText.substring(0, 300)}`,
    );
  }

  let parsed: {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
  };
  try {
    parsed = (await response.json()) as typeof parsed;
  } catch (err) {
    throw new AiPromptSanitizationError(
      `AI_PROMPT_SANITIZER_RESPONSE_PARSE_FAILED: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text || text.trim().length === 0) {
    const finishReason = parsed?.candidates?.[0]?.finishReason ?? 'unknown';
    throw new AiPromptSanitizationError(
      `AI_PROMPT_SANITIZER_EMPTY_RESPONSE: finishReason=${finishReason}`,
    );
  }

  let payload: { sanitized_prompt?: unknown; removed_concepts?: unknown; was_changed?: unknown };
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch (err) {
    throw new AiPromptSanitizationError(
      `AI_PROMPT_SANITIZER_JSON_PARSE_FAILED: ${err instanceof Error ? err.message : String(err)} (text head=${text.substring(0, 200)})`,
      err,
    );
  }

  const sanitizedPrompt =
    typeof payload.sanitized_prompt === 'string' ? payload.sanitized_prompt.trim() : '';
  if (sanitizedPrompt.length === 0) {
    throw new AiPromptSanitizationError(
      'AI_PROMPT_SANITIZER_INVALID_PAYLOAD: sanitized_prompt missing or empty',
    );
  }

  const removedConcepts: string[] = Array.isArray(payload.removed_concepts)
    ? (payload.removed_concepts.filter((x) => typeof x === 'string' && x.trim().length > 0) as string[])
    : [];

  // Trust the model's was_changed flag, but fall back to a string compare so
  // a buggy/false negative still gets reflected accurately downstream.
  const modelSaysChanged = payload.was_changed === true;
  const stringDiffers = sanitizedPrompt !== rawPrompt.trim();
  const wasChanged = modelSaysChanged || stringDiffers;

  const geminiMs = Date.now() - startMs;

  logger.info('AI_PROMPT_SANITIZED', {
    ...context,
    asset_type: assetType,
    original_chars: rawPrompt.length,
    sanitized_chars: sanitizedPrompt.length,
    removed_chars: rawPrompt.length - sanitizedPrompt.length,
    was_changed: wasChanged,
    removed_concept_count: removedConcepts.length,
    removed_concepts_head: removedConcepts.slice(0, 8),
    gemini_ms: geminiMs,
  });

  return {
    sanitized_prompt: sanitizedPrompt,
    was_changed: wasChanged,
    removed_concepts: removedConcepts,
    gemini_ms: geminiMs,
  };
}
