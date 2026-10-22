// The status bar item: the current gear and, while guiding, which piece the user is on.

import * as vscode from 'vscode';
import type { Gear } from './panel/protocol.ts';
import type { SessionStore } from './session.ts';

const GEAR_LABEL: Record<Gear, string> = { type: 'Type', accept: 'Accept', watch: 'Watch' };

export class StatusItem implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('senior.status', vscode.StatusBarAlignment.Right, 100);
  private readonly subscription: vscode.Disposable;

  constructor(private readonly session: SessionStore) {
    this.item.name = 'Senior';
    this.item.command = 'senior.cycleGear';
    this.subscription = session.onMeta(() => this.render());
    this.render();
    this.item.show();
  }

  private render(): void {
    const { gear, active } = this.session;
    const piece = active ? ` · piece ${active.index + 1} of ${active.total}` : '';
    this.item.text = `$(senior-spectacles) ${GEAR_LABEL[gear]}${piece}`;
    this.item.tooltip = new vscode.MarkdownString(
      `**Senior** is in the **${GEAR_LABEL[gear].toLowerCase()}** gear.\n\nClick to change gear. Type: you write the important lines. Accept: Tab accepts while you read why. Watch: Senior types at reading speed.`,
    );
    this.item.backgroundColor = active?.diverged ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
  }

  dispose(): void {
    this.subscription.dispose();
    this.item.dispose();
  }
}
