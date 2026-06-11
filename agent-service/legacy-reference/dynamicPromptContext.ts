/**
 * Dynamic AI Prompt Context Builder
 *
 * Centralized module that produces lesson-specific prompt descriptions for
 * all AI asset types. When an AI prompt plan is available (from assetPromptPlanner),
 * uses those rich, LLM-generated descriptions. Otherwise falls back to simple
 * topic-based descriptions.
 *
 * When `useLegacyCategories=true`, delegates to the original keyword-match
 * resolvers (preserved in each generator module as exports).
 */

import type { LessonDataForAssets } from '../assets.js';

// ---------------------------------------------------------------------------
// AI Prompt Overrides — optional, runtime-config-driven
//
// All fields are optional appended suffixes (or planner system-prompt
// override). Empty/unset = unchanged hardcoded behavior. Resolved upstream
// from runtimeConfig.global_defaults.ai_prompts.* and threaded through
// processor.ts to each resolver.
// ---------------------------------------------------------------------------

export interface AiPromptOverrides {
  safety_prefix?: string;
  character_style_suffix?: string;
  scene_object_style_suffix?: string;
  motif_style_suffix?: string;
  loop_style_suffix?: string;
  background_style_suffix?: string;
  planner_system_instruction?: string;

  // ---------------------------------------------------------------------------
  // Per-asset prompt scaffolds (REPLACE semantics, with {token} substitution).
  //
  // When set, each scaffold replaces the corresponding hardcoded build*Prompt()
  // template inside its generator. Tokens like {topic}, {character_description},
  // {object_description}, {motif_style}, {topic_style}, {motion_note},
  // {anim_description}, {idle_loop_instruction}, {duration_seconds} are
  // substituted via scaffoldTemplating.applyScaffold(). Empty = use default.
  //
  // Mirrored verbatim in `src/components/dev-panel/aiPipelineDefaults.ts`
  // (DEFAULT_*_SCAFFOLD constants). See naming_discrepancies.md.
  // ---------------------------------------------------------------------------
  background_scaffold?: string;
  character_overlay_scaffold?: string;
  scene_object_overlay_scaffold?: string;
  motif_scaffold?: string;
  loop_scaffold?: string;
  /** Optional scaffold override for the loop's image-to-video branch when the
   *  freshly-generated background PNG is supplied as a Veo reference image.
   *  See `loopGenerator.DEFAULT_LOOP_SCAFFOLD_WITH_REF` for the default. */
  loop_scaffold_with_ref?: string;
  character_anim_scaffold_with_ref?: string;
  character_anim_scaffold_no_ref?: string;
  scene_object_anim_scaffold_with_ref?: string;
  scene_object_anim_scaffold_no_ref?: string;

  // ---------------------------------------------------------------------------
  // Token-level overrides (REPLACE semantics, with overrideOrCompute helper).
  //
  // When a string is non-empty, it REPLACES the value the resolver would
  // otherwise compute for the matching token slot. Consumers must call
  // `overrideOrCompute(override, () => computeFn())` so an empty/undefined
  // override falls through to the existing computed default with zero
  // behavior change.
  //
  // Mirrored byte-for-byte in supabase/functions/_shared/aiAssetPromptBuilder.ts
  // and src/components/dev-panel/aiPipelineDefaults.ts.
  // See mem://architecture/test-preview-prompt-parity.
  // ---------------------------------------------------------------------------
  age_visual_style?: string;
  age_label?: string;
  gender_hint?: string;
  interest_clause?: string;
  motion_note_loop?: string;
  motion_note_char_anim?: string;
  motion_note_so_anim?: string;
  idle_loop_instruction_char?: string;
  idle_loop_instruction_so?: string;
  topic_style_loop?: string;
  motif_style_directive?: string;
  background_style_directive?: string;
}

/**
 * Helper for token-level overrides. When `overrideValue` is a non-empty
 * trimmed string, returns it verbatim (REPLACE semantics). Otherwise calls
 * `computeFn()` to produce the default. Used by every site that resolves
 * one of the 12 token overrides above so admins can substitute the value
 * without touching the surrounding scaffold.
 *
 * Mirrored verbatim in supabase/functions/_shared/aiAssetPromptBuilder.ts.
 */
export function overrideOrCompute(
  overrideValue: string | undefined | null,
  computeFn: () => string,
): string {
  if (typeof overrideValue === 'string' && overrideValue.trim().length > 0) {
    return overrideValue;
  }
  return computeFn();
}

function appendSuffix(base: string, suffix?: string): string {
  if (typeof suffix !== 'string') return base;
  const trimmed = suffix.trim();
  if (trimmed.length === 0) return base;
  return `${base} ${trimmed}`.trim();
}
// Age Visual Specs — mirrors ageSpecs.ts from supabase/functions/_shared/
// ---------------------------------------------------------------------------

interface AgeVisualSpec {
  age: number;
  stageLabel: string;
  toneDescriptor: string;
  abstractionLevel: string;
  /** Multi-sentence visual style directive for image generation prompts */
  visualStyle: string;
}

/**
 * Per-age visual specifications aligned with the educational ageSpecs.ts
 * framework. Each entry mirrors the corresponding AGE_SPECS entry and adds
 * concrete visual directives for AI image generation.
 */
const AGE_VISUAL_SPECS: Record<5 | 6 | 7 | 8, AgeVisualSpec> = {
  5: {
    age: 5,
    stageLabel: 'Kindergarten Entry',
    toneDescriptor: 'Enthusiastic, sing-song, exclamatory ("Wow! Look at that!").',
    abstractionLevel: 'Fully concrete — everything tied to visible/touchable objects.',
    visualStyle:
      'Friendly KidTok storybook-cartoon style with simple rounded shapes, clear silhouettes, and a warm playful palette. Keep details low and easy to read, but do not make the design babyish. Prefer borderless, outline-free character design using soft shape contrast, gentle shading, and color separation for readability. If an outline is needed, use a bright friendly colored outline, never black or dark heavy strokes. Use expressive faces, cozy proportions, and safe approachable forms. Colors may vary naturally to fit the lesson, as long as the result stays gentle, cheerful, and unified with KidTok.',
  },
  6: {
    age: 6,
    stageLabel: 'Early Reader',
    toneDescriptor: 'Warm and encouraging, slightly less sing-song.',
    abstractionLevel: 'Mostly concrete with simple categories ("These are all animals").',
    visualStyle:
      'Friendly KidTok storybook-cartoon style with simple expressive shapes, clear silhouettes, and a warm varied palette. Add a little more expression and visual specificity than age 5 while keeping the design clean, uncluttered, and easy to understand. Prefer borderless, outline-free character design using soft shape contrast, gentle shading, and color separation for readability. If an outline is needed, use a bright friendly colored outline, never black or dark heavy strokes. Use cheerful color choices that fit the topic instead of a fixed age palette. Keep characters approachable, safe, and playful.',
  },
  7: {
    age: 7,
    stageLabel: 'Developing Reader',
    toneDescriptor: 'Conversational, "let\'s figure this out together".',
    abstractionLevel: 'Beginning abstraction — timelines, simple classifications, basic "what would happen if".',
    visualStyle:
      'Friendly KidTok storybook-cartoon style with slightly richer poses, clearer topic details, and a balanced varied palette. Allow moderate detail and light texture when it helps the lesson, but keep silhouettes clean and the composition readable. Prefer borderless, outline-free character design using soft shape contrast, gentle shading, and color separation for readability. If an outline is needed, use a bright friendly colored outline, never black or dark heavy strokes. The character may feel curious, capable, or investigative while still remaining soft, playful, and consistent with the KidTok world.',
  },
  8: {
    age: 8,
    stageLabel: 'Independent Learner',
    toneDescriptor: 'Respectful, "you\'re ready to learn something cool".',
    abstractionLevel: 'Comfortable with categories, timelines, basic logical reasoning, hypotheticals.',
    visualStyle:
      'Friendly KidTok storybook-cartoon style with confident but still playful character design, clear silhouettes, and a polished educational look. Allow somewhat richer detail and topic-specific props when useful, but avoid realism, clutter, intense drama, or overly mature styling. Prefer borderless, outline-free character design using soft shape contrast, gentle shading, and color separation for readability. If an outline is needed, use a bright friendly colored outline, never black or dark heavy strokes. Use a flexible harmonious palette that fits the lesson while staying warm, safe, and recognizably KidTok.',
  },
};

/**
 * Resolve an age_band string to a supported exact age (5-8).
 * Mirrors resolveExactAge() from ageSpecs.ts.
 */
function resolveAge(ageBand: string): 5 | 6 | 7 | 8 {
  const trimmed = ageBand.trim();
  if (trimmed === '5') return 5;
  if (trimmed === '6') return 6;
  if (trimmed === '7') return 7;
  if (trimmed === '8') return 8;
  if (trimmed === '3-4') return 5;
  if (trimmed === '5-6') return 6;
  return 6;
}

function getVisualSpec(ageBand: string, data?: LessonDataForAssets): AgeVisualSpec {
  const hardcoded = AGE_VISUAL_SPECS[resolveAge(ageBand)];
  // Prefer DB-loaded visual params if available
  if (data?.db_visual_params) {
    return {
      ...hardcoded,
      stageLabel: data.db_stage_label ?? hardcoded.stageLabel,
      visualStyle: data.db_visual_params.visualStyle ?? hardcoded.visualStyle,
      toneDescriptor: data.db_visual_params.toneDescriptor ?? hardcoded.toneDescriptor,
      abstractionLevel: data.db_visual_params.abstractionLevel ?? hardcoded.abstractionLevel,
    };
  }
  return hardcoded;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ageLabel(ageBand: string, data?: LessonDataForAssets): string {
  const spec = getVisualSpec(ageBand, data);
  return `${spec.age}-year-old child (${spec.stageLabel})`;
}

/**
 * Per-asset-type age-style directive. Replaces the legacy practice of fanning
 * `spec.visualStyle` (a character-flavored string containing fragments like
 * "Confident character poses" and "Richer backgrounds with depth and layering")
 * into every resolver. Returns ONLY the per-asset-purpose-appropriate slice of
 * style guidance (palette/tone/density), keyed off `spec.age`.
 *
 * `resolveCharacterDescription` keeps using `spec.visualStyle` directly because
 * the character-flavored body is appropriate for the character mascot itself.
 *
 * Mirrored verbatim in `supabase/functions/_shared/aiAssetPromptBuilder.ts`
 * (`buildAgeStyleDirective`). Any edit MUST be reflected there in the same
 * patch — see naming_discrepancies.md.
 */
// Historically named "non-character"; now also covers character_overlay and
// character_animation (added 2026-05-08). Name preserved to avoid a parallel
// pipeline; see naming_discrepancies.md.
export type NonCharacterAgeAssetType =
  | 'background'
  | 'motif'
  | 'loop'
  | 'scene_object'
  | 'scene_object_animation'
  | 'character_overlay'
  | 'character_animation';

export function buildAgeStyleDirective(
  spec: AgeVisualSpec,
  assetType: NonCharacterAgeAssetType,
  data?: LessonDataForAssets,
): string {
  // Per-age Quality-tab override wins when non-empty.
  const perAsset = data?.db_visual_params?.per_asset_visual_style;
  if (perAsset) {
    const candidate = (perAsset as Record<string, string | undefined>)[assetType];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }

  const age = spec.age;

  if (assetType === 'background') {
    if (age <= 5) return 'Warm, friendly KidTok background style for young learners: simple readable environment, soft lighting, gentle contrast, and a flexible cheerful palette that fits the lesson. Keep the scene uncluttered and cozy without forcing pastel-only colors.';
    if (age === 6) return 'Warm, friendly KidTok background style: clear simple environment, cheerful topic-appropriate colors, soft lighting, and slightly more visual variety than age 5. Keep the background readable, welcoming, and uncluttered.';
    if (age === 7) return 'Warm, friendly KidTok background style with a bit more atmosphere, depth, and topic-specific detail while staying clean and easy to read. Use a harmonious varied palette chosen for the lesson, not a fixed age palette.';
    return 'Warm, friendly KidTok background style with polished educational atmosphere, readable depth, and useful topic-specific details. Keep it playful and clear rather than cinematic, realistic, dark, or overly complex. Use a flexible harmonious palette that still feels unified with KidTok.';
  }

  if (assetType === 'scene_object') {
    if (age <= 5) return 'Simple rounded KidTok cartoon object with a clear silhouette, friendly proportions, soft shape contrast, and a warm flexible palette. Prefer a borderless, outline-free object design that remains readable through color separation and gentle shading. If an outline is needed, use a bright friendly colored outline, never black or dark heavy strokes. Keep details minimal and easy to recognize without making the object feel babyish.';
    if (age === 6) return 'Simple expressive KidTok cartoon object with a clear silhouette, friendly proportions, soft shape contrast, and cheerful topic-appropriate colors. Prefer a borderless, outline-free object design that remains readable through color separation and gentle shading. If an outline is needed, use a bright friendly colored outline, never black or dark heavy strokes. Add a little more specificity than age 5 while keeping the object readable and uncluttered.';
    if (age === 7) return 'KidTok cartoon object with a clear silhouette, slightly more expressive shape language, moderate topic detail, soft shape contrast, and a balanced varied palette. Prefer a borderless, outline-free object design that remains readable through color separation and gentle shading. If an outline is needed, use a bright friendly colored outline, never black or dark heavy strokes. Light texture is allowed only when it improves clarity and charm.';
    return 'Polished KidTok cartoon object with a clear silhouette, confident friendly proportions, soft shape contrast, and useful topic-specific details. Prefer a borderless, outline-free object design that remains readable through color separation and gentle shading. If an outline is needed, use a bright friendly colored outline, never black or dark heavy strokes. Keep it playful, readable, and not overly realistic or complex. Use harmonious colors that fit the lesson while staying consistent with KidTok.';
  }

  if (assetType === 'motif') {
    if (age <= 5) return 'Gentle KidTok particle accents with a soft, flexible palette, sparse density, and a light transparent feeling. Keep the motif simple, calm, and supportive rather than visually dominant.';
    if (age === 6) return 'Gentle KidTok particle accents with cheerful topic-appropriate colors, sparse density, and a light transparent feeling. Add slight variety while keeping the motif calm and supportive.';
    if (age === 7) return 'Gentle KidTok particle accents with a balanced varied palette, subtle motion-friendly shapes, sparse density, and a light transparent feeling. The motif may feel a little more curious or energetic but should stay unobtrusive.';
    return 'Gentle KidTok particle accents with a polished harmonious palette, sparse density, and a light transparent feeling. Allow slightly richer accents when useful, but keep the motif calm, readable, and supportive of the lesson.';
  }

  if (assetType === 'character_overlay') {
    if (age <= 5) return 'Friendly KidTok storybook-cartoon character overlay for young learners, with simple rounded forms, clear silhouette, cozy proportions, and a warm flexible palette chosen for the lesson. Prefer a borderless, outline-free character design that stays readable through soft shape contrast, gentle shading, and color separation. If an outline is needed, use a bright friendly colored outline, never black or dark heavy strokes. Keep details low, expressions kind and easy to read, and the overall design playful without feeling babyish.';
    if (age === 6) return 'Friendly KidTok storybook-cartoon character overlay with simple expressive forms, clear silhouette, approachable proportions, and cheerful topic-appropriate colors. Prefer a borderless, outline-free character design that stays readable through soft shape contrast, gentle shading, and color separation. If an outline is needed, use a bright friendly colored outline, never black or dark heavy strokes. Add a little more expression and specificity than age 5 while keeping the character clean, uncluttered, safe, and playful.';
    if (age === 7) return 'Friendly KidTok storybook-cartoon character overlay with slightly richer posing, clear silhouette, curious expression, and moderate topic-specific detail. Prefer a borderless, outline-free character design that stays readable through soft shape contrast, gentle shading, and color separation. If an outline is needed, use a bright friendly colored outline, never black or dark heavy strokes. Allow light texture or small props when they help the lesson, but keep the design soft, readable, and consistent with the KidTok world.';
    return 'Friendly KidTok storybook-cartoon character overlay with a confident but still playful educational look, clear silhouette, polished shape language, and useful topic-specific details. Prefer a borderless, outline-free character design that stays readable through soft shape contrast, gentle shading, and color separation. If an outline is needed, use a bright friendly colored outline, never black or dark heavy strokes. Avoid realism, clutter, intense drama, or overly mature styling. Use harmonious colors that fit the lesson while staying warm, safe, and recognizably KidTok.';
  }

  if (assetType === 'scene_object_animation') {
    if (age <= 5) return 'Gentle KidTok scene-object animation for one isolated stylized cartoon object only. The object should gently levitate or float in place on a pure black empty background. Animate only the object itself with very simple classroom-safe motion such as a soft bounce, tiny tilt, gentle wiggle, or slow hover. Keep every non-object pixel pure black and motionless throughout the animation. Preserve the original object design, clear silhouette, borderless or softly colored-edge look, warm flexible palette, and easy-to-recognize shape. Keep the motion soothing, readable, and playful without adding scenery, particles, symbols, text, extra objects, or environmental effects.';
    if (age === 6) return 'Gentle KidTok scene-object animation for one isolated stylized cartoon object only. The object should gently levitate or float in place on a pure black empty background. Animate only the object itself with simple cheerful classroom-safe motion such as a light bounce, small rotation, subtle tilt, gentle wiggle, or slow hover. Keep every non-object pixel pure black and motionless throughout the animation. Preserve the original object design, clear silhouette, borderless or softly colored-edge look, cheerful topic-appropriate colors, and friendly proportions. Keep the motion clear, supportive, and non-distracting without adding scenery, particles, symbols, text, extra objects, or environmental effects.';
    if (age === 7) return 'Gentle KidTok scene-object animation for one isolated stylized cartoon object only. The object should gently levitate or float in place on a pure black empty background. Animate only the object itself with calm curious classroom-safe motion such as a subtle hover, small tilt, soft bounce, gentle rotation, or tiny expressive movement. Keep every non-object pixel pure black and motionless throughout the animation. Preserve the original object design, clear silhouette, borderless or softly colored-edge look, balanced varied palette, and moderate topic detail. Keep the motion readable and educational without adding scenery, particles, symbols, text, extra objects, or environmental effects.';
    return 'Gentle KidTok scene-object animation for one isolated stylized cartoon object only. The object should gently levitate or float in place on a pure black empty background. Animate only the object itself with polished but restrained classroom-safe motion such as a slow hover, small confident tilt, subtle bounce, gentle rotation, or controlled pose-like shift. Keep every non-object pixel pure black and motionless throughout the animation. Preserve the original object design, clear silhouette, borderless or softly colored-edge look, harmonious lesson-appropriate palette, and useful topic-specific details. Keep the motion playful, readable, and educational rather than cinematic, intense, or busy, without adding scenery, particles, symbols, text, extra objects, or environmental effects.';
  }

  if (assetType === 'character_animation') {
    if (age <= 5) return 'Gentle KidTok character animation for one isolated stylized cartoon character only. The character should gently levitate or float in place on a pure black empty background. Animate only the existing character with very simple classroom-safe motion such as a soft bounce, small wave, blink, nod, tiny hand gesture, or friendly look-around. Keep every non-character pixel pure black and motionless throughout the animation. Preserve the original character design, clear silhouette, borderless or softly colored-edge look, warm flexible palette, cozy proportions, and kind playful expression. Keep the motion soothing, readable, and comforting without adding scenery, particles, symbols, text, extra characters, new props, or environmental effects.';
    if (age === 6) return 'Gentle KidTok character animation for one isolated stylized cartoon character only. The character should gently levitate or float in place on a pure black empty background. Animate only the existing character with simple cheerful classroom-safe motion such as blinking, nodding, a small wave, subtle pointing, light upbeat bounce, or friendly look-around. Keep every non-character pixel pure black and motionless throughout the animation. Preserve the original character design, clear silhouette, borderless or softly colored-edge look, cheerful topic-appropriate colors, approachable proportions, and playful expression. Keep the motion clear and supportive of the lesson without adding scenery, particles, symbols, text, extra characters, new props, or environmental effects.';
    if (age === 7) return 'Gentle KidTok character animation for one isolated stylized cartoon character only. The character should gently levitate or float in place on a pure black empty background. Animate only the existing character with calm curious classroom-safe motion such as a thoughtful nod, small explanatory gesture, friendly wave, subtle pointing, light bounce, or brief look-around. Keep every non-character pixel pure black and motionless throughout the animation. Preserve the original character design, clear silhouette, borderless or softly colored-edge look, balanced varied palette, curious expression, and KidTok storybook-cartoon style. Keep the motion slow, readable, and non-distracting without adding scenery, particles, symbols, text, extra characters, new props, or environmental effects.';
    return 'Gentle KidTok character animation for one isolated stylized cartoon character only. The character should gently levitate or float in place on a pure black empty background. Animate only the existing character with polished but restrained classroom-safe motion such as a confident nod, small explanatory gesture, friendly wave, subtle pointing, blink, calm pose shift, or slow hover. Keep every non-character pixel pure black and motionless throughout the animation. Preserve the original character design, clear silhouette, borderless or softly colored-edge look, harmonious lesson-appropriate palette, confident playful expression, and KidTok storybook-cartoon style. Keep the animation clear and educational rather than cinematic, intense, realistic, or busy, without adding scenery, particles, symbols, text, extra characters, new props, or environmental effects.';
  }

  // assetType === 'loop'
  if (age <= 5) return 'Very calm KidTok ambient motion with soft, friendly visual energy and a flexible gentle palette. Motion should feel soothing, simple, and easy to follow.';
  if (age === 6) return 'Calm KidTok ambient motion with cheerful, friendly visual energy and topic-appropriate colors. Motion should feel gentle, clear, and supportive of the lesson.';
  if (age === 7) return 'Calm KidTok ambient motion with slightly more atmosphere and visual variety while remaining slow, readable, and supportive. Avoid busy or distracting movement.';
  return 'Calm KidTok ambient motion with polished educational atmosphere and subtle depth. Allow slightly richer movement when helpful, but avoid intense, cinematic, chaotic, or overly dynamic motion.';
}

function genderHint(gender: string, dbDirective?: string | null): string {
  // Prefer DB-loaded directive when available
  if (dbDirective) return dbDirective;
  // Hardcoded fallback
  if (gender === 'boy') {
    return 'The character should have a boyish appearance — short or spiky hair, sporty or adventurous clothing (cape, sneakers, backpack). Energetic, confident posture.';
  }
  if (gender === 'girl') {
    return 'The character should have a girlish appearance — longer hair with accessories (bow, headband, ponytail), colorful expressive outfit. Curious, enthusiastic posture.';
  }
  return 'The character should have a gender-neutral appearance — simple hairstyle, casual colorful clothing. Friendly, approachable posture.';
}

function interestClause(interest: string | null): string {
  if (!interest || interest.trim().length === 0) return '';
  return ` Incorporate visual elements of ${interest.trim()}.`;
}

// ---------------------------------------------------------------------------
// Public resolvers — dynamic path
//
// NOTE: The fallback base-template literals inside each resolve* function below
// (the strings used when `data.ai_prompt_plan` is unavailable) are mirrored in
// `src/components/dev-panel/aiPipelineDefaults.ts` (CHARACTER_BASE_TEMPLATE_DEFAULT,
// SCENE_OBJECT_BASE_TEMPLATE_DEFAULT, MOTIF_BASE_TEMPLATE_DEFAULT,
// LOOP_BASE_TEMPLATE_DEFAULT, BACKGROUND_BASE_TEMPLATE_DEFAULT). Any edit here
// MUST be reflected there in the same patch — see naming_discrepancies.md.
// ---------------------------------------------------------------------------

export function resolveCharacterDescription(
  data: LessonDataForAssets,
  useLegacyCategories: boolean,
  promptOverrides?: AiPromptOverrides,
): string {
  if (useLegacyCategories) {
    return ''; // empty signals caller to use legacy in-module resolver
  }

  const spec = getVisualSpec(data.age_band, data);
  const gender = overrideOrCompute(promptOverrides?.gender_hint, () =>
    genderHint(data.child_gender, data.db_gender_directive));
  const ageVisualStyle = overrideOrCompute(promptOverrides?.age_visual_style, () => spec.visualStyle);
  const interest = overrideOrCompute(promptOverrides?.interest_clause, () => interestClause(data.interest));

  let base: string;
  if (data.ai_prompt_plan?.character_description) {
    base = `${data.ai_prompt_plan.character_description} ${ageVisualStyle} ${gender}`.trim();
  } else {
    const age = overrideOrCompute(promptOverrides?.age_label, () => ageLabel(data.age_band, data));
    base = (
      `a friendly,  safe for children, cute cartoon character mascot inspired by the lesson topic "${data.topic}" for a ${age}. ` +
      `${ageVisualStyle} ${gender}` +
      interest
    ).trim();
  }
  return appendSuffix(base, promptOverrides?.character_style_suffix);
}

export function resolveSceneObjectDescription(
  data: LessonDataForAssets,
  shotIndex: number,
  useLegacyCategories: boolean,
  promptOverrides?: AiPromptOverrides,
): string {
  if (useLegacyCategories) return '';

  const spec = getVisualSpec(data.age_band, data);
  const styleDirective = overrideOrCompute(promptOverrides?.age_visual_style, () =>
    buildAgeStyleDirective(spec, 'scene_object', data));
  const interest = overrideOrCompute(promptOverrides?.interest_clause, () => interestClause(data.interest));

  let base: string;
  if (data.ai_prompt_plan?.scene_object_descriptions?.length) {
    const descriptions = data.ai_prompt_plan.scene_object_descriptions;
    const desc = descriptions[shotIndex % descriptions.length];
    base = `${desc} ${styleDirective}`.trim();
  } else {
    base = (
      `a cute,  safe for children, colorful cartoon object related to the lesson "${data.topic}". ` +
      `${styleDirective}` +
      interest
    ).trim();
  }
  return appendSuffix(base, promptOverrides?.scene_object_style_suffix);
}

export function resolveMotifStyleDescription(
  data: LessonDataForAssets,
  useLegacyCategories: boolean,
  promptOverrides?: AiPromptOverrides,
): string {
  if (useLegacyCategories) return '';

  const spec = getVisualSpec(data.age_band, data);
  const styleDirective = overrideOrCompute(promptOverrides?.motif_style_directive, () =>
    overrideOrCompute(promptOverrides?.age_visual_style, () => buildAgeStyleDirective(spec, 'motif', data)));

  let base: string;
  if (data.ai_prompt_plan?.motif_style) {
    base = `${data.ai_prompt_plan.motif_style} ${styleDirective}`.trim();
  } else {
    base = (
      `Glowing animated accent particles and effects related to the lesson topic "${data.topic}". ` +
      `${styleDirective}`
    ).trim();
  }
  return appendSuffix(base, promptOverrides?.motif_style_suffix);
}

export function resolveLoopStyleDescription(
  data: LessonDataForAssets,
  useLegacyCategories: boolean,
  promptOverrides?: AiPromptOverrides,
): string {
  if (useLegacyCategories) return '';

  const spec = getVisualSpec(data.age_band, data);
  const styleDirective = overrideOrCompute(promptOverrides?.age_visual_style, () =>
    buildAgeStyleDirective(spec, 'loop', data));
  const dbMotionLoop = data.db_visual_params?.motion_notes?.loop;
  const motion = overrideOrCompute(promptOverrides?.motion_note_loop, () => {
    if (typeof dbMotionLoop === 'string' && dbMotionLoop.trim().length > 0) return dbMotionLoop;
    return (spec.age <= 5)
      ? 'Very slow, gentle motion. Calm and soothing.'
      : (spec.age >= 8)
        ? 'Moderate gentle motion. Slightly dynamic but still calm.'
        : 'Slow, gentle motion. Dreamy pace.';
  });
  const interest = overrideOrCompute(promptOverrides?.interest_clause, () => interestClause(data.interest));

  let base: string;
  if (data.ai_prompt_plan?.loop_style) {
    base = `${data.ai_prompt_plan.loop_style} ${motion} ${styleDirective}`.trim();
  } else {
    base = (
      `A dreamy, atmospheric background animation mood and movement elements heavily inspired by the background reference image as a canvas where those effects should be happening in the frame, but never just using the background image itself in the final output for a lesson about "${data.topic}". ` +
      `${motion} ${styleDirective} ` +
      interest
    ).trim();
  }
  return appendSuffix(base, promptOverrides?.loop_style_suffix);
}

export function resolveBackgroundContext(
  data: LessonDataForAssets,
  useLegacyCategories: boolean,
  promptOverrides?: AiPromptOverrides,
): string {
  if (useLegacyCategories) return '';

  const spec = getVisualSpec(data.age_band, data);
  const styleDirective = overrideOrCompute(promptOverrides?.background_style_directive, () =>
    overrideOrCompute(
      data.db_visual_params?.background_style_directive,
      () => overrideOrCompute(promptOverrides?.age_visual_style, () => buildAgeStyleDirective(spec, 'background', data)),
    ));
  const interest = overrideOrCompute(promptOverrides?.interest_clause, () => interestClause(data.interest));

  let base: string;
  if (data.ai_prompt_plan?.background_context) {
    base = `${data.ai_prompt_plan.background_context} ${styleDirective}`.trim();
  } else {
    base = (
      `A beautiful, colorful, saturated background illustration for a lesson about "${data.topic}". ` +
      `${styleDirective} ` +
      interest
    ).trim();
  }
  return appendSuffix(base, promptOverrides?.background_style_suffix);
}
