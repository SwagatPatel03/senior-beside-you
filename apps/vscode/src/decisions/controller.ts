// Decisions in the code. Each ledger decision shows as a quiet line above the code it is about; the
// hover card holds the whole decision; the full record opens in the Senior panel; the status bar
// counts the decisions linked to the open file, or the whole project's when none is. Where they go
// and what they say lives in text.ts, and the panel's page of every decision and plan in memory.ts.

import fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { briefPath, findRoot, listPlans, loadLedger, loadPlan, readSessions } from '../../../../plugin/core/index.mjs';
import type { Decision, Plan } from '../../../../plugin/core/index.mjs';
import type { MemoryView } from '../panel/protocol.ts';
import { memoryView } from './memory.ts';
import { clip, GROUP_FROM, groupTitle, hoverMarkdown, placeDecisions, shortName, undoLabel, type NamedPlace, type Placement } from './text.ts';

interface Placed {
  version: number;
  project: string;
  placements: Placement[];
}

// A plain label in a row of lenses. A lens with no command shows as text and cannot be clicked.
const label = (range: vscode.Range, title: string) => new vscode.CodeLens(range, { title, command: '' });
const action = (range: vscode.Range, title: string, command: string, args: unknown[]) => new vscode.CodeLens(range, { title, command, arguments: args });

export class DecisionLenses implements vscode.CodeLensProvider, vscode.HoverProvider, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changeEmitter.event;
  private readonly ledgers = new Map<string, Decision[]>();
  private readonly placed = new Map<string, Placed>();
  private readonly retried = new Set<string>();
  /** Set for a moment by "Why?", so the hover it opens shows the decisions of that line. */
  private forced: { uri: string; line: number; until: number } | null = null;
  private readonly status = vscode.window.createStatusBarItem('senior.decisions', vscode.StatusBarAlignment.Right, 99);
  private readonly subscriptions: vscode.Disposable[] = [];
  /** Fires when a decision or a plan is recorded, linked, replaced or moved on. `created` is true for a new file. */
  private readonly memoryEmitter = new vscode.EventEmitter<{ created: boolean }>();
  readonly onDidChangeMemory = this.memoryEmitter.event;
  private memoryTimer: ReturnType<typeof setTimeout> | null = null;
  private memoryCreated = false;

  /** `root` is the workspace folder Senior follows, for when no open file says which project it is. */
  constructor(private readonly root: () => string | null) {
    this.status.name = 'Senior decisions';
    const ledgerWatcher = vscode.workspace.createFileSystemWatcher('**/.senior/ledger/*.json');
    const planWatcher = vscode.workspace.createFileSystemWatcher('**/.senior/features/*.plan.json');
    const reload = (created: boolean) => () => {
      this.reload();
      this.memoryChanged(created);
    };
    const planChanged = (created: boolean) => () => this.memoryChanged(created);
    this.subscriptions.push(
      ledgerWatcher,
      ledgerWatcher.onDidCreate(reload(true)),
      ledgerWatcher.onDidChange(reload(false)),
      ledgerWatcher.onDidDelete(reload(false)),
      planWatcher,
      planWatcher.onDidCreate(planChanged(true)),
      planWatcher.onDidChange(planChanged(false)),
      planWatcher.onDidDelete(planChanged(false)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('senior.decisionLenses')) this.reload();
      }),
      vscode.window.onDidChangeActiveTextEditor(() => void this.updateStatus()),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc === vscode.window.activeTextEditor?.document) void this.updateStatus();
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => this.placed.delete(doc.uri.toString())),
    );
    void this.updateStatus();
  }

  /** Read the ledger again, for example after a decision was recorded, linked or replaced. */
  reload(): void {
    this.ledgers.clear();
    this.placed.clear();
    this.changeEmitter.fire();
    void this.updateStatus();
  }

  /** A design session writes several files in a row, so their changes are reported once, together. */
  private memoryChanged(created: boolean): void {
    this.memoryCreated ||= created;
    if (this.memoryTimer) clearTimeout(this.memoryTimer);
    this.memoryTimer = setTimeout(() => {
      this.memoryTimer = null;
      const wasCreated = this.memoryCreated;
      this.memoryCreated = false;
      this.memoryEmitter.fire({ created: wasCreated });
    }, 300);
  }

  /** The project Senior follows: the open file's, or else the workspace folder's. */
  project(): string | null {
    const doc = vscode.window.activeTextEditor?.document;
    const fromDoc = doc?.uri.scheme === 'file' ? findRoot(path.dirname(doc.uri.fsPath)) : null;
    if (fromDoc) return fromDoc;
    const folder = this.root();
    return folder ? findRoot(folder) : null;
  }

  /** Every decision and plan in the project, read fresh from `.senior/`. */
  memory(project: string): MemoryView | null {
    let ledger: Decision[];
    try {
      ledger = loadLedger(project);
    } catch {
      return null;
    }
    const plans: Plan[] = [];
    try {
      for (const p of listPlans(project)) {
        const plan = loadPlan(project, p.feature);
        if (plan) plans.push(plan);
      }
    } catch {
      // A plan that cannot be read leaves the decisions worth showing.
    }
    let sessions: ReturnType<typeof readSessions> = [];
    try {
      sessions = readSessions(project);
    } catch {
      // Session records only add history. A decision is still worth showing without them.
    }
    const rel = (file: string) => path.relative(project, file).replace(/\\/g, '/');
    return memoryView({
      ledger,
      plans,
      sessions,
      recordFile: (e) => {
        const stored = (e as Decision & { _file?: string })._file;
        return stored ? rel(stored) : `.senior/ledger/${e.id}.json`;
      },
      brief: (feature) => {
        const file = briefPath(project, feature);
        return fs.existsSync(file) ? rel(file) : null;
      },
    });
  }

  /** Whether the project's ledger has a decision with this id. */
  has(project: string, id: string): string | null {
    return this.ledger(project).find((e) => e.id.toLowerCase() === id.toLowerCase())?.id ?? null;
  }

  private get enabled(): boolean {
    return vscode.workspace.getConfiguration('senior').get<boolean>('decisionLenses', true);
  }

  private ledger(project: string): Decision[] {
    let entries = this.ledgers.get(project);
    if (!entries) {
      try {
        entries = loadLedger(project);
      } catch {
        entries = [];
      }
      this.ledgers.set(project, entries);
    }
    return entries;
  }

  /** The project a document belongs to, and its project-relative path with forward slashes. */
  private where(doc: vscode.TextDocument): { project: string; rel: string } | null {
    if (doc.uri.scheme !== 'file') return null;
    const project = findRoot(path.dirname(doc.uri.fsPath));
    if (!project) return null;
    const rel = path.relative(project, doc.uri.fsPath).replace(/\\/g, '/');
    if (!rel || rel.startsWith('..') || rel.startsWith('.senior/')) return null;
    return { project, rel };
  }

  private async placementsFor(doc: vscode.TextDocument): Promise<Placed | null> {
    if (!this.enabled) return null;
    const where = this.where(doc);
    if (!where) return null;
    const key = doc.uri.toString();
    const cached = this.placed.get(key);
    if (cached && cached.version === doc.version) return cached;
    const ledger = this.ledger(where.project);
    const text = doc.getText();
    // Ask the language for its symbols only when a linked symbol is named in the file.
    const named = ledger.some((e) => e.status !== 'superseded' && e.symbols.some((s) => text.includes(shortName(s))));
    const places = named ? await documentPlaces(doc.uri) : null;
    if (named && !places) this.retryLater(key);
    const placed = { version: doc.version, project: where.project, placements: placeDecisions(ledger, where.rel, text, places) };
    this.placed.set(key, placed);
    return placed;
  }

  /** A language server that is still starting has no symbols yet. Look once more when it may be ready. */
  private retryLater(key: string): void {
    if (this.retried.has(key)) return;
    this.retried.add(key);
    setTimeout(() => {
      this.placed.delete(key);
      this.changeEmitter.fire();
      void this.updateStatus();
    }, 2000);
  }

  async provideCodeLenses(doc: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const placed = await this.placementsFor(doc);
    if (!placed) return [];
    const lenses: vscode.CodeLens[] = [];
    for (const p of placed.placements) {
      const range = new vscode.Range(p.line, p.character, p.line, p.character);
      if (p.decisions.length >= GROUP_FROM) {
        lenses.push(label(range, `$(layers) ${groupTitle(p)}`));
        lenses.push(action(range, 'Show them', 'senior.pickDecision', [p.decisions.map((d) => d.id), placed.project]));
        continue;
      }
      const d = p.decisions[0];
      lenses.push(label(range, `$(layers) ${d.id}: ${clip(d.title)}`));
      lenses.push(label(range, d.supersedes ? `Replaced ${d.supersedes}` : undoLabel(d)));
      lenses.push(action(range, d.supersedes ? 'What changed?' : 'Why?', 'senior.decisionWhy', [doc.uri, p.line, p.character]));
      lenses.push(action(range, 'Full record', 'senior.showDecision', [d.id, placed.project]));
    }
    return lenses;
  }

  async provideHover(doc: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | null> {
    const placed = await this.placementsFor(doc);
    const p = placed?.placements.find((x) => x.line === position.line);
    if (!placed || !p) return null;
    const f = this.forced;
    const forced = !!f && f.uri === doc.uri.toString() && f.line === position.line && Date.now() < f.until;
    if (!forced) {
      // Without "Why?", the card shows only over the linked name, so ordinary hovers stay quiet.
      if (!p.symbol) return null;
      const word = doc.getWordRangeAtPosition(position);
      if (!word || doc.getText(word) !== shortName(p.symbol)) return null;
    }
    const ledger = this.ledger(placed.project);
    const text = new vscode.MarkdownString(p.decisions.map((d) => hoverMarkdown(d, ledger, placed.project)).join('\n\n---\n\n'));
    text.isTrusted = { enabledCommands: ['senior.showDecision'] };
    return new vscode.Hover(text);
  }

  /** "Why?" on a lens: put the cursor on the line's linked name and open the hover card there. */
  async showWhy(uri: vscode.Uri, line: number, character: number): Promise<void> {
    const editor = await vscode.window.showTextDocument(uri);
    const at = new vscode.Position(line, character);
    editor.selection = new vscode.Selection(at, at);
    this.forced = { uri: uri.toString(), line, until: Date.now() + 5000 };
    await vscode.commands.executeCommand('editor.action.showHover');
  }

  /**
   * The decisions placed in the open file, or the ones named, to choose from. When the file has
   * none, the answer has no id, and the panel shows every decision in the project instead.
   */
  async pick(ids?: string[], project?: string): Promise<{ id?: string; project: string } | null> {
    const doc = vscode.window.activeTextEditor?.document;
    const placed = doc ? await this.placementsFor(doc) : null;
    const dir = project ?? placed?.project ?? this.project();
    if (!dir) {
      void vscode.window.showInformationMessage('This folder is not a project that uses Senior yet. Run /senior:onboard in Claude Code to start.');
      return null;
    }
    const ledger = this.ledger(dir);
    const wanted = ids ?? [...new Set((placed?.placements ?? []).flatMap((p) => p.decisions.map((d) => d.id)))];
    const items = wanted.map((id) => ledger.find((e) => e.id === id)).filter((e): e is Decision => !!e);
    if (!items.length) return { project: dir };
    const chosen = await vscode.window.showQuickPick(
      items.map((e) => ({ label: `${e.id}: ${e.title}`, description: undoLabel(e), detail: e.chosen, id: e.id })),
      { title: 'Decisions linked to this code', placeHolder: 'Choose one to read in full' },
    );
    return chosen ? { id: chosen.id, project: dir } : null;
  }

  /**
   * With decisions linked to the open file, the status bar counts those. Otherwise it counts the
   * project's, so decisions that no code carries out yet are still one click away.
   */
  private async updateStatus(): Promise<void> {
    const doc = vscode.window.activeTextEditor?.document;
    const placed = doc ? await this.placementsFor(doc) : null;
    const count = placed ? new Set(placed.placements.flatMap((p) => p.decisions.map((d) => d.id))).size : 0;
    if (count) {
      this.status.text = `$(layers) ${count} decision${count === 1 ? '' : 's'}`;
      this.status.tooltip = `${count === 1 ? 'One decision is' : `${count} decisions are`} linked to this file. Click to choose one and read it in full.`;
      this.status.command = 'senior.pickDecision';
      this.status.show();
      return;
    }
    const project = this.enabled ? this.project() : null;
    const active = project ? this.ledger(project).filter((e) => e.status !== 'superseded').length : 0;
    if (!active) {
      this.status.hide();
      return;
    }
    const total = `${active} decision${active === 1 ? '' : 's'}`;
    this.status.text = `$(layers) ${total}`;
    this.status.tooltip = `This project has ${total}. Click to see every decision and plan in the Senior panel.`;
    this.status.command = 'senior.showMemory';
    this.status.show();
  }

  dispose(): void {
    for (const s of this.subscriptions) s.dispose();
    if (this.memoryTimer) clearTimeout(this.memoryTimer);
    this.changeEmitter.dispose();
    this.memoryEmitter.dispose();
    this.status.dispose();
  }
}

// Kinds that name a value rather than define it, such as `reserveSlot` in `module.exports = { reserveSlot }`.
const PROPERTY_KINDS = new Set([vscode.SymbolKind.Property, vscode.SymbolKind.Field, vscode.SymbolKind.Key, vscode.SymbolKind.EnumMember]);

/** The named places the language reports for a document, flattened. Null when it reports none. */
async function documentPlaces(uri: vscode.Uri): Promise<NamedPlace[] | null> {
  let symbols: (vscode.DocumentSymbol | vscode.SymbolInformation)[] | undefined;
  try {
    symbols = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>('vscode.executeDocumentSymbolProvider', uri);
  } catch {
    return null;
  }
  if (!symbols?.length) return null;
  const out: NamedPlace[] = [];
  const property = (kind: vscode.SymbolKind) => PROPERTY_KINDS.has(kind) || undefined;
  const walk = (list: (vscode.DocumentSymbol | vscode.SymbolInformation)[]) => {
    for (const s of list) {
      if ('selectionRange' in s) {
        out.push({ name: s.name, line: s.selectionRange.start.line, character: s.selectionRange.start.character, property: property(s.kind) });
        walk(s.children);
      } else {
        out.push({ name: s.name, line: s.location.range.start.line, character: s.location.range.start.character, property: property(s.kind) });
      }
    }
  };
  walk(symbols);
  return out;
}
