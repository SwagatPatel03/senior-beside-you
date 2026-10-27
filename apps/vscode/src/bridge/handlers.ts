// What each editor bridge tool does. Claude Code calls these through the senior plugin.

import * as path from 'node:path';
import * as vscode from 'vscode';
import type { GuideController } from '../guide/controller.ts';
import { findAnchor, type Piece } from '../guide/text.ts';
import { locationsInText } from '../../../../plugin/core/index.mjs';
import type { Place, SayKind, StepInfo } from '../panel/protocol.ts';
import type { ReplayController } from '../replay/controller.ts';
import type { LevelChange, SessionStore } from '../session.ts';

const GUIDE_WAIT_MS = 90_000;
const SAY_KINDS: SayKind[] = ['narration', 'answer', 'callback', 'takeaway', 'warning'];

function text(value: unknown, name: string, required = true): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!required && (value === undefined || value === '')) return '';
  throw new Error(`"${name}" must be text.`);
}

function stepInfo(args: Record<string, unknown>): StepInfo {
  return {
    index: Number(args.index) || 1,
    total: Number(args.total) || 1,
    title: text(args.title, 'title'),
    why: text(args.why, 'why'),
    expect: text(args.expect, 'expect'),
    ...(typeof args.feature === 'string' ? { feature: args.feature } : {}),
    ...(typeof args.risk === 'string' && args.risk.trim() ? { risk: args.risk.trim() } : {}),
  };
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()) : [];
}

export class BridgeHandlers {
  constructor(
    private readonly session: SessionStore,
    private readonly guide: GuideController,
    private readonly replays: ReplayController,
    private readonly workspaceRoot: () => string | null,
    private readonly useProject: (dir: string | undefined) => void,
  ) {}

  /**
   * Every result carries the questions the user asked in the editor since the last call, and any
   * level they changed, so Claude prepares the next piece at the new level.
   */
  private withQuestions<T extends object>(result: T): T & { userQuestions?: { id: string; text: string; where?: string }[]; levelsChanged?: LevelChange[] } {
    const questions = this.session.takeQuestions();
    const levels = this.session.takeLevelChanges();
    return {
      ...result,
      ...(questions.length ? { userQuestions: questions } : {}),
      ...(levels.length ? { levelsChanged: levels, levelsNote: 'Prepare the next piece again at the new level: run "senior level profile" for it. The piece in progress stays as it is.' } : {}),
    };
  }

  /** The user picked an option of a choice in the panel. */
  choose(id: string, option: number): void {
    const entry = this.session.entry(id);
    if (!entry || entry.kind !== 'choice' || entry.chosen !== undefined || !entry.options[option]) return;
    this.session.update({ ...entry, chosen: option });
    this.session.answer(id, option);
  }

  /** The user kept their version or took the usual one. Taking the usual one replaces their code in the file. */
  async chooseIdiom(id: string, choice: 'mine' | 'usual'): Promise<void> {
    const entry = this.session.entry(id);
    if (!entry || entry.kind !== 'idiom' || entry.chosen) return;
    let replaced = choice === 'mine';
    if (choice === 'usual') replaced = await this.replaceIn(entry.file, entry.mine, entry.usual);
    this.session.update({ ...entry, chosen: choice });
    this.session.answer(id, { choice, replaced });
  }

  private async replaceIn(file: string, mine: string, usual: string): Promise<boolean> {
    const root = this.workspaceRoot();
    if (!root) return false;
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.resolve(root, file)));
      const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
      const found = findAnchor(doc.getText(), mine.replace(/(\r?\n)+$/, ''), eol);
      if ('error' in found) return false;
      const edit = new vscode.WorkspaceEdit();
      edit.replace(doc.uri, new vscode.Range(doc.positionAt(found.start), doc.positionAt(found.end)), usual.replace(/(\r?\n)+$/, '').replace(/\r?\n/g, eol));
      if (!(await vscode.workspace.applyEdit(edit))) return false;
      await doc.save();
      return true;
    } catch {
      return false;
    }
  }

  /** Show a choice, or keep waiting on the same one, until the user picks. */
  private async offerChoice(args: Record<string, unknown>, signal: AbortSignal) {
    const question = text(args.question, 'question');
    const options = (Array.isArray(args.options) ? args.options : [])
      .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
      .map((o) => ({
        label: text(o.label, 'label'),
        detail: text(o.detail, 'detail'),
        ...(o.pick === true ? { pick: true } : {}),
        ...(typeof o.risk === 'string' && o.risk.trim() ? { risk: o.risk.trim() } : {}),
        ...(typeof o.pushback === 'string' && o.pushback.trim() ? { pushback: o.pushback.trim() } : {}),
      }));
    if (options.length < 2) throw new Error('A choice needs at least two options.');
    const open = this.session.find('choice', (e) => e.question === question && e.chosen === undefined);
    const entry = open ?? this.session.add({ kind: 'choice', question, options });
    const { answer, question: asked } = await this.session.awaitAnswer(entry.id, GUIDE_WAIT_MS, signal);
    if (typeof answer === 'number') {
      const picked = options[answer];
      return this.withQuestions({ status: 'chosen', option: answer, label: picked.label, ...(picked.pushback ? { pushedBack: true } : {}) });
    }
    if (asked) return this.withQuestions({ status: 'question' });
    return this.withQuestions({ status: 'waiting', note: 'The user has not chosen yet. Call offer_choice again with the same question to keep waiting.' });
  }

  private async showIdiom(args: Record<string, unknown>, signal: AbortSignal) {
    const file = text(args.file, 'file');
    const mine = text(args.mine, 'mine');
    const usual = text(args.usual, 'usual');
    const why = text(args.why, 'why');
    const open = this.session.find('idiom', (e) => e.file === file && e.mine === mine && !e.chosen);
    const entry = open ?? this.session.add({ kind: 'idiom', file, mine, usual, why });
    const { answer, question } = await this.session.awaitAnswer(entry.id, GUIDE_WAIT_MS, signal);
    if (answer && typeof answer === 'object') {
      const { choice, replaced } = answer as { choice: 'mine' | 'usual'; replaced: boolean };
      return this.withQuestions({
        status: 'chosen',
        choice,
        ...(choice === 'usual' && !replaced ? { note: 'The editor could not find the user\'s code to replace. Replace it with a flesh piece.' } : {}),
      });
    }
    if (question) return this.withQuestions({ status: 'question' });
    return this.withQuestions({ status: 'waiting', note: 'The user has not chosen yet. Call show_idiom again with the same code to keep waiting.' });
  }

  handle = async (name: string, args: Record<string, unknown>, signal: AbortSignal, project?: string): Promise<unknown> => {
    this.useProject(project);
    this.session.lastBridgeCall = Date.now();
    this.session.changed();
    switch (name) {
      case 'status':
        return this.status();
      case 'begin_step':
        this.session.beginStep(stepInfo(args));
        return this.withQuestions({ ok: true, gear: this.session.gear });
      case 'activity': {
        // From the plugin's activity hook, not from Claude. It must not take the user's questions.
        const state = args.state === 'working' || args.state === 'thinking' || args.state === 'idle' ? args.state : null;
        if (!state) throw new Error('"state" must be working, thinking or idle.');
        this.session.setActivity(
          { state, ...(typeof args.label === 'string' ? { label: args.label.slice(0, 120) } : {}), helper: args.helper === true, at: Number(args.at) || Date.now() },
          this.guide.guiding,
        );
        return { ok: true };
      }
      case 'say': {
        const kind = SAY_KINDS.includes(args.kind as SayKind) ? (args.kind as SayKind) : 'narration';
        this.session.say(kind, text(args.text, 'text'), typeof args.replyTo === 'string' ? args.replyTo : undefined);
        return this.withQuestions({ ok: true });
      }
      case 'guide':
        this.guide.start((args.pieces ?? []) as Piece[]);
        return this.withQuestions(await this.guide.next(GUIDE_WAIT_MS, signal));
      case 'wait':
        return this.withQuestions(await this.guide.next(GUIDE_WAIT_MS, signal));
      case 'show_check': {
        // Models sometimes send booleans as text; accept both spellings.
        const passed = args.passed === true || args.passed === 'true';
        const output = typeof args.output === 'string' ? args.output : '';
        const root = this.workspaceRoot();
        // When the result surprises, put the evidence in front of the user while Claude thinks.
        const evidence = !passed && root ? locationsInText(root, output).slice(0, 3) : [];
        const risk = !passed ? this.session.step?.risk : undefined;
        this.session.add({
          kind: 'check',
          command: text(args.command, 'command'),
          expected: text(args.expected, 'expected'),
          passed,
          ...(output.trim() ? { output: output.split(/\r?\n/).slice(-40).join('\n') } : {}),
          ...(evidence.length ? { evidence } : {}),
          ...(risk ? { risk } : {}),
        });
        if (evidence.length) await this.showEvidence(root as string, evidence[0]);
        return this.withQuestions({ ok: true, ...(evidence.length ? { openedForTheUser: `${evidence[0].file}:${evidence[0].line}` } : {}) });
      }
      case 'offer_choice':
        return this.offerChoice(args, signal);
      case 'show_idiom':
        return this.showIdiom(args, signal);
      case 'open_file':
        return this.withQuestions(await this.openFile(text(args.file, 'file'), Number(args.line) || undefined, text(args.why, 'why')));
      case 'show_replay': {
        const id = text(args.id, 'id');
        // A replay the user already finished is reported once; the next call opens it again.
        const ended = this.replays.takeEnding(id);
        if (ended) return this.withQuestions(ended);
        this.replays.show(id);
        return this.withQuestions(await this.replays.watch(GUIDE_WAIT_MS, signal));
      }
      case 'end_step': {
        // Check the next step first, so a malformed one leaves the current step open.
        const next = args.next && typeof args.next === 'object' ? stepInfo(args.next as Record<string, unknown>) : null;
        this.session.endStep(text(args.summary, 'summary'), list(args.verified), list(args.notVerified), text(args.takeaway, 'takeaway', false) || undefined);
        if (next) this.session.beginStep(next);
        return this.withQuestions({ ok: true, ...(next ? { gear: this.session.gear } : {}) });
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };

  private status() {
    const editor = vscode.window.activeTextEditor;
    const root = this.workspaceRoot();
    const file = editor && root ? path.relative(root, editor.document.uri.fsPath).replace(/\\/g, '/') : null;
    return this.withQuestions({
      connected: true,
      workspace: root,
      gear: this.session.gear,
      guiding: this.guide.guiding,
      activeFile: file && !file.startsWith('..') ? file : null,
      line: editor ? editor.selection.active.line + 1 : null,
      levels: (this.session.levels?.technologies ?? []).map((t) => ({ tech: t.id, name: t.name, level: t.level })),
    });
  }

  /** Open the line a failure points at beside the user's work, without taking the keyboard from them. */
  private async showEvidence(root: string, place: Place): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, place.file)));
      const line = Math.max(0, Math.min(place.line - 1, doc.lineCount - 1));
      const range = new vscode.Range(line, 0, line, 0);
      const editor = await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true, selection: range });
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      this.guide.markEvidence(editor, line);
    } catch {
      // The file may have gone; the panel still names it.
    }
  }

  private async openFile(file: string, line: number | undefined, why: string) {
    const root = this.workspaceRoot();
    if (!root) throw new Error('No folder is open in the editor.');
    const target = path.resolve(root, file);
    const rel = path.relative(root, target);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`${file} is outside the project.`);
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
    const position = new vscode.Position(Math.max(0, Math.min((line ?? 1) - 1, doc.lineCount - 1)), 0);
    const editor = await vscode.window.showTextDocument(doc, { preview: true, selection: new vscode.Range(position, position) });
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.AtTop);
    this.session.add({ kind: 'open', file: rel.replace(/\\/g, '/'), ...(line ? { line } : {}), why });
    return { ok: true };
  }
}
