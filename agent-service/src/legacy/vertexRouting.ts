/**
 * Vertex AI endpoint routing policy.
 *
 * Ported from agent-service/legacy-reference/vertexRouting.ts (verbatim policy
 * table + URL builder + thinking-config helper; the Flex PayGo and
 * model-probe machinery was intentionally dropped for this service).
 *
 * Source of truth for endpoint policy:
 *   https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations
 *   - Gemini 3.x family is listed under "Supported models for the
 *     global endpoint" with NO regional checkmarks → global_only.
 *   - Gemini 2.5 family + Imagen 3/4 → regional_with_global_fallback.
 */

export type ModelEndpointPolicy =
  | "global_only"
  | "regional_with_global_fallback"
  | "regional_only";

const POLICY_TABLE: Record<string, ModelEndpointPolicy> = {
  // Gemini 3.x — GLOBAL ONLY
  "gemini-3-flash": "global_only",
  "gemini-3-flash-preview": "global_only",
  "gemini-3.1-flash-image-preview": "global_only",
  "gemini-3-pro-image-preview": "global_only",
  "gemini-3.1-pro-preview": "global_only",
  "gemini-3.1-flash-lite-preview": "global_only",

  // Gemini 2.5 — regional with global fallback
  "gemini-2.5-flash-image": "regional_with_global_fallback",
  "gemini-2.5-flash": "regional_with_global_fallback",
  "gemini-2.5-pro": "regional_with_global_fallback",

  // Imagen 3/4 — regional with global fallback
  "imagen-3.0-generate-002": "regional_with_global_fallback",
  "imagen-4.0-fast-generate-001": "regional_with_global_fallback",
  "imagen-4.0-generate-001": "regional_with_global_fallback",
  "imagen-4.0-ultra-generate-001": "regional_with_global_fallback",
};

/** Conservative default for unknown / future models: behave like Gemini 2.5. */
const DEFAULT_POLICY: ModelEndpointPolicy = "regional_with_global_fallback";

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
): string {
  const policy = getModelPolicy(modelId);

  if (policy === "global_only") {
    return `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/publishers/google/models/${modelId}${methodSuffix}`;
  }

  if (policy === "regional_only") {
    return `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${modelId}${methodSuffix}`;
  }

  // regional_with_global_fallback
  if (isGlobal) {
    return `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/publishers/google/models/${modelId}${methodSuffix}`;
  }
  return `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${modelId}${methodSuffix}`;
}

/**
 * Returns the correct `thinkingConfig` payload subset for a Gemini model,
 * or undefined if the model does not accept thinking config.
 *
 * - Gemini 3.x text: uses `thinking_level: 'low'` to keep cost down.
 * - Gemini 3.x IMAGE-mode variants reject `thinking_level` outright —
 *   image-mode Gemini 3 calls MUST omit thinkingConfig.
 * - Gemini 2.5: uses `thinkingBudget: 0` to disable thinking and avoid
 *   exhausting token budget.
 * - Anything else: undefined — caller MUST omit the field.
 */
export function getThinkingPayload(
  modelId: string,
):
  | { thinking_level: "minimal" | "low" | "medium" | "high" }
  | { thinkingBudget: number }
  | undefined {
  if (modelId.startsWith("gemini-3") && modelId.includes("-image")) {
    return undefined;
  }
  if (modelId.startsWith("gemini-3")) {
    return { thinking_level: "low" };
  }
  if (modelId.startsWith("gemini-2.5")) {
    return { thinkingBudget: 0 };
  }
  return undefined;
}
