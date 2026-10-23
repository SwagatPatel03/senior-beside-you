// Pure text logic for guided pieces: where a piece goes, whether what the user typed matches it,
// and what ghost text to show next. Nothing here touches VS Code, so it is tested with plain Node.

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
 * Where a piece goes in the current text, and what to insert there.
 * Flesh pieces insert their full text. Spine and probe pieces insert an empty "slot" line with the
 * first line's indentation, which the user then writes into; `slotStart..slotEnd` is that slot.
 */
export function locate(text: string, piece: Piece, eol: string): Located {
  const body = piece.text.replace(/(\r?\n)+$/, '').replace(/\r?\n/g, eol);
  const handwritten = piece.kind !== 'flesh';
  const slot = handwritten ? indentOf(lines(piece.text)[0] ?? '') : '';
  const content = handwritten ? slot : body;

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

/**
 * Ghost text for the cursor: the rest of the current line, and in the accept gear every line after it.
 * `typed` is the text before the cursor on its line.
 */
export function ghostText(expected: Expected, k: number, typed: string, gear: 'type' | 'accept' | 'watch', eol = '\n'): string | null {
  if (k >= expected.content.length) return null;
  const lineIndex = expected.content[k];
  const rest = remainder(expected.raw[lineIndex], typed);
  if (rest === null) return null;
  if (gear !== 'accept') return rest;
  const after = expected.raw.slice(lineIndex + 1);
  return after.length ? `${rest}${eol}${after.join(eol)}` : rest;
}

/** How many lines of a piece a person actually has to write. */
export function writtenLineCount(text: string): number {
  return expectedOf(text).content.length;
}
