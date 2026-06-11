/**
 * TTS Compiler for Worker
 * 
 * STRATEGY: DB is the source of truth for provider selection.
 * The lesson row contains tts_provider and all provider-specific config.
 * This compiler reads those values and fails loudly if config is invalid.
 */

import { CompiledTts, TtsProvider, VoiceIntentPreset, ScriptPlan, LessonRowForTts } from './types.js';
import { DEFAULT_TTS_VOICE, DEFAULT_ELEVENLABS_MODEL, MAX_TTS_CHARS, GOOGLE_PRESETS, ELEVENLABS_PRESETS } from './constants.js';
import { validatePreset, clampGoogleParams, clampElevenLabsParams, isChirpVoice, sanitizeForChirp, isNeural2SsmlEnabled, buildTtsMarkupFromScriptPlan, buildPlainTextFromMarkup, truncateMarkupToMaxChars, renderGoogleSsmlFromMarkup, renderElevenLabsV3WithTags, ensurePlainTextForV2 } from './helpers.js';
import { logger } from '../logger.js';

export interface CompilationError {
  code: string;
  message: string;
}

export type CompilationResult =
  | {
      success: true;
      compiled: CompiledTts;
    }
  | {
      success: false;
      error: CompilationError;
    };

/**
 * Validates that ElevenLabs configuration is complete.
 * Returns an error if required fields are missing.
 */
function validateElevenLabsConfig(lesson: LessonRowForTts, context: { trace_id?: string }): CompilationError | null {
  if (!lesson.elevenlabs_voice_id) {
    logger.error('ElevenLabs requested but elevenlabs_voice_id is missing', {
      ...context,
      lesson_id: lesson.id,
      tts_provider: lesson.tts_provider,
    });
    return {
      code: 'ELEVENLABS_VOICE_ID_MISSING',
      message: 'ElevenLabs TTS requested but voice ID is not configured. Set elevenlabs_voice_id on the lesson.',
    };
  }
  
  // model_id has a default, but log if it's missing
  if (!lesson.elevenlabs_model_id) {
    logger.warn('ElevenLabs model_id missing, using default', {
      ...context,
      lesson_id: lesson.id,
      default_model: DEFAULT_ELEVENLABS_MODEL,
    });
  }
  
  return null;
}

/**
 * Determines the TTS provider from lesson data.
 * STRATEGY: DB is the source of truth.
 * 
 * Priority:
 * 1. Explicit tts_provider value ('google' or 'elevenlabs')
 * 2. Infer from data: elevenlabs_voice_id present → 'elevenlabs'
 * 3. Default: 'google'
 */
function determineProvider(lesson: LessonRowForTts, context: { trace_id?: string }): TtsProvider {
  // Explicit provider takes priority
  if (lesson.tts_provider === 'elevenlabs') {
    logger.debug('Provider from DB: elevenlabs (explicit)', { ...context, lesson_id: lesson.id });
    return 'elevenlabs';
  }
  if (lesson.tts_provider === 'google') {
    logger.debug('Provider from DB: google (explicit)', { ...context, lesson_id: lesson.id });
    return 'google';
  }
  
  // Infer from data if tts_provider is null/empty
  if (lesson.elevenlabs_voice_id) {
    logger.info('Provider inferred from elevenlabs_voice_id: elevenlabs', {
      ...context,
      lesson_id: lesson.id,
      voice_id: lesson.elevenlabs_voice_id,
    });
    return 'elevenlabs';
  }
  
  // Default to Google
  logger.debug('Provider defaulted to google (no explicit provider, no elevenlabs_voice_id)', {
    ...context,
    lesson_id: lesson.id,
  });
  return 'google';
}

export function compileTtsFromScriptPlan(
  scriptPlan: ScriptPlan,
  lesson: LessonRowForTts,
  context: { trace_id?: string } = {},
  prePlannedTags?: { taggedScript: string; usedLlm: boolean; tagCount: number }
): CompilationResult {
  // Determine provider with clear logging
  const provider = determineProvider(lesson, context);
  const presetName: VoiceIntentPreset = validatePreset(lesson.voice_intent_preset);
  
  // Log the source-of-truth decision
  logger.info('TTS provider selection', {
    ...context,
    lesson_id: lesson.id,
    series_id: lesson.series_id,
    provider,
    source: lesson.tts_provider ? 'explicit_db_field' : (lesson.elevenlabs_voice_id ? 'inferred_from_voice_id' : 'default'),
    db_tts_provider: lesson.tts_provider,
    elevenlabs_voice_id: lesson.elevenlabs_voice_id,
    elevenlabs_model_id: lesson.elevenlabs_model_id,
    google_voice_name: lesson.tts_voice_name,
    preset: presetName,
  });
  
  // Validate ElevenLabs config if that provider is selected
  if (provider === 'elevenlabs') {
    const validationError = validateElevenLabsConfig(lesson, context);
    if (validationError) {
      return { success: false, error: validationError };
    }
  }
  
  const baseMarkup = buildTtsMarkupFromScriptPlan(scriptPlan);
  const truncatedMarkup = truncateMarkupToMaxChars(baseMarkup, MAX_TTS_CHARS);
  let text = buildPlainTextFromMarkup(truncatedMarkup);
  
  const originalLength = buildPlainTextFromMarkup(baseMarkup).length;
  if (text.length !== originalLength) {
    logger.info('Truncated TTS text', { ...context, original_length: originalLength, truncated_length: text.length });
  }
  
  const voiceName = lesson.tts_voice_name || DEFAULT_TTS_VOICE;
  const isChirp = provider === 'google' && isChirpVoice(voiceName);
  const isNeural2 = provider === 'google' && !isChirp;
  const useSsml = isNeural2 && isNeural2SsmlEnabled();
  
  let ssml: string | undefined;
  if (useSsml) {
    ssml = renderGoogleSsmlFromMarkup(truncatedMarkup);
    logger.debug('Generated SSML for Neural2', { ...context, voice: voiceName, ssml_length: ssml.length });
  }
  
  if (isChirp) {
    text = sanitizeForChirp(text);
    logger.debug('Applied Chirp sanitization', { ...context, voice: voiceName });
  }
  
  const compiled: CompiledTts = { provider, text, useSsml, validatedPreset: presetName };
  if (ssml) compiled.ssml = ssml;
  
  if (provider === 'elevenlabs') {
    const preset = ELEVENLABS_PRESETS[presetName];
    const modelId = lesson.elevenlabs_model_id || DEFAULT_ELEVENLABS_MODEL;
    const isV3 = modelId === 'eleven_v3';
    
    const clamped = clampElevenLabsParams({
      stability: typeof lesson.elevenlabs_stability === 'number' ? lesson.elevenlabs_stability : preset.stability,
      similarityBoost: typeof lesson.elevenlabs_similarity_boost === 'number' ? lesson.elevenlabs_similarity_boost : preset.similarityBoost,
      style: typeof lesson.elevenlabs_style === 'number' ? lesson.elevenlabs_style : preset.style,
      speed: typeof lesson.elevenlabs_speed === 'number' ? lesson.elevenlabs_speed : preset.speed,
    });
    
    const languageCode = lesson.language_code || 'en';
    let finalText = text;
    let renderedFormat: 'plain_text' | 'audio_tags_text' = 'plain_text';
    let usedLlmTags = false;
    let audioTagCount = 0;
    
    if (isV3) {
      const audioTagResult = renderElevenLabsV3WithTags(scriptPlan.hook_text, scriptPlan.model_lines, presetName, modelId, languageCode, prePlannedTags);
      finalText = audioTagResult.text;
      renderedFormat = audioTagResult.format;
      usedLlmTags = audioTagResult.usedLlm;
      audioTagCount = audioTagResult.tagCount;
      logger.debug('Applied v3 audio tags', { ...context, format: renderedFormat, tag_count: audioTagCount });
    } else {
      finalText = ensurePlainTextForV2(text, modelId);
    }
    
    compiled.text = finalText;
    compiled.renderedFormat = renderedFormat;
    compiled.usedLlmTags = usedLlmTags;
    compiled.audioTagCount = audioTagCount;
    compiled.elevenLabsConfig = { voiceId: lesson.elevenlabs_voice_id || '', modelId, stability: clamped.stability, similarityBoost: clamped.similarityBoost, style: clamped.style, speed: clamped.speed, useSpeakerBoost: lesson.elevenlabs_use_speaker_boost !== false, languageCode };
    compiled.providerModel = modelId;
    
    logger.info('ElevenLabs TTS compiled successfully', {
      ...context,
      lesson_id: lesson.id,
      voice_id: compiled.elevenLabsConfig.voiceId,
      model_id: modelId,
      is_v3: isV3,
      language: languageCode,
      stability: clamped.stability,
      speed: clamped.speed,
      text_length: finalText.length,
    });
  } else {
    const preset = GOOGLE_PRESETS[presetName];
    const clamped = clampGoogleParams(typeof lesson.tts_speaking_rate === 'number' ? lesson.tts_speaking_rate : preset.speakingRate, typeof lesson.tts_pitch === 'number' ? lesson.tts_pitch : preset.pitch);
    const rawLang = lesson.language_code || 'en-US';
    const languageCode = rawLang === 'en' ? 'en-US' : rawLang;

    compiled.googleConfig = {
      voiceName,
      speakingRate: isChirp ? 1.0 : clamped.speakingRate,
      pitch: isChirp ? 0.0 : clamped.pitch,
      languageCode,
    };
    compiled.providerModel = isChirp ? 'chirp3_hd' : (voiceName.includes('Neural2') ? 'neural2' : voiceName);
    
    logger.info('Google TTS compiled successfully', {
      ...context,
      lesson_id: lesson.id,
      voice: voiceName,
      is_chirp: isChirp,
      use_ssml: useSsml,
      speaking_rate: compiled.googleConfig.speakingRate,
      pitch: compiled.googleConfig.pitch,
      text_length: text.length,
    });
  }
  
  return { success: true, compiled };
}
