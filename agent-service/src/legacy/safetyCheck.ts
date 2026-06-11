/**
 * Child-content safety check for generated scripts.
 *
 * Ported from agent-service/legacy-reference/safetyCheckAgent.ts:
 *   - HARD_FAIL_CATEGORY_PATTERNS (verbatim)
 *   - applyCategoryTrumpsBooleanGate (verbatim)
 *   - SAFETY_SYSTEM_PROMPT (verbatim)
 *   - the Gemini structured-output classification call shape
 *
 * The Gemini call itself is injected (TextLlm) so the same logic runs against
 * Vertex in production and against the fake provider in smoke tests.
 */

import type { TextLlm } from "../clients/interfaces.js";

export const HARD_FAIL_CATEGORY_PATTERNS: ReadonlyArray<RegExp> = [
  /\bweapon(s|ry)?\b/i,
  /\bgore\b/i,
  /\bblood(y|shed)?\b/i,
  /\bsuggestive\b/i,
  /\bsexual\b/i,
  /\bnudity\b/i,
  /\bhate[\s-]?symbol/i,
  /\bdrugs?\b/i,
  /\balcohol\b/i,
  /\bsmoking\b/i,
  /\bself[\s-]?harm\b/i,
  /\bdangerous[\s-]?(act|stunt)\b/i,
];

export type SafetyVerdict = "safe" | "maybe_unsafe" | "unsafe" | "error" | "pending";

export function applyCategoryTrumpsBooleanGate(
  verdict: SafetyVerdict,
  reasons: string[],
): SafetyVerdict {
  if (verdict === "unsafe" || verdict === "error" || verdict === "pending") return verdict;
  const blob = (reasons ?? []).join(" \n ");
  if (!blob) return verdict;
  for (const re of HARD_FAIL_CATEGORY_PATTERNS) {
    if (re.test(blob)) return "unsafe";
  }
  return verdict;
}

export const SAFETY_SYSTEM_PROMPT = `You are a child-content safety classifier for educational lessons aimed at children ages 3-8.

Analyze the lesson script and classify it as one of:
- "safe" — fully appropriate for young children
- "maybe_unsafe" — contains elements that might concern parents (mild scary content, complex emotions, cultural sensitivity, borderline topics)
- "unsafe" — contains content clearly inappropriate for children (violence, sexual themes, self-harm, hate speech, dangerous instructions, medical advice)

Be conservative: if in doubt, classify as "maybe_unsafe" rather than "safe".`;

export interface SafetyCheckResult {
  verdict: SafetyVerdict;
  reasons: string[];
}

const SAFETY_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    verdict: {
      type: "STRING",
      enum: ["safe", "maybe_unsafe", "unsafe"],
      description: "The safety classification.",
    },
    reasons: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "Brief reasons for the classification. Empty array if safe.",
    },
  },
  required: ["verdict", "reasons"],
} as const;

/**
 * Classify a script summary. Mirrors SafetyCheckAgent.run(): structured
 * Gemini classification at temperature 0, then the hard-fail category gate.
 * Returns verdict "error" instead of throwing — the caller decides policy.
 */
export async function runSafetyCheck(
  llm: TextLlm,
  scriptSummary: string,
): Promise<SafetyCheckResult> {
  try {
    const parsed = await llm.generateJson<{ verdict?: string; reasons?: string[] }>({
      spanName: "safety-check",
      system: SAFETY_SYSTEM_PROMPT,
      user: `Classify this lesson script:\n\n${scriptSummary}`,
      schema: SAFETY_RESPONSE_SCHEMA,
      temperature: 0,
    });
    let verdict = (parsed.verdict || "maybe_unsafe") as SafetyVerdict;
    const reasons = Array.isArray(parsed.reasons) ? parsed.reasons : [];
    verdict = applyCategoryTrumpsBooleanGate(verdict, reasons);
    return { verdict, reasons };
  } catch (err) {
    return {
      verdict: "error",
      reasons: [err instanceof Error ? err.message : "Safety check failed unexpectedly"],
    };
  }
}
