// Messages between the extension and the Senior panel. Both sides import these types, so a change
// to the contract fails type checking on both sides at once.

export type Gear = 'type' | 'accept' | 'watch';
export type PieceKind = 'spine' | 'flesh' | 'probe';

/** A line in a project file. */
export interface Place {
  file: string;
  line: number;
}

/** A ledger decision as the panel shows it when the user asks why. */
export interface DecisionView {
  id: string;
  title: string;
  chosen: string;
  why: string;
  rejected: { option: string; why: string }[];
}

/** Everything in one ledger decision, as the panel shows it when the user asks for the full record. */
export interface DecisionDetail {
  id: string;
  title: string;
  /** "Hard to undo" or "Easy to undo". */
  undo: string;
  replacedBy?: string;
  chosen: string;
  why: string;
  rejected: { option: string; why: string }[];
  guards: string;
  payoff: string;
  examples: string[];
  replaces?: { id: string; title: string; chosen: string };
  /** Linked paths. A glob cannot be opened, so only plain paths are links. */
  files: { path: string; open: boolean }[];
  symbols: string[];
  regrets: string[];
  checks: { label: string; result: string }[];
  /** Sentences, oldest first: when it was decided, each time it was brought back, and when it was replaced. */
  history: string[];
  /** The stored JSON, exactly as it is on disk, and its project-relative path. */
  record: { file: string; json: string };
}

/** What Claude Code is doing right now, from the plugin's activity hook. */
export interface Activity {
  state: 'working' | 'thinking' | 'idle';
  label?: string;
  /** True when the work belongs to a helper, such as the navigator preparing the next step. */
  helper?: boolean;
  /** When this activity started, in milliseconds since 1970. */
  since: number;
}

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
  notice?: string;
  decision?: string;
}

export interface StepInfo {
  index: number;
  total: number;
  title: string;
  why: string;
  expect: string;
  feature?: string;
  /** The risk the plan named for this step, recalled when its check fails. */
  risk?: string;
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
  | { id: string; at: string; kind: 'check'; command: string; expected: string; passed: boolean; output?: string; evidence?: Place[]; risk?: string }
  | { id: string; at: string; kind: 'explain'; where: string; why?: string; notice?: string; decisions: DecisionView[] }
  | { id: string; at: string; kind: 'decision'; decision: DecisionDetail }
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
  notice?: string;
  decision?: string;
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
  /** Whether this computer has a voice to read aloud with; unknown until the extension has looked. */
  speech: boolean | 'unknown';
  activity: Activity | null;
  replay: ReplayView | null;
  replays: ReplaySummary[];
}

/** Everything in the panel state except the journal, which arrives one entry at a time. */
export type PanelMeta = Omit<PanelState, 'journal'>;

export type ToPanel =
  | { type: 'state'; state: PanelState }
  | { type: 'entry'; entry: JournalEntry }
  | { type: 'meta'; meta: PanelMeta };

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
  | { type: 'askMore'; where: string }
  | { type: 'piece'; action: PieceAction }
  | ({ type: 'replay' } & ReplayAction)
  | { type: 'openFile'; file: string; line?: number }
  | { type: 'showDecision'; id: string }
  | { type: 'setup' }
  | { type: 'copy'; text: string }
  | { type: 'toggleReadAloud' };
