/**
 * Minimal dependency-free PNG encoder used for the styled degraded-scene
 * placeholder (soft vertical pastel gradient, 1280x720). Pure Node (zlib).
 */

import zlib from "node:zlib";

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (CRC_TABLE[(c ^ (buf[i] as number)) & 0xff] as number) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

export interface PlaceholderOptions {
  width?: number;
  height?: number;
  /** Top gradient color [r,g,b]. */
  from?: [number, number, number];
  /** Bottom gradient color [r,g,b]. */
  to?: [number, number, number];
}

/** Warm KidTok pastel defaults: peach → soft sky blue. */
export function renderPlaceholderPng(opts: PlaceholderOptions = {}): Buffer {
  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;
  const from = opts.from ?? [255, 214, 165];
  const to = opts.to ?? [173, 216, 230];

  const raw = Buffer.alloc(height * (1 + width * 3));
  let off = 0;
  for (let y = 0; y < height; y++) {
    raw[off++] = 0; // filter: none
    const t = y / Math.max(1, height - 1);
    // Gentle two-band gradient with a soft horizon stripe for a "scene" feel.
    const band = Math.abs(t - 0.62) < 0.015 ? 14 : 0;
    const r = Math.round((from[0] + (to[0] - from[0]) * t + band) % 256);
    const g = Math.round((from[1] + (to[1] - from[1]) * t + band) % 256);
    const b = Math.round((from[2] + (to[2] - from[2]) * t + band) % 256);
    for (let x = 0; x < width; x++) {
      raw[off++] = r;
      raw[off++] = g;
      raw[off++] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
