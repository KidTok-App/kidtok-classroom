/**
 * TTS Provider Implementations for Worker
 * 
 * ElevenLabs uses /with-timestamps endpoint by default for alignment data.
 * Falls back to standard endpoint if /with-timestamps fails.
 */

import { createHash } from 'crypto';
import { GoogleTtsSettings, ElevenLabsSettings, TtsProvider } from './types.js';
import { isChirpVoice } from './helpers.js';
import { workerConfig } from '../config.js';
import { logger } from '../logger.js';

interface TTSResponse { audioContent: string; }

/**
 * ElevenLabs alignment data from /with-timestamps endpoint
 */
export interface ElevenLabsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/**
 * Result from ElevenLabs synthesis (with optional alignment)
 */
export interface ElevenLabsSynthesisResult {
  audioBytes: Uint8Array;
  alignment: ElevenLabsAlignment | null;
  normalizedAlignment: ElevenLabsAlignment | null;
  usedWithTimestamps: boolean;
  seed: number | null;
}

/**
 * Compute a deterministic seed from ElevenLabs config for reproducible synthesis.
 * Converts hash to 32-bit unsigned int within [0, 4294967295].
 */
function computeElevenLabsSeed(settings: ElevenLabsSettings, text: string): number {
  const seedInput = JSON.stringify({
    voiceId: settings.voiceId,
    modelId: settings.modelId,
    stability: settings.stability,
    similarityBoost: settings.similarityBoost,
    style: settings.style,
    speed: settings.speed,
    text: text.substring(0, 500), // Use first 500 chars for seed stability
  });
  const hash = createHash('sha256').update(seedInput).digest();
  // Use first 4 bytes as 32-bit unsigned int
  return hash.readUInt32BE(0);
}

async function synthesizeGoogleSpeech(text: string, options: GoogleTtsSettings & { ssml?: string }): Promise<Uint8Array> {
  const { languageCode, voiceName, speakingRate, pitch, ssml } = options;
  const isChirp = isChirpVoice(voiceName);
  
  const apiKey = workerConfig.GOOGLE_CLOUD_TTS_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_CLOUD_TTS_API_KEY not configured');
  
  let input: { text: string } | { ssml: string };
  if (isChirp) {
    input = { text: text.replace(/<[^>]*>/g, '').trim() };
  } else if (ssml) {
    input = { ssml };
  } else {
    input = { text };
  }
  
  const effectiveRate = isChirp ? 1.0 : speakingRate;
  const effectivePitch = isChirp ? 0.0 : pitch;
  
  logger.debug('Google TTS synthesis', { voice: voiceName, is_chirp: isChirp, using_ssml: 'ssml' in input, rate: effectiveRate, pitch: effectivePitch });
  
  const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, voice: { languageCode, name: voiceName }, audioConfig: { audioEncoding: 'MP3', speakingRate: effectiveRate, pitch: effectivePitch, volumeGainDb: 0.0 } }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('Google TTS API error', { status: response.status, error: errorText.substring(0, 200) });
    throw new Error(`Google TTS API error: ${response.status} - ${errorText.substring(0, 200)}`);
  }

  const raw: unknown = await response.json();
  const data = raw as Partial<TTSResponse>;

  if (!data || typeof data.audioContent !== 'string') {
    throw new Error('Google TTS API returned unexpected payload (missing audioContent)');
  }
  
  // Use Buffer for Node.js runtime safety (works in Node 14+, avoids atob issues)
  return new Uint8Array(Buffer.from(data.audioContent, 'base64'));
}

/**
 * Synthesize speech using ElevenLabs /with-timestamps endpoint.
 * Returns audio bytes plus alignment data for beat timing.
 * Falls back to standard endpoint if /with-timestamps fails.
 */
async function synthesizeElevenLabsSpeechWithTimestamps(
  text: string,
  settings: ElevenLabsSettings
): Promise<ElevenLabsSynthesisResult> {
  const { voiceId, modelId, stability, similarityBoost, style, speed, useSpeakerBoost, languageCode } = settings;
  
  const apiKey = workerConfig.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not configured');
  
  const seed = computeElevenLabsSeed(settings, text);
  
  logger.info('ElevenLabs TTS synthesis with-timestamps', {
    voice_id: voiceId,
    model_id: modelId,
    is_v3: modelId === 'eleven_v3',
    language: languageCode,
    stability,
    similarity_boost: similarityBoost,
    style,
    speed,
    seed,
    text_length: text.length,
  });
  
  // Build request body
  const requestBody: Record<string, unknown> = {
    text,
    model_id: modelId,
    seed,
    voice_settings: {
      stability,
      similarity_boost: similarityBoost,
      style,
      use_speaker_boost: useSpeakerBoost,
      speed,
    },
  };
  
  if (languageCode && languageCode !== 'en') {
    requestBody.language_code = languageCode;
  }
  
  // Try /with-timestamps endpoint first (returns JSON with alignment)
  try {
    const withTimestampsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`;
    
    const response = await fetch(withTimestampsUrl, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn('ElevenLabs /with-timestamps failed, falling back to standard endpoint', {
        status: response.status,
        error: errorText.substring(0, 200),
      });
      // Fall through to fallback
      throw new Error(`/with-timestamps failed: ${response.status}`);
    }

    const jsonResponse = await response.json() as {
      audio_base64?: string;
      alignment?: ElevenLabsAlignment;
      normalized_alignment?: ElevenLabsAlignment;
    };

    if (!jsonResponse.audio_base64) {
      logger.warn('ElevenLabs /with-timestamps returned no audio_base64, falling back');
      throw new Error('No audio_base64 in response');
    }

    // Decode base64 audio using Buffer for Node.js runtime safety
    const audioBytes = new Uint8Array(Buffer.from(jsonResponse.audio_base64, 'base64'));

    const alignment = jsonResponse.alignment ?? null;
    const normalizedAlignment = jsonResponse.normalized_alignment ?? null;

    logger.info('ElevenLabs /with-timestamps success', {
      audio_size: audioBytes.length,
      has_alignment: !!alignment,
      has_normalized_alignment: !!normalizedAlignment,
      alignment_char_count: normalizedAlignment?.characters?.length ?? alignment?.characters?.length ?? 0,
      seed,
    });

    return {
      audioBytes,
      alignment,
      normalizedAlignment,
      usedWithTimestamps: true,
      seed,
    };

  } catch (withTimestampsError) {
    // Fallback to standard endpoint
    logger.info('Using ElevenLabs standard endpoint fallback', {
      voice_id: voiceId,
      model_id: modelId,
      fallback_reason: withTimestampsError instanceof Error ? withTimestampsError.message : 'unknown',
    });

    const standardUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    
    const response = await fetch(standardUrl, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('ElevenLabs standard API error', { status: response.status, error: errorText.substring(0, 200) });
      throw new Error(`ElevenLabs API error: ${response.status} - ${errorText.substring(0, 200)}`);
    }

    const audioBytes = new Uint8Array(await response.arrayBuffer());
    
    logger.info('ElevenLabs standard endpoint success', {
      audio_size: audioBytes.length,
      seed,
    });

    return {
      audioBytes,
      alignment: null,
      normalizedAlignment: null,
      usedWithTimestamps: false,
      seed,
    };
  }
}

/**
 * Legacy function for backward compatibility - returns just audio bytes
 */
async function synthesizeElevenLabsSpeech(text: string, settings: ElevenLabsSettings): Promise<Uint8Array> {
  const result = await synthesizeElevenLabsSpeechWithTimestamps(text, settings);
  return result.audioBytes;
}

export interface SynthesisOptions {
  provider: TtsProvider;
  google?: GoogleTtsSettings & { ssml?: string };
  elevenlabs?: ElevenLabsSettings;
}

/**
 * Extended synthesis result that includes alignment for ElevenLabs
 */
export interface SynthesisResultExtended {
  audioBytes: Uint8Array;
  elevenLabsResult?: ElevenLabsSynthesisResult;
}

/**
 * Synthesize speech with extended result including alignment data
 */
export async function synthesizeSpeechExtended(text: string, options: SynthesisOptions): Promise<SynthesisResultExtended> {
  if (options.provider === 'elevenlabs') {
    if (!options.elevenlabs) throw new Error('ElevenLabs settings required for elevenlabs provider');
    const result = await synthesizeElevenLabsSpeechWithTimestamps(text, options.elevenlabs);
    return {
      audioBytes: result.audioBytes,
      elevenLabsResult: result,
    };
  }
  
  if (!options.google) throw new Error('Google settings required for google provider');
  const isChirp = isChirpVoice(options.google.voiceName);
  
  if (!isChirp && options.google.ssml) {
    try {
      const audioBytes = await synthesizeGoogleSpeech(text, options.google);
      return { audioBytes };
    } catch (ssmlError) {
      logger.warn('SSML synthesis failed, falling back to plain text', { voice: options.google.voiceName, error: ssmlError instanceof Error ? ssmlError.message.substring(0, 200) : 'unknown' });
    }
  }
  
  const audioBytes = await synthesizeGoogleSpeech(text, { ...options.google, ssml: undefined });
  return { audioBytes };
}

/**
 * Backward-compatible synthesizeSpeech that returns just audio bytes
 */
export async function synthesizeSpeech(text: string, options: SynthesisOptions): Promise<Uint8Array> {
  const result = await synthesizeSpeechExtended(text, options);
  return result.audioBytes;
}
