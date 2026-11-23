/**
 * Generate the PWA icons as real PNGs with zero dependencies.
 * Motif: a reading card with lines of text — full-bleed so it works as a
 * maskable Android icon.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const BG: [number, number, number] = [0x0d, 0x0f, 0x12];
const FG: [number, number, number] = [0xe9, 0xe6, 0xe1];
const ACCENT: [number, number, number] = [0x6f, 0xa8, 0xff];

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (stride + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Rounded-rectangle coverage test. */
function inRoundRect(x: number, y: number, rx: number, ry: number, w: number, h: number, r: number): boolean {
  const cx = Math.min(Math.max(x, rx + r), rx + w - r);
  const cy = Math.min(Math.max(y, ry + r), ry + h - r);
  if (x >= rx && x <= rx + w && y >= ry + r && y <= ry + h - r) return true;
  if (y >= ry && y <= ry + h && x >= rx + r && x <= rx + w - r) return true;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function draw(size: number) {
  const u = size / 100; // work in percentage units
  // Four "text lines" of varying width, plus an accent line standing for the tag.
  const lines = [
    { y: 30, w: 46, c: FG },
    { y: 44, w: 56, c: FG },
    { y: 58, w: 38, c: FG },
    { y: 74, w: 18, c: ACCENT },
  ];
  return (x: number, y: number): [number, number, number] => {
    const px = x / u, py = y / u;
    for (const ln of lines) {
      // Right-aligned, because the app reads right-to-left.
      const right = 78;
      if (inRoundRect(px, py, right - ln.w, ln.y, ln.w, 7, 3.5)) return ln.c;
    }
    return BG;
  };
}

mkdirSync(new URL("../public/icons/", import.meta.url), { recursive: true });
for (const size of [192, 512, 180]) {
  const buf = png(size, draw(size));
  const name = size === 180 ? "apple-touch-icon.png" : `icon-${size}.png`;
  writeFileSync(new URL(`../public/icons/${name}`, import.meta.url), buf);
  console.log(`  ${name.padEnd(22)} ${size}x${size}  ${(buf.length / 1024).toFixed(1)} KB`);
}
