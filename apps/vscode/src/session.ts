// What the Senior panel shows, and what the editor remembers for the project story.

import * as vscode from 'vscode';
import { appendEvent, findRoot } from '../../../plugin/core/index.mjs';
import type { ActivePiece, Connection, Gear, JournalEntry, PanelMeta, PanelState, ReplayPlace, ReplaySummary, ReplayView, SayKind, Stats, StepInfo } from './panel/protocol.ts';

const MAX_JOURNAL = 300;

export interface UserQuestion {
  id: string;
  text: string;
  where?: string;
}

type NewEntry = JournalEntry extends infer E ? (E extends JournalEntry ? Omit<E, 'id' | 'at'> : never) : never;

export class SessionStore implements vscode.Disposable {
  private journal: JournalEntry[] = [];
  private questions: (UserQuestion & { delivered: boolean })[] = [];
  private counter = 0;
  private readonly sessionId = `editor-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${Math.random().toString(36).slice(2, 6)}`;

  step: StepInfo | null = null;
  active: ActivePiece | null = null;
  stats: Stats = { typed: 0, accepted: 0, watched: 0, filled: 0, steps: 0, takeaways: 0 };
  lastBridgeCall: number | null = null;
  claudeFound: boolean | 'unknown' = 'unknown';
  pluginInstalled: boolean | 'unknown' = 'unknown';
  /** The replay open in the panel, and the saved replays of this project. Set by the replay controller. */
  replay: ReplayView | null = null;
  replays: ReplaySummary[] = [];

  private readonly entryEmitter = new vscode.EventEmitter<JournalEntry>();
  private readonly metaEmitter = new vscode.EventEmitter<void>();
  private readonly questionEmitter = new vscode.EventEmitter<UserQuestion>();
  private readonly gearEmitter = new vscode.EventEmitter<Gear>();
  readonly onEntry = this.entryEmitter.event;
  readonly onMeta = this.metaEmitter.event;
  readonly onQuestion = this.questionEmitter.event;
  readonly onGear = this.gearEmitter.event;

  private currentGear: Gear;

  constructor(
    private readonly memento: vscode.Memento,
    private readonly workspaceRoot: () => string | null,
  ) {
    // Read the stored gear once. Storage writes echo back asynchronously, so reading it on every
    // access would let a stale echo undo a newer change.
    this.currentGear = memento.get<Gear>('senior.gear') ?? vscode.workspace.getConfiguration('senior').get<Gear>('gear', 'type');
  }

  get gear(): Gear {
    return this.currentGear;
  }

  async setGear(gear: Gear): Promise<void> {
    if (gear === this.currentGear) return;
    this.currentGear = gear;
    this.gearEmitter.fire(gear);
    this.changed();
    await this.memento.update('senior.gear', gear);
  }

  get readAloud(): boolean {
    return vscode.workspace.getConfiguration('senior').get<boolean>('readAloud', false);
  }

  connection(): Connection {
    return {
      lastCallSecondsAgo: this.lastBridgeCall === null ? null : Math.round((Date.now() - this.lastBridgeCall) / 1000),
      claudeFound: this.claudeFound,
      pluginInstalled: this.pluginInstalled,
    };
  }

  meta(): PanelMeta {
    return {
      gear: this.gear,
      workspace: this.workspaceRoot(),
      step: this.step,
      stats: { ...this.stats },
      active: this.active,
      connection: this.connection(),
      readAloud: this.readAloud,
      replay: this.replay,
      replays: this.replays,
    };
  }

  snapshot(): PanelState {
    return { ...this.meta(), journal: [...this.journal] };
  }

  changed(): void {
    this.metaEmitter.fire();
  }

  add(entry: NewEntry): JournalEntry {
    const full = { ...entry, id: `e${++this.counter}`, at: new Date().toISOString() } as JournalEntry;
    this.journal.push(full);
    if (this.journal.length > MAX_JOURNAL) this.journal.splice(0, this.journal.length - MAX_JOURNAL);
    this.entryEmitter.fire(full);
    return full;
  }

  update(entry: JournalEntry): void {
    const i = this.journal.findIndex((e) => e.id === entry.id);
    if (i >= 0) this.journal[i] = entry;
    this.entryEmitter.fire(entry);
  }

  say(kind: SayKind, text: string, replyTo?: string): JournalEntry {
    if (replyTo) {
      const question = this.journal.find((e) => e.id === replyTo);
      if (question && question.kind === 'question') this.update({ ...question, answered: true });
    }
    if (kind === 'takeaway') {
      this.stats.takeaways++;
      this.record({ type: 'takeaway', text });
      this.changed();
    }
    return this.add({ kind, text, replyTo });
  }

  /** A question the user asked in the editor. Claude reads it in the next tool result. */
  ask(text: string, where?: string, replay?: ReplayPlace): UserQuestion {
    const entry = this.add({ kind: 'question', text, where, ...(replay ? { replay } : {}), answered: false });
    const question = { id: entry.id, text, where, delivered: false };
    this.questions.push(question);
    this.questionEmitter.fire(question);
    return question;
  }

  hasPendingQuestions(): boolean {
    return this.questions.some((q) => !q.delivered);
  }

  takeQuestions(): UserQuestion[] {
    const pending = this.questions.filter((q) => !q.delivered);
    for (const q of pending) q.delivered = true;
    return pending.map(({ id, text, where }) => (where ? { id, text, where } : { id, text }));
  }

  /** Note a replay in the journal the first time it is opened, so it can be watched again from there. */
  noteReplay(replayId: string, title: string, scenes: number): void {
    if (this.journal.some((e) => e.kind === 'replay' && e.replayId === replayId)) return;
    this.add({ kind: 'replay', replayId, title, scenes });
  }

  beginStep(step: StepInfo): void {
    this.step = step;
    this.add({ kind: 'step', step });
    this.record({ type: 'step', status: 'started', title: step.title });
    this.changed();
  }

  endStep(summary: string, verified: string[], notVerified: string[], takeaway?: string): void {
    this.add({ kind: 'summary', summary, verified, notVerified, takeaway });
    this.stats.steps++;
    if (takeaway) {
      this.stats.takeaways++;
      this.record({ type: 'takeaway', text: takeaway });
    }
    this.record({ type: 'step', status: 'done', title: this.step?.title ?? 'step', summary });
    this.changed();
  }

  /** Record to `.senior/sessions/` when the project uses Senior. The editor never creates `.senior/` on its own. */
  record(event: { type: string; [key: string]: unknown }): void {
    const folder = this.workspaceRoot();
    const root = folder ? findRoot(folder) : null;
    if (!root) return;
    try {
      appendEvent(root, this.sessionId, event);
    } catch {
      // Recording is a convenience. A read-only folder must not break guiding.
    }
  }

  dispose(): void {
    this.entryEmitter.dispose();
    this.metaEmitter.dispose();
    this.questionEmitter.dispose();
    this.gearEmitter.dispose();
  }
}
