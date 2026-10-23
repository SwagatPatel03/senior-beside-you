// Messages between the extension and the Senior panel. Both sides import these types, so a change
// to the contract fails type checking on both sides at once.

export type Gear = 'type' | 'accept' | 'watch';
export type PieceKind = 'spine' | 'flesh' | 'probe';

export type PieceStatus = 'waiting' | 'active' | 'typed' | 'accepted' | 'watched' | 'filled' | 'kept_own' | 'skipped' | 'failed';

export interface PieceView {
  index: number;
  kind: PieceKind;
  file: string;
  why: string;
  lines: number;
  status: PieceStatus;
  expect?: string;
  detail?: string;
}

export interface StepInfo {
  index: number;
  total: number;
  title: string;
  why: string;
  expect: string;
  feature?: string;
}

export type SayKind = 'narration' | 'answer' | 'callback' | 'takeaway' | 'warning';

/** Where a question asked during a replay belongs: the replay and the scene (0-based). */
export interface ReplayPlace {
  id: string;
  scene: number;
}

export type JournalEntry =
  | { id: string; at: string; kind: SayKind; text: string; replyTo?: string }
  | { id: string; at: string; kind: 'question'; text: string; where?: string; replay?: ReplayPlace; answered: boolean }
  | { id: string; at: string; kind: 'replay'; replayId: string; title: string; scenes: number }
  | { id: string; at: string; kind: 'step'; step: StepInfo }
  | { id: string; at: string; kind: 'pieces'; pieces: PieceView[] }
  | { id: string; at: string; kind: 'check'; command: string; expected: string; passed: boolean; output?: string }
  | { id: string; at: string; kind: 'summary'; summary: string; verified: string[]; notVerified: string[]; takeaway?: string }
  | { id: string; at: string; kind: 'open'; file: string; line?: number; why: string }
  | { id: string; at: string; kind: 'notice'; text: string; tone?: 'info' | 'error' };

export interface Stats {
  typed: number;
  accepted: number;
  watched: number;
  filled: number;
  steps: number;
  takeaways: number;
}

export interface Divergence {
  wrote: string;
  wanted: string;
}

export interface ActivePiece {
  index: number;
  total: number;
  kind: PieceKind;
  file: string;
  why: string;
  watching: boolean;
  diverged?: Divergence;
}

export interface Connection {
  /** Seconds since Claude Code last called the editor bridge, or null if it never has. */
  lastCallSecondsAgo: number | null;
  claudeFound: boolean | 'unknown';
  pluginInstalled: boolean | 'unknown';
}

export type SceneKind = 'build' | 'bug' | 'decision' | 'skipped' | 'check';

export interface ReplaySceneView {
  title: string;
  narration: string;
  kind: SceneKind;
  /** Ledger decisions the scene carries out, with their titles when the ledger has them. */
  decisions: { id: string; title?: string }[];
  files: { path: string; change: 'added' | 'changed' }[];
}

export interface ReplayView {
  id: string;
  title: string;
  task: string;
  /** The scene being read. Equal to scenes.length on the closing page. */
  index: number;
  scenes: ReplaySceneView[];
  skipped: string[];
  verified: string[];
  notVerified: string[];
}

export interface ReplaySummary {
  id: string;
  title: string;
  createdAt: string;
  scenes: number;
}

export interface PanelState {
  gear: Gear;
  workspace: string | null;
  step: StepInfo | null;
  journal: JournalEntry[];
  stats: Stats;
  active: ActivePiece | null;
  connection: Connection;
  readAloud: boolean;
  replay: ReplayView | null;
  replays: ReplaySummary[];
}

/** Everything in the panel state except the journal, which arrives one entry at a time. */
export type PanelMeta = Omit<PanelState, 'journal'>;

export type ToPanel =
  | { type: 'state'; state: PanelState }
  | { type: 'entry'; entry: JournalEntry }
  | { type: 'meta'; meta: PanelMeta }
  | { type: 'speak'; text: string };

export type PieceAction = 'fillIn' | 'skip' | 'keepMine' | 'showAgain' | 'takeOver';

export type ReplayAction =
  | { action: 'open'; id: string }
  | { action: 'go'; index: number }
  | { action: 'showChange'; file: number }
  | { action: 'close' }
  | { action: 'finish' };

export type FromPanel =
  | { type: 'ready' }
  | { type: 'setGear'; gear: Gear }
  | { type: 'ask'; text: string }
  | { type: 'piece'; action: PieceAction }
  | ({ type: 'replay' } & ReplayAction)
  | { type: 'openFile'; file: string; line?: number }
  | { type: 'setup' }
  | { type: 'copy'; text: string }
  | { type: 'toggleReadAloud' };
