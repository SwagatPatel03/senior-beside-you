// Ghost text: the rest of the line the user is writing, or the whole piece in the accept gear.

import * as vscode from 'vscode';
import type { GuideController } from './controller.ts';

export class GhostTextProvider implements vscode.InlineCompletionItemProvider {
  constructor(private readonly guide: GuideController) {}

  provideInlineCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.InlineCompletionItem[] {
    const ghost = this.guide.ghostAt(document, position);
    return ghost ? [new vscode.InlineCompletionItem(ghost.insertText, ghost.range)] : [];
  }
}
