// While the user writes a piece, other extensions' ghost text (GitHub Copilot, for example) would
// appear on the same lines as Senior's plan. VS Code cannot hide another extension's suggestions for a
// few lines, so Senior turns inline suggestions off in the user settings while a guide runs and puts
// the setting back afterwards. The user's own value is kept in global state first, so a window that
// closes or crashes during a piece cannot leave the setting off: the next start puts it back.

import * as vscode from 'vscode';

const KEY = 'senior.quietGhostText';
const SETTING = 'inlineSuggest.enabled';

interface Saved {
  /** The user's own value in their settings, or null when they had none. */
  value: boolean | null;
}

export class QuietOthers {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly state: vscode.Memento) {}

  /** Turn other ghost text off, unless the user opted out or it is already off. */
  hush(): Promise<void> {
    return this.then(async () => {
      if (!vscode.workspace.getConfiguration('senior').get<boolean>('quietOtherGhostText', true)) return;
      if (this.state.get<Saved>(KEY)) return;
      const editor = vscode.workspace.getConfiguration('editor');
      if (editor.get<boolean>(SETTING) === false) return;
      const own = editor.inspect<boolean>(SETTING)?.globalValue;
      await this.state.update(KEY, { value: own ?? null } satisfies Saved);
      await editor.update(SETTING, false, vscode.ConfigurationTarget.Global);
    });
  }

  /** Put the user's setting back. Also run at start, after a window that closed during a piece. */
  restore(): Promise<void> {
    return this.then(async () => {
      const saved = this.state.get<Saved>(KEY);
      if (!saved) return;
      const editor = vscode.workspace.getConfiguration('editor');
      // If the user changed the setting themselves in the meantime, their choice stays.
      if (editor.inspect<boolean>(SETTING)?.globalValue === false) {
        await editor.update(SETTING, saved.value ?? undefined, vscode.ConfigurationTarget.Global);
      }
      await this.state.update(KEY, undefined);
    });
  }

  private then(step: () => Promise<void>): Promise<void> {
    // One change at a time, and a failure never stops the next one or reaches the caller.
    this.queue = this.queue.then(step).catch(() => undefined);
    return this.queue;
  }
}
