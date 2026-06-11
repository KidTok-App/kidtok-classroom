/**
 * Shared safety gate used by AI image generators (background,
 * character_overlay, scene_object_overlay) AFTER `generateImage` returns
 * and BEFORE Storage upload + `video_asset_variants` insert.
 *
 * Throws `VisualAssetUnsafeError` on a positive UNSAFE verdict so the
 * orchestrator can mark the lesson `cancelled_unsafe_asset`. Classifier
 * infrastructure errors (network/auth/HTTP) NEVER throw — they fall back
 * to `safe:true` per the Core rule "AI generation MUST fallback to curated
 * assets" (the curated fallback path is upstream in `storageAssets.ts`).
 */

import { logger } from "../../logger.js";
import {
  checkVisualAssetSafety,
  type VisualAssetType,
} from "../visualAssetSafetyClient.js";
import { VisualAssetUnsafeError } from "./visualAssetUnsafeError.js";

function envEnabled(): boolean {
  const v = (process.env.ENABLE_VISUAL_ASSET_SAFETY ?? "true").toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function detectMime(bytes: Buffer): "image/png" | "image/jpeg" | "image/webp" {
  // PNG: 89 50 4E 47
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  // WEBP: "RIFF"…"WEBP"
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return "image/png";
}

export interface VisualSafetyGateArgs {
  bytes: Buffer;
  /** Provider-reported mime; if not one of the supported types we sniff. */
  mimeHint?: string | null;
  assetType: VisualAssetType;
  ageBand: string;
  topic?: string | null;
  lessonId: string;
  assetId?: string | null;
}

/**
 * Verdict shape suitable for direct persistence onto
 * `video_asset_variants.safety_*` columns. Returned by
 * `runVisualAssetSafetyGate` so the generator can stamp the very FIRST
 * INSERT for the row (the legacy edge-fn UPDATE-by-asset_id path raced
 * the insert and silently dropped the verdict — see
 * mem://features/moderation-review-visual-safety-column).
 */
export type PersistedSafetyVerdictKind =
  | "safe"
  | "unsafe"
  | "maybe_unsafe"
  | "error"
  | "disabled";

export interface PersistedSafetyVerdict {
  verdict: PersistedSafetyVerdictKind;
  reasons: string[];
  categories: string[];
  soft_categories: string[];
  model: string | null;
  /** ISO timestamp of the classifier call, or null when disabled. */
  checked_at: string | null;
}

const DISABLED_VERDICT: PersistedSafetyVerdict = {
  verdict: "disabled",
  reasons: [],
  categories: [],
  soft_categories: [],
  model: null,
  checked_at: null,
};

/**
 * Run the classifier and return a structured verdict ready to write into
 * `video_asset_variants.safety_*`. Throws `VisualAssetUnsafeError` ONLY
 * on a positive unsafe verdict; classifier infrastructure errors are
 * surfaced as `verdict: 'error'` (fail-open per the curated-fallback
 * Core rule).
 */
export async function runVisualAssetSafetyGate(
  args: VisualSafetyGateArgs,
): Promise<PersistedSafetyVerdict> {
  if (!envEnabled()) return DISABLED_VERDICT;

  const supabaseUrl = process.env.SUPABASE_URL ?? "";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !supabaseKey) {
    logger.warn("VISUAL_SAFETY_GATE_SKIPPED_NO_CREDENTIALS", {
      lesson_id: args.lessonId,
      asset_type: args.assetType,
    });
    return DISABLED_VERDICT;
  }

  const validMime: "image/png" | "image/jpeg" | "image/webp" =
    args.mimeHint === "image/png" || args.mimeHint === "image/jpeg" || args.mimeHint === "image/webp"
      ? args.mimeHint
      : detectMime(args.bytes);

  const result = await checkVisualAssetSafety(
    {
      imageBytesBase64: args.bytes.toString("base64"),
      mime: validMime,
      assetType: args.assetType,
      ageBand: args.ageBand,
      topicHint: args.topic ?? null,
      lessonId: args.lessonId,
      assetId: args.assetId ?? undefined,
    },
    {
      enabled: true,
      supabaseUrl,
      supabaseServiceRoleKey: supabaseKey,
    },
    logger,
  );

  const checkedAt = new Date().toISOString();
  const reasons = Array.isArray(result.reasons) ? result.reasons : [];
  const categories = Array.isArray(result.categories) ? result.categories : [];
  const softCategories = Array.isArray(result.soft_categories) ? result.soft_categories : [];
  const model = result.model_used ?? null;

  // Classifier infrastructure error → fail-open; curated fallback handles
  // the bytes path. Persist as 'error' so the moderator UI shows "Error".
  if (result.error) {
    return {
      verdict: "error",
      reasons,
      categories,
      soft_categories: softCategories,
      model,
      checked_at: checkedAt,
    };
  }

  if (!result.safe) {
    throw new VisualAssetUnsafeError({
      assetType: args.assetType,
      categories,
      reasons,
      assetId: args.assetId ?? null,
    });
  }

  // Safe path. Soft (non-hard) categories surface as `maybe_unsafe`; pure
  // safe rows have empty categories and a clean `safe` verdict.
  const verdictKind: PersistedSafetyVerdictKind =
    softCategories.length > 0 ? "maybe_unsafe" : "safe";

  return {
    verdict: verdictKind,
    reasons,
    categories,
    soft_categories: softCategories,
    model,
    checked_at: checkedAt,
  };
}

/**
 * Back-compat wrapper. Prefer `runVisualAssetSafetyGate` so the verdict
 * can be persisted on the initial INSERT.
 */
export async function assertVisualAssetSafeOrThrow(
  args: VisualSafetyGateArgs,
): Promise<void> {
  await runVisualAssetSafetyGate(args);
}
