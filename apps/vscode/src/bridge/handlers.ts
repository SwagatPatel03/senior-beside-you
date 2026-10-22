// What each editor bridge tool does. Claude Code calls these through the senior plugin.

import * as path from 'node:path';
import * as vscode from 'vscode';
import type { GuideController } from '../guide/controller.ts';
import type { Piece } from '../guide/text.ts';
import type { SayKind } from '../panel/protocol.ts';
import type { SessionStore } from '../session.ts';

const GUIDE_WAIT_MS = 90_000;
const SAY_KINDS: SayKind[] = ['narration', 'answer', 'callback', 'takeaway', 'warning'];

function text(value: unknown, name: string, required = true): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!required && (value === undefined || value === '')) return '';
  throw new Error(`"${name}" must be text.`);
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()) : [];
}

export class BridgeHandlers {
  constructor(
    private readonly session: SessionStore,
    private readonly guide: GuideController,
    private readonly workspaceRoot: () => string | null,
    private readonly useProject: (dir: string | undefined) => void,
  ) {}

  /** Every result carries the questions the user asked in the editor since the last call. */
  private withQuestions<T extends object>(result: T): T & { userQuestions?: { id: string; text: string; where?: string }[] } {
    const questions = this.session.takeQuestions();
    return questions.length ? { ...result, userQuestions: questions } : result;
  }

  handle = async (name: string, args: Record<string, unknown>, signal: AbortSignal, project?: string): Promise<unknown> => {
    this.useProject(project);
    this.session.lastBridgeCall = Date.now();
    this.session.changed();
    switch (name) {
      case 'status':
        return this.status();
      case 'begin_step':
        this.session.beginStep({
          index: Number(args.index) || 1,
          total: Number(args.total) || 1,
          title: text(args.title, 'title'),
          why: text(args.why, 'why'),
          expect: text(args.expect, 'expect'),
          ...(typeof args.feature === 'string' ? { feature: args.feature } : {}),
        });
        return this.withQuestions({ ok: true, gear: this.session.gear });
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
      case 'show_check':
        this.session.add({
          kind: 'check',
          command: text(args.command, 'command'),
          expected: text(args.expected, 'expected'),
          // Models sometimes send booleans as text; accept both spellings.
          passed: args.passed === true || args.passed === 'true',
          ...(typeof args.output === 'string' && args.output.trim() ? { output: args.output.split(/\r?\n/).slice(-40).join('\n') } : {}),
        });
        return this.withQuestions({ ok: true });
      case 'open_file':
        return this.withQuestions(await this.openFile(text(args.file, 'file'), Number(args.line) || undefined, text(args.why, 'why')));
      case 'end_step':
        this.session.endStep(text(args.summary, 'summary'), list(args.verified), list(args.notVerified), text(args.takeaway, 'takeaway', false) || undefined);
        return this.withQuestions({ ok: true });
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
    });
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
