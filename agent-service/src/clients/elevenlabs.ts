/**
 * ElevenLabs Speech Synthesis Client.
 * Replaces Google Cloud TTS with ElevenLabs v3 Sarah voice when api key is provided.
 */

import type { SpeechSynth } from "./interfaces.js";

export class ElevenLabsSpeechSynth implements SpeechSynth {
  constructor(
    private readonly apiKey: string,
    private readonly voiceId = "EXAVITQu4vr4xnSDxMaL", // Sarah
    private readonly modelId = "eleven_v3"
  ) {}

  async synthesizeMp3(
    text: string,
    _cfg: { voiceName: string; languageCode: string; speakingRate: number; pitch: number },
  ): Promise<Buffer> {
    console.log(`[ElevenLabsSpeechSynth] Synthesizing speech with ElevenLabs. Voice ID: ${this.voiceId}, Model: ${this.modelId}`);
    
    // Standard request body configuration for ElevenLabs
    const requestBody = {
      text,
      model_id: this.modelId,
      voice_settings: {
        stability: 0.7,
        similarity_boost: 0.8,
        style: 0.2,
        speed: 0.95,
      },
    };

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ElevenLabsSpeechSynth] API Error ${response.status}:`, errorText);
      throw new Error(`ElevenLabs API error: ${response.status} - ${errorText.slice(0, 200)}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
