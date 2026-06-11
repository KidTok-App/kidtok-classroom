/**
 * Scene-prompt template + visual safety gate prompt.
 *
 * The template is the seed for the Phoenix-managed "kidtok-scene-prompt"
 * prompt. It was assembled from the legacy prompt builders
 * (agent-service/legacy-reference/dynamicPromptContext.ts age visual specs +
 * the global cartoon style mandate) and is rendered with
 * applyScaffold()/assertNoUnresolvedTokens() from scaffoldTemplating.ts.
 *
 * Supported tokens: {visual_description}, {topic}, {age_label}, {age_visual_style}
 */

export const SCENE_PROMPT_NAME = "kidtok-scene-prompt";

export const GLOBAL_CARTOON_STYLE =
  "warm, friendly 2D children's cartoon illustration, soft rounded shapes, vibrant colors";

export const LEGACY_SCENE_PROMPT_TEMPLATE = `{visual_description}. A scene from an educational cartoon about {topic} for a {age_label}. {age_visual_style} Global art direction: ${GLOBAL_CARTOON_STYLE}, gentle lighting, uncluttered composition with one clear focal point. No text, no letters, no numbers, no captions, no watermarks anywhere in the image. No photorealistic humans; stylized cartoon characters only.`;

export const SCENE_PROMPT_DESCRIPTION =
  "KidTok Classroom scene-image prompt template. Rendered per scene with {visual_description}, {topic}, {age_label}, {age_visual_style}. Managed by QualityReviewerAgent: it publishes improved versions when episode telemetry shows scene-image weaknesses.";

/**
 * Visual-asset safety classifier prompt — the Gemini-side replacement for the
 * legacy remote classifier endpoint (the gate semantics in
 * legacy-reference/visualSafetyGate.ts are preserved by clients/imageSafety.ts:
 * fail-open on infrastructure errors, throw only on a positive unsafe verdict).
 */
export const VISUAL_SAFETY_SYSTEM_PROMPT = `You are a visual-content safety classifier for a children's educational platform (audience: ages 3-8).
You will be shown ONE generated cartoon illustration. Classify it.

Mark "safe": friendly cartoon scenes, animals, nature, objects, abstract shapes, stylized mascot characters.
Mark "unsafe" when the image contains ANY of: realistic depictions of human children, violence or weapons, gore or blood, scary/horror imagery likely to frighten young children, sexual or suggestive content, nudity, drugs/alcohol/smoking, hate symbols, dangerous acts presented as fun, or photorealistic humans.
Soft categories (image stays safe but flag them): mild_darkness, mild_peril, busy_composition, text_in_image.

Return JSON: { "safe": boolean, "reasons": string[], "categories": string[], "soft_categories": string[] }.
"categories" only lists hard-unsafe categories. Be conservative with hard categories — cartoon volcanoes, dinosaurs, weather, and space are normal educational content and are safe.`;

export const VISUAL_SAFETY_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    safe: { type: "BOOLEAN" },
    reasons: { type: "ARRAY", items: { type: "STRING" } },
    categories: { type: "ARRAY", items: { type: "STRING" } },
    soft_categories: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["safe", "reasons", "categories"],
} as const;
