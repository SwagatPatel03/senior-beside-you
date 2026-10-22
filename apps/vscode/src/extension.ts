// Senior for VS Code: the editor side of a senior developer beside you.

import * as path from 'node:path';
import * as vscode from 'vscode';
import { setSeedDir } from '../../../plugin/core/index.mjs';
import { BridgeHandlers } from './bridge/handlers.ts';
import { BridgeServer } from './bridge/server.ts';
import { GuideController } from './guide/controller.ts';
import { Decorations } from './guide/decorations.ts';
import { GhostTextProvider } from './guide/inline.ts';
import type { FromPanel, Gear } from './panel/protocol.ts';
import { PanelProvider } from './panel/provider.ts';
import { SessionStore } from './session.ts';
import { detect, installPlugin } from './setup.ts';
import { StatusItem } from './status.ts';

const GEARS: Gear[] = ['type', 'accept', 'watch'];

export interface SeniorApi {
  session: SessionStore;
  guide: GuideController;
  bridge: { port: number; token: string };
}

export async function activate(context: vscode.ExtensionContext): Promise<SeniorApi> {
  setSeedDir(path.join(context.extensionPath, 'dist', 'regrets'));
  const log = vscode.window.createOutputChannel('Senior', { log: true });

  // In a multi-root workspace, follow the folder Claude Code is working in.
  let projectDir: string | null = null;
  const root = (): string | null => {
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    if (projectDir) {
      const match = folders.filter((f) => isInside(f, projectDir as string)).sort((a, b) => b.length - a.length)[0];
      if (match) return match;
    }
    return folders[0] ?? null;
  };

  const session = new SessionStore(context.globalState, root);
  const decorations = new Decorations();
  const guide = new GuideController(session, decorations, root);
  const handlers = new BridgeHandlers(session, guide, root, (dir) => {
    if (dir) projectDir = dir;
  });
  const bridge = new BridgeServer(handlers.handle, context.extension.packageJSON.version as string, log);
  const panel = new PanelProvider(context.extensionUri, session, (message) => void onPanel(message));
  const status = new StatusItem(session);

  async function askWhy(prefill?: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    let where: string | undefined;
    if (editor) {
      const r = root();
      const file = r ? path.relative(r, editor.document.uri.fsPath).replace(/\\/g, '/') : editor.document.fileName;
      const line = editor.selection.active.line;
      const code = editor.selection.isEmpty ? editor.document.lineAt(line).text.trim() : editor.document.getText(editor.selection).trim();
      where = `${file}:${line + 1}${code ? `: ${code.slice(0, 300)}` : ''}`;
    }
    const question = prefill ?? (await vscode.window.showInputBox({ title: 'Ask Senior why', prompt: where ? `About ${where}` : undefined, value: 'Why ', valueSelection: [4, 4] }));
    if (!question?.trim()) return;
    session.ask(question.trim(), where);
    panel.reveal();
  }

  async function onPanel(message: FromPanel): Promise<void> {
    switch (message.type) {
      case 'setGear':
        await session.setGear(message.gear);
        break;
      case 'ask':
        await askWhy(message.text);
        break;
      case 'piece':
        await guide.action(message.action);
        break;
      case 'openFile': {
        const r = root();
        const target = r ? path.resolve(r, message.file) : null;
        if (!r || !target || !isInside(r, target)) return;
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
        const at = new vscode.Position(Math.max(0, (message.line ?? 1) - 1), 0);
        await vscode.window.showTextDocument(doc, { selection: new vscode.Range(at, at) });
        break;
      }
      case 'setup':
        if (await installPlugin(log)) await refreshSetup();
        break;
      case 'copy':
        await vscode.env.clipboard.writeText(message.text);
        void vscode.window.setStatusBarMessage('Copied', 2000);
        break;
      case 'toggleReadAloud':
        await vscode.workspace.getConfiguration('senior').update('readAloud', !session.readAloud, vscode.ConfigurationTarget.Global);
        break;
    }
  }

  async function refreshSetup(): Promise<void> {
    const found = await detect();
    session.claudeFound = found.claudeFound;
    session.pluginInstalled = found.pluginInstalled;
    session.changed();
  }

  context.subscriptions.push(
    log,
    session,
    decorations,
    guide,
    bridge,
    panel,
    status,
    vscode.window.registerWebviewViewProvider(PanelProvider.viewId, panel),
    // Guided pieces live in project files on disk, in any language.
    vscode.languages.registerInlineCompletionItemProvider({ scheme: 'file' }, new GhostTextProvider(guide)),
    vscode.commands.registerCommand('senior.askWhy', () => askWhy()),
    vscode.commands.registerCommand('senior.cycleGear', () => session.setGear(GEARS[(GEARS.indexOf(session.gear) + 1) % GEARS.length])),
    vscode.commands.registerCommand('senior.gearType', () => session.setGear('type')),
    vscode.commands.registerCommand('senior.gearAccept', () => session.setGear('accept')),
    vscode.commands.registerCommand('senior.gearWatch', () => session.setGear('watch')),
    vscode.commands.registerCommand('senior.takeOver', () => guide.action('takeOver')),
    vscode.commands.registerCommand('senior.fillIn', () => guide.action('fillIn')),
    vscode.commands.registerCommand('senior.skipPiece', () => guide.action('skip')),
    vscode.commands.registerCommand('senior.focus', () => vscode.commands.executeCommand('senior.panel.focus')),
    vscode.commands.registerCommand('senior.setupClaudeCode', async () => {
      if (await installPlugin(log)) await refreshSetup();
    }),
  );

  // Keep "connected a minute ago" fresh in the panel.
  const tick = setInterval(() => session.changed(), 15_000);
  context.subscriptions.push({ dispose: () => clearInterval(tick) });

  try {
    await bridge.start();
  } catch (err) {
    log.error(`The bridge for Claude Code could not start: ${err instanceof Error ? err.message : String(err)}`);
  }
  void refreshSetup();

  return { session, guide, bridge: bridge.address };
}

export function deactivate(): void {
  // Disposables registered on the context clean up the bridge and its lock file.
}

function isInside(folder: string, target: string): boolean {
  const rel = path.relative(folder, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
