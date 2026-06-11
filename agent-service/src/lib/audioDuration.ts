/**
 * MP3 duration extraction. Primary path: music-metadata (accurate frame
 * parse). Fallback: constant-bitrate estimate (Google TTS emits 32 kbps CBR
 * MP3), which also covers the fake-provider smoke mode.
 */

import { parseBuffer } from "music-metadata";

const GOOGLE_TTS_MP3_BITRATE = 32_000; // bits/sec

export async function mp3DurationMs(buffer: Buffer): Promise<number> {
  try {
    const meta = await parseBuffer(buffer, { mimeType: "audio/mpeg" }, { duration: true });
    const seconds = meta.format.duration;
    if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) {
      return Math.round(seconds * 1000);
    }
  } catch {
    /* fall through to estimate */
  }
  return Math.max(500, Math.round((buffer.length * 8 * 1000) / GOOGLE_TTS_MP3_BITRATE));
}
