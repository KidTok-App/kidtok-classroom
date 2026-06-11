/**
 * Age specifications for the supported age bands (5 / 6 / 7 / 8).
 *
 * Ported from agent-service/legacy-reference/dynamicPromptContext.ts
 * (AGE_VISUAL_SPECS + resolveAge + ageLabel) and the age-band prompt rules in
 * agent-service/legacy-reference/generate-lesson.ts (system prompt language
 * requirements). The educational specs (vocabulary tier / sentence range /
 * repetition style) are compacted from the same framework.
 */

export type ExactAge = 5 | 6 | 7 | 8;

export interface AgeSpec {
  age: ExactAge;
  stageLabel: string;
  toneDescriptor: string;
  abstractionLevel: string;
  vocabularyTier: string;
  sentenceLengthRange: [number, number];
  repetitionStyle: string;
  /** Multi-sentence visual style directive for image generation prompts */
  visualStyle: string;
}

export const AGE_SPECS: Record<ExactAge, AgeSpec> = {
  5: {
    age: 5,
    stageLabel: "Kindergarten Entry",
    toneDescriptor: 'Enthusiastic, sing-song, exclamatory ("Wow! Look at that!").',
    abstractionLevel: "Fully concrete — everything tied to visible/touchable objects.",
    vocabularyTier:
      "Only the most common everyday words a 5-year-old already knows; zero jargon.",
    sentenceLengthRange: [5, 8],
    repetitionStyle: "Use heavy repetition and rhythm for memory.",
    visualStyle:
      "Friendly KidTok storybook-cartoon style with simple rounded shapes, clear silhouettes, and a warm playful palette. Keep details low and easy to read, but do not make the design babyish. Prefer borderless, outline-free character design using soft shape contrast, gentle shading, and color separation for readability. If an outline is needed, use a bright friendly colored outline, never black or dark heavy strokes. Use expressive faces, cozy proportions, and safe approachable forms. Colors may vary naturally to fit the lesson, as long as the result stays gentle, cheerful, and unified with KidTok.",
  },
  6: {
    age: 6,
    stageLabel: "Early Reader",
    toneDescriptor: "Warm and encouraging, slightly less sing-song.",
    abstractionLevel: 'Mostly concrete with simple categories ("These are all animals").',
    vocabularyTier:
      "Simple everyday words a 6-year-old knows, plus one or two new words explained with playful analogies.",
    sentenceLengthRange: [6, 10],
    repetitionStyle: "Use gentle repetition of the key words.",
    visualStyle:
      "Friendly KidTok storybook-cartoon style with simple expressive shapes, clear silhouettes, and a warm varied palette. Add a little more expression and visual specificity than age 5 while keeping the design clean, uncluttered, and easy to understand. Prefer borderless, outline-free character design using soft shape contrast, gentle shading, and color separation for readability. If an outline is needed, use a bright friendly colored outline, never black or dark heavy strokes. Use cheerful color choices that fit the topic instead of a fixed age palette. Keep characters approachable, safe, and playful.",
  },
  7: {
    age: 7,
    stageLabel: "Developing Reader",
    toneDescriptor: 'Conversational, "let\'s figure this out together".',
    abstractionLevel:
      'Beginning abstraction — timelines, simple classifications, basic "what would happen if".',
    vocabularyTier:
      "Everyday words a 7-year-old knows; new topic words are allowed when immediately explained simply.",
    sentenceLengthRange: [8, 12],
    repetitionStyle: "Repeat the key terms naturally across the lesson.",
    visualStyle:
      "Friendly KidTok storybook-cartoon style with slightly richer poses, clearer topic details, and a balanced varied palette. Allow moderate detail and light texture when it helps the lesson, but keep silhouettes clean and the composition readable. Prefer borderless, outline-free character design using soft shape contrast, gentle shading, and color separation for readability. If an outline is needed, use a bright friendly colored outline, never black or dark heavy strokes. The character may feel curious, capable, or investigative while still remaining soft, playful, and consistent with the KidTok world.",
  },
  8: {
    age: 8,
    stageLabel: "Independent Learner",
    toneDescriptor: 'Respectful, "you\'re ready to learn something cool".',
    abstractionLevel:
      "Comfortable with categories, timelines, basic logical reasoning, hypotheticals.",
    vocabularyTier:
      "Richer everyday vocabulary an 8-year-old understands; topic terms welcome with a one-line kid-friendly definition.",
    sentenceLengthRange: [10, 14],
    repetitionStyle: "Reinforce the key ideas through varied restatement.",
    visualStyle:
      "Friendly KidTok storybook-cartoon style with confident but still playful character design, clear silhouettes, and a polished educational look. Allow somewhat richer detail and topic-specific props when useful, but avoid realism, clutter, intense drama, or overly mature styling. Prefer borderless, outline-free character design using soft shape contrast, gentle shading, and color separation for readability. If an outline is needed, use a bright friendly colored outline, never black or dark heavy strokes. Use a flexible harmonious palette that fits the lesson while staying warm, safe, and recognizably KidTok.",
  },
};

/**
 * Resolve an ageBand (number or string) to a supported exact age (5-8).
 * Mirrors resolveAge() from the legacy dynamicPromptContext.ts.
 */
export function resolveAge(ageBand: string | number): ExactAge {
  const trimmed = String(ageBand).trim();
  if (trimmed === "5") return 5;
  if (trimmed === "6") return 6;
  if (trimmed === "7") return 7;
  if (trimmed === "8") return 8;
  if (trimmed === "3-4") return 5;
  if (trimmed === "5-6") return 6;
  return 6;
}

export function getAgeSpec(ageBand: string | number): AgeSpec {
  return AGE_SPECS[resolveAge(ageBand)];
}

export function ageLabel(ageBand: string | number): string {
  const spec = getAgeSpec(ageBand);
  return `${spec.age}-year-old child (${spec.stageLabel})`;
}

/**
 * Age section injected into the ScriptAgent system prompt.
 * Ported from the legacy buildAgeSectionForPrompt usage in generate-lesson.ts.
 */
export function buildAgeSectionForPrompt(spec: AgeSpec): string {
  return [
    `=== AUDIENCE: AGE ${spec.age} (${spec.stageLabel}) ===`,
    `- Tone: ${spec.toneDescriptor}`,
    `- Abstraction level: ${spec.abstractionLevel}`,
    `- Vocabulary tier: ${spec.vocabularyTier}`,
    `- Sentence length: keep sentences within the ${spec.sentenceLengthRange[0]}-${spec.sentenceLengthRange[1]} word range — this is a HARD ceiling`,
    `- ${spec.repetitionStyle}`,
  ].join("\n");
}
