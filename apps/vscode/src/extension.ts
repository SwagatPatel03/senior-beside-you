// Senior for VS Code: the editor side of a senior developer beside you.

import * as path from 'node:path';
import * as vscode from 'vscode';
import { activeEntries, entriesTouching, findRoot, setSeedDir } from '../../../plugin/core/index.mjs';
import { BridgeHandlers } from './bridge/handlers.ts';
import { BridgeServer } from './bridge/server.ts';
import { GuideController } from './guide/controller.ts';
import { Decorations } from './guide/decorations.ts';
import { GhostTextProvider } from './guide/inline.ts';
import type { DecisionView, FromPanel, Gear, JournalEntry } from './panel/protocol.ts';
import { PanelProvider } from './panel/provider.ts';
import { REPLAY_SCHEME, ReplayController } from './replay/controller.ts';
import { SessionStore } from './session.ts';
import { detect, installPlugin } from './setup.ts';
import { StatusItem } from './status.ts';
import { Voice } from './voice.ts';

const GEARS: Gear[] = ['type', 'accept', 'watch'];

export interface SeniorApi {
  session: SessionStore;
  guide: GuideController;
  replays: ReplayController;
  voice: Voice;
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
  const voice = new Voice();
  const readAloud = (text: string) => {
    if (session.readAloud) void voice.say(text);
  };
  const decorations = new Decorations();
  const guide = new GuideController(session, decorations, root);
  const replays = new ReplayController(session, root, () => panel.reveal(), readAloud);
  const handlers = new BridgeHandlers(session, guide, replays, root, (dir) => {
    if (dir) projectDir = dir;
  });
  const bridge = new BridgeServer(handlers.handle, context.extension.packageJSON.version as string, log);
  const panel = new PanelProvider(context.extensionUri, session, (message) => void onPanel(message), readAloud);
  void voice.ready.then((available) => {
    session.speech = available;
    session.changed();
    if (available && session.readAloud) void voice.warm();
  });
  const status = new StatusItem(session);

  async function watchReplay(id?: string): Promise<void> {
    let chosen = id;
    if (!chosen) {
      replays.refreshList();
      if (!session.replays.length) {
        void vscode.window.showInformationMessage('This project has no replays yet. After fast work, run /senior:replay in Claude Code to make one.');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        session.replays.map((r) => ({ label: r.title, description: `${r.scenes} scenes`, detail: new Date(r.createdAt).toLocaleString(), id: r.id })),
        { title: 'Watch a replay', placeHolder: 'Choose a replay' },
      );
      chosen = pick?.id;
    }
    if (!chosen) return;
    try {
      replays.show(chosen);
    } catch (err) {
      void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }

  function whereIn(editor: vscode.TextEditor): string {
    const r = root();
    const file = r ? path.relative(r, editor.document.uri.fsPath).replace(/\\/g, '/') : editor.document.fileName;
    const line = editor.selection.active.line;
    const code = editor.selection.isEmpty ? editor.document.lineAt(line).text.trim() : editor.document.getText(editor.selection).trim();
    return `${file}:${line + 1}${code ? `: ${code.slice(0, 300)}` : ''}`;
  }

  async function askWhy(prefill?: string, about?: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const where = about ?? (editor ? whereIn(editor) : undefined);
    const question = prefill ?? (await vscode.window.showInputBox({ title: 'Ask Senior why', prompt: where ? `About ${where}` : undefined, value: 'Why ', valueSelection: [4, 4] }));
    if (!question?.trim()) return;
    session.ask(question.trim(), where);
    panel.reveal();
  }

  /**
   * "Why is this line here?" First, at once, what is already known: the guided piece the line came
   * from and the decisions behind it. Only when nothing is known does the question go to Claude Code;
   * from the answer shown, the user can still ask more.
   */
  async function whyThisLine(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const known = editor ? explain(editor) : null;
    if (!editor || !known) return askWhy();
    session.add({ kind: 'explain', where: whereIn(editor), ...known });
    panel.reveal();
  }

  function explain(editor: vscode.TextEditor): Omit<Extract<JournalEntry, { kind: 'explain' }>, 'id' | 'at' | 'kind' | 'where'> | null {
    const line = editor.selection.active.line;
    const piece = guide.pieceAt(editor.document, line);
    const folder = root();
    const project = folder ? findRoot(folder) : null;
    const decisions: DecisionView[] = [];
    if (project) {
      const ledger = activeEntries(project);
      const rel = path.relative(project, editor.document.uri.fsPath).replace(/\\/g, '/');
      const ids = new Set<string>(piece?.decision ? [piece.decision] : []);
      for (const hit of entriesTouching(ledger, { files: [rel], text: editor.document.lineAt(line).text })) ids.add(hit.entry.id);
      for (const id of [...ids].slice(0, 3)) {
        const d = ledger.find((e) => e.id.toLowerCase() === id.toLowerCase());
        if (d) decisions.push({ id: d.id, title: d.title, chosen: d.chosen, why: d.why, rejected: d.rejected.slice(0, 3) });
      }
    }
    if (!piece && !decisions.length) return null;
    return { ...(piece ? { why: piece.why } : {}), ...(piece?.notice ? { notice: piece.notice } : {}), decisions };
  }

  async function onPanel(message: FromPanel): Promise<void> {
    switch (message.type) {
      case 'setGear':
        await session.setGear(message.gear);
        break;
      case 'ask': {
        // During a replay, a question is about the scene being read, not the line under the cursor.
        const place = replays.place();
        if (place) session.ask(message.text.trim(), place.where, place.at);
        else await askWhy(message.text);
        break;
      }
      case 'askMore':
        await askWhy(undefined, message.where);
        break;
      case 'piece':
        await guide.action(message.action);
        break;
      case 'replay':
        if (message.action === 'open') await watchReplay(message.id);
        else if (message.action === 'go') replays.go(message.index);
        else if (message.action === 'showChange') await replays.showChange(message.file);
        else if (message.action === 'finish') replays.finish();
        else replays.close();
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
      case 'toggleReadAloud': {
        const on = !session.readAloud;
        if (on) void voice.warm();
        else voice.stop();
        await vscode.workspace.getConfiguration('senior').update('readAloud', on, vscode.ConfigurationTarget.Global);
        break;
      }
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
    voice,
    decorations,
    guide,
    replays,
    bridge,
    panel,
    status,
    vscode.window.registerWebviewViewProvider(PanelProvider.viewId, panel),
    vscode.workspace.registerTextDocumentContentProvider(REPLAY_SCHEME, replays),
    vscode.commands.registerCommand('senior.watchReplay', () => watchReplay()),
    // Guided pieces live in project files on disk, in any language.
    vscode.languages.registerInlineCompletionItemProvider({ scheme: 'file' }, new GhostTextProvider(guide)),
    vscode.commands.registerCommand('senior.askWhy', () => whyThisLine()),
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

  return { session, guide, replays, voice, bridge: bridge.address };
}

export function deactivate(): void {
  // Disposables registered on the context clean up the bridge and its lock file.
}

function isInside(folder: string, target: string): boolean {
  const rel = path.relative(folder, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
