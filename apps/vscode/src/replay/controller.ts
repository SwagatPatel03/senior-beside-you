// Replays in the editor. A saved replay opens in the Senior panel one scene at a time, and each
// change opens side by side in a diff editor. Claude Code stays with the user through show_replay,
// which returns when they ask a question or finish, the same way guide does.

import * as path from 'node:path';
import * as vscode from 'vscode';
import { findRoot, listReplays, loadLedger, loadReplay } from '../../../../plugin/core/index.mjs';
import type { Replay } from '../../../../plugin/core/index.mjs';
import type { ReplayPlace, ReplayView, SceneKind } from '../panel/protocol.ts';
import type { SessionStore } from '../session.ts';

export const REPLAY_SCHEME = 'senior-replay';

const SCENE_KINDS: SceneKind[] = ['build', 'bug', 'decision', 'skipped', 'check'];

type Ending = 'finished' | 'closed';

export type ReplayUpdate = { status: 'question' | 'waiting' | Ending; scene: number; of: number; note?: string };

interface OpenReplay {
  replay: Replay;
  index: number;
  decisionTitles: Map<string, string>;
}

export class ReplayController implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private current: OpenReplay | null = null;
  /** How the last replay ended, kept until Claude Code has been told once. */
  private ended: { id: string; how: Ending; scene: number; of: number } | null = null;
  private readonly wakers = new Set<() => void>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly session: SessionStore,
    private readonly workspaceRoot: () => string | null,
    private readonly reveal: () => void,
    /** Reads a scene aloud when the user has turned reading aloud on. */
    private readonly speak: (text: string) => void = () => undefined,
  ) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/.senior/replays/*.json');
    this.disposables.push(
      watcher,
      watcher.onDidCreate(() => this.refreshList()),
      watcher.onDidChange(() => this.refreshList()),
      watcher.onDidDelete(() => this.refreshList()),
      session.onQuestion(() => this.wake()),
    );
    this.refreshList();
  }

  /** The replay and scene a question asked now belongs to, if a replay is open. */
  place(): { at: ReplayPlace; where: string } | null {
    const open = this.current;
    if (!open) return null;
    const { replay, index } = open;
    const scene = replay.scenes[index];
    const where = scene ? `Replay "${replay.title}", scene ${index + 1} of ${replay.scenes.length}: ${scene.title}` : `Replay "${replay.title}", after the last scene`;
    return { at: { id: replay.id, scene: index }, where };
  }

  /** Open a saved replay. Opening the replay that is already open keeps the user's scene. */
  show(id: string): void {
    if (this.current?.replay.id === id) {
      this.reveal();
      return;
    }
    const root = this.projectRoot();
    const replay = loadReplay(root, id);
    if (!replay) throw new Error(`There is no replay "${id}" in .senior/replays. Run "replay list" to see the saved replays.`);
    const decisionTitles = new Map(loadLedger(root).map((d) => [d.id, d.title] as [string, string]));
    this.current = { replay, index: 0, decisionTitles };
    this.ended = null;
    this.session.noteReplay(replay.id, replay.title, replay.scenes.length);
    this.publish();
    this.reveal();
    this.speakScene();
  }

  /** Move to a scene. The page after the last scene closes the replay with what was skipped and checked. */
  go(index: number): void {
    const open = this.current;
    if (!open) return;
    const next = Math.max(0, Math.min(Math.trunc(index), open.replay.scenes.length));
    if (next === open.index) return;
    open.index = next;
    this.publish();
    this.speakScene();
  }

  private speakScene(): void {
    const scene = this.current?.replay.scenes[this.current.index];
    if (scene) this.speak(`${scene.title}. ${scene.narration}`);
  }

  finish(): void {
    this.end('finished');
  }

  close(): void {
    this.end('closed');
  }

  /** If the replay with this id ended and Claude Code has not been told, tell it now, once. */
  takeEnding(id: string): ReplayUpdate | null {
    const ended = this.ended;
    if (!ended || ended.id !== id) return null;
    this.ended = null;
    return { status: ended.how, scene: ended.scene, of: ended.of };
  }

  /** Wait until the user asks a question, ends the replay, or the timeout passes. */
  async watch(timeoutMs: number, signal?: AbortSignal): Promise<ReplayUpdate> {
    const id = this.current?.replay.id;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const open = this.current;
      if (!open || open.replay.id !== id) {
        return (id && this.takeEnding(id)) || { status: 'closed', scene: 0, of: 0 };
      }
      const position = { scene: Math.min(open.index + 1, open.replay.scenes.length), of: open.replay.scenes.length };
      if (this.session.hasPendingQuestions()) return { status: 'question', ...position };
      const left = deadline - Date.now();
      if (left <= 0 || signal?.aborted) {
        return { status: 'waiting', ...position, note: `The user is reading scene ${position.scene} of ${position.of}. Call show_replay again to keep waiting.` };
      }
      await this.sleep(left, signal);
    }
  }

  /** Open one change of the current scene side by side. */
  async showChange(fileIndex: number): Promise<void> {
    const open = this.current;
    const file = open?.replay.scenes[open.index]?.files[fileIndex];
    if (!open || !file) return;
    const base = `/${open.replay.id}/${open.index}/${fileIndex}`;
    const name = path.posix.basename(file.path) || 'change';
    const before = vscode.Uri.from({ scheme: REPLAY_SCHEME, path: `${base}/before/${name}` });
    const after = vscode.Uri.from({ scheme: REPLAY_SCHEME, path: `${base}/after/${name}` });
    await vscode.commands.executeCommand('vscode.diff', before, after, `${file.path} (scene ${open.index + 1}, before and after)`, { preview: true });
  }

  /** The text of one side of a change, for the diff editor. */
  provideTextDocumentContent(uri: vscode.Uri): string {
    const [id, scene, file, side] = uri.path.split('/').filter(Boolean);
    const replay = this.current?.replay.id === id ? this.current.replay : this.tryLoad(id);
    const change = replay?.scenes[Number(scene)]?.files[Number(file)];
    if (!change) return '';
    return (side === 'before' ? change.before : change.after) ?? '';
  }

  refreshList(): void {
    const root = this.rootOrNull();
    this.session.replays = root ? listReplays(root).map(({ id, title, createdAt, scenes }) => ({ id, title, createdAt, scenes })) : [];
    this.session.changed();
  }

  private view(): ReplayView | null {
    const open = this.current;
    if (!open) return null;
    const { replay, index, decisionTitles } = open;
    return {
      id: replay.id,
      title: replay.title,
      task: replay.task,
      index,
      scenes: replay.scenes.map((s) => ({
        title: s.title,
        narration: s.narration,
        kind: SCENE_KINDS.includes(s.kind) ? s.kind : 'build',
        decisions: s.decisions.map((d) => (decisionTitles.has(d) ? { id: d, title: decisionTitles.get(d) } : { id: d })),
        files: s.files.map((f) => ({ path: f.path, change: f.before === undefined ? 'added' : 'changed' })),
      })),
      skipped: replay.skipped,
      verified: replay.verified,
      notVerified: replay.notVerified,
    };
  }

  private end(how: Ending): void {
    const open = this.current;
    if (!open) return;
    this.ended = { id: open.replay.id, how, scene: Math.min(open.index + 1, open.replay.scenes.length), of: open.replay.scenes.length };
    this.current = null;
    this.publish();
    this.wake();
  }

  private publish(): void {
    this.session.replay = this.view();
    this.session.changed();
  }

  private rootOrNull(): string | null {
    const folder = this.workspaceRoot();
    return folder ? findRoot(folder) : null;
  }

  private projectRoot(): string {
    const root = this.rootOrNull();
    if (!root) throw new Error('This folder has no .senior/ folder, so it has no replays yet.');
    return root;
  }

  private tryLoad(id: string | undefined): Replay | null {
    const root = this.rootOrNull();
    return root && id ? loadReplay(root, id) : null;
  }

  private wake(): void {
    for (const w of [...this.wakers]) w();
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.wakers.delete(done);
        signal?.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.wakers.add(done);
      signal?.addEventListener('abort', done, { once: true });
    });
  }

  dispose(): void {
    this.wake();
    for (const d of this.disposables) d.dispose();
  }
}
