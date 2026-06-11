/**
 * Image-prompt sanitization — two layers, both ported from legacy reference:
 *
 * 1. `sanitizeImagePrompt` — fast deterministic people-noun scrub +
 *    positive-framing directive. Ported verbatim from
 *    agent-service/legacy-reference/imageProviderClient.ts.
 * 2. `buildLlmSanitizerMessages` — the Gemini-based prompt-safety rewriter
 *    system prompt and response schema, ported from
 *    agent-service/legacy-reference/aiPromptSanitizer.ts, with asset-type
 *    guidance specialized to this service's `scene_illustration` asset
 *    (full scene image: cartoon mascots allowed, no realistic humans).
 * 3. `buildImagePromptForAttempt` — progressive simplification on retry,
 *    ported verbatim from imageProviderClient.ts.
 */

export interface SanitizeResult {
  text: string;
  wasSanitized: boolean;
  removedPatterns: string[];
}

const PEOPLE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(adult|woman|man|girl|boy|teacher|parent|baby|toddler|infant)\b/gi, ""],
  [
    /\b(child|kid|person)\s+(holding|looking at|reading|playing with|sitting|standing|watching|helping|teaching|learning)\b/gi,
    "",
  ],
  [
    /\b(holding hands|smiling faces?|facial expression|portrait|close-?up of face|looking at camera)\b/gi,
    "",
  ],
];

const POSITIVE_FRAMING_DIRECTIVE =
  "Compose the scene with only abstract shapes, props, and environmental elements — no characters, no figures.";

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

  text = text.replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").replace(/\.\s*\./g, ".").trim();
  text = text.replace(/^[,.\s]+/, "").replace(/[,.\s]+$/, "").trim();

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
 * used by the original production pipeline. Topic argument lets us fall back
 * to a minimal topic-only prompt if the original keeps failing.
 */
export function buildImagePromptForAttempt(
  sanitized: string,
  topic: string,
  attempt: number,
): string {
  switch (attempt) {
    case 0:
      return sanitized;
    case 1: {
      const simplified = sanitized
        .replace(
          /\b(beautiful|warm|cozy|lovely|stunning|gorgeous|vibrant|colorful|bright|cheerful|delightful|magnificent)\b/gi,
          "",
        )
        .replace(/\s{2,}/g, " ")
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
// LLM-based prompt-safety rewriter (used on the retry path)
// ---------------------------------------------------------------------------

const SCENE_ASSET_GUIDANCE =
  "Target asset: a single illustrated cartoon scene for a children's educational episode (environment plus optional friendly cartoon mascot characters). Allow stylized cartoon character description (mascot, animal, magical creature, or anthropomorphic object). AVOID realistic human depictions, photorealism, real children, faces with detailed features, or anatomical body parts. Keep environment, setting, props, and atmospheric details.";

export const SANITIZER_SYSTEM_PROMPT = `You are a prompt-safety rewriter for a children's educational video platform that generates assets via Google Vertex AI (Gemini for images).

Your job: take a production-built generation prompt that Google's safety filters are likely to reject, and rewrite it into a SAFE prompt that:
  1. PRESERVES the lesson topic, visual style, color palette, and overall composition intent.
  2. REMOVES or REPHRASES wording that commonly trips Vertex RAI safety classifiers:
     - People-noun phrasing ("child", "kid", "boy", "girl", "person", "adult", "teacher", "parent").
     - Body-part references (faces, hands, eyes, smiling, holding).
     - Anything that could read as a depiction of a real human child.
     - Realistic / photographic / photorealistic descriptors when applied to human-like figures.
  3. KEEPS the prompt the same approximate LENGTH and STYLE as the input (do not shorten dramatically).
  4. KEEPS scene composition details and technical directives verbatim.

Replacement strategy:
  - Replace people nouns with abstract substitutes that fit the lesson topic
    (e.g. "a friendly cartoon mascot", "a glowing shape", "an animated icon").
  - Replace body-part references with "no characters, abstract shapes only" guidance.
  - Replace realistic-style adjectives with "stylized cartoon, flat illustration".
  - PRESERVE all directives, prefixes, suffixes, and technical instructions verbatim.

Return JSON with these exact fields:
  - sanitized_prompt (string): the rewritten prompt, ready to send to Vertex.
  - removed_concepts (string[]): short labels for each concept removed or rephrased. Empty array when nothing needed changing.
  - was_changed (boolean): true when sanitized_prompt differs meaningfully from the input.

If the input prompt is ALREADY safe, return it unchanged with was_changed=false and removed_concepts=[].

${SCENE_ASSET_GUIDANCE}`;

export const SANITIZER_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    sanitized_prompt: { type: "STRING" },
    removed_concepts: { type: "ARRAY", items: { type: "STRING" } },
    was_changed: { type: "BOOLEAN" },
  },
  required: ["sanitized_prompt", "removed_concepts", "was_changed"],
} as const;

export function buildLlmSanitizerUserMessage(rawPrompt: string): string {
  return `Rewrite this prompt to pass Vertex RAI safety filters. Asset type: scene_illustration.\n\n=== ORIGINAL PROMPT ===\n${rawPrompt}\n=== END ORIGINAL PROMPT ===`;
}
