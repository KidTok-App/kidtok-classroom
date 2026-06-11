/**
 * NarrationAgent — per scene: clean narrationText (legacy compiler logic) →
 * Google Cloud TTS (child-friendly en-US voice, slightly slow rate) → upload
 * MP3 → capture durationMs from the audio bytes.
 */

import { trace } from "@opentelemetry/api";
import { compileGoogleTts } from "../legacy/narrationCompiler.js";
import { mp3DurationMs } from "../lib/audioDuration.js";
import { withSpan, SPAN_KIND_ATTR, SPAN_KINDS } from "../tracing.js";
import type { AssetStorage, SpeechSynth } from "../clients/interfaces.js";
import type { ScriptScene } from "../types.js";

export interface NarrationResult {
  index: number;
  audioUrl: string;
  durationMs: number;
}

export class NarrationAgent {
  constructor(
    private readonly tts: SpeechSynth,
    private readonly storage: AssetStorage,
    private readonly voiceCfg: { voiceName: string; speakingRate: number; pitch: number },
  ) {}

  async run(input: { episodeId: string; scenes: ScriptScene[] }): Promise<NarrationResult[]> {
    const tracer = trace.getTracer("kidtok-classroom");
    const results: NarrationResult[] = [];

    for (let index = 0; index < input.scenes.length; index++) {
      const scene = input.scenes[index];
      if (!scene) continue;
      const result = await withSpan(
        tracer,
        `NarrationAgent.scene[${index}]`,
        {
          [SPAN_KIND_ATTR]: SPAN_KINDS.TOOL,
          episodeId: input.episodeId,
          "scene.index": index,
        },
        async (span) => {
          const compiled = compileGoogleTts(scene.narrationText, {
            voiceName: this.voiceCfg.voiceName,
            speakingRate: this.voiceCfg.speakingRate,
            pitch: this.voiceCfg.pitch,
          });
          if (!compiled.text) throw new Error(`NARRATION_EMPTY_AFTER_CLEANING scene=${index}`);

          const mp3 = await this.tts.synthesizeMp3(compiled.text, compiled.config);
          const durationMs = await mp3DurationMs(mp3);
          const audioUrl = await this.storage.uploadBuffer(
            `episodes/${input.episodeId}/scene-${index}.mp3`,
            mp3,
            "audio/mpeg",
          );
          span.setAttribute("narration.durationMs", durationMs);
          span.setAttribute("narration.chars", compiled.text.length);
          return { index, audioUrl, durationMs };
        },
      );
      results.push(result);
    }

    return results;
  }
}
