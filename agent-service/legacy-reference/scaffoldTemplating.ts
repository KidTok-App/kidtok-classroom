/**
 * Scaffold Templating Helper
 *
 * Lightweight `{token}` substitution used by AI asset generators when an
 * admin-supplied prompt scaffold override is in effect. Empty/unknown tokens
 * are replaced with an empty string so a partial override never crashes the
 * pipeline.
 *
 * Used by: backgroundGenerator, characterOverlayGenerator, sceneObjectGenerator,
 * motifGenerator, loopGenerator, characterAnimGenerator, sceneObjectAnimGenerator.
 *
 * Tokens supported (depend on caller — see each DEFAULT_*_SCAFFOLD comment):
 *   {topic}, {character_description}, {object_description}, {motif_style},
 *   {topic_style}, {motion_note}, {anim_description}, {idle_loop_instruction},
 *   {duration_seconds}
 */

export function applyScaffold(template: string, vars: Record<string, string | number | undefined | null>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const v = vars[key];
    if (v === undefined || v === null) return '';
    return String(v);
  });
}

// ---------------------------------------------------------------------------
// Token safeguard (Chunk 2 of the AI Pipeline coherent patch)
//
// `applyScaffold` only substitutes `\{[A-Za-z_]\w*\}` patterns. Any template
// literal that uses a slightly different token shape — most commonly a
// hyphenated token like `{audio-clause}` instead of `{audio_clause}`, or a
// stray brace pair like `{TODO}` left over from copy-paste — survives
// substitution and is shipped verbatim to the model, where it materially
// degrades generation quality (Veo / Imagen treat the literal `{audio_clause}`
// as nonsense and the scaffold's downstream rules silently no-op).
//
// `assertNoUnresolvedTokens` scans a fully-rendered prompt for any surviving
// brace token and throws `UnresolvedScaffoldTokenError`. It is wired into
// every scaffold build site (background, motif, loop with-ref + no-ref,
// character overlay, character animation with-ref + no-ref, scene-object
// overlay, scene-object animation with-ref + no-ref). Throwing fails the AI
// asset job loud and early, surfacing the bug in worker logs instead of
// silently shipping a broken prompt.
// ---------------------------------------------------------------------------

export class UnresolvedScaffoldTokenError extends Error {
  public readonly code = 'UNRESOLVED_SCAFFOLD_TOKEN' as const;
  constructor(public readonly tokens: string[], public readonly site: string) {
    super(`Unresolved scaffold token(s) at ${site}: ${tokens.join(', ')}`);
    this.name = 'UnresolvedScaffoldTokenError';
  }
}

// Catches hyphenated, dotted, mixedCase, or otherwise non-`\w` brace tokens
// that `applyScaffold`'s `\{(\w+)\}` regex skips over. Examples it detects:
//   {audio-clause}, {age.style}, {TODO}, {character description}
// Examples it intentionally ignores (these are NOT tokens, they are JSON-ish
// braces that legitimately appear in some scaffolds):
//   {}, { foo: 1 }, {"key": "value"}
// Heuristic: a brace pair surrounding a token-like identifier with no
// surrounding whitespace and at least one alphabetic character.
const UNRESOLVED_TOKEN_RE = /\{(?=[^{}\s]*[A-Za-z])[^{}\s]+\}/g;

export function assertNoUnresolvedTokens(rendered: string, site: string): void {
  const matches = rendered.match(UNRESOLVED_TOKEN_RE);
  if (!matches || matches.length === 0) return;
  const unique = Array.from(new Set(matches));
  throw new UnresolvedScaffoldTokenError(unique, site);
}

// ---------------------------------------------------------------------------
// Shared style clauses for character + scene-object overlay/animation scaffolds
//
// These two clauses are spliced verbatim into the six scaffolds covering
// character_overlay, scene_object_overlay, character_animation (with-ref +
// no-ref), and scene_object_animation (with-ref + no-ref). They are
// mirrored byte-for-byte in:
//   - supabase/functions/_shared/aiAssetPromptBuilder.ts (Test Asset
//     Generator preview path)
//   - src/components/dev-panel/aiPipelineDefaults.ts (Dev Panel default
//     mirror)
// per the dual-source-of-truth contract documented in
// mem://style/ai-asset-prompt-positive-phrasing.
//
// Loops and motifs are intentionally NOT consumers — invasiveness of those
// asset families is being mitigated via `global_defaults.ai_opacity` first
// (see mem://features/ai-pipeline-motif-and-animation-reuse-settings).
// ---------------------------------------------------------------------------

/**
 * Prohibits luminous, atmospheric, shadow, and soft-falloff effects that
 * would otherwise survive matte extraction as a dark halo / haze / shadow
 * cloud around the subject (evidence: image-308 / image-309 — luminous rim
 * halo; image-325 — Round 10 dark atmospheric/painterly fog around the
 * silhouette that the matter pass keys as opaque). Closes the dark-halo
 * mode by enumerating: luminous + lens-flare + bloom + atmospheric haze
 * (fog/mist/smoke/dust) + motion-blur smear + shadow (drop/cast/ground/
 * contact/ambient-occlusion) + soft painted falloff, and pinning a hard
 * alpha boundary between subject and the surrounding pure black field.
 *
 * Mirrored byte-for-byte in:
 *   - supabase/functions/_shared/aiAssetPromptBuilder.ts (BASE_DESIGN_NO_GLOW_CLAUSE)
 *   - src/components/dev-panel/aiPipelineDefaults.ts (6 inlined copies)
 */
export const BASE_DESIGN_NO_GLOW_CLAUSE =
  `Use clean flat base colors with a uniform matte finish — no glow, no aura, no light halo, no bloom, no rim-light, no rim-lighting, no edge-light, no back-light, no lens flare, no inner light, no inner glow, no outer glow, no specular shine, no specular highlight, no colored lighting wash, no light beams, no light rays, no god rays, no light leaks, no sunbeam, no spotlight cone, no luminous outline, no luminescence, no neon, no fluorescent edge, no chromatic aberration, no painted gradient around the silhouette, no painterly atmospheric haze, no fog, no mist, no dust cloud, no smoke, no smoke puff, no smoke trail, no motion blur smear, no speed-line haze, no energy field, no aura cloud, no soft shadow, no hard shadow, no drop shadow, no cast shadow, no ground shadow, no contact shadow, no ambient-occlusion darkening, no shaded vignette, no dark gradient halo, and no painted dark fade around the subject. The subject reads as a flat 2D cartoon illustration lit only by its own base colors. Every pixel that is not part of the subject's own colored fill is uniform pure black #000000 — flat, opaque, uninterrupted, with zero gradient, zero darkening ramp, and zero color shift toward the subject's edge. The transition from subject to surrounding pure black is a hard alpha boundary, not a soft painted falloff. The full canvas outside the subject is one continuous flat field of pure black #000000 reaching every frame edge — no white frame, no white border, no white picture-frame mat, no white passe-partout, no white margin, no white inset, no white safe-area band, no paper edge, no card edge, no sticker die-cut white rim, no polaroid border, no postcard border, no scrapbook frame, no torn-paper edge, no white vignette, no white corner highlight, no light-colored canvas behind the subject. The black field touches every pixel of the outer frame on all four sides.`;

/**
 * Borderless-first contour guidance with a palette-matched fallback. If a
 * contour appears it must be a thin soft tone hand-picked from the subject's
 * own palette — never pure black, never a hard inked stroke. Replaces the
 * prior wording ("Thin dark outlines and small dark details are fine" /
 * "clean outlines") that passively encouraged black ink contours.
 */
export const PALETTE_OUTLINE_CLAUSE =
  `Borderless preferred — the silhouette is defined by the base colors against the surrounding pure black field, with no drawn contour. If an outline is unavoidable, use a thin soft contour in a palette-matched tone — a slightly darker or lighter shade of the adjacent fill color from the subject's own palette — never pure black, never a hard inked stroke, never a uniform dark contour around the whole subject. BRIGHT OUTLINE LUMINANCE FLOOR (HARD NUMERIC RULE): if any contour is drawn anywhere on the subject, every pixel of that contour MUST have an sRGB luminance Y' of at least 0.60 (i.e. clearly bright, never below Y' 0.45 anywhere along the contour). The contour color must come from the subject's own bright palette (a saturated, light-or-mid tone of an adjacent fill — for example bright lemon yellow, bright mint green, bright sky blue, bright coral, bright lavender). Pure black, near-black, dark grey, dark brown, dark navy, charcoal, or any low-luminance contour that could be visually mistaken for the surrounding pure-black canvas is forbidden — such a contour will be erased by the alpha matting pass and the subject will read as transparent. Borderless remains the preferred choice; only fall back to a bright palette contour if the subject visually requires it.`;
