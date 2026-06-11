import { getGeminiAccessToken } from './googleAuth.js';

/**
 * Vertex AI endpoint routing policy — Node/worker side.
 *
 * Single source of truth for which Vertex models are global-only,
 * which support regional rotation with global fallback, and which
 * are regional-only. Mirrored verbatim by:
 *   - supabase/functions/_shared/vertexRouting.ts (Deno)
 *
 * Why mirror? Deno cannot import from worker-service/, and the worker
 * cannot import Deno-flavored TS. Both files MUST stay in sync — see
 * .memory/naming_discrepancies.md entry "vertexRouting Deno↔Node mirror".
 *
 * Source of truth for endpoint policy:
 *   https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations
 *   - Gemini 3.x family is listed under "Supported models for the
 *     global endpoint" with NO regional checkmarks → global_only.
 *   - Gemini 2.5 family + Imagen 3/4 → regional_with_global_fallback.
 *   - Veo + Lyria → regional_only (no global endpoint).
 */

export type ModelEndpointPolicy =
  | 'global_only'
  | 'regional_with_global_fallback'
  | 'regional_only';

const POLICY_TABLE: Record<string, ModelEndpointPolicy> = {
  // Gemini 3.x — GLOBAL ONLY
  'gemini-3.1-flash-image-preview': 'global_only',
  'gemini-3-pro-image-preview': 'global_only',
  'gemini-3.1-pro-preview': 'global_only',
  'gemini-3-flash-preview': 'global_only',
  'gemini-3.1-flash-lite-preview': 'global_only',

  // Gemini 2.5 — regional with global fallback
  'gemini-2.5-flash-image': 'regional_with_global_fallback',
  'gemini-2.5-flash': 'regional_with_global_fallback',
  'gemini-2.5-pro': 'regional_with_global_fallback',

  // Imagen 3/4 — regional with global fallback
  'imagen-3.0-generate-002': 'regional_with_global_fallback',
  'imagen-4.0-fast-generate-001': 'regional_with_global_fallback',
  'imagen-4.0-generate-001': 'regional_with_global_fallback',
  'imagen-4.0-ultra-generate-001': 'regional_with_global_fallback',

  // Veo / Lyria — regional only (no global endpoint per Vertex docs)
  'veo-3.0-generate-001': 'regional_only',
  'veo-3.1-generate-preview': 'regional_only',
  'veo-3.1-generate-001': 'regional_only',
  'veo-3.1-fast-generate-001': 'regional_only',
  'veo-3.1-lite-generate-001': 'regional_only',
  'lyria-002': 'regional_only',
};

/** Conservative default for unknown / future models: behave like Gemini 2.5. */
const DEFAULT_POLICY: ModelEndpointPolicy = 'regional_with_global_fallback';

export function getModelPolicy(modelId: string): ModelEndpointPolicy {
  return POLICY_TABLE[modelId] ?? DEFAULT_POLICY;
}

/**
 * Build the Vertex publisher URL honoring the model's endpoint policy.
 *
 * - global_only: ALWAYS uses bare `aiplatform.googleapis.com` host with
 *   `locations/global` in the path (region argument is ignored).
 * - regional_with_global_fallback: when isGlobal=true, uses the bare
 *   global host with `locations/global`; otherwise uses regional host
 *   + `locations/{region}`.
 * - regional_only: ignores isGlobal and always uses `{region}-aiplatform`
 *   + `locations/{region}`.
 */
export function buildVertexUrl(
  modelId: string,
  projectId: string,
  region: string,
  isGlobal: boolean,
  methodSuffix: string, // ':generateContent' or ':predict' etc.
  /**
   * LEGACY parameter — Vertex AI Flex PayGo is now opted-in via HTTP
   * **headers**, not the URL. See `buildVertexFlexHeaders()` below and
   * https://cloud.google.com/vertex-ai/generative-ai/docs/flex-paygo.
   *
   * Earlier draft appended `?endpointType=flex` here, which Vertex
   * `:generateContent` / `:predict` reject with INVALID_ARGUMENT. That
   * incident is documented in
   * `mem://architecture/ai-asset-generation-pipeline-failure-modes.md`
   * → "endpointType=flex URL bug".
   *
   * The argument is retained as a no-op so existing call sites that pass
   * it (or rely on `isFlexEligible(modelId)` upstream) continue to compile.
   * Callers MUST also send the headers from `buildVertexFlexHeaders()` to
   * actually route through Flex PayGo.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  useFlexTier: boolean = false,
): string {
  const policy = getModelPolicy(modelId);

  if (policy === 'global_only') {
    return `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/publishers/google/models/${modelId}${methodSuffix}`;
  }

  if (policy === 'regional_only') {
    return `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${modelId}${methodSuffix}`;
  }

  // regional_with_global_fallback
  if (isGlobal) {
    return `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/publishers/google/models/${modelId}${methodSuffix}`;
  }
  return `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${modelId}${methodSuffix}`;
}

/**
 * Returns true if the model supports Vertex AI **Flex PayGo** per the
 * official supported-models list:
 *   https://cloud.google.com/vertex-ai/generative-ai/docs/flex-paygo
 *
 * Vertex Flex PayGo is opt-in via the HTTP headers
 *   X-Vertex-AI-LLM-Request-Type: shared
 *   X-Vertex-AI-LLM-Shared-Request-Type: flex
 * (see `buildVertexFlexHeaders()`) and is supported ONLY against the
 * `global` endpoint. 50% discount, sheddable, 503/429 on capacity loss,
 * NO server-side fallback to standard — caller MUST implement client-side
 * retry/fallback (see `imageProviderClient.geminiImageRequestRegional`).
 *
 * Image-generation models KidTok currently uses that are listed:
 *  - gemini-3.1-flash-image-preview  (Nano Banana 2)
 *  - gemini-3-pro-image-preview      (Nano Banana Pro)
 *
 * NOT on the Vertex Flex PayGo list (despite some appearing on the
 * separate Gemini *Developer API* Flex inference list — different product):
 * gemini-2.5-flash-image, Imagen 3/4 family, Veo, Lyria. Sending the flex
 * headers to those is silently ignored and may distort billing telemetry.
 *
 * Text models (gemini-3-flash-preview, gemini-3.1-flash-lite-preview,
 * gemini-3.1-pro-preview) are listed by Google but NOT yet wired into the
 * KidTok lesson-script path — they remain ineligible here on purpose so
 * the helper can't accidentally route user-blocking lesson generation
 * through best-effort Flex.
 */
const FLEX_ELIGIBLE_MODELS = new Set<string>([
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image-preview',
]);

export function isFlexEligible(modelId: string): boolean {
  return FLEX_ELIGIBLE_MODELS.has(modelId);
}

/**
 * HTTP headers required to request Vertex AI Flex PayGo for a single call.
 * Per https://cloud.google.com/vertex-ai/generative-ai/docs/flex-paygo
 * §"Use only Flex PayGo".
 *
 * `serverTimeoutSec` becomes the optional `X-Server-Timeout` server hint,
 * floored to 1s and capped at 1800s (30 min — the Vertex Flex PayGo doc
 * cap). Defaults to 600s, matching the documented sample.
 *
 * Callers MUST also gate on `isFlexEligible(modelId)` AND target the
 * `global` endpoint — Flex PayGo is global-endpoint-only.
 */
export function buildVertexFlexHeaders(
  serverTimeoutSec: number = 600,
): Record<string, string> {
  const cappedSec = Math.max(1, Math.min(1800, Math.floor(serverTimeoutSec)));
  return {
    'X-Vertex-AI-LLM-Request-Type': 'shared',
    'X-Vertex-AI-LLM-Shared-Request-Type': 'flex',
    'X-Server-Timeout': String(cappedSec),
  };
}

/**
 * Returns true if the response's `usageMetadata` indicates the request was
 * actually served by Vertex Flex PayGo (vs silently downgraded to standard).
 * Per the Vertex Flex PayGo doc, success returns
 * `usageMetadata.trafficType === "ON_DEMAND_FLEX"`.
 */
export function isFlexTrafficResponse(responseJson: unknown): boolean {
  const usage = (responseJson as { usageMetadata?: { trafficType?: string } })
    ?.usageMetadata;
  return usage?.trafficType === 'ON_DEMAND_FLEX';
}

/**
 * Returns the correct `thinkingConfig` payload subset for a Gemini model,
 * or undefined if the model does not accept thinking config.
 *
 * - Gemini 3.x: uses `thinking_level: 'low' | 'medium' | 'high' | 'minimal'`.
 *   We default to 'low' to keep cost down (vs default `medium`).
 * - Gemini 2.5: uses `thinkingBudget: 0` to disable thinking and avoid
 *   exhausting token budget (current production behavior).
 * - Anything else (Imagen, Veo, Lyria): undefined — caller MUST omit the field.
 */
export function getThinkingPayload(
  modelId: string,
): { thinking_level: 'minimal' | 'low' | 'medium' | 'high' } | { thinkingBudget: number } | undefined {
  // Gemini 3.x IMAGE-mode preview variants reject `thinking_level` outright
  // (Vertex Thinking docs list them as supported, but :generateContent
  // returns INVALID_ARGUMENT — confirmed empirically 2026-04-24 on
  // gemini-3-pro-image-preview). Image-mode Gemini 3 calls MUST omit
  // thinkingConfig. Reasoning/text Gemini 3.x variants still accept
  // `thinking_level`. See mem://architecture/vertex-routing-policy.md
  // and mem://architecture/ai-asset-generation-pipeline-failure-modes.md.
  if (modelId.startsWith('gemini-3') && modelId.includes('-image')) {
    return undefined;
  }
  if (modelId.startsWith('gemini-3')) {
    return { thinking_level: 'low' };
  }
  if (modelId.startsWith('gemini-2.5')) {
    return { thinkingBudget: 0 };
  }
  return undefined;
}

interface ProbeCache {
  supportedModels: Set<string>;
  lastProbedAt: number;
}

let probeCache: ProbeCache | null = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function probeModelsIfNeeded(): Promise<Set<string>> {
  const now = Date.now();
  if (probeCache && (now - probeCache.lastProbedAt < CACHE_TTL_MS)) {
    return probeCache.supportedModels;
  }

  const supported = new Set<string>();
  try {
    let projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    if (!projectId) {
      try {
        projectId = getGeminiAccessToken.getProjectId();
      } catch {
        // Ignore
      }
    }
    if (projectId) {
      const region = process.env.GOOGLE_CLOUD_REGION || 'us-central1';
      const endpoint = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models`;
      const accessToken = await getGeminiAccessToken();

      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const json = await response.json() as any;
        if (json.models && Array.isArray(json.models)) {
          for (const m of json.models) {
            const name = m.name || '';
            const parts = name.split('/');
            const modelId = parts[parts.length - 1];
            if (modelId) {
              supported.add(modelId);
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('Vertex AI models.list probe failed, using fallback/defaults:', err);
  }

  probeCache = {
    supportedModels: supported,
    lastProbedAt: now,
  };
  return supported;
}

/**
 * Manually set the probe cache. Mainly for testing.
 */
export function setProbeCache(supported: Set<string>): void {
  probeCache = {
    supportedModels: supported,
    lastProbedAt: Date.now(),
  };
}

/**
 * Clear the probe cache.
 */
export function clearProbeCache(): void {
  probeCache = null;
}

export function resolveModel({ role }: { role: 'planner' | 'script' | 'safety' | 'prompt-builder' | 'tagger' | 'visual-image' | 'visual-video' | 'music' | 'tts' }): string {
  // Defaults: Fly.io parity — planner/safety -> gemini-2.5-pro, other text roles -> gemini-2.5-flash.
  // The 3.1-preview bump (2026-05) was unintentional and the GCP project does not have access
  // to those preview models. Revert kept here as the canonical baseline; do not re-bump without
  // an explicit decision documented in mem://incidents/2026-05-29-planner-model-bump-revert.
  let defaultModel = 'gemini-2.5-flash';
  if (role === 'planner' || role === 'safety') {
    defaultModel = 'gemini-2.5-pro';
  }

  if (probeCache) {
    const supported = probeCache.supportedModels;
    // If we successfully probed models and found some, but the default is not supported, fallback.
    if (supported.size > 0 && !supported.has(defaultModel)) {
      return 'gemini-flash-latest';
    }
  }

  return defaultModel;
}

// Trigger asynchronous boot-time probe (non-blocking)
probeModelsIfNeeded().catch(() => {});

