/**
 * Narration text cleaning + Google TTS parameter compilation.
 *
 * Ported from agent-service/legacy-reference/compiler.ts and providers.ts —
 * ONLY the Google branch was kept; every other vendor path was deleted per
 * the runtime mandate. The markup/SSML machinery was collapsed to the plain
 * text path (this service narrates one short scene at a time).
 */

export const MAX_TTS_CHARS = 900;

export interface GoogleTtsSettings {
  voiceName: string;
  languageCode: string;
  speakingRate: number;
  pitch: number;
}

/** Child-friendly preset: slightly slow, warm. Mirrors the legacy GOOGLE_PRESETS "warm_teacher" shape. */
export const DEFAULT_GOOGLE_PRESET = {
  speakingRate: 0.92,
  pitch: 1.0,
};

export const DEFAULT_TTS_VOICE = "en-US-Neural2-F";

/** Clamp to the ranges Google Cloud TTS accepts. Ported from clampGoogleParams. */
export function clampGoogleParams(speakingRate: number, pitch: number): {
  speakingRate: number;
  pitch: number;
} {
  return {
    speakingRate: Math.min(4.0, Math.max(0.25, speakingRate)),
    pitch: Math.min(20.0, Math.max(-20.0, pitch)),
  };
}

/** Chirp voices reject SSML and pitch/rate overrides. Ported from isChirpVoice. */
export function isChirpVoice(voiceName: string): boolean {
  return /chirp/i.test(voiceName);
}

/**
 * Clean a narration line for TTS synthesis. Collapsed port of the legacy
 * buildPlainTextFromMarkup + sanitizeForChirp pipeline:
 *  - strip stage-direction markup ("[pause]", "(softly)", asterisks, audio tags)
 *  - strip emojis and pictographs (TTS reads them literally otherwise)
 *  - strip square-bracket placeholders that survived authoring
 *  - normalize quotes/dashes, collapse whitespace
 *  - enforce the MAX_TTS_CHARS ceiling on sentence boundaries when possible
 */
export function cleanNarrationText(raw: string): string {
  let text = raw ?? "";

  // Stage directions / audio tags / markup tokens
  text = text.replace(/\[[^\]]*\]/g, " ");
  text = text.replace(/\([^)]*\)/g, (m) => (m.length <= 24 ? " " : m)); // short parentheticals are stage directions
  text = text.replace(/[*_~`#>]+/g, " ");

  // Emojis & pictographs
  text = text.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, " ");

  // Normalize punctuation
  text = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[—–]/g, ", ");

  // Whitespace
  text = text.replace(/\s{2,}/g, " ").trim();

  // Length ceiling, prefer cutting at a sentence boundary
  if (text.length > MAX_TTS_CHARS) {
    const slice = text.slice(0, MAX_TTS_CHARS);
    const lastStop = Math.max(slice.lastIndexOf("."), slice.lastIndexOf("!"), slice.lastIndexOf("?"));
    text = lastStop > MAX_TTS_CHARS / 2 ? slice.slice(0, lastStop + 1) : slice;
  }

  // Make sure the narrator does not trail off mid-breath
  if (text && !/[.!?]$/.test(text)) text = `${text}.`;
  return text;
}

export interface CompiledGoogleTts {
  text: string;
  config: GoogleTtsSettings;
}

/**
 * Compile narration text + env-configurable voice settings into the final
 * Google TTS request parameters. Ported (Google branch only) from
 * compileTtsFromScriptPlan in legacy compiler.ts: Chirp voices force
 * rate=1.0/pitch=0.0, everything else gets the clamped child-friendly preset.
 */
export function compileGoogleTts(
  rawText: string,
  opts?: { voiceName?: string; languageCode?: string; speakingRate?: number; pitch?: number },
): CompiledGoogleTts {
  const voiceName = opts?.voiceName || DEFAULT_TTS_VOICE;
  const isChirp = isChirpVoice(voiceName);
  const clamped = clampGoogleParams(
    typeof opts?.speakingRate === "number" ? opts.speakingRate : DEFAULT_GOOGLE_PRESET.speakingRate,
    typeof opts?.pitch === "number" ? opts.pitch : DEFAULT_GOOGLE_PRESET.pitch,
  );
  const rawLang = opts?.languageCode || "en-US";
  const languageCode = rawLang === "en" ? "en-US" : rawLang;

  return {
    text: cleanNarrationText(rawText),
    config: {
      voiceName,
      languageCode,
      speakingRate: isChirp ? 1.0 : clamped.speakingRate,
      pitch: isChirp ? 0.0 : clamped.pitch,
    },
  };
}
