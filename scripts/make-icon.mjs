#!/usr/bin/env node
/**
 * 生成 images/icon.png —— 不依赖图形库，直接用 zlib 手写 PNG。
 *
 *   node scripts/make-icon.mjs
 *
 * 256×256（Marketplace 要求 ≥128×128），深色圆角底 + 四格 T 形方块。
 * 4 倍超采样做抗锯齿。
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 256;
const SS = 4;
const BIG = SIZE * SS;

const BACKDROP = [0x2b, 0x2f, 0x45];
const CELLS = [
  { x: 54, y: 80, color: [0x4d, 0xd0, 0xe1] },
  { x: 102, y: 80, color: [0xff, 0xd5, 0x4f] },
  { x: 150, y: 80, color: [0xb3, 0x9d, 0xdb] },
  { x: 102, y: 128, color: [0x81, 0xc7, 0x84] },
];
const CELL = 48;
const GAP = 4;
const RADIUS = 8;

function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function sample(x, y) {
  const s = (value) => value * SS;

  if (!inRoundedRect(x, y, s(8), s(8), s(248), s(248), s(56))) return null;

  for (const cell of CELLS) {
    if (
      inRoundedRect(
        x,
        y,
        s(cell.x) + s(GAP),
        s(cell.y) + s(GAP),
        s(cell.x + CELL) - s(GAP),
        s(cell.y + CELL) - s(GAP),
        s(RADIUS),
      )
    ) {
      return cell.color;
    }
  }

  return BACKDROP;
}

const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let hits = 0;

    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const color = sample(px * SS + sx, py * SS + sy);
        if (color === null) continue;
        r += color[0];
        g += color[1];
        b += color[2];
        hits++;
      }
    }

    const offset = (py * SIZE + px) * 4;
    if (hits === 0) continue;

    pixels[offset] = Math.round(r / hits);
    pixels[offset + 1] = Math.round(g / hits);
    pixels[offset + 2] = Math.round(b / hits);
    pixels[offset + 3] = Math.round((hits / (SS * SS)) * 255);
  }
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  const from = y * SIZE * 4;
  const to = y * (SIZE * 4 + 1);
  raw[to] = 0;
  pixels.copy(raw, to + 1, from, from + SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "images", "icon.png");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`已生成 ${out}（${SIZE}×${SIZE}，${png.length} 字节）`);
