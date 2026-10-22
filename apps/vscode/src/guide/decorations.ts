// How a guided piece looks in the editor: a quiet bar beside the lines being written, a hint at the
// end of the current line, and a short-lived highlight on code Senior filled in.

import * as vscode from 'vscode';
import type { Divergence, Gear } from '../panel/protocol.ts';

const FILLED_FOR_MS = 1800;

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

  private readonly hint = vscode.window.createTextEditorDecorationType({
    after: { color: new vscode.ThemeColor('senior.hintForeground'), margin: '0 0 0 2.5em', fontStyle: 'italic' },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
  });

  private readonly diverged = vscode.window.createTextEditorDecorationType({
    textDecoration: 'underline dotted',
    after: { color: new vscode.ThemeColor('senior.divergedForeground'), margin: '0 0 0 2.5em', fontStyle: 'italic' },
  });

  private readonly filled = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('senior.filledBackground'),
  });

  private filledTimer: NodeJS.Timeout | undefined;

  showSlot(editor: vscode.TextEditor, lines: vscode.Range, cursorLine: number, gear: Gear, divergence?: Divergence): void {
    editor.setDecorations(this.slot, [lines]);
    const end = editor.document.lineAt(Math.min(cursorLine, editor.document.lineCount - 1)).range.end;
    if (divergence) {
      editor.setDecorations(this.hint, []);
      editor.setDecorations(this.diverged, [
        { range: new vscode.Range(end, end), renderOptions: { after: { contentText: `differs from the plan, which has: ${clip(divergence.wanted)}` } } },
      ]);
      return;
    }
    editor.setDecorations(this.diverged, []);
    editor.setDecorations(this.hint, [{ range: new vscode.Range(end, end), renderOptions: { after: { contentText: hintFor(gear) } } }]);
  }

  flashFilled(editor: vscode.TextEditor, range: vscode.Range): void {
    editor.setDecorations(this.filled, [range]);
    clearTimeout(this.filledTimer);
    this.filledTimer = setTimeout(() => editor.setDecorations(this.filled, []), FILLED_FOR_MS);
  }

  clear(editor?: vscode.TextEditor): void {
    for (const e of editor ? [editor] : vscode.window.visibleTextEditors) {
      e.setDecorations(this.slot, []);
      e.setDecorations(this.hint, []);
      e.setDecorations(this.diverged, []);
    }
  }

  dispose(): void {
    clearTimeout(this.filledTimer);
    this.slot.dispose();
    this.hint.dispose();
    this.diverged.dispose();
    this.filled.dispose();
  }
}

function hintFor(gear: Gear): string {
  const why = process.platform === 'darwin' ? '⌘⌥/ asks why' : 'Ctrl+Alt+/ asks why';
  if (gear === 'accept') return `Tab accepts this piece · ${why}`;
  if (gear === 'watch') return 'Senior is typing · Esc to take over';
  return `write this line · ${why}`;
}

function clip(text: string): string {
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}
