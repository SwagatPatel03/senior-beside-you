// Renders media/icon.png, the 128x128 Marketplace icon: brass reading glasses on deep ink.
// Each pixel is sampled 4x4 times so edges are smooth. Run: node scripts/make-icon.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const SIZE = 128;
const SAMPLES = 4;
const INK = [42, 37, 32];
const BRASS = [200, 171, 110];
const STROKE = 2.4; // half the line width

const ring = (cx, cy, r) => (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - r) <= STROKE;
const arc = (cx, cy, r, maxY) => (x, y) => y <= maxY && Math.abs(Math.hypot(x - cx, y - cy) - r) <= STROKE;
function segment(x1, y1, x2, y2) {
  return (x, y) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) <= STROKE;
  };
}
function roundedSquare(r) {
  return (x, y) => {
    const qx = Math.max(Math.abs(x - SIZE / 2) - (SIZE / 2 - r), 0);
    const qy = Math.max(Math.abs(y - SIZE / 2) - (SIZE / 2 - r), 0);
    return Math.hypot(qx, qy) <= r;
  };
}

const background = roundedSquare(26);
const glasses = [ring(40, 72, 21), ring(88, 72, 21), arc(64, 76, 10, 70), segment(19.5, 69, 9, 50), segment(108.5, 69, 119, 50)];

const rows = [];
for (let py = 0; py < SIZE; py++) {
  const row = Buffer.alloc(1 + SIZE * 4);
  for (let px = 0; px < SIZE; px++) {
    let bg = 0;
    let fg = 0;
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const x = px + (sx + 0.5) / SAMPLES;
        const y = py + (sy + 0.5) / SAMPLES;
        if (background(x, y)) {
          bg++;
          if (glasses.some((shape) => shape(x, y))) fg++;
        }
      }
    }
    const n = SAMPLES * SAMPLES;
    const alpha = bg / n;
    const mix = bg ? fg / bg : 0;
    const o = 1 + px * 4;
    for (let c = 0; c < 3; c++) row[o + c] = Math.round(INK[c] + (BRASS[c] - INK[c]) * mix);
    row[o + 3] = Math.round(alpha * 255);
  }
  rows.push(row);
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'media', 'icon.png');
fs.writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes)`);
