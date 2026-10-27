// How a guided piece looks in the editor: a quiet bar beside the lines being written, the plan traced
// on them in Senior's own colour, a hint at the end of the current line, and a short-lived highlight on
// code Senior filled in.

import * as vscode from 'vscode';

const FILLED_FOR_MS = 1800;
const EVIDENCE_FOR_MS = 30_000;

/** Everything drawn for the slot being written, already placed in the document. */
export interface SlotPaint {
  lines: vscode.Range;
  traces: { at: vscode.Position; text: string }[];
  /** Lines that differ from the plan, with what to say at their end. */
  diverged: { range: vscode.Range; message: string }[];
  /** Plain sentences on empty lines that say what to write there, when only the first line is traced. */
  notes: { at: vscode.Position; text: string }[];
  hint?: { at: vscode.Position; text: string };
}

export class Decorations implements vscode.Disposable {
  private readonly slot = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('senior.slotBackground'),
    borderColor: new vscode.ThemeColor('senior.slotBorder'),
    borderStyle: 'solid',
    borderWidth: '0 0 0 2px',
    overviewRulerColor: new vscode.ThemeColor('senior.slotBorder'),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });

  // Created before the hint, so at the same spot the plan comes first and the hint after it.
  private readonly trace = vscode.window.createTextEditorDecorationType({
    after: { color: new vscode.ThemeColor('senior.traceForeground') },
  });

  private readonly note = vscode.window.createTextEditorDecorationType({
    after: { color: new vscode.ThemeColor('senior.hintForeground'), fontStyle: 'italic' },
  });

  private readonly hint = vscode.window.createTextEditorDecorationType({
    after: { color: new vscode.ThemeColor('senior.hintForeground'), margin: '0 0 0 2.5em', fontStyle: 'italic' },
  });

  private readonly diverged = vscode.window.createTextEditorDecorationType({
    textDecoration: 'underline dotted',
    after: { color: new vscode.ThemeColor('senior.divergedForeground'), margin: '0 0 0 2.5em', fontStyle: 'italic' },
  });

  private readonly filled = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('senior.filledBackground'),
  });

  private readonly evidence = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('senior.evidenceBackground'),
    borderColor: new vscode.ThemeColor('senior.divergedForeground'),
    borderStyle: 'solid',
    borderWidth: '0 0 0 2px',
    overviewRulerColor: new vscode.ThemeColor('senior.divergedForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });

  private filledTimer: NodeJS.Timeout | undefined;
  private evidenceTimer: NodeJS.Timeout | undefined;

  /** Mark the line a failing check points at, until the next guide or for half a minute. */
  markEvidence(editor: vscode.TextEditor, line: number): void {
    editor.setDecorations(this.evidence, [new vscode.Range(line, 0, line, 0)]);
    clearTimeout(this.evidenceTimer);
    this.evidenceTimer = setTimeout(() => editor.setDecorations(this.evidence, []), EVIDENCE_FOR_MS);
  }

  clearEvidence(): void {
    clearTimeout(this.evidenceTimer);
    for (const e of vscode.window.visibleTextEditors) e.setDecorations(this.evidence, []);
  }

  showSlot(editor: vscode.TextEditor, paint: SlotPaint): void {
    const tab = typeof editor.options.tabSize === 'number' ? editor.options.tabSize : 4;
    editor.setDecorations(this.slot, [paint.lines]);
    editor.setDecorations(
      this.trace,
      paint.traces.map((t) => ({ range: new vscode.Range(t.at, t.at), renderOptions: { after: { contentText: visible(t.text, tab) } } })),
    );
    editor.setDecorations(
      this.diverged,
      paint.diverged.map((d) => ({ range: d.range, renderOptions: { after: { contentText: clip(d.message, 90) } } })),
    );
    editor.setDecorations(
      this.note,
      paint.notes.map((n) => ({ range: new vscode.Range(n.at, n.at), renderOptions: { after: { contentText: visible(n.text, tab) } } })),
    );
    const hint = paint.hint;
    const clash = hint && paint.diverged.some((d) => d.range.end.line === hint.at.line);
    editor.setDecorations(this.hint, hint && !clash ? [{ range: new vscode.Range(hint.at, hint.at), renderOptions: { after: { contentText: hint.text } } }] : []);
  }

  flashFilled(editor: vscode.TextEditor, range: vscode.Range): void {
    editor.setDecorations(this.filled, [range]);
    clearTimeout(this.filledTimer);
    this.filledTimer = setTimeout(() => editor.setDecorations(this.filled, []), FILLED_FOR_MS);
  }

  clear(editor?: vscode.TextEditor): void {
    for (const e of editor ? [editor] : vscode.window.visibleTextEditors) {
      e.setDecorations(this.slot, []);
      e.setDecorations(this.trace, []);
      e.setDecorations(this.hint, []);
      e.setDecorations(this.diverged, []);
      e.setDecorations(this.note, []);
    }
  }

  dispose(): void {
    clearTimeout(this.filledTimer);
    clearTimeout(this.evidenceTimer);
    this.evidence.dispose();
    this.slot.dispose();
    this.trace.dispose();
    this.hint.dispose();
    this.note.dispose();
    this.diverged.dispose();
    this.filled.dispose();
  }
}

/** Decoration text collapses runs of spaces, so spacing is drawn with no-break spaces. */
function visible(text: string, tab: number): string {
  return text.replace(/\t/g, ' '.repeat(tab)).replace(/ /g, ' ');
}

function clip(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}
