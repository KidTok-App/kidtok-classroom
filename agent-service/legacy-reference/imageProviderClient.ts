/**
 * Centralized Image Provider Client for AI Asset Generation
 *
 * Houses BOTH image-generation methods used by the worker for image asset
 * types (background, character_overlay, scene_object_overlay):
 *   - 'vertex_gemini' (default) — gemini-2.5-flash-image via :generateContent
 *   - 'vertex_imagen'           — imagen-3.0-generate-002 via :predict
 *
 * Both methods share the proven Topic Pages reliability pattern:
 *   - 7-region rotation chain
 *   - Sticky region index per provider
 *   - 429 in regional → return "rate_limited" immediately so caller rotates
 *   - Global fallback (us-central1) with [10s,30s,60s] backoff, honors Retry-After
 *   - Region outcome logging to topic_image_region_stats (worker_* tags)
 *
 * Both providers authenticate via GOOGLE_SERVICE_ACCOUNT_IMAGEN_JSON, the
 * same service account used by the Topic Pages edge function. (Veo continues
 * to use GOOGLE_SERVICE_ACCOUNT_VEO_JSON in veoClient.ts — untouched.)
 */

import { getImagenAccessToken } from '../../lib/googleAuth.js';
import { logger, type LogContext } from '../../logger.js';
import { getSupabaseClient } from '../../supabaseClient.js';
import {
  buildVertexUrl,
  buildVertexFlexHeaders,
  getModelPolicy,
  getThinkingPayload,
  isFlexEligible,
  isFlexTrafficResponse,
} from '../../lib/vertexRouting.js';
import { estimateImageCost, type ImageResolution } from '../../lib/vertexCost.js';
import type { GeneratedAsset, GenerateImageOptions } from './veoClient.js';
import {
  sanitizeAiPromptViaGemini,
  AiPromptSanitizationError,
  type AiAssetType,
} from './aiPromptSanitizer.js';
import {
  resolveAiRetryConfigAndLog,
  type AiRetryImageAssetType,
  type AiRetryStage,
} from '../../lib/resolveAiRetryConfig.js';

/**
 * Image-asset-type labels for which the Gemini-rewrite production fallback
 * fires. Mirrors the keys recognized by `sanitizeAiPromptViaGemini`. Image
 * callers pass one of `background | character_overlay | scene_object_overlay`
 * via `options.assetTypeForStats`. When the label is missing or
 * unrecognized (defensive), the Gemini step is skipped and we go directly
 * to the legacy topic-only `buildImagePromptForAttempt(...,2)` extreme
 * fallback so an in-flight render is never blocked by a missing label.
 */
const IMAGE_GEMINI_REWRITE_ASSET_TYPES: ReadonlySet<AiAssetType> = new Set([
  'background',
  'character_overlay',
  'scene_object_overlay',
]);

/**
 * Detects errors that mean "the upstream Vertex AI provider is unavailable
 * across every region we know about" — there is no point burning the next
 * retry stage (Gemini rewrite, extreme-sanitized) because they hit the same
 * endpoints with the same outcome. When this fires, the retry ladder
 * short-circuits and the caller's curated-asset fallback takes over.
 *
 * Today this covers two failure modes:
 *   - `Vertex Gemini exhausted all regions and global fallback (...)`
 *   - `Vertex Imagen exhausted all regions and global fallback (...)`
 *   - `AI_PROMPT_SANITIZER_TIMEOUT: Vertex Gemini did not respond within …`
 *     (the Gemini rewrite stage's own outage signal; if that times out the
 *     subsequent extreme-sanitized stage is still useful, so this is logged
 *     but not enough on its own to abandon the ladder — only the "exhausted
 *     all regions" messages trigger short-circuit.)
 */
export function isVertexUpstreamOutageError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  if (!msg) return false;
  return /exhausted all regions and global fallback/i.test(msg);
}

// ---------------------------------------------------------------------------
// Provider type
//
// Supports 6 explicit model IDs + 2 legacy aliases. Aliases resolve to a
// concrete model ID via resolveProviderModel() so the dispatch layer can
// always work with one of the 6 explicit IDs.
//
// MUST stay mirrored with: supabase/functions/render-config/index.ts validator
// and src/components/dev-panel/tabs/AIPipelineTab.tsx ImageProvider union + Selects.
// ---------------------------------------------------------------------------

export type ImageProvider =
  // Legacy aliases (backward-compatible with existing render_runtime_config values)
  | 'vertex_gemini'
  | 'vertex_imagen'
  // Imagen 4 family (Vertex AI, GA)
  | 'imagen-4.0-fast-generate-001'
  | 'imagen-4.0-generate-001'
  | 'imagen-4.0-ultra-generate-001'
  // Gemini Nano Banana family
  | 'gemini-2.5-flash-image'
  | 'gemini-3.1-flash-image-preview'
  | 'gemini-3-pro-image-preview';

export const DEFAULT_IMAGE_PROVIDER: ImageProvider = 'vertex_gemini';

/**
 * Returns the underlying family for an image provider — either 'imagen' (uses
 * Vertex Imagen :predict body shape) or 'gemini' (uses Vertex Gemini
 * :generateContent body shape). Both legacy aliases and new explicit model IDs
 * route through here so the dispatch layer never needs to know about aliases.
 */
function resolveProviderFamily(provider: ImageProvider): 'imagen' | 'gemini' {
  switch (provider) {
    case 'vertex_imagen':
    case 'imagen-4.0-fast-generate-001':
    case 'imagen-4.0-generate-001':
    case 'imagen-4.0-ultra-generate-001':
      return 'imagen';
    case 'vertex_gemini':
    case 'gemini-2.5-flash-image':
    case 'gemini-3.1-flash-image-preview':
    case 'gemini-3-pro-image-preview':
      return 'gemini';
  }
}

/**
 * Resolves a provider value to the concrete model ID used in the Vertex AI
 * publisher URL. Legacy aliases are mapped to their current default model:
 *   - vertex_imagen → imagen-4.0-generate-001  (was imagen-3.0-generate-002 — upgraded)
 *   - vertex_gemini → gemini-2.5-flash-image
 */
function resolveProviderModel(provider: ImageProvider): string {
  switch (provider) {
    case 'vertex_imagen':
      return 'imagen-4.0-generate-001';
    case 'vertex_gemini':
      return 'gemini-2.5-flash-image';
    default:
      return provider;
  }
}

// ---------------------------------------------------------------------------
// Auth (delegated to lib/googleAuth.ts — shared per-SA token cache so multi-
// image Imagen batches and parallel Gemini image calls reuse one OAuth token
// instead of re-minting per request).
// ---------------------------------------------------------------------------

function getImagenProjectId(): string {
  return getImagenAccessToken.getProjectId();
}

async function mintImagenAccessToken(): Promise<string> {
  return getImagenAccessToken();
}

// ---------------------------------------------------------------------------
// Region rotation (mirrors Topic Pages 1:1)
// ---------------------------------------------------------------------------

const VERTEX_REGIONS = [
  'us-central1',
  'us-east4',
  'us-west1',
  'europe-west1',
  'europe-west4',
  'asia-northeast1',
  'asia-southeast1',
];

// Module-scoped sticky indices: persist across sequential image generations
// in one render job, dramatically reducing 429s on multi-asset renders.
let _stickyGeminiRegionIndex = 0;
let _stickyImagenRegionIndex = 0;

const BACKOFF_SCHEDULE_MS = [10_000, 30_000, 60_000];

// ---------------------------------------------------------------------------
// Region outcome logging (fire-and-forget)
// ---------------------------------------------------------------------------

async function logRegionOutcome(
  region: string,
  provider: 'worker_vertex_gemini' | 'worker_vertex_imagen',
  outcome: 'success' | 'rate_limited' | 'error',
  slug: string | undefined,
  latencyMs: number,
  costMeta?: {
    model?: string;
    assetType?: string;
    costUsd?: number | null;
  },
): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('topic_image_region_stats').insert({
      region,
      provider,
      outcome,
      slug: slug ?? null,
      latency_ms: Math.round(latencyMs),
      model: costMeta?.model ?? null,
      asset_type: costMeta?.assetType ?? null,
      cost_usd: costMeta?.costUsd ?? null,
    });
    if (error) {
      // Non-blocking; logged at debug
      logger.debug('REGION_STATS_INSERT_FAILED', { error: error.message, region, provider });
    }
  } catch (e) {
    logger.debug('REGION_STATS_LOG_ERROR', { error: e instanceof Error ? e.message : String(e) });
  }
}

// ---------------------------------------------------------------------------
// Prompt sanitization (Imagen-only safety; Gemini uses BLOCK_ONLY_HIGH).
//
// Per Google's Nano Banana prompting guide, models respond best to POSITIVE
// FRAMING ("abstract shapes only") rather than negation ("no people"). The
// previous broad PEOPLE_PATTERNS set fought the model by leaving negation-
// shaped holes. We now keep a much narrower regex that only strips obvious
// people-noun mentions (Imagen's safety filter rejects these regardless),
// and inject a positive-framing directive when stripping occurs so the
// model has clear constructive guidance instead of a hole.
// ---------------------------------------------------------------------------

const PEOPLE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(adult|woman|man|girl|boy|teacher|parent|baby|toddler|infant)\b/gi, ''],
  [/\b(child|kid|person)\s+(holding|looking at|reading|playing with|sitting|standing|watching|helping|teaching|learning)\b/gi, ''],
  [/\b(holding hands|smiling faces?|facial expression|portrait|close-?up of face|looking at camera)\b/gi, ''],
];

/** Positive-framing directive injected when sanitization removed people refs. */
const POSITIVE_FRAMING_DIRECTIVE =
  'Compose the scene with only abstract shapes, props, and environmental elements — no characters, no figures.';

export interface SanitizeResult {
  text: string;
  wasSanitized: boolean;
  removedPatterns: string[];
}

export function sanitizeImagePrompt(description: string): SanitizeResult {
  let text = description;
  const removedPatterns: string[] = [];

  for (const [pattern, replacement] of PEOPLE_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      removedPatterns.push(...matches.map((m) => m.trim()).filter(Boolean));
      text = text.replace(pattern, replacement);
    }
  }

  text = text.replace(/\s{2,}/g, ' ').replace(/,\s*,/g, ',').replace(/\.\s*\./g, '.').trim();
  text = text.replace(/^[,.\s]+/, '').replace(/[,.\s]+$/, '').trim();

  // Positive framing: when we stripped people refs, replace the resulting
  // semantic hole with constructive guidance the model can render against.
  if (removedPatterns.length > 0) {
    text = `${text} ${POSITIVE_FRAMING_DIRECTIVE}`.trim();
  }

  return {
    text,
    wasSanitized: removedPatterns.length > 0,
    removedPatterns: [...new Set(removedPatterns)],
  };
}

/**
 * Progressive simplification on retry — same anti-safety-rejection strategy
 * that fixed Topic Pages. Topic argument lets us fall back to a minimal
 * topic-only prompt if the original keeps failing.
 */
export function buildImagePromptForAttempt(sanitized: string, topic: string, attempt: number): string {
  switch (attempt) {
    case 0:
      return sanitized;
    case 1: {
      const simplified = sanitized
        .replace(/\b(beautiful|warm|cozy|lovely|stunning|gorgeous|vibrant|colorful|bright|cheerful|delightful|magnificent)\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      return simplified;
    }
    case 2:
      return `An educational scene about ${topic.toLowerCase()}. Objects and materials related to the topic arranged neatly. Child-safe cartoon illustration.`;
    default:
      return `A simple, calm scene representing ${topic.toLowerCase()}. Child-safe cartoon illustration.`;
  }
}

// ---------------------------------------------------------------------------
// Vertex AI Imagen — single-region request (parameterized model)
// ---------------------------------------------------------------------------

// Legacy constants kept for reference / external import compatibility.
// Active dispatch routes through resolveProviderModel().
const IMAGEN_MODEL = 'imagen-4.0-generate-001';
const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';

/**
 * Build the `generationConfig.imageConfig` payload for a Vertex Gemini
 * `*-image` model :generateContent call.
 *
 * Vertex Nano Banana accepts:
 *   - `aspectRatio`  — e.g. '9:16', '1:1', '16:9'
 *   - `imageSize`    — '512' | '1K' | '2K' | '4K' (snaps to the model's
 *                       native grid for the chosen aspect; e.g. 9:16 @ 1K
 *                       resolves to 768×1344, NOT a free pixel pair).
 *
 * The helper canonicalizes the resolution token (`'1k'` → `'1K'`, `'512'`
 * stays numeric) and is exported so unit tests can pin the request shape
 * without spinning up a fake Vertex endpoint. Returning an empty object is
 * intentional — `geminiImageRequestRegional` only includes `imageConfig` in
 * the body when at least one field is set, preserving prior behavior for
 * callers that pass neither knob.
 */
export function buildGeminiImageConfig(opts: {
  aspectRatio?: string;
  imageResolution?: '512' | '1k' | '2k';
}): Record<string, string> {
  const out: Record<string, string> = {};
  if (opts.aspectRatio) out.aspectRatio = opts.aspectRatio;
  if (opts.imageResolution) {
    out.imageSize = opts.imageResolution === '512' ? '512' : opts.imageResolution.toUpperCase();
  }
  return out;
}

// One-shot warn flag — emit `VERTEX_FLEX_NOT_SUPPORTED_FOR_MODEL` at most once
// per Imagen model per worker process. Mirrors the silent-strip pattern used
// in veoClient.ts for `imageResolution` / `useFlexTier` on incompatible Veo
// models. Imagen :predict is NOT on the Vertex Flex PayGo supported-models
// list per https://cloud.google.com/vertex-ai/generative-ai/docs/flex-paygo.
const _imagenFlexWarnedFor = new Set<string>();

async function imagenRequestRegional(
  prompt: string,
  region: string,
  isGlobal: boolean,
  width: number,
  height: number,
  options: GenerateImageOptions,
  model: string = IMAGEN_MODEL,
): Promise<{ data: Buffer; mimeType: string } | null | 'rate_limited'> {
  const projectId = getImagenProjectId();
  // Imagen :predict is NOT a Vertex Flex PayGo supported model. Silently
  // strip the flag to standard tier and warn once per model. `isFlexEligible`
  // already returns false for all Imagen IDs in vertexRouting.ts; this guard
  // surfaces the strip in logs so cost telemetry matches reality.
  if (options.useFlexTier && !isFlexEligible(model) && !_imagenFlexWarnedFor.has(model)) {
    _imagenFlexWarnedFor.add(model);
    logger.warn('VERTEX_FLEX_NOT_SUPPORTED_FOR_MODEL', { model, family: 'imagen' });
  }
  const useFlex = false;
  const endpoint = buildVertexUrl(model, projectId, region, isGlobal, ':predict', useFlex);

  const MAX_INTERNAL_RETRIES = isGlobal ? 3 : 0;

  for (let retry = 0; retry <= MAX_INTERNAL_RETRIES; retry++) {
    try {
      const token = await mintImagenAccessToken();

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: {
            sampleCount: options.sampleCount ?? 1,
            aspectRatio: options.aspectRatio ?? '9:16',
            outputOptions: { mimeType: 'image/png' },
            // Match Topic Pages: most permissive safety
            safetyFilterLevel: 'block_only_high',
          },
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        const is429 = resp.status === 429 || errText.includes('RESOURCE_EXHAUSTED');

        if (is429) {
          if (!isGlobal) return 'rate_limited';
          if (retry < MAX_INTERNAL_RETRIES) {
            const retryAfterHeader = resp.headers.get('Retry-After');
            const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 0;
            const scheduled = BACKOFF_SCHEDULE_MS[Math.min(retry, BACKOFF_SCHEDULE_MS.length - 1)];
            const backoff = Math.max(retryAfterMs || 0, scheduled);
            await new Promise((r) => setTimeout(r, backoff));
            continue;
          }
          return 'rate_limited';
        }

        logger.warn('IMAGEN_API_ERROR', { region, status: resp.status, body_snippet: errText.substring(0, 300), width, height });
        return null;
      }

      const result = (await resp.json()) as {
        predictions?: Array<{ bytesBase64Encoded: string; mimeType?: string }>;
      };

      if (!result.predictions || result.predictions.length === 0) {
        logger.warn('IMAGEN_NO_PREDICTIONS', { region, possible_safety_block: true });
        return null;
      }

      const prediction = result.predictions[0];
      return {
        data: Buffer.from(prediction.bytesBase64Encoded, 'base64'),
        mimeType: prediction.mimeType || 'image/png',
      };
    } catch (e) {
      if (isGlobal && retry < MAX_INTERNAL_RETRIES) {
        const backoff = BACKOFF_SCHEDULE_MS[Math.min(retry, BACKOFF_SCHEDULE_MS.length - 1)];
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      logger.warn('IMAGEN_REQUEST_EXCEPTION', { region, error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Vertex AI Gemini — single-region request
// ---------------------------------------------------------------------------

/**
 * Outcome of one Gemini :generateContent call. `flex_unavailable` is a
 * dedicated terminal value used ONLY when Vertex Flex PayGo headers were
 * sent and the server returned 503 (sheddable capacity exhausted) — the
 * caller is expected to client-side fall back by retrying without flex
 * headers, since Vertex Flex PayGo has NO server-side fallback.
 *
 * `flexServed` distinguishes "asked for flex AND got flex" from
 * "asked for flex, silently served by standard" so cost telemetry can
 * stay accurate. Only set on success.
 */
type GeminiImageOutcome =
  | { data: Buffer; mimeType: string; flexServed: boolean }
  | null
  | 'rate_limited'
  | 'flex_unavailable';

async function geminiImageRequestRegional(
  prompt: string,
  region: string,
  isGlobal: boolean,
  model: string = GEMINI_IMAGE_MODEL,
  options?: { aspectRatio?: string; imageResolution?: '512' | '1k' | '2k'; useFlexTier?: boolean },
): Promise<GeminiImageOutcome> {
  const projectId = getImagenProjectId();
  // Vertex Flex PayGo is GLOBAL-endpoint-only (per
  // https://cloud.google.com/vertex-ai/generative-ai/docs/flex-paygo) and
  // gated to the official supported-models list (`isFlexEligible`).
  // Triple-gate so flex headers are never sent on an ineligible call.
  const flexRequested =
    !!options?.useFlexTier && isFlexEligible(model) && isGlobal;
  // useFlexTier on buildVertexUrl is a no-op (legacy parameter) — flex is
  // expressed via headers below, not the URL.
  const endpoint = buildVertexUrl(model, projectId, region, isGlobal, ':generateContent');
  const thinkingCfg = getThinkingPayload(model);

  // Per Vertex Nano Banana docs, image params live under generationConfig.imageConfig
  // for Gemini *-image models. Older `gemini-2.5-flash-image` accepts the same
  // shape; unknown fields are ignored. `imageSize` accepts '512', '1K', '2K', '4K'.
  const imageConfig = buildGeminiImageConfig({
    aspectRatio: options?.aspectRatio,
    imageResolution: options?.imageResolution,
  });
  const hasImageConfig = Object.keys(imageConfig).length > 0;

  const MAX_INTERNAL_RETRIES = isGlobal ? 3 : 0;

  for (let retry = 0; retry <= MAX_INTERNAL_RETRIES; retry++) {
    try {
      const token = await mintImagenAccessToken();

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          // Vertex AI Flex PayGo opt-in headers — sent ONLY when the call is
          // flex-eligible. Per docs the `serverTimeoutSec` hint defaults to
          // 600s; the worker's outer per-render-job timeout already provides
          // the hard client-side cap.
          ...(flexRequested ? buildVertexFlexHeaders(600) : {}),
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ['IMAGE', 'TEXT'],
            temperature: 1.0,
            ...(thinkingCfg ? { thinkingConfig: thinkingCfg } : {}),
            ...(hasImageConfig ? { imageConfig } : {}),
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
          ],
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        const is429 = resp.status === 429 || errText.includes('RESOURCE_EXHAUSTED');

        // Vertex Flex PayGo: 503 means flex capacity exhausted. Per docs
        // there is NO server-side fallback — bubble a typed signal so the
        // caller can immediately retry on standard tier.
        if (flexRequested && resp.status === 503) {
          logger.warn('VERTEX_FLEX_UNAVAILABLE', {
            region,
            model,
            status: 503,
            body_snippet: errText.substring(0, 200),
          });
          return 'flex_unavailable';
        }

        if (is429) {
          if (!isGlobal) return 'rate_limited';
          if (retry < MAX_INTERNAL_RETRIES) {
            const retryAfterHeader = resp.headers.get('Retry-After');
            const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 0;
            const scheduled = BACKOFF_SCHEDULE_MS[Math.min(retry, BACKOFF_SCHEDULE_MS.length - 1)];
            const backoff = Math.max(retryAfterMs || 0, scheduled);
            await new Promise((r) => setTimeout(r, backoff));
            continue;
          }
          return 'rate_limited';
        }

        logger.warn('GEMINI_IMAGE_API_ERROR', { region, status: resp.status, body_snippet: errText.substring(0, 300) });
        return null;
      }

      const json = await resp.json();
      const data = json as {
        candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
      };
      const parts = data.candidates?.[0]?.content?.parts;
      if (!parts || parts.length === 0) {
        logger.warn('GEMINI_IMAGE_NO_PARTS', { region });
        return null;
      }

      const imagePart = parts.find((p) => p.inlineData?.mimeType?.startsWith('image/'));
      if (!imagePart?.inlineData?.data) {
        logger.warn('GEMINI_IMAGE_NO_INLINE_DATA', { region });
        return null;
      }

      const flexServed = isFlexTrafficResponse(json);
      if (flexRequested && !flexServed) {
        // We asked for Flex but got Standard back. Per Vertex Flex PayGo
        // docs success MUST carry `usageMetadata.trafficType = "ON_DEMAND_FLEX"`
        // — anything else means the request silently fell through to standard
        // billing. Surface for telemetry; no behavior change.
        logger.info('VERTEX_FLEX_DOWNGRADED_TO_STANDARD', { region, model });
      }

      return {
        data: Buffer.from(imagePart.inlineData.data, 'base64'),
        mimeType: imagePart.inlineData.mimeType || 'image/png',
        flexServed,
      };
    } catch (e) {
      if (isGlobal && retry < MAX_INTERNAL_RETRIES) {
        const backoff = BACKOFF_SCHEDULE_MS[Math.min(retry, BACKOFF_SCHEDULE_MS.length - 1)];
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      logger.warn('GEMINI_IMAGE_REQUEST_EXCEPTION', { region, error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Multi-region wrappers
// ---------------------------------------------------------------------------

function orderedRegionsFromSticky(sticky: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < VERTEX_REGIONS.length; i++) {
    out.push(VERTEX_REGIONS[(sticky + i) % VERTEX_REGIONS.length]);
  }
  return out;
}

export async function generateImageViaVertexImagen(
  prompt: string,
  width: number,
  height: number,
  options: GenerateImageOptions,
  context?: LogContext,
  slugForStats?: string,
  model: string = IMAGEN_MODEL,
): Promise<GeneratedAsset> {
  const policy = getModelPolicy(model);
  const useFlex = !!options.useFlexTier && isFlexEligible(model);
  const costMetaSuccess = {
    model,
    assetType: options.assetTypeForStats,
    costUsd: estimateImageCost(model, useFlex, (options.imageResolution as ImageResolution) ?? '1k', options.sampleCount ?? 1),
  };
  const costMetaFail = { model, assetType: options.assetTypeForStats, costUsd: null };

  // Global-only models (e.g. future Imagen variants) skip the regional loop entirely.
  if (policy === 'global_only') {
    const t0g = Date.now();
    const globalResult = await imagenRequestRegional(prompt, 'global', true, width, height, options, model);
    const latencyG = Date.now() - t0g;
    const ok = !!globalResult && globalResult !== 'rate_limited';
    await logRegionOutcome(
      'global',
      'worker_vertex_imagen',
      globalResult === 'rate_limited' ? 'rate_limited' : ok ? 'success' : 'error',
      slugForStats,
      latencyG,
      ok ? costMetaSuccess : costMetaFail,
    );
    if (ok) {
      if (context) {
        logger.info('IMAGE_PROVIDER_SELECTED', { ...context, provider: 'vertex_imagen', model, region: 'global', latency_ms: latencyG, outcome: 'success' });
      }
      return globalResult as GeneratedAsset;
    }
    throw new Error(`Vertex Imagen (global-only model ${model}) failed (last outcome: ${globalResult ?? 'error'})`);
  }

  const orderedRegions = orderedRegionsFromSticky(_stickyImagenRegionIndex);

  for (const region of orderedRegions) {
    const t0 = Date.now();
    const result = await imagenRequestRegional(prompt, region, false, width, height, options, model);
    const latency = Date.now() - t0;

    if (result === 'rate_limited') {
      await logRegionOutcome(region, 'worker_vertex_imagen', 'rate_limited', slugForStats, latency, costMetaFail);
      continue;
    }

    if (result !== null) {
      await logRegionOutcome(region, 'worker_vertex_imagen', 'success', slugForStats, latency, costMetaSuccess);
      _stickyImagenRegionIndex = VERTEX_REGIONS.indexOf(region);
      if (context) {
        logger.info('IMAGE_PROVIDER_SELECTED', {
          ...context,
          provider: 'vertex_imagen',
          model,
          region,
          latency_ms: latency,
          outcome: 'success',
        });
      }
      return result;
    }

    await logRegionOutcome(region, 'worker_vertex_imagen', 'error', slugForStats, latency, costMetaFail);
  }

  // Global fallback (uses locations/global via vertexRouting policy)
  const t0g = Date.now();
  const globalResult = await imagenRequestRegional(prompt, 'global', true, width, height, options, model);
  const latencyG = Date.now() - t0g;
  const okG = !!globalResult && globalResult !== 'rate_limited';
  await logRegionOutcome(
    'global',
    'worker_vertex_imagen',
    globalResult === 'rate_limited' ? 'rate_limited' : okG ? 'success' : 'error',
    slugForStats,
    latencyG,
    okG ? costMetaSuccess : costMetaFail,
  );

  if (okG) {
    if (context) {
      logger.info('IMAGE_PROVIDER_SELECTED', { ...context, provider: 'vertex_imagen', model, region: 'global', latency_ms: latencyG, outcome: 'success' });
    }
    return globalResult as GeneratedAsset;
  }

  throw new Error(`Vertex Imagen exhausted all regions and global fallback (last outcome: ${globalResult ?? 'error'})`);
}

export async function generateImageViaVertexGemini(
  prompt: string,
  options: GenerateImageOptions,
  context?: LogContext,
  slugForStats?: string,
  model: string = GEMINI_IMAGE_MODEL,
): Promise<GeneratedAsset> {
  // Gemini infers aspect ratio from the prompt rather than parameters
  const aspectSuffix = options.aspectRatio ? ` (aspect ratio ${options.aspectRatio})` : '';
  const finalPrompt = `${prompt}${aspectSuffix}`;
  const policy = getModelPolicy(model);
  const useFlexRequested = !!options.useFlexTier && isFlexEligible(model);
  const reqOptions = {
    aspectRatio: options.aspectRatio,
    imageResolution: options.imageResolution,
    useFlexTier: options.useFlexTier,
  };
  const reqOptionsStandard = { ...reqOptions, useFlexTier: false };
  const costMetaFail = { model, assetType: options.assetTypeForStats, costUsd: null };
  // Cost is computed AFTER the call so we can use the actual served tier
  // (`flexServed`) instead of the requested tier — keeps telemetry honest
  // when Flex silently downgrades to standard or when the 503 fallback runs.
  const buildCostMetaSuccess = (flexServed: boolean) => ({
    model,
    assetType: options.assetTypeForStats,
    costUsd: estimateImageCost(model, flexServed, (options.imageResolution as ImageResolution) ?? '1k', 1),
  });

  // Helper: a single global Flex-aware call that, on `flex_unavailable` (503
  // from Flex capacity loss), retries the SAME global call without flex
  // headers. Vertex Flex PayGo has NO server-side fallback, per
  // https://cloud.google.com/vertex-ai/generative-ai/docs/flex-paygo §"Client
  // responsibility" — the client must implement this.
  const callGlobalWithFallback = async (): Promise<{
    outcome: GeminiImageOutcome;
    flexFellBackToStandard: boolean;
  }> => {
    let outcome = await geminiImageRequestRegional(finalPrompt, 'global', true, model, reqOptions);
    let flexFellBackToStandard = false;
    if (outcome === 'flex_unavailable') {
      logger.warn('VERTEX_FLEX_FALLBACK_TO_STANDARD', { model, region: 'global' });
      flexFellBackToStandard = true;
      outcome = await geminiImageRequestRegional(finalPrompt, 'global', true, model, reqOptionsStandard);
    }
    return { outcome, flexFellBackToStandard };
  };

  // Global-only models (e.g. Gemini 3.x): single global call, NO region rotation.
  if (policy === 'global_only') {
    const t0g = Date.now();
    const { outcome: globalResult, flexFellBackToStandard } = await callGlobalWithFallback();
    const latencyG = Date.now() - t0g;
    const ok = !!globalResult && globalResult !== 'rate_limited' && globalResult !== 'flex_unavailable';
    const flexServed = ok ? (globalResult as { flexServed: boolean }).flexServed : false;
    await logRegionOutcome(
      'global',
      'worker_vertex_gemini',
      globalResult === 'rate_limited' ? 'rate_limited' : ok ? 'success' : 'error',
      slugForStats,
      latencyG,
      ok ? buildCostMetaSuccess(flexServed) : costMetaFail,
    );
    if (ok) {
      if (context) {
        logger.info('IMAGE_PROVIDER_SELECTED', {
          ...context,
          provider: 'vertex_gemini',
          model,
          region: 'global',
          latency_ms: latencyG,
          outcome: 'success',
          flex_requested: useFlexRequested,
          flex_served: flexServed,
          flex_fallback: flexFellBackToStandard,
        });
      }
      return globalResult as GeneratedAsset;
    }
    throw new Error(`Vertex Gemini (global-only model ${model}) failed (last outcome: ${globalResult ?? 'error'})`);
  }

  const orderedRegions = orderedRegionsFromSticky(_stickyGeminiRegionIndex);

  for (const region of orderedRegions) {
    const t0 = Date.now();
    // Regional calls are NOT flex-eligible (Flex PayGo is global-only). The
    // helper already triple-gates and skips headers for isGlobal=false, so we
    // never see 'flex_unavailable' here — the type narrow is defensive.
    const result = await geminiImageRequestRegional(finalPrompt, region, false, model, reqOptions);
    const latency = Date.now() - t0;

    if (result === 'rate_limited' || result === 'flex_unavailable') {
      await logRegionOutcome(region, 'worker_vertex_gemini', 'rate_limited', slugForStats, latency, costMetaFail);
      continue;
    }

    if (result !== null) {
      const flexServed = result.flexServed;
      await logRegionOutcome(region, 'worker_vertex_gemini', 'success', slugForStats, latency, buildCostMetaSuccess(flexServed));
      _stickyGeminiRegionIndex = VERTEX_REGIONS.indexOf(region);
      if (context) {
        logger.info('IMAGE_PROVIDER_SELECTED', {
          ...context,
          provider: 'vertex_gemini',
          model,
          region,
          latency_ms: latency,
          outcome: 'success',
          flex_requested: useFlexRequested,
          flex_served: flexServed,
          flex_fallback: false,
        });
      }
      return result;
    }

    await logRegionOutcome(region, 'worker_vertex_gemini', 'error', slugForStats, latency, costMetaFail);
  }

  // Global fallback (uses locations/global via vertexRouting policy)
  const t0g = Date.now();
  const { outcome: globalResult, flexFellBackToStandard } = await callGlobalWithFallback();
  const latencyG = Date.now() - t0g;
  const okG = !!globalResult && globalResult !== 'rate_limited' && globalResult !== 'flex_unavailable';
  const flexServedG = okG ? (globalResult as { flexServed: boolean }).flexServed : false;
  await logRegionOutcome(
    'global',
    'worker_vertex_gemini',
    globalResult === 'rate_limited' ? 'rate_limited' : okG ? 'success' : 'error',
    slugForStats,
    latencyG,
    okG ? buildCostMetaSuccess(flexServedG) : costMetaFail,
  );

  if (okG) {
    if (context) {
      logger.info('IMAGE_PROVIDER_SELECTED', {
        ...context,
        provider: 'vertex_gemini',
        model,
        region: 'global',
        latency_ms: latencyG,
        outcome: 'success',
        flex_requested: useFlexRequested,
        flex_served: flexServedG,
        flex_fallback: flexFellBackToStandard,
      });
    }
    return globalResult as GeneratedAsset;
  }

  throw new Error(`Vertex Gemini exhausted all regions and global fallback (last outcome: ${globalResult ?? 'error'})`);
}

// ---------------------------------------------------------------------------
// Top-level dispatch — used by veoClient.generateImage facade
// ---------------------------------------------------------------------------

const DEFAULT_SAFETY_PREFIX =
  'Child-safe educational content for ages 5–8. Wholesome, gentle, bright, colorful, saturated, age-appropriate visuals.';

function resolveSafetyPrefixLocal(override?: string | null): string {
  if (typeof override === 'string') {
    const trimmed = override.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return DEFAULT_SAFETY_PREFIX;
}

/**
 * Dispatches to the configured provider with a simple 2-attempt progressive
 * simplification loop (matches Topic Pages anti-safety-rejection strategy).
 *
 * - Imagen path: sanitizes the prompt (people-pattern stripping) before
 *   prepending the safety prefix.
 * - Gemini path: uses the raw description (matches Topic Pages: Gemini's
 *   BLOCK_ONLY_HIGH safety is permissive enough that sanitization is not
 *   needed); we still log `wasSanitized` for diagnostics.
 *
 * `topicHint` is used by the progressive-simplification fallback prompt
 * builder to land on a topic-relevant minimal prompt if the full one fails.
 */
export async function generateImageWithProvider(
  prompt: string,
  width: number,
  height: number,
  options: GenerateImageOptions & { provider?: ImageProvider; topicHint?: string },
  context?: LogContext,
): Promise<GeneratedAsset> {
  const provider: ImageProvider = options.provider ?? DEFAULT_IMAGE_PROVIDER;
  const family = resolveProviderFamily(provider);
  const model = resolveProviderModel(provider);
  const topic = options.topicHint ?? 'this topic';

  const sanitized = sanitizeImagePrompt(prompt);
  if (sanitized.wasSanitized && context) {
    logger.info('IMAGE_PROMPT_SANITIZED', {
      ...context,
      provider,
      model,
      removed_patterns: sanitized.removedPatterns,
      applied_to_request: family === 'imagen',
    });
  }

  // Stage-driven progressive-fallback chain — counts come from
  // `resolveAiRetryConfig`, with stage order [raw → gemini_rewritten →
  // extreme_sanitized]. A stage with count=0 is skipped (logged once).
  // Today's defaults yield {1,1,1} → byte-identical to the old
  // `MAX_ATTEMPTS = 3` loop. Admins can raise per stage up to 5 attempts via
  // the Dev Panel AI Pipeline tab. The Veo-only ENABLE_VIDEO_COST_SAVINGS
  // clamp is irrelevant here (image asset types are not Veo).
  const safetyPrefix = resolveSafetyPrefixLocal(options.safetyPrefix);
  const sanitizerAssetType: AiAssetType | null =
    options.assetTypeForStats &&
    IMAGE_GEMINI_REWRITE_ASSET_TYPES.has(options.assetTypeForStats as AiAssetType)
      ? (options.assetTypeForStats as AiAssetType)
      : null;

  // Map this image generation to one of the seven `AiRetryAssetType` rows.
  // The "asset type unknown" defensive branch falls back to baseline 1/1/1
  // (we still call the resolver but with `background` as a stand-in — it'll
  // surface its `baseline` source for any unconfigured rows).
  const retryAssetType: AiRetryImageAssetType =
    sanitizerAssetType && (
      sanitizerAssetType === 'background' ||
      sanitizerAssetType === 'character_overlay' ||
      sanitizerAssetType === 'scene_object_overlay'
    )
      ? sanitizerAssetType
      : 'background';

  const retryCfg = await resolveAiRetryConfigAndLog(retryAssetType, context);
  const stageOrder: readonly AiRetryStage[] = ['raw', 'gemini_rewritten', 'extreme_sanitized'];

  let cachedGeminiRewrite: string | null = null;
  let lastError: unknown;
  let totalAttemptsUsed = 0;
  let previousStage: AiRetryStage | null = null;

  for (const stage of stageOrder) {
    const stageBudget = retryCfg.counts[stage];
    if (stageBudget <= 0) {
      if (context) {
        logger.info('AI_RETRY_STAGE_SKIPPED', {
          ...context,
          asset_type: retryAssetType,
          stage,
        });
      }
      continue;
    }

    if (previousStage !== null && context) {
      logger.info('AI_RETRY_STAGE_TRANSITION', {
        ...context,
        asset_type: retryAssetType,
        from_stage: previousStage,
        to_stage: stage,
        attempts_used: totalAttemptsUsed,
      });
    }
    previousStage = stage;

    // Stage 'gemini_rewritten' needs an asset type; if missing, skip the
    // stage entirely (the rewrite call would no-op).
    if (stage === 'gemini_rewritten' && !sanitizerAssetType) {
      if (context) {
        logger.info('AI_RETRY_STAGE_SKIPPED', {
          ...context,
          asset_type: retryAssetType,
          stage,
          reason: 'no_sanitizer_asset_type',
        });
      }
      continue;
    }

    for (let attemptInStage = 0; attemptInStage < stageBudget; attemptInStage++) {
      let promptForAttempt: string;
      let attemptClass: 'raw' | 'gemini_rewritten' | 'extreme_sanitized_fallback' = 'raw';

      if (stage === 'raw') {
        attemptClass = 'raw';
        promptForAttempt =
          family === 'gemini' ? prompt : `${safetyPrefix} ${sanitized.text}`;
      } else if (stage === 'gemini_rewritten') {
        // Cached across attempts within this stage AND across stages — the
        // rewrite is deterministic per (prompt, assetType) so paying for it
        // more than once would just waste tokens.
        if (!cachedGeminiRewrite && sanitizerAssetType) {
          try {
            const result = await sanitizeAiPromptViaGemini(
              prompt,
              sanitizerAssetType,
              context ?? {},
            );
            cachedGeminiRewrite = result.sanitized_prompt;
            if (context) {
              logger.warn('IMAGE_PROMPT_GEMINI_REWRITTEN', {
                ...context,
                provider,
                model,
                attempt: totalAttemptsUsed,
                asset_type: sanitizerAssetType,
                was_changed: result.was_changed,
                removed_concepts_head: result.removed_concepts.slice(0, 8),
                removed_concept_count: result.removed_concepts.length,
                gemini_ms: result.gemini_ms,
                original_chars: prompt.length,
                rewritten_chars: cachedGeminiRewrite.length,
              });
            }
          } catch (rewriteErr) {
            if (context) {
              logger.warn('IMAGE_GEMINI_REWRITE_FAILED', {
                ...context,
                provider,
                model,
                attempt: totalAttemptsUsed,
                asset_type: sanitizerAssetType,
                error:
                  rewriteErr instanceof AiPromptSanitizationError ||
                  rewriteErr instanceof Error
                    ? rewriteErr.message
                    : String(rewriteErr),
              });
            }
            // Rewrite call failed — abandon this stage entirely; the next
            // stage will still get its full budget.
            break;
          }
        }
        if (!cachedGeminiRewrite) {
          // Defensive: no rewrite available, skip the rest of this stage.
          break;
        }
        attemptClass = 'gemini_rewritten';
        promptForAttempt =
          family === 'gemini' ? cachedGeminiRewrite : `${safetyPrefix} ${cachedGeminiRewrite}`;
      } else {
        // 'extreme_sanitized'
        attemptClass = 'extreme_sanitized_fallback';
        const corePrompt = buildImagePromptForAttempt(sanitized.text, topic, 2);
        promptForAttempt =
          family === 'gemini' ? corePrompt : `${safetyPrefix} ${corePrompt}`;
        if (context) {
          logger.warn('IMAGE_PROMPT_EXTREME_SANITIZED', {
            ...context,
            provider,
            model,
            attempt: totalAttemptsUsed,
            attempt_in_stage: attemptInStage,
            trigger: previousStage === 'gemini_rewritten'
              ? 'gemini_rewritten_failed'
              : 'raw_failed',
          });
        }
      }

      try {
        const result =
          family === 'gemini'
            ? await generateImageViaVertexGemini(promptForAttempt, options, context, undefined, model)
            : await generateImageViaVertexImagen(
                promptForAttempt,
                width,
                height,
                options,
                context,
                undefined,
                model,
              );
        if (context) {
          logger.info('IMAGE_PROMPT_ATTEMPT_USED', {
            ...context,
            provider,
            model,
            attempt: totalAttemptsUsed,
            attempt_in_stage: attemptInStage,
            stage,
            attempt_class: attemptClass,
            asset_type: options.assetTypeForStats ?? null,
          });
        }
        return result;
      } catch (e) {
        lastError = e;
        totalAttemptsUsed++;
        if (context) {
          logger.warn('IMAGE_PROVIDER_ATTEMPT_FAILED', {
            ...context,
            provider,
            attempt: totalAttemptsUsed - 1,
            attempt_in_stage: attemptInStage,
            stage,
            attempt_class: attemptClass,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        // Upstream Vertex outage: every region + global fallback failed for
        // this single call. The remaining retry stages would hit the same
        // endpoints with the same outcome, so abandon the ladder and let
        // the caller's curated-asset fallback take over immediately.
        // Without this short-circuit, a Vertex outage on a 5-slot lesson
        // takes ~7 min per slot (5 attempts × ~80 s) instead of ~30 s.
        if (isVertexUpstreamOutageError(e)) {
          if (context) {
            logger.warn('IMAGE_PROVIDER_UPSTREAM_OUTAGE', {
              ...context,
              provider,
              model,
              stage,
              attempt: totalAttemptsUsed - 1,
              attempts_used: totalAttemptsUsed,
              error_head: e instanceof Error ? e.message.substring(0, 240) : String(e).substring(0, 240),
              short_circuit_reason: 'vertex_all_regions_exhausted',
            });
          }
          // Break out of both the inner attempt loop AND the outer stage
          // loop by labelled break via the existing post-loop fall-through.
          break;
        }
        continue;
      }
    }
    // If the inner loop broke because of an upstream outage short-circuit,
    // skip the remaining stages too — see comment above.
    if (lastError && isVertexUpstreamOutageError(lastError)) {
      break;
    }
    // End of stage; fall through to next stage in `stageOrder`.
  }

  // Final-summary log on retry exhaustion (improvement plan C). Per-attempt
  // rows still flow into `topic_image_region_stats` via the inner
  // generate*Region calls; this single line per generation makes silent
  // failures impossible.
  let lastErrorClass: string = 'unknown';
  if (lastError instanceof Error) {
    const msg = lastError.message.toLowerCase();
    if (msg.includes('safety')) lastErrorClass = 'safety_block';
    else if (msg.includes('timeout') || msg.includes('aborted')) lastErrorClass = 'timeout';
    else if (msg.includes('429') || msg.includes('rate')) lastErrorClass = 'rate_limited';
    else if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) lastErrorClass = 'server_5xx';
    else if (msg.includes('quota')) lastErrorClass = 'quota';
    else lastErrorClass = 'unknown';
  }
  if (context) {
    logger.warn('IMAGEN_OUTCOME', {
      ...context,
      ok: false,
      provider,
      model,
      asset_type: options.assetTypeForStats ?? null,
      attempts_used: totalAttemptsUsed,
      last_error_class: lastErrorClass,
      last_error_head: lastError instanceof Error ? lastError.message.substring(0, 240) : String(lastError ?? '').substring(0, 240),
      stage_budget: {
        raw: retryCfg.counts.raw,
        gemini_rewritten: retryCfg.counts.gemini_rewritten,
        extreme_sanitized: retryCfg.counts.extreme_sanitized,
      },
    });
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(
        `Image generation failed via ${provider} after ${totalAttemptsUsed} attempt(s) ` +
        `(stages: raw=${retryCfg.counts.raw}, gemini_rewritten=${retryCfg.counts.gemini_rewritten}, ` +
        `extreme_sanitized=${retryCfg.counts.extreme_sanitized})`,
      );
}
