/**
 * Worker → Edge HTTP wrapper for the visual-asset safety classifier.
 *
 * Mirrors the side-effect-isolated pattern used by `autoDiagnosticsClient.ts`:
 *  - NEVER throws.
 *  - Returns a structured `{ safe, reasons, categories, error }` verdict.
 *  - On any internal failure (network, HTTP error, JSON parse), returns
 *    `safe:true` with `error` set so the caller can fall back to curated
 *    assets per the Core rule "AI generation MUST fallback to curated assets".
 *
 * Hard-fail verdicts ONLY come from a positive Gemini classification — we
 * NEVER fail-closed on classifier infrastructure problems.
 */

// NOTE: `character_animation` and `scene_object_animation` are intentionally
// excluded — those assets are direct derivatives of the corresponding
// `*_overlay` PNG which IS classified upstream. Re-checking the animation
// frames just burns a Gemini call and pollutes the moderator UI with
// "No check" rows. See mem://features/moderation-review-visual-safety-column.
export type VisualAssetType =
  | 'background'
  | 'character_overlay'
  | 'scene_object_overlay'
  | 'motif'
  | 'loop';

export interface VisualSafetyClientArgs {
  imageBytesBase64: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  assetType: VisualAssetType;
  ageBand: string;
  topicHint?: string | null;
  lessonId?: string;
  /** Optional asset_id; when present the edge stamps video_asset_variants. */
  assetId?: string;
}

export interface VisualSafetyClientConfig {
  enabled: boolean;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  /** Test-only seam. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Test-only. Defaults to 30_000 ms. */
  timeoutMs?: number;
}

export interface VisualSafetyClientLogger {
  info: (msg: string, ctx?: Record<string, unknown>) => void;
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
}

export interface VisualSafetyVerdict {
  safe: boolean;
  reasons: string[];
  categories: string[];
  soft_categories?: string[];
  model_used?: string;
  /** Set when classifier failed and we fell back to safe:true. */
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const ERROR_BODY_TRUNCATE = 500;

const SAFE_FALLBACK = (error: string): VisualSafetyVerdict => ({
  safe: true,
  reasons: [`classifier_${error}`],
  categories: [],
  error,
});

export async function checkVisualAssetSafety(
  args: VisualSafetyClientArgs,
  cfg: VisualSafetyClientConfig,
  log: VisualSafetyClientLogger,
): Promise<VisualSafetyVerdict> {
  if (!cfg.enabled) return SAFE_FALLBACK('disabled');

  const fetchImpl = cfg.fetchImpl ?? globalThis.fetch;
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ctx = {
    lesson_id: args.lessonId,
    asset_type: args.assetType,
    asset_id: args.assetId,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetchImpl(`${cfg.supabaseUrl}/functions/v1/check-visual-asset-safety`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.supabaseServiceRoleKey}`,
      },
      body: JSON.stringify({
        imageBytesBase64: args.imageBytesBase64,
        mime: args.mime,
        assetType: args.assetType,
        ageBand: args.ageBand,
        topicHint: args.topicHint ?? null,
        lessonId: args.lessonId,
        assetId: args.assetId,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    log.warn('VISUAL_SAFETY_CLASSIFIER_ERROR', {
      ...ctx,
      stage: 'fetch',
      error: e instanceof Error ? e.message : String(e),
    });
    return SAFE_FALLBACK('network_error');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch { /* */ }
    log.warn('VISUAL_SAFETY_CLASSIFIER_ERROR', {
      ...ctx,
      stage: 'http',
      status: res.status,
      body_tail: body.substring(0, ERROR_BODY_TRUNCATE),
    });
    return SAFE_FALLBACK(`http_${res.status}`);
  }

  let json: VisualSafetyVerdict;
  try { json = await res.json() as VisualSafetyVerdict; }
  catch (e) {
    log.warn('VISUAL_SAFETY_CLASSIFIER_ERROR', {
      ...ctx,
      stage: 'json_parse',
      error: e instanceof Error ? e.message : String(e),
    });
    return SAFE_FALLBACK('bad_json');
  }

  if (typeof json.safe !== 'boolean' || !Array.isArray(json.categories) || !Array.isArray(json.reasons)) {
    log.warn('VISUAL_SAFETY_CLASSIFIER_ERROR', { ...ctx, stage: 'shape' });
    return SAFE_FALLBACK('bad_shape');
  }

  log.info('VISUAL_SAFETY_VERDICT', {
    ...ctx,
    safe: json.safe,
    category_count: json.categories.length,
    reason_count: json.reasons.length,
    error: json.error,
  });

  return json;
}
