// Writes media/senior-icons.ttf: a TrueType font with one glyph, Senior's spectacles, at U+E000.
// The status bar can only show extension icons that come from a font, so this draws the mark from
// media/spectacles.svg as filled outlines. Run: node scripts/make-icon-font.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UPM = 300; // the em square is the icon box, as in VS Code's own icon font
const GRID = 24; // the drawing below uses the 24 unit grid of spectacles.svg, with y growing downwards
const HALF = 0.75; // half the line width
const LIFT = 1.5; // moves the mark up so it sits in the middle of the box
const CODE_POINT = 0xe000;
const NAME = 'Senior Icons';
const POSTSCRIPT_NAME = 'SeniorIcons-Regular';
// A fixed date keeps the file identical from one run to the next.
const CREATED = BigInt(Date.UTC(2026, 9, 23) / 1000 + 2082844800); // seconds since 1904-01-01

// Outlines

/** A circle as eight quadratic segments: a point on the circle every 45 degrees, a control point between. */
function circle(cx, cy, r) {
  const points = [];
  for (let k = 0; k < 16; k++) {
    const angle = (k * Math.PI) / 8;
    const radius = k % 2 ? r / Math.cos(Math.PI / 8) : r;
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), on: k % 2 === 0 });
  }
  return points;
}

/** The outline of a line drawn through `line` with round caps. */
function stroke(line, w) {
  const n = line.length;
  const direction = (i) => {
    const [x0, y0] = line[Math.max(0, i - 1)];
    const [x1, y1] = line[Math.min(n - 1, i + 1)];
    const length = Math.hypot(x1 - x0, y1 - y0);
    return [(x1 - x0) / length, (y1 - y0) / length];
  };
  const left = [];
  const right = [];
  for (let i = 0; i < n; i++) {
    const [dx, dy] = direction(i);
    const [x, y] = line[i];
    left.push({ x: x - dy * w, y: y + dx * w, on: true });
    right.push({ x: x + dy * w, y: y - dx * w, on: true });
  }
  // Half a circle around an end, from the left edge to the right edge, as two quadratic segments.
  const cap = ([x, y], [dx, dy]) => [
    { x: x + (dx - dy) * w, y: y + (dy + dx) * w, on: false },
    { x: x + dx * w, y: y + dy * w, on: true },
    { x: x + (dx + dy) * w, y: y + (dy - dx) * w, on: false },
  ];
  const [ex, ey] = direction(n - 1);
  const [sx, sy] = direction(0);
  return [...left, ...cap(line[n - 1], [ex, ey]), ...right.reverse(), ...cap(line[0], [-sx, -sy])];
}

function cubic(p0, p1, p2, p3, steps) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const at = (k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k];
    points.push([at(0), at(1)]);
  }
  return points;
}

const toFont = (p) => ({ x: Math.round((p.x * UPM) / GRID), y: Math.round(((GRID - (p.y - LIFT)) * UPM) / GRID), on: p.on });

/** Signed area in font units; negative means clockwise, which TrueType expects for filled shapes. */
function area(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function contour(points, { hole = false } = {}) {
  const font = points.map(toFont);
  const clockwise = area(font) < 0;
  return clockwise === !hole ? font : font.reverse();
}

const spectacles = [
  contour(circle(6.5, 13.5, 4 + HALF)),
  contour(circle(6.5, 13.5, 4 - HALF), { hole: true }),
  contour(circle(17.5, 13.5, 4 + HALF)),
  contour(circle(17.5, 13.5, 4 - HALF), { hole: true }),
  contour(stroke(cubic([10.5, 13.2], [11.1, 12.1], [12.9, 12.1], [13.5, 13.2], 8), HALF)),
  contour(stroke([[2.5, 13.2], [1, 9.5]], HALF)),
  contour(stroke([[21.5, 13.2], [23, 9.5]], HALF)),
];

// Tables

function table(size, fill) {
  const buf = Buffer.alloc(size);
  fill(buf);
  return buf;
}

function bounds(contours) {
  const all = contours.flat();
  return {
    xMin: Math.min(...all.map((p) => p.x)),
    yMin: Math.min(...all.map((p) => p.y)),
    xMax: Math.max(...all.map((p) => p.x)),
    yMax: Math.max(...all.map((p) => p.y)),
  };
}

function glyph(contours) {
  const box = bounds(contours);
  const points = contours.flat();
  const buf = Buffer.alloc(10 + contours.length * 2 + 2 + points.length * 5);
  let o = 0;
  o = buf.writeInt16BE(contours.length, o);
  o = buf.writeInt16BE(box.xMin, o);
  o = buf.writeInt16BE(box.yMin, o);
  o = buf.writeInt16BE(box.xMax, o);
  o = buf.writeInt16BE(box.yMax, o);
  let end = -1;
  for (const c of contours) o = buf.writeUInt16BE((end += c.length), o);
  o = buf.writeUInt16BE(0, o); // no hinting instructions
  for (const p of points) o = buf.writeUInt8(p.on ? 1 : 0, o); // every coordinate is a 16 bit delta
  let last = 0;
  for (const p of points) {
    o = buf.writeInt16BE(p.x - last, o);
    last = p.x;
  }
  last = 0;
  for (const p of points) {
    o = buf.writeInt16BE(p.y - last, o);
    last = p.y;
  }
  return buf;
}

const pad4 = (buf) => (buf.length % 4 ? Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4))]) : buf);

const box = bounds(spectacles);
const points = spectacles.flat().length;
const glyphs = [Buffer.alloc(0), pad4(glyph(spectacles))]; // glyph 0 is the empty .notdef

const glyf = Buffer.concat(glyphs);
const loca = table((glyphs.length + 1) * 4, (b) => {
  let offset = 0;
  glyphs.forEach((g, i) => {
    b.writeUInt32BE(offset, i * 4);
    offset += g.length;
  });
  b.writeUInt32BE(offset, glyphs.length * 4);
});

const head = table(54, (b) => {
  b.writeUInt16BE(1, 0);
  b.writeUInt16BE(0, 2);
  b.writeUInt32BE(0x00010000, 4); // font revision 1.0
  b.writeUInt32BE(0, 8); // checksum adjustment, filled in at the end
  b.writeUInt32BE(0x5f0f3cf5, 12);
  b.writeUInt16BE(0b1011, 16); // baseline at 0, left side bearing at 0, integer scaling
  b.writeUInt16BE(UPM, 18);
  b.writeBigInt64BE(CREATED, 20);
  b.writeBigInt64BE(CREATED, 28);
  b.writeInt16BE(box.xMin, 36);
  b.writeInt16BE(box.yMin, 38);
  b.writeInt16BE(box.xMax, 40);
  b.writeInt16BE(box.yMax, 42);
  b.writeUInt16BE(0, 44); // regular style
  b.writeUInt16BE(8, 46); // smallest readable size in pixels
  b.writeInt16BE(2, 48);
  b.writeInt16BE(1, 50); // long offsets in loca
  b.writeInt16BE(0, 52);
});

const hhea = table(36, (b) => {
  b.writeUInt32BE(0x00010000, 0);
  b.writeInt16BE(UPM, 4); // ascender
  b.writeInt16BE(0, 6); // descender
  b.writeInt16BE(0, 8); // line gap
  b.writeUInt16BE(UPM, 10); // widest advance
  b.writeInt16BE(box.xMin, 12); // smallest left and right side bearings, and the widest extent
  b.writeInt16BE(UPM - box.xMax, 14);
  b.writeInt16BE(box.xMax, 16);
  b.writeInt16BE(1, 18); // vertical caret
  b.writeUInt16BE(glyphs.length, 34);
});

const hmtx = table(glyphs.length * 4, (b) => {
  b.writeUInt16BE(UPM, 0);
  b.writeInt16BE(0, 2);
  b.writeUInt16BE(UPM, 4);
  b.writeInt16BE(box.xMin, 6);
});

const maxp = table(32, (b) => {
  b.writeUInt32BE(0x00010000, 0);
  b.writeUInt16BE(glyphs.length, 4);
  b.writeUInt16BE(points, 6);
  b.writeUInt16BE(spectacles.length, 8);
  b.writeUInt16BE(2, 14); // zones
});

const os2 = table(96, (b) => {
  b.writeUInt16BE(4, 0);
  b.writeInt16BE(UPM, 2); // average width
  b.writeUInt16BE(400, 4); // regular weight
  b.writeUInt16BE(5, 6); // normal width
  b.writeUInt16BE(0, 8); // installable embedding
  b.writeInt16BE(195, 10); // subscript and superscript sizes and offsets
  b.writeInt16BE(210, 12);
  b.writeInt16BE(0, 14);
  b.writeInt16BE(42, 16);
  b.writeInt16BE(195, 18);
  b.writeInt16BE(210, 20);
  b.writeInt16BE(0, 22);
  b.writeInt16BE(120, 24);
  b.writeInt16BE(15, 26); // strikeout size and position
  b.writeInt16BE(81, 28);
  b.writeUInt32BE(1 << 28, 46); // Unicode range bit 60: private use area
  b.write('NONE', 58, 'latin1');
  b.writeUInt16BE(0x00c0, 62); // regular, and use the typographic metrics
  b.writeUInt16BE(CODE_POINT, 64);
  b.writeUInt16BE(CODE_POINT, 66);
  b.writeInt16BE(UPM, 68); // typographic ascender, descender and line gap
  b.writeInt16BE(0, 70);
  b.writeInt16BE(0, 72);
  b.writeUInt16BE(UPM, 74); // Windows ascent and descent
  b.writeUInt16BE(0, 76);
  b.writeUInt32BE(1, 78); // code page: Latin 1
  b.writeUInt16BE(32, 92); // break character
});

const cmap = table(4 + 2 * 8 + 32, (b) => {
  b.writeUInt16BE(0, 0);
  b.writeUInt16BE(2, 2);
  // Unicode BMP and Windows Unicode BMP records share one format 4 subtable.
  b.writeUInt16BE(0, 4);
  b.writeUInt16BE(3, 6);
  b.writeUInt32BE(20, 8);
  b.writeUInt16BE(3, 12);
  b.writeUInt16BE(1, 14);
  b.writeUInt32BE(20, 16);
  const s = 20;
  b.writeUInt16BE(4, s); // format
  b.writeUInt16BE(32, s + 2); // length
  b.writeUInt16BE(0, s + 4); // language
  b.writeUInt16BE(4, s + 6); // two segments
  b.writeUInt16BE(4, s + 8); // search range
  b.writeUInt16BE(1, s + 10); // entry selector
  b.writeUInt16BE(0, s + 12); // range shift
  b.writeUInt16BE(CODE_POINT, s + 14); // end codes
  b.writeUInt16BE(0xffff, s + 16);
  b.writeUInt16BE(0, s + 18);
  b.writeUInt16BE(CODE_POINT, s + 20); // start codes
  b.writeUInt16BE(0xffff, s + 22);
  b.writeUInt16BE((1 - CODE_POINT) & 0xffff, s + 24); // deltas
  b.writeUInt16BE(1, s + 26);
  b.writeUInt16BE(0, s + 28); // range offsets
  b.writeUInt16BE(0, s + 30);
});

const NAMES = [
  [1, NAME],
  [2, 'Regular'],
  [3, `${POSTSCRIPT_NAME} 1.000`],
  [4, NAME],
  [5, 'Version 1.000'],
  [6, POSTSCRIPT_NAME],
];
const strings = NAMES.map(([, text]) => Buffer.from(text, 'utf16le').swap16());
const name = table(6 + NAMES.length * 12 + strings.reduce((n, s) => n + s.length, 0), (b) => {
  b.writeUInt16BE(0, 0);
  b.writeUInt16BE(NAMES.length, 2);
  b.writeUInt16BE(6 + NAMES.length * 12, 4);
  let offset = 0;
  NAMES.forEach(([id], i) => {
    const r = 6 + i * 12;
    b.writeUInt16BE(3, r); // Windows
    b.writeUInt16BE(1, r + 2); // Unicode BMP
    b.writeUInt16BE(0x0409, r + 4); // English (United States)
    b.writeUInt16BE(id, r + 6);
    b.writeUInt16BE(strings[i].length, r + 8);
    b.writeUInt16BE(offset, r + 10);
    strings[i].copy(b, 6 + NAMES.length * 12 + offset);
    offset += strings[i].length;
  });
});

const post = table(32, (b) => {
  b.writeUInt32BE(0x00030000, 0); // no glyph names
  b.writeInt16BE(-30, 8); // underline position and thickness
  b.writeInt16BE(15, 10);
});

// The file

function checksum(buf) {
  const padded = pad4(buf);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
}

const tables = { 'OS/2': os2, cmap, glyf, head, hhea, hmtx, loca, maxp, name, post };
const tags = Object.keys(tables).sort();
const count = tags.length;
const power = 2 ** Math.floor(Math.log2(count));
const directory = table(12 + count * 16, (b) => {
  b.writeUInt32BE(0x00010000, 0);
  b.writeUInt16BE(count, 4);
  b.writeUInt16BE(power * 16, 6);
  b.writeUInt16BE(Math.log2(power), 8);
  b.writeUInt16BE(count * 16 - power * 16, 10);
  let offset = 12 + count * 16;
  tags.forEach((tag, i) => {
    const r = 12 + i * 16;
    b.write(tag, r, 'latin1');
    b.writeUInt32BE(checksum(tables[tag]), r + 4);
    b.writeUInt32BE(offset, r + 8);
    b.writeUInt32BE(tables[tag].length, r + 12);
    offset += pad4(tables[tag]).length;
  });
});

const font = Buffer.concat([directory, ...tags.map((tag) => pad4(tables[tag]))]);
const headOffset = directory.readUInt32BE(12 + tags.indexOf('head') * 16 + 8);
font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, headOffset + 8);

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'media', 'senior-icons.ttf');
fs.writeFileSync(out, font);
console.log(`Wrote ${out} (${font.length} bytes, ${points} points)`);
