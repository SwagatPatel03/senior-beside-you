// Runs guided pieces in the editor. Flesh is applied at once. For spine and probe pieces the user
// gets an empty slot to write in, ghost text shows what comes next, and the piece completes when what
// they wrote matches the plan (ignoring spacing). The bridge and the built-in engine both use this.

import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Divergence, Gear, PieceAction, PieceKind, PieceView } from '../panel/protocol.ts';
import type { SessionStore } from '../session.ts';
import type { Decorations } from './decorations.ts';
import { expectedOf, ghostText, locate, progress, writtenLineCount, type Expected, type Piece } from './text.ts';

export type PieceOutcome = 'typed' | 'accepted' | 'watched' | 'filled' | 'kept_own' | 'skipped' | 'failed';

export interface PieceResult {
  index: number;
  file: string;
  kind: PieceKind;
  status: PieceOutcome;
  text?: string;
  detail?: string;
}

export type GuideUpdate =
  | { status: 'done'; results: PieceResult[] }
  | { status: 'waiting'; results: PieceResult[]; active: number; note: string }
  | { status: 'question'; results: PieceResult[]; active: number }
  | { status: 'error'; results: PieceResult[]; error: string; failedPiece: number };

interface Run {
  pieces: Piece[];
  results: PieceResult[];
  index: number;
  state: 'running' | 'done' | 'error';
  error?: string;
  entryId: string;
  views: PieceView[];
  settle?: (result: PieceResult) => void;
  touched: Set<vscode.TextDocument>;
}

interface Slot {
  run: Run;
  doc: vscode.TextDocument;
  start: number;
  end: number;
  expected: Expected;
  eol: string;
  body: string;
  indent: string;
  piece: Piece;
  index: number;
  accepted: boolean;
  watched: boolean;
  divergence?: Divergence;
}

class PieceError extends Error {}

const MAX_PIECE_CHARS = 20000;

export class GuideController implements vscode.Disposable {
  private run: Run | null = null;
  private slot: Slot | null = null;
  /** Edits Senior has sent and not yet seen come back as change events. */
  private readonly pendingOwn: { doc: vscode.TextDocument; offset: number; length: number; text: string }[] = [];
  private typing: NodeJS.Timeout | null = null;
  private readonly wakers = new Set<() => void>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly session: SessionStore,
    private readonly decorations: Decorations,
    private readonly workspaceRoot: () => string | null,
  ) {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => this.onChange(e)),
      vscode.window.onDidChangeTextEditorSelection((e) => this.onSelection(e)),
      session.onQuestion(() => this.wake()),
      session.onGear((gear) => this.onGear(gear)),
    );
  }

  get guiding(): boolean {
    return this.run?.state === 'running';
  }

  /** Stop guiding, leaving whatever the user wrote in place. Remaining pieces are reported as skipped. */
  stop(reason = 'Stopped.'): void {
    this.cancelRun(reason);
    this.wake();
  }

  /** The slot being written, for diagnostics and tests. */
  inspect(): { file: string; kind: PieceKind; expected: string; region: string; start: number; end: number; divergence?: Divergence } | null {
    const slot = this.slot;
    if (!slot) return null;
    return {
      file: slot.piece.file,
      kind: slot.piece.kind,
      expected: slot.piece.text,
      region: this.regionText(slot),
      start: slot.start,
      end: slot.end,
      ...(slot.divergence ? { divergence: slot.divergence } : {}),
    };
  }

  /** Start guiding a list of pieces. A call with the same pieces as the running guide just keeps waiting. */
  start(pieces: Piece[]): void {
    const problems = this.check(pieces);
    if (problems.length) throw new Error(problems.join(' '));
    if (this.run?.state === 'running') {
      if (JSON.stringify(this.run.pieces) === JSON.stringify(pieces)) return;
      this.cancelRun('Replaced by a new set of pieces.');
    }
    const views: PieceView[] = pieces.map((p, i) => ({
      index: i,
      kind: p.kind,
      file: p.file,
      why: p.why,
      lines: writtenLineCount(p.text),
      status: 'waiting',
      ...(p.expect ? { expect: p.expect } : {}),
    }));
    const entry = this.session.add({ kind: 'pieces', pieces: views });
    const run: Run = { pieces, results: [], index: 0, state: 'running', entryId: entry.id, views, touched: new Set() };
    this.run = run;
    void this.drive(run);
  }

  /** Wait until the guide finishes, the user asks a question, or the timeout passes. */
  async next(timeoutMs: number, signal?: AbortSignal): Promise<GuideUpdate> {
    const run = this.run;
    if (!run) return { status: 'error', results: [], error: 'Nothing is being guided. Call guide first.', failedPiece: -1 };
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (run.state === 'done') {
        if (this.run === run) this.run = null;
        return { status: 'done', results: [...run.results] };
      }
      if (run.state === 'error') {
        if (this.run === run) this.run = null;
        return { status: 'error', results: [...run.results], error: run.error ?? 'The guide failed.', failedPiece: run.index };
      }
      if (this.session.hasPendingQuestions()) return { status: 'question', results: [...run.results], active: run.index };
      const left = deadline - Date.now();
      if (left <= 0 || signal?.aborted) {
        const piece = run.index + 1;
        return { status: 'waiting', results: [...run.results], active: run.index, note: `The user is still on piece ${piece} of ${run.pieces.length}. Call wait to keep waiting.` };
      }
      await this.sleep(left, signal);
    }
  }

  /** The ghost text to show at a position, if it is inside the slot being written. */
  ghostAt(document: vscode.TextDocument, position: vscode.Position): { insertText: string; range: vscode.Range } | null {
    const slot = this.slot;
    const gear = this.session.gear;
    if (!slot || document !== slot.doc || gear === 'watch' || this.typing) return null;
    const offset = document.offsetAt(position);
    if (offset < slot.start || offset > slot.end) return null;
    const { line, column } = this.cursorIn(slot, offset);
    const state = progress(this.regionText(slot), slot.expected, line, column);
    if (state.state !== 'writing') return null;
    const typed = document.lineAt(position.line).text.slice(0, position.character);
    const ghost = ghostText(slot.expected, state.line, typed, gear);
    if (!ghost) return null;
    const lead = typed.length - typed.trimStart().length;
    return { insertText: typed.trimStart() + ghost, range: new vscode.Range(position.line, lead, position.line, position.character) };
  }

  async action(action: PieceAction): Promise<void> {
    const slot = this.slot;
    if (action === 'takeOver') {
      // From here the user finishes the piece, so it counts as theirs.
      if (slot) slot.watched = false;
      this.stopTyping();
      if (this.session.gear === 'watch') await this.session.setGear('type');
      return;
    }
    if (!slot) return;
    if (action === 'fillIn') {
      this.stopTyping();
      await this.replaceRegion(slot, slot.body);
      await this.finish(slot, 'filled');
    } else if (action === 'skip') {
      this.stopTyping();
      if (!this.regionText(slot).trim()) await this.removeSlotLine(slot);
      await this.finish(slot, 'skipped');
    } else if (action === 'keepMine') {
      await this.finish(slot, 'kept_own', this.regionText(slot));
    } else if (action === 'showAgain') {
      slot.divergence = undefined;
      await this.replaceRegion(slot, slot.indent);
      this.placeCursor(slot);
      this.render();
    }
  }

  // The piece loop ------------------------------------------------------------------------------

  private async drive(run: Run): Promise<void> {
    for (let i = 0; i < run.pieces.length && run.state === 'running'; i++) {
      run.index = i;
      this.setView(run, i, 'active');
      try {
        const result = await this.runPiece(run, i);
        if (run.state !== 'running') break;
        run.results.push(result);
        this.setView(run, i, result.status, result.detail);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        run.results.push({ index: i, file: run.pieces[i].file, kind: run.pieces[i].kind, status: 'failed', detail });
        this.setView(run, i, 'failed', detail);
        run.state = 'error';
        run.error = `Piece ${i + 1} (${run.pieces[i].file}) could not be placed: ${detail}`;
      }
    }
    if (run.state === 'running') run.state = 'done';
    await Promise.all([...run.touched].map((doc) => (doc.isDirty ? doc.save() : true)));
    // A newer run may have started meanwhile; only clean up what belongs to this one.
    if (this.slot?.run === run) this.clearSlot();
    if (this.run === run || this.run === null) {
      this.session.active = null;
      this.session.changed();
    }
    this.wake();
  }

  private async runPiece(run: Run, index: number): Promise<PieceResult> {
    const piece = run.pieces[index];
    const uri = this.uriFor(piece.file);
    if (piece.where === 'new_file') {
      const edit = new vscode.WorkspaceEdit();
      edit.createFile(uri, { ignoreIfExists: true });
      await vscode.workspace.applyEdit(edit);
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    run.touched.add(doc);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const at = locate(doc.getText(), piece, eol);
    if (!at.ok) throw new PieceError(at.reason);

    await this.edit(doc, at.span.start, at.span.end, at.insert);

    if (piece.kind === 'flesh') {
      const range = new vscode.Range(doc.positionAt(at.span.start), doc.positionAt(at.span.start + at.insert.length));
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      this.decorations.flashFilled(editor, range);
      await doc.save();
      const lines = writtenLineCount(piece.text);
      this.session.stats.filled += lines;
      this.session.changed();
      return { index, file: piece.file, kind: piece.kind, status: 'filled' };
    }

    const slot: Slot = {
      run,
      doc,
      start: at.slotStart,
      end: at.slotEnd,
      expected: expectedOf(piece.text),
      eol,
      body: piece.text.replace(/(\r?\n)+$/, '').replace(/\r?\n/g, eol),
      indent: doc.getText().slice(at.slotStart, at.slotEnd),
      piece,
      index,
      accepted: false,
      watched: false,
    };
    this.slot = slot;
    this.session.active = { index, total: run.pieces.length, kind: piece.kind, file: piece.file, why: piece.why, watching: false };
    this.session.changed();
    this.placeCursor(slot);
    this.render();
    if (this.session.gear === 'watch') this.startTyping(slot);
    else void vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');

    return new Promise<PieceResult>((resolve) => {
      run.settle = resolve;
    });
  }

  private async finish(slot: Slot, status: PieceOutcome, text?: string): Promise<void> {
    if (this.slot !== slot) return;
    this.clearSlot();
    this.session.active = null;
    this.session.changed();
    if (status === 'typed' || status === 'accepted' || status === 'watched') {
      if (this.regionText(slot) !== slot.body) await this.replaceRegion(slot, slot.body);
    }
    if (slot.doc.isDirty) await slot.doc.save();
    const lines = slot.expected.content.length;
    if (status === 'typed') this.session.stats.typed += lines;
    else if (status === 'accepted') this.session.stats.accepted += lines;
    else if (status === 'watched') this.session.stats.watched += lines;
    else if (status === 'filled') this.session.stats.filled += lines;
    if (status === 'typed' || status === 'kept_own') {
      this.session.record({ type: 'typed', file: slot.piece.file, lines, gear: this.session.gear });
    }
    this.session.changed();
    const result: PieceResult = { index: slot.index, file: slot.piece.file, kind: slot.piece.kind, status, ...(text !== undefined ? { text } : {}) };
    this.run?.settle?.(result);
  }

  private cancelRun(reason: string): void {
    const run = this.run;
    if (!run) return;
    this.stopTyping();
    for (let i = run.index; i < run.pieces.length; i++) this.setView(run, i, 'skipped', reason);
    run.state = 'done';
    if (this.slot) this.clearSlot();
    run.settle?.({ index: run.index, file: run.pieces[run.index]?.file ?? '', kind: run.pieces[run.index]?.kind ?? 'spine', status: 'skipped', detail: reason });
    this.run = null;
  }

  // Watching the document -----------------------------------------------------------------------

  private onChange(e: vscode.TextDocumentChangeEvent): void {
    if (!e.contentChanges.length) return;
    // Recognise Senior's own edits by their content, so the order of events never matters.
    let ours = false;
    for (const c of e.contentChanges) if (this.claimOwn(e.document, c)) ours = true;
    const slot = this.slot;
    if (!slot || e.document !== slot.doc) return;
    const changes = [...e.contentChanges].sort((a, b) => b.rangeOffset - a.rangeOffset);
    for (const c of changes) {
      const start = c.rangeOffset;
      const end = c.rangeOffset + c.rangeLength;
      const delta = c.text.length - c.rangeLength;
      if (end < slot.start || (end === slot.start && start < slot.start)) {
        slot.start += delta;
        slot.end += delta;
      } else if (start <= slot.end) {
        const newStart = Math.min(slot.start, start);
        slot.end = end > slot.end ? start + c.text.length : slot.end + delta;
        slot.start = newStart;
        if (!ours && c.text.replace(/\s/g, '').length >= 4) slot.accepted = true;
      }
    }
    if (!ours && this.typing) void this.action('takeOver');
    if (ours && !this.typing) return;
    this.evaluate(slot);
  }

  private onSelection(e: vscode.TextEditorSelectionChangeEvent): void {
    const slot = this.slot;
    if (!slot || e.textEditor.document !== slot.doc) return;
    this.render();
    const offset = slot.doc.offsetAt(e.selections[0].active);
    if (offset >= slot.start && offset <= slot.end && e.kind === vscode.TextEditorSelectionChangeKind.Mouse) {
      void vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
    }
  }

  private onGear(gear: Gear): void {
    const slot = this.slot;
    if (!slot) return;
    if (gear === 'watch') this.startTyping(slot);
    else {
      this.stopTyping();
      void this.refreshGhost();
    }
    this.render();
  }

  /** Drop the suggestion the editor has cached (it was computed for the old gear) and ask again. */
  private async refreshGhost(): Promise<void> {
    await vscode.commands.executeCommand('editor.action.inlineSuggest.hide');
    await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
  }

  private evaluate(slot: Slot): void {
    const editor = this.editorFor(slot);
    const offset = editor ? slot.doc.offsetAt(editor.selection.active) : -1;
    const { line, column } = this.cursorIn(slot, offset);
    const state = progress(this.regionText(slot), slot.expected, line, column);
    if (state.state === 'complete') {
      void this.finish(slot, slot.watched ? 'watched' : slot.accepted ? 'accepted' : 'typed');
      return;
    }
    const divergence = state.state === 'diverged' ? { wrote: state.wrote, wanted: state.wanted } : undefined;
    if (JSON.stringify(divergence) !== JSON.stringify(slot.divergence)) {
      slot.divergence = divergence;
      if (this.session.active) this.session.active = { ...this.session.active, ...(divergence ? { diverged: divergence } : { diverged: undefined }) };
      this.session.changed();
    }
    this.render();
  }

  // The watch gear ------------------------------------------------------------------------------

  private startTyping(slot: Slot): void {
    if (this.typing) return;
    const speed = vscode.workspace.getConfiguration('senior').get<number>('watchSpeed', 40);
    const tick = 50;
    const perTick = Math.max(1, Math.round((speed * tick) / 1000));
    const text = slot.body.slice(slot.indent.length);
    let typed = 0;
    slot.watched = true;
    if (this.session.active) this.session.active = { ...this.session.active, watching: true };
    this.session.changed();
    void vscode.commands.executeCommand('setContext', 'senior.watching', true);
    let busy = false;
    const start = async () => {
      if (this.regionText(slot) !== slot.indent) await this.replaceRegion(slot, slot.indent);
      this.typing = setInterval(async () => {
        if (busy || this.slot !== slot) return;
        busy = true;
        try {
          let chunk = text.slice(typed, typed + perTick);
          // Never split a Windows line break across two edits.
          if (chunk.endsWith('\r') && text[typed + chunk.length] === '\n') chunk += '\n';
          typed += chunk.length;
          await this.edit(slot.doc, slot.end, slot.end, chunk);
          const editor = this.editorFor(slot);
          if (editor) {
            const end = slot.doc.positionAt(slot.end);
            editor.selection = new vscode.Selection(end, end);
            editor.revealRange(new vscode.Range(end, end), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
          }
          if (typed >= text.length) {
            this.stopTyping();
            this.evaluate(slot);
          }
        } finally {
          busy = false;
        }
      }, tick);
    };
    void start();
  }

  private stopTyping(): void {
    if (this.typing) clearInterval(this.typing);
    this.typing = null;
    void vscode.commands.executeCommand('setContext', 'senior.watching', false);
    if (this.session.active?.watching) {
      this.session.active = { ...this.session.active, watching: false };
      this.session.changed();
    }
  }

  // Helpers -------------------------------------------------------------------------------------

  private check(pieces: Piece[]): string[] {
    const problems: string[] = [];
    if (!Array.isArray(pieces) || !pieces.length) return ['Send at least one piece.'];
    const root = this.workspaceRoot();
    if (!root) return ['No folder is open in the editor.'];
    pieces.forEach((p, i) => {
      const n = i + 1;
      if (!p || typeof p.file !== 'string' || !p.file.trim()) problems.push(`Piece ${n} needs a file.`);
      else if (!this.inside(root, p.file)) problems.push(`Piece ${n}: ${p.file} is outside the project.`);
      if (!['spine', 'flesh', 'probe'].includes(p?.kind)) problems.push(`Piece ${n}: kind must be spine, flesh or probe.`);
      if (!['after', 'before', 'replace', 'start', 'end', 'new_file'].includes(p?.where)) problems.push(`Piece ${n}: where must be after, before, replace, start, end or new_file.`);
      if (['after', 'before', 'replace'].includes(p?.where) && !p.anchor) problems.push(`Piece ${n}: "${p.where}" needs an anchor.`);
      if (typeof p?.text !== 'string' || !p.text.trim()) problems.push(`Piece ${n} needs text.`);
      else if (p.text.length > MAX_PIECE_CHARS) problems.push(`Piece ${n} is too long. Split it into smaller pieces.`);
    });
    return problems;
  }

  private inside(root: string, file: string): boolean {
    const target = path.resolve(root, file);
    const rel = path.relative(root, target);
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  private uriFor(file: string): vscode.Uri {
    return vscode.Uri.file(path.resolve(this.workspaceRoot() ?? '', file));
  }

  private editorFor(slot: Slot): vscode.TextEditor | undefined {
    return vscode.window.visibleTextEditors.find((e) => e.document === slot.doc);
  }

  private regionText(slot: Slot): string {
    return slot.doc.getText(new vscode.Range(slot.doc.positionAt(slot.start), slot.doc.positionAt(slot.end)));
  }

  private cursorIn(slot: Slot, offset: number): { line: number; column: number } {
    if (offset < slot.start || offset > slot.end) return { line: -1, column: 0 };
    const before = slot.doc.getText(new vscode.Range(slot.doc.positionAt(slot.start), slot.doc.positionAt(offset)));
    const breaks = before.split('\n');
    return { line: breaks.length - 1, column: breaks[breaks.length - 1].length };
  }

  private placeCursor(slot: Slot): void {
    const editor = this.editorFor(slot);
    if (!editor) return;
    const end = slot.doc.positionAt(slot.end);
    editor.selection = new vscode.Selection(end, end);
    editor.revealRange(new vscode.Range(end, end), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  private render(): void {
    const slot = this.slot;
    if (!slot) return;
    const editor = this.editorFor(slot);
    if (!editor) return;
    const first = slot.doc.positionAt(slot.start).line;
    const last = slot.doc.positionAt(slot.end).line;
    const cursor = editor.selection.active.line;
    const hintLine = cursor >= first && cursor <= last ? cursor : last;
    this.decorations.showSlot(editor, new vscode.Range(first, 0, last, 0), hintLine, this.session.gear, slot.divergence);
  }

  private clearSlot(): void {
    this.stopTyping();
    this.slot = null;
    this.decorations.clear();
  }

  /**
   * True when a change is one Senior sent. The editor may report an edit in a smaller form (only the
   * characters that differ), so a change counts as ours when it falls inside a pending edit's range
   * and its text is part of that edit's text.
   */
  private claimOwn(doc: vscode.TextDocument, change: vscode.TextDocumentContentChangeEvent): boolean {
    const i = this.pendingOwn.findIndex((p) => {
      if (p.doc !== doc) return false;
      const from = p.offset;
      const to = p.offset + Math.max(p.length, p.text.length);
      return change.rangeOffset >= from && change.rangeOffset + change.rangeLength <= to + p.length && p.text.includes(change.text);
    });
    if (i < 0) return false;
    this.pendingOwn.splice(i, 1);
    return true;
  }

  private async edit(doc: vscode.TextDocument, start: number, end: number, text: string): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(start), doc.positionAt(end)), text);
    const own = { doc, offset: start, length: end - start, text };
    this.pendingOwn.push(own);
    try {
      if (!(await vscode.workspace.applyEdit(edit))) throw new PieceError('The editor refused the change. Is the file read-only?');
    } finally {
      // If no change event matched (an empty edit, for example), stop waiting for one.
      setTimeout(() => {
        const i = this.pendingOwn.indexOf(own);
        if (i >= 0) this.pendingOwn.splice(i, 1);
      }, 2000);
    }
  }

  private async replaceRegion(slot: Slot, text: string): Promise<void> {
    const start = slot.start;
    await this.edit(slot.doc, slot.start, slot.end, text);
    slot.start = start;
    slot.end = start + text.length;
  }

  private async removeSlotLine(slot: Slot): Promise<void> {
    const text = slot.doc.getText();
    const lineEnd = text.startsWith(slot.eol, slot.end) ? slot.end + slot.eol.length : slot.end;
    await this.edit(slot.doc, slot.start, lineEnd, '');
    slot.end = slot.start;
  }

  private setView(run: Run, index: number, status: PieceView['status'], detail?: string): void {
    run.views[index] = { ...run.views[index], status, ...(detail ? { detail } : {}) };
    this.session.update({ id: run.entryId, at: new Date().toISOString(), kind: 'pieces', pieces: [...run.views] });
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
    this.cancelRun('The editor is closing.');
    for (const d of this.disposables) d.dispose();
  }
}
