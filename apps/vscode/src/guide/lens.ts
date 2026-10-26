// The line above the piece being written: which piece it is, what it is for, and what you can do
// with it. VS Code draws CodeLens lines between the real lines, so nothing is added to the file.

import * as vscode from 'vscode';
import type { GuideController } from './controller.ts';

export class PieceLens implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;
  private readonly listener: vscode.Disposable;

  constructor(private readonly guide: GuideController) {
    this.listener = guide.onDidChangeSlot(() => this.changed.fire());
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const header = this.guide.header(document);
    if (!header) return [];
    const range = new vscode.Range(header.line, 0, header.line, 0);
    // A lens without a command is a plain label.
    const lenses = [new vscode.CodeLens(range, { title: `Piece ${header.index + 1} of ${header.total}: ${firstSentence(header.why)}`, command: '' })];
    lenses.push(new vscode.CodeLens(range, { title: 'Why?', command: 'senior.whyPiece', tooltip: 'Show why this piece is here' }));
    if (header.gear === 'accept') lenses.push(new vscode.CodeLens(range, { title: 'Accept (Tab)', command: 'senior.acceptPiece' }));
    lenses.push(new vscode.CodeLens(range, { title: 'Fill in', command: 'senior.fillIn', tooltip: 'Senior writes this piece for you' }));
    lenses.push(new vscode.CodeLens(range, { title: 'Skip', command: 'senior.skipPiece' }));
    return lenses;
  }

  dispose(): void {
    this.listener.dispose();
    this.changed.dispose();
  }
}

function firstSentence(text: string): string {
  const first = text.trim().split(/(?<=[.!?])\s/)[0] ?? '';
  return first.length > 90 ? `${first.slice(0, 87)}...` : first;
}
