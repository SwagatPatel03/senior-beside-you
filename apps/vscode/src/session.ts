// What the Senior panel shows, and what the editor remembers for the project story.

import * as vscode from 'vscode';
import { agentHost } from './setup.ts';
import { appendEvent, findRoot } from '../../../plugin/core/index.mjs';
import type { ActivePiece, Activity, Connection, Gear, JournalEntry, LevelsView, MemoryView, PanelMeta, PanelState, PanelView, ReplayPlace, ReplaySummary, ReplayView, SayKind, Stats, StepInfo } from './panel/protocol.ts';

const MAX_JOURNAL = 300;

export interface UserQuestion {
  id: string;
  text: string;
  where?: string;
}

export interface LevelChange {
  tech: string;
  name: string;
  from: number | null;
  to: number;
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
  /** Whether the panel can read aloud. It reports this once it has looked for a voice. */
  speech: boolean | 'unknown' = 'unknown';
  activity: Activity | null = null;
  private activityAt = 0;
  /** The page the panel shows, and the project's decisions and plans for the memory page. */
  view: PanelView = 'session';
  memory: MemoryView | null = null;
  private focus: { id: string; n: number } | null = null;

  setView(view: PanelView): void {
    if (view === this.view) return;
    this.view = view;
    this.changed();
  }

  setMemory(memory: MemoryView | null): void {
    this.memory = memory;
    this.memoryEmitter.fire(memory);
  }

  /** Open the memory page at one decision, with its whole record unfolded. */
  focusDecision(id: string): void {
    this.view = 'memory';
    this.focus = { id, n: (this.focus?.n ?? 0) + 1 };
    this.changed();
  }

  /**
   * What Claude Code is doing, from the plugin's activity hook. Reports arrive in the background and
   * can overtake each other, so an older report never replaces a newer one. While the user is typing
   * a guided piece, Claude Code itself is waiting for them, so any work belongs to a helper.
   */
  setActivity(report: { state: Activity['state']; label?: string; helper?: boolean; at: number }, helping: boolean): void {
    if (report.at < this.activityAt) return;
    this.activityAt = report.at;
    // While the user types, only the helper's own work and its finishing are news.
    if (helping && report.state !== 'working' && !report.helper) return;
    const helper = report.helper || helping;
    const same = this.activity && this.activity.state === report.state && this.activity.label === report.label && !!this.activity.helper === helper;
    if (same) return;
    this.activity = { state: report.state, ...(report.label ? { label: report.label } : {}), ...(helper ? { helper: true } : {}), since: report.at };
    this.changed();
  }

  private readonly entryEmitter = new vscode.EventEmitter<JournalEntry>();
  private readonly metaEmitter = new vscode.EventEmitter<void>();
  private readonly memoryEmitter = new vscode.EventEmitter<MemoryView | null>();
  readonly onMemory = this.memoryEmitter.event;
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
      host: agentHost(),
      agentFound: this.claudeFound,
      lastCallSecondsAgo: this.lastBridgeCall === null ? null : Math.round((Date.now() - this.lastBridgeCall) / 1000),
      claudeFound: this.claudeFound,
      pluginInstalled: this.pluginInstalled,
    };
  }

  meta(): PanelMeta {
    return {
      view: this.view,
      focus: this.focus,
      gear: this.gear,
      workspace: this.workspaceRoot(),
      step: this.step,
      stats: { ...this.stats },
      active: this.active,
      connection: this.connection(),
      readAloud: this.readAloud,
      speech: this.speech,
      activity: this.activity,
      replay: this.replay,
      replays: this.replays,
      levels: this.levels,
    };
  }

  // Levels ---------------------------------------------------------------------------------------

  /** The user's levels for this project's stack, for the Levels page. Set by the levels controller. */
  levels: LevelsView | null = null;
  private levelChanges: LevelChange[] = [];

  setLevels(levels: LevelsView | null): void {
    this.levels = levels;
    this.changed();
  }

  /** A level the user changed in the editor. Claude reads it in the next tool result, as with questions. */
  noteLevelChange(change: LevelChange): void {
    this.levelChanges = [...this.levelChanges.filter((c) => c.tech !== change.tech), change];
  }

  takeLevelChanges(): LevelChange[] {
    const changes = this.levelChanges;
    this.levelChanges = [];
    return changes;
  }

  // Answers to choices -----------------------------------------------------------------------------

  private readonly answers = new Map<string, unknown>();
  private readonly answerWakers = new Set<() => void>();

  /** The user answered a choice in the panel. */
  answer(id: string, value: unknown): void {
    this.answers.set(id, value);
    this.wakeAnswers();
  }

  private wakeAnswers(): void {
    for (const w of [...this.answerWakers]) w();
  }

  /**
   * Wait for the answer to the choice in entry `id`. Returns early when the user asks a question,
   * and with nothing when the time runs out, so Claude can call again and keep waiting.
   */
  async awaitAnswer(id: string, ms: number, signal?: AbortSignal): Promise<{ answer?: unknown; question?: true }> {
    const deadline = Date.now() + ms;
    for (;;) {
      if (this.answers.has(id)) {
        const answer = this.answers.get(id);
        this.answers.delete(id);
        return { answer };
      }
      if (this.hasPendingQuestions()) return { question: true };
      const left = deadline - Date.now();
      if (left <= 0 || signal?.aborted) return {};
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          this.answerWakers.delete(done);
          signal?.removeEventListener('abort', done);
          resolve();
        };
        const timer = setTimeout(done, left);
        this.answerWakers.add(done);
        signal?.addEventListener('abort', done, { once: true });
      });
    }
  }

  /** The latest entry, for finding an open choice when Claude asks the same question again. */
  find<K extends JournalEntry['kind']>(kind: K, test: (e: Extract<JournalEntry, { kind: K }>) => boolean): Extract<JournalEntry, { kind: K }> | undefined {
    for (let i = this.journal.length - 1; i >= 0; i--) {
      const e = this.journal[i];
      if (e.kind === kind && test(e as Extract<JournalEntry, { kind: K }>)) return e as Extract<JournalEntry, { kind: K }>;
    }
    return undefined;
  }

  entry(id: string): JournalEntry | undefined {
    return this.journal.find((e) => e.id === id);
  }

  snapshot(): PanelState {
    return { ...this.meta(), memory: this.memory, journal: [...this.journal] };
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
    this.wakeAnswers();
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
    this.memoryEmitter.dispose();
    this.questionEmitter.dispose();
    this.gearEmitter.dispose();
  }
}
