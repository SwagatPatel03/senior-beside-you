// Type declarations for the core library. The core is plain JavaScript so the plugin runs without a
// build step; these declarations give the TypeScript hosts the same contract.

export declare const SENIOR_DIR: '.senior';

// paths
export declare function findRoot(start?: string): string | null;
export declare function seniorPath(root: string, ...parts: string[]): string;
export declare function toRel(root: string, p: string | undefined | null): string | null;
export declare function globToRegExp(glob: string): RegExp;
export declare function matchesAny(rel: string, globs?: string[]): boolean;
export declare function pathsInText(root: string, text: string): string[];
export declare function locationsInText(root: string, text: string): { file: string; line: number }[];
export declare function slugify(text: string, max?: number): string;
export declare function readJson<T>(file: string, fallback: T): T;
export declare function writeJson(file: string, value: unknown): void;

// project
export declare function initProject(root: string): string;
export declare function hasSourceCode(root: string): boolean;

// ledger
export type Reversibility = 'one-way' | 'two-way';

export interface Rejected {
  option: string;
  why: string;
}

export interface DecisionInput {
  title: string;
  reversibility: Reversibility;
  chosen: string;
  why: string;
  rejected?: Rejected[];
  guards?: string;
  payoff?: string;
  files?: string[];
  symbols?: string[];
  examples?: string[];
  regrets?: string[];
  feature?: string;
  checks?: Record<string, string>;
  origin?: 'found-in-code';
}

export interface Decision extends Required<Omit<DecisionInput, 'checks' | 'origin'>> {
  id: string;
  status: 'active' | 'superseded';
  created: string;
  checks?: Record<string, string>;
  origin?: 'found-in-code';
  supersedes?: string;
  supersededBy?: string;
  supersededAt?: string;
}

export interface LedgerHit {
  entry: Decision;
  reasons: string[];
}

export declare function ledgerDir(root: string): string;
export declare function loadLedger(root: string): Decision[];
export declare function activeEntries(root: string): Decision[];
export declare function validateEntry(entry: Partial<DecisionInput>): string[];
export declare function warningsFor(entry: Decision): string[];
export declare function nextId(entries: Decision[]): string;
export declare function addEntry(root: string, input: DecisionInput, options?: { now?: Date; supersedes?: string }): Decision;
export declare function linkEntry(root: string, id: string, links: { files?: string[]; symbols?: string[] }): Decision;
export declare function symbolPattern(symbol: string): RegExp;
export declare function entriesTouching(entries: Decision[], touch: { files?: string[]; text?: string }): LedgerHit[];
export declare function searchEntries(entries: Decision[], query: string): Decision[];
export declare function formatEntry(entry: Decision): string;
export declare function formatLine(entry: Decision): string;

// regrets
export interface RegretEntry {
  id: string;
  title: string;
  text: string;
}

export interface RegretTopic {
  topic: string;
  title: string;
  appliesTo: string[];
  source: string;
  origin: 'seed' | 'project';
  entries: RegretEntry[];
}

export declare function defaultSeedDir(): string;
export declare function setSeedDir(dir: string): void;
export declare function regretsDisabled(): boolean;
export declare function loadRegrets(root: string | null, options?: { seedDir?: string }): RegretTopic[];
export declare function formatTopicList(topics: RegretTopic[]): string;
export declare function showTopics(topics: RegretTopic[], names: string[]): string;

// sessions
export interface SessionEvent {
  at: string;
  type: string;
  [key: string]: unknown;
}

export interface SessionState {
  startedAt: string;
  fired: Record<string, string>;
}

export interface SessionRecord {
  id: string;
  events: SessionEvent[];
  startedAt: string;
  endedAt: string;
}

export declare function sessionLogPath(root: string, sessionId: string): string;
export declare function appendEvent(root: string, sessionId: string, event: { type: string; [key: string]: unknown }, now?: Date): void;
export declare function loadState(root: string, sessionId: string, now?: Date): SessionState;
export declare function saveState(root: string, sessionId: string, state: SessionState): void;
export declare function readSessions(root: string): SessionRecord[];
export declare function storyCursor(root: string): string;
export declare function markStory(root: string, now?: Date): void;
export declare function unstoriedSessions(root: string): SessionRecord[];
export declare function digestSessions(sessions: SessionRecord[], options?: { since?: string }): string;

// callbacks
export interface Touch {
  kind: 'edit' | 'edit-failed' | 'command' | 'failure' | 'other';
  tool: string;
  files: string[];
  text: string;
  command?: string;
  snippet?: string;
}

export interface CallbackHit extends LedgerHit {
  trigger: 'edit' | 'failure';
}

export declare const EDIT_TOOLS: Set<string>;
export declare function describeTouch(root: string, input: Record<string, unknown>): Touch;
export declare function computeCallbacks(args: { touch: Touch; entries: Decision[]; state: SessionState }): { hits: CallbackHit[]; state: SessionState };
export declare function callbackMessage(hits: CallbackHit[], touch: Touch): string;

// status
export declare function features(root: string): string[];
export declare function statusText(root: string, options?: { cli?: string; currentSession?: string }): string;

// plans
export type StepStatus = 'pending' | 'active' | 'done' | 'skipped';

export interface PlanStepInput {
  id?: string;
  title: string;
  why: string;
  expect: string;
  risk?: string;
  files?: string[];
  check?: string;
  status?: StepStatus;
}

export interface PlanStep extends Required<Omit<PlanStepInput, 'status'>> {
  status: StepStatus;
  summary?: string;
}

export interface PlanInput {
  feature?: string;
  title: string;
  goal: string;
  decisions?: string[];
  examples?: string[];
  steps: PlanStepInput[];
}

export interface Plan {
  feature: string;
  title: string;
  goal: string;
  decisions: string[];
  examples: string[];
  steps: PlanStep[];
  createdAt: string;
  updatedAt: string;
}

export interface DesignRecord {
  answers?: { question: string; answer: string }[];
  risks?: { title: string; scene: string; cause: string; prevention: string; regret?: string }[];
  examples?: string[];
}

export declare const STEP_STATUSES: StepStatus[];
export declare function planPath(root: string, feature: string): string;
export declare function briefPath(root: string, feature: string): string;
export declare function validatePlan(plan: unknown): string[];
export declare function savePlan(root: string, input: PlanInput, options?: { now?: Date }): Plan;
export declare function loadPlan(root: string, feature: string): Plan | null;
export declare function listPlans(root: string): { feature: string; title: string; steps: number; done: number; updatedAt: string }[];
export declare function setStepStatus(root: string, feature: string, stepId: string, status: StepStatus, options?: { now?: Date; summary?: string }): Plan;
export declare function nextStep(plan: Plan): PlanStep | null;
export declare function renderBrief(plan: Plan, design?: DesignRecord): string;
export declare function saveBrief(root: string, plan: Plan, design?: DesignRecord): string;

// replays
export type SceneKind = 'build' | 'bug' | 'decision' | 'skipped' | 'check';

export interface ReplayFile {
  path: string;
  before?: string;
  after?: string;
}

export interface ReplayScene {
  title: string;
  narration: string;
  kind?: SceneKind;
  decisions?: string[];
  files?: ReplayFile[];
}

export interface ReplayInput {
  title: string;
  task?: string;
  source?: 'claude-code' | 'engine';
  scenes: ReplayScene[];
  skipped?: string[];
  verified?: string[];
  notVerified?: string[];
}

export interface Replay extends Required<Omit<ReplayInput, 'scenes'>> {
  id: string;
  createdAt: string;
  scenes: Required<ReplayScene>[];
}

export declare function replaysDir(root: string): string;
export declare function validateReplay(replay: unknown): string[];
export declare function saveReplay(root: string, input: ReplayInput, options?: { now?: Date }): Replay;
export declare function loadReplay(root: string, id: string): Replay | null;
export declare function listReplays(root: string): { id: string; title: string; createdAt: string; scenes: number; source: string }[];
export declare function renderReplayMarkdown(replay: Replay): string;
