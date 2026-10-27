// Pure text logic for guided pieces: where a piece goes, whether what the user typed matches it,
// and what tracing text to show on each line. Nothing here touches VS Code, so it is tested with plain Node.

import { profile } from '../../../../plugin/core/index.mjs';
import type { Teaching, TraceMode } from '../panel/protocol.ts';

export type Where = 'after' | 'before' | 'replace' | 'start' | 'end' | 'new_file';
export type PieceKind = 'spine' | 'flesh' | 'probe';

export interface Piece {
  file: string;
  kind: PieceKind;
  where: Where;
  anchor?: string;
  text: string;
  why: string;
  /** Spine pieces: the one detail worth noticing while typing it. */
  notice?: string;
  /** The ledger decision this piece carries out. */
  decision?: string;
  expect?: string;
  /** The technology and the user's level in it, which decide the trace and what the panel teaches. */
  tech?: string;
  level?: number;
  trace?: TraceMode;
  concept?: Teaching['concept'];
  words?: Teaching['words'];
  lines?: Teaching['lines'];
  blanks?: Teaching['blanks'];
  outline?: string[];
  todo?: string[];
  names?: string[];
}

const TRACES: TraceMode[] = ['full', 'shape', 'first', 'none'];

/**
 * What the editor shows before the user types a piece. Only spine pieces fade: a probe tests a
 * guess and is always shown in full. A piece without a level is traced in full, as before levels.
 */
export function traceFor(piece: Piece): TraceMode {
  if (piece.kind !== 'spine') return 'full';
  if (piece.trace && TRACES.includes(piece.trace)) return piece.trace;
  if (typeof piece.level === 'number') return profile(piece.level).trace;
  return 'full';
}

/** True when the user is learning this technology: below level 7 they type every spine piece themselves. */
export function isLearning(piece: Pick<Piece, 'level'>): boolean {
  return typeof piece.level === 'number' && piece.level < 7;
}

/** The teaching a piece carries, for the panel. Empty lists are left out. */
export function teachingOf(piece: Piece, techName?: string): Teaching | undefined {
  const t: Teaching = {};
  if (piece.tech) t.tech = piece.tech;
  if (techName) t.techName = techName;
  if (typeof piece.level === 'number') t.level = piece.level;
  if (piece.kind === 'spine') t.trace = traceFor(piece);
  if (piece.concept?.title && piece.concept.text) t.concept = piece.concept;
  if (piece.words?.length) t.words = piece.words;
  if (piece.lines?.length) t.lines = piece.lines;
  if (piece.blanks?.length) t.blanks = piece.blanks;
  if (piece.outline?.length) t.outline = piece.outline;
  if (piece.todo?.length) t.todo = piece.todo;
  if (piece.names?.length) t.names = piece.names;
  return Object.keys(t).length ? t : undefined;
}

/** Hide each blank's text behind its hint, so the trace shows the shape of a line without the names. */
export function maskBlanks(text: string, blanks: { text: string; hint: string }[] = []): string {
  let out = text;
  for (const b of blanks) if (b.text) out = out.split(b.text).join(`⟨${b.hint}⟩`);
  return out;
}

/** A span in the document, as offsets into its text. */
export interface Span {
  start: number;
  end: number;
}

export type Located =
  | { ok: true; span: Span; insert: string; slotStart: number; slotEnd: number }
  | { ok: false; reason: string };

const lines = (text: string) => text.split(/\r?\n/);

export function indentOf(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? '';
}

/** Find `anchor` in `text` exactly once. Falls back to a line-by-line match that ignores indentation. */
export function findAnchor(text: string, anchor: string, eol: string): Span | { error: string } {
  const exact = anchor.replace(/\r?\n/g, eol);
  const first = text.indexOf(exact);
  if (first !== -1) {
    if (text.indexOf(exact, first + 1) !== -1) return { error: `The anchor appears more than once. Use a longer anchor that is unique.` };
    return { start: first, end: first + exact.length };
  }

  const wanted = lines(anchor).map((l) => l.trim()).filter((l, i, all) => l || (i > 0 && i < all.length - 1));
  if (!wanted.length) return { error: 'The anchor is empty.' };
  const docLines = lines(text);
  const starts: number[] = [];
  let offset = 0;
  for (const line of docLines) {
    starts.push(offset);
    offset += line.length + eol.length;
  }
  const matches: number[] = [];
  for (let i = 0; i + wanted.length <= docLines.length; i++) {
    let same = true;
    for (let j = 0; j < wanted.length && same; j++) same = docLines[i + j].trim() === wanted[j];
    if (same) matches.push(i);
  }
  if (matches.length === 0) return { error: 'The anchor was not found in the file. Copy it exactly from the current file.' };
  if (matches.length > 1) return { error: 'The anchor matches more than one place. Use a longer anchor that is unique.' };
  const i = matches[0];
  const last = i + wanted.length - 1;
  return { start: starts[i], end: starts[last] + docLines[last].length };
}

function lineStart(text: string, offset: number): number {
  const i = text.lastIndexOf('\n', offset - 1);
  return i === -1 ? 0 : i + 1;
}

function lineEnd(text: string, offset: number): number {
  const i = text.indexOf('\n', offset);
  if (i === -1) return text.length;
  return text[i - 1] === '\r' ? i - 1 : i;
}

/**
 * The empty lines a handwritten piece starts as: one per planned line, each holding only that
 * line's indentation. The user writes over them while the plan is traced on top.
 */
export function blankLines(text: string, eol: string): string {
  return lines(text.replace(/(\r?\n)+$/, '')).map(indentOf).join(eol);
}

/**
 * Where a piece goes in the current text, and what to insert there.
 * Flesh pieces insert their full text. Spine and probe pieces insert a "slot" of empty lines, one
 * per planned line, which the user then writes into; `slotStart..slotEnd` is that slot.
 */
export function locate(text: string, piece: Piece, eol: string): Located {
  const body = piece.text.replace(/(\r?\n)+$/, '').replace(/\r?\n/g, eol);
  const handwritten = piece.kind !== 'flesh';
  const content = handwritten ? blankLines(piece.text, eol) : body;

  const insertLines = (offset: number, leading: string, trailing: string): Located => ({
    ok: true,
    span: { start: offset, end: offset },
    insert: `${leading}${content}${trailing}`,
    slotStart: offset + leading.length,
    slotEnd: offset + leading.length + content.length,
  });

  switch (piece.where) {
    case 'new_file':
      if (text.trim()) return { ok: false, reason: 'The file already exists and is not empty. Use start, end, after or before instead of new_file.' };
      return { ok: true, span: { start: 0, end: text.length }, insert: `${content}${eol}`, slotStart: 0, slotEnd: content.length };
    case 'start':
      return insertLines(0, '', eol);
    case 'end': {
      const needsBreak = text.length > 0 && !text.endsWith('\n');
      return insertLines(text.length, needsBreak ? eol : '', handwritten ? '' : eol);
    }
    case 'after':
    case 'before':
    case 'replace': {
      if (!piece.anchor) return { ok: false, reason: `"${piece.where}" needs an anchor copied from the file.` };
      const found = findAnchor(text, piece.anchor, eol);
      if ('error' in found) return { ok: false, reason: found.error };
      if (piece.where === 'before') return insertLines(lineStart(text, found.start), '', eol);
      if (piece.where === 'after') {
        const end = lineEnd(text, found.end === found.start ? found.end : found.end - 1);
        const atEof = end >= text.length;
        return atEof ? insertLines(text.length, eol, handwritten ? '' : eol) : insertLines(end + eol.length, '', eol);
      }
      // replace: flesh replaces exactly the anchor; handwritten pieces replace the whole lines it covers.
      if (!handwritten) return { ok: true, span: found, insert: body, slotStart: found.start, slotEnd: found.start + body.length };
      const start = lineStart(text, found.start);
      const end = lineEnd(text, Math.max(found.start, found.end - 1));
      return { ok: true, span: { start, end }, insert: content, slotStart: start, slotEnd: start + content.length };
    }
  }
}

/** Strip all whitespace: "x=1" and "x = 1" are the same intent. */
export const squash = (s: string) => s.replace(/\s+/g, '');

export interface Expected {
  /** The piece text split into lines, exactly as written. */
  raw: string[];
  /** Indices of lines that are not blank. Blank lines never need typing. */
  content: number[];
}

export function expectedOf(text: string): Expected {
  const raw = lines(text.replace(/(\r?\n)+$/, ''));
  return { raw, content: raw.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0) };
}

/** A line made only of closing brackets and separators, such as the editor adds automatically. */
const CLOSERS = /^[\s)\]}>;,]*$/;

export type Progress =
  | { state: 'complete' }
  | { state: 'writing'; line: number; typed: string }
  | { state: 'diverged'; line: number; wrote: string; wanted: string };

/**
 * Compare what is in the slot with the expected piece.
 * `region` is the slot's text; `cursorLine` is the cursor's line within the slot (0-based), or -1 if
 * the cursor is outside. Lines below the cursor are ignored while writing, because editors add
 * closing brackets there on their own.
 */
export function progress(region: string, expected: Expected, cursorLine: number, cursorColumn = Number.MAX_SAFE_INTEGER): Progress {
  const written = lines(region);
  const nonBlank = written.map((l, i) => ({ text: l, i })).filter((l) => l.text.trim());
  const want = expected.content.map((i) => expected.raw[i]);

  // Every planned line is there. Anything after it may only be closing characters the editor
  // inserted by itself (a "}" after typing "{" and Enter); tidying removes them.
  const allThere = nonBlank.length >= want.length && want.every((w, k) => squash(nonBlank[k].text) === squash(w));
  if (allThere && nonBlank.slice(want.length).every((l) => CLOSERS.test(l.text))) return { state: 'complete' };

  let k = 0;
  for (const line of nonBlank) {
    if (cursorLine >= 0 && line.i >= cursorLine) break;
    if (k >= want.length || squash(line.text) !== squash(want[k])) {
      return { state: 'diverged', line: line.i, wrote: line.text.trim(), wanted: want[k]?.trim() ?? '(nothing more)' };
    }
    k++;
  }
  if (cursorLine < 0) return { state: 'writing', line: k, typed: '' };

  const typed = (written[cursorLine] ?? '').slice(0, cursorColumn);
  if (typed.trim() && (k >= want.length || !squash(want[k]).startsWith(squash(typed)))) {
    return { state: 'diverged', line: cursorLine, wrote: typed.trim(), wanted: want[k]?.trim() ?? '(nothing more)' };
  }
  return { state: 'writing', line: k, typed };
}

/**
 * The rest of expected line `k` after what the user has typed on it, matching characters while
 * ignoring whitespace. Returns null when the typed text is not a prefix of the expected line.
 */
export function remainder(expectedLine: string, typed: string): string | null {
  const want = expectedLine.trimStart();
  const have = typed.trimStart();
  let i = 0;
  let j = 0;
  while (j < have.length) {
    if (/\s/.test(have[j])) {
      // A space the user typed uses up the expected space at the same point, if there is one.
      while (i < want.length && /\s/.test(want[i])) i++;
      j++;
      continue;
    }
    while (i < want.length && /\s/.test(want[i])) i++;
    if (i >= want.length || want[i] !== have[j]) return null;
    i++;
    j++;
  }
  return want.slice(i);
}

/** Characters an editor closes by itself: brackets and quotes. */
const AUTO_CLOSED = /[\s)\]}>'"`]*$/;

/**
 * How many characters at the end of a line to drop so that it matches the planned line, when
 * those characters are only brackets or quotes the editor closed by itself. Typing "if (x) {"
 * leaves "if (x) {}" behind; the plan puts the "}" on a later line. Returns 0 when nothing should go.
 */
export function strayClosers(text: string, want: string): number {
  if (squash(text) === squash(want)) return 0;
  const from = AUTO_CLOSED.exec(text)?.index ?? text.length;
  for (let cut = text.length - 1; cut >= from; cut--) {
    if (squash(text.slice(0, cut)) === squash(want)) return text.length - cut;
  }
  return 0;
}

/** Every planned line is written, once characters the editor closed by itself are set aside. */
export function isComplete(region: string, expected: Expected): boolean {
  const cleaned = lines(region).map((line, r) => {
    const want = expected.raw[r];
    if (!want?.trim()) return line;
    const extra = strayClosers(line, want);
    return extra ? line.slice(0, line.length - extra) : line;
  });
  return progress(cleaned.join('\n'), expected, -1).state === 'complete';
}

/** Text to draw at a column of a line. */
export interface TracePart {
  column: number;
  text: string;
}

export interface LineView {
  /** The line within the slot. */
  line: number;
  state: 'empty' | 'writing' | 'done' | 'diverged' | 'extra';
  /** The faint text still to type on this line, placed around what is already there. */
  trace: TracePart[];
  wrote?: string;
  wanted?: string;
}

/**
 * Place `rest` around `after`, the text already to the right of where it starts: characters the
 * editor closed by itself, such as the ")" after "foo(". Each character of `after` uses up the same
 * character of `rest`, and the parts between are drawn in the gaps. Columns count from the start of
 * `after`. Returns null when `after` holds something the plan does not have there.
 */
export function splitTrace(rest: string, after: string): TracePart[] | null {
  const parts: TracePart[] = [];
  let i = 0;
  for (let p = 0; p < after.length; p++) {
    const c = after[p];
    if (/\s/.test(c)) continue;
    const at = rest.indexOf(c, i);
    if (at < 0) return null;
    if (at > i) parts.push({ column: p, text: rest.slice(i, at) });
    i = at + 1;
  }
  if (i < rest.length) parts.push({ column: after.length, text: rest.slice(i) });
  return parts;
}

/**
 * The tracing text for every line of the slot. Line r of the slot carries planned line r. On the
 * cursor's line only the text before the cursor counts as written, so the rest of the plan is drawn
 * at the cursor. Elsewhere, brackets the editor closed by itself at the end of a line are allowed.
 * `cursorLine` is -1 when the cursor is outside the slot.
 */
export function traceLines(region: string, expected: Expected, cursorLine: number, cursorColumn: number): LineView[] {
  return lines(region).map((text, line): LineView => {
    const want = expected.raw[line];
    const closersOnly = CLOSERS.test(text);
    if (want === undefined || !want.trim()) {
      if (closersOnly) return { line, state: want === undefined ? 'extra' : 'done', trace: [] };
      return { line, state: 'diverged', trace: [], wrote: text.trim(), wanted: want === undefined ? '(nothing more)' : '(an empty line)' };
    }
    if (squash(text) === squash(want)) return { line, state: 'done', trace: [] };
    const state = text.trim() ? 'writing' : 'empty';

    if (line === cursorLine) {
      const typed = text.slice(0, cursorColumn);
      const rest = remainder(want, typed);
      if (rest === null) return { line, state: 'diverged', trace: [], wrote: typed.trim(), wanted: want.trim() };
      const parts = splitTrace(rest, text.slice(cursorColumn)) ?? [];
      return { line, state, trace: parts.map((p) => ({ column: cursorColumn + p.column, text: p.text })) };
    }

    // A closing line the editor added below the cursor is not a mistake.
    if (cursorLine >= 0 && line > cursorLine && closersOnly && text.trim()) return { line, state: 'extra', trace: [] };
    const from = AUTO_CLOSED.exec(text)?.index ?? text.length;
    for (let cut = text.length; cut >= from; cut--) {
      const rest = remainder(want, text.slice(0, cut));
      const parts = rest === null ? null : splitTrace(rest, text.slice(cut));
      if (parts) return { line, state, trace: parts.map((p) => ({ column: cut + p.column, text: p.text })) };
    }
    return { line, state: 'diverged', trace: [], wrote: text.trim(), wanted: want.trim() };
  });
}

/** How many lines of a piece a person actually has to write. */
export function writtenLineCount(text: string): number {
  return expectedOf(text).content.length;
}
