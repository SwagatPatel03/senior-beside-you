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

export type PlanStepStatus = 'pending' | 'active' | 'done' | 'skipped';

export interface PlanStepView {
  id: string;
  title: string;
  why: string;
  expect: string;
  risk: string;
  files: string[];
  check: string;
  status: PlanStepStatus;
  /** What was done, written when the step finished. */
  summary?: string;
}

/** One feature plan from a design session, as a checklist a person reads. */
export interface PlanView {
  feature: string;
  title: string;
  goal: string;
  done: number;
  total: number;
  /** The ledger decisions the plan carries out. The title is the ledger's when it has the decision. */
  decisions: { id: string; title: string }[];
  examples: string[];
  steps: PlanStepView[];
  /** The design brief next to the plan, project-relative, when there is one. */
  brief: string | null;
  updatedAt: string;
}

/** Everything the project remembers in `.senior/`: every decision in full and every plan. */
export interface MemoryView {
  /** Active decisions first, then replaced ones, each in id order. */
  decisions: DecisionDetail[];
  /** The most recently changed plan first. */
  plans: PlanView[];
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

/**
 * What the editor shows before the user types a piece: the whole piece, the piece with names hidden
 * behind hints, only its first line with plain sentences under it, or nothing.
 */
export type TraceMode = 'full' | 'shape' | 'first' | 'none';

/** What a piece teaches, at the user's level in its technology. Every field is optional. */
export interface Teaching {
  tech?: string;
  techName?: string;
  level?: number;
  trace?: TraceMode;
  concept?: { title: string; text: string; bridge?: string };
  words?: { text: string; meaning: string }[];
  lines?: { code: string; text: string }[];
  blanks?: { text: string; hint: string }[];
  outline?: string[];
  todo?: string[];
  names?: string[];
}

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
  teach?: Teaching;
  /** True when the user asked to see the full code of a piece whose trace was faded or hidden. */
  revealed?: boolean;
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
  | { id: string; at: string; kind: 'summary'; summary: string; verified: string[]; notVerified: string[]; takeaway?: string }
  | { id: string; at: string; kind: 'open'; file: string; line?: number; why: string }
  | { id: string; at: string; kind: 'notice'; text: string; tone?: 'info' | 'error' }
  | { id: string; at: string; kind: 'choice'; question: string; options: ChoiceOption[]; chosen?: number }
  | { id: string; at: string; kind: 'idiom'; file: string; mine: string; usual: string; why: string; chosen?: 'mine' | 'usual' }
  | { id: string; at: string; kind: 'level'; tech: string; name: string; from: number | null; to: number; change: string }
  | { id: string; at: string; kind: 'suggestion'; tech: string; name: string; from: number; to: number; text: string; answer?: 'yes' | 'no' };

/** One option of a choice the user makes at level 10. */
export interface ChoiceOption {
  label: string;
  detail: string;
  pick?: boolean;
  risk?: string;
  pushback?: string;
}

/** What one level means, for the rating card. */
export interface LevelMeaning {
  level: number;
  name: string;
  anchor: string;
  change: string;
}

/** The user's levels for this project's technologies, and the words they have learned. */
export interface LevelsView {
  technologies: { id: string; name: string; found: string[]; level: number | null }[];
  /** The level for this codebase, or null when not rated. Only projects with code have one. */
  codebase: number | null;
  hasCode: boolean;
  /** Languages the user rated in other projects, used for comparisons. */
  elsewhere: { id: string; name: string; level: number }[];
  words: { id: string; name: string; words: string[] }[];
  scale: LevelMeaning[];
}

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
  teach?: Teaching;
  revealed?: boolean;
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

/** The pages of the panel: the journal of this session, the project's decisions and plans, and the user's levels. */
export type PanelView = 'session' | 'memory' | 'levels';

export interface PanelState {
  view: PanelView;
  /** Null when the project has no `.senior/` folder. */
  memory: MemoryView | null;
  /** A decision to open and scroll to on the memory page. The number changes with each request. */
  focus: { id: string; n: number } | null;
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
  /** Null when no folder is open. */
  levels: LevelsView | null;
}

/**
 * Everything in the panel state except the journal, which arrives one entry at a time, and the
 * project memory, which is large and arrives only when it changes.
 */
export type PanelMeta = Omit<PanelState, 'journal' | 'memory'>;

export type ToPanel =
  | { type: 'state'; state: PanelState }
  | { type: 'entry'; entry: JournalEntry }
  | { type: 'meta'; meta: PanelMeta }
  | { type: 'memory'; memory: MemoryView | null };

/** reveal shows the full code of a faded or hidden piece. done finishes a piece written from a description. */
export type PieceAction = 'fillIn' | 'skip' | 'keepMine' | 'showAgain' | 'takeOver' | 'reveal' | 'done';

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
  | { type: 'openFile'; file: string; line?: number; preview?: boolean }
  | { type: 'showDecision'; id: string }
  | { type: 'setView'; view: PanelView }
  | { type: 'setup' }
  | { type: 'copy'; text: string }
  | { type: 'toggleReadAloud' }
  | { type: 'setLevel'; tech: string; level: number }
  | { type: 'choose'; id: string; option: number }
  | { type: 'idiom'; id: string; choice: 'mine' | 'usual' }
  | { type: 'suggestion'; id: string; answer: 'yes' | 'no' };
