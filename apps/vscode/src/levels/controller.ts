// The user's knowledge levels in the editor: the Levels page, changes made there, the level of a
// piece that does not carry one, and the occasional suggestion to move a level up or down.
// Levels live in ~/.senior/levels.json (the user's) and .senior/stack.json (the project's), and
// both are read and written through the plugin's core, exactly as the CLI does.

import * as vscode from 'vscode';
import {
  currentStack,
  hasSourceCode,
  loadLevels,
  PROFILES,
  profile,
  setCodebaseLevel,
  setLevel,
  stackLevels,
  techForPath,
  techName,
  type Stack,
} from '../../../../plugin/core/index.mjs';
import type { FinishedPiece } from '../guide/controller.ts';
import type { LevelsView } from '../panel/protocol.ts';
import type { SessionStore } from '../session.ts';

/** Pieces in a row that show a level is too easy before Senior asks about the next one. */
const UP_AFTER = 10;
/** Of the last few pieces, how many needed help before Senior asks about the level below. */
const DOWN_WINDOW = 6;
const DOWN_AFTER = 4;
const STACK_FOR_MS = 5000;

export class LevelsController implements vscode.Disposable {
  private stack: { root: string; at: number; value: Stack } | null = null;
  private readonly runs = new Map<string, { clean: number; recent: boolean[] }>();
  /** Technologies Senior has already asked about this session. It asks at most once each. */
  private readonly asked = new Set<string>();

  constructor(
    private readonly session: SessionStore,
    private readonly workspaceRoot: () => string | null,
  ) {
    // Levels also change from the terminal (/senior:level). The page reads the files again whenever
    // it is opened and while it is showing; pieces always read the user's level fresh. No file
    // watcher is needed, and one outside the workspace would slow the others down.
    this.refresh();
  }

  /** Rebuild the Levels page from the files. */
  refresh(fresh = false): void {
    if (fresh) this.stack = null;
    try {
      this.session.setLevels(this.view());
    } catch {
      this.session.setLevels(null);
    }
  }

  private currentStack(): Stack | null {
    const root = this.workspaceRoot();
    if (!root) return null;
    if (this.stack && this.stack.root === root && Date.now() - this.stack.at < STACK_FOR_MS) return this.stack.value;
    const value = currentStack(root);
    this.stack = { root, at: Date.now(), value };
    return value;
  }

  private view(): LevelsView | null {
    const root = this.workspaceRoot();
    const stack = this.currentStack();
    if (!root || !stack) return null;
    const data = loadLevels();
    const inStack = new Set(stack.technologies.map((t) => t.id));
    return {
      technologies: stackLevels(stack, data),
      codebase: stack.codebase?.level ?? null,
      hasCode: hasSourceCode(root),
      elsewhere: Object.entries(data.levels)
        .filter(([id, e]) => !inStack.has(id) && typeof e?.level === 'number')
        .map(([id, e]) => ({ id, name: e.name ?? techName(id), level: e.level })),
      words: Object.entries(data.words)
        .filter(([, words]) => Array.isArray(words) && words.length > 0)
        .map(([id, words]) => ({ id, name: techName(id), words })),
      scale: PROFILES.map(({ level, name, anchor, change }) => ({ level, name, anchor, change })),
    };
  }

  /** The level for a file the user has rated, for pieces Claude sent without one. */
  techFor = (file: string): { id: string; name: string; level: number } | null => {
    const stack = this.currentStack();
    if (!stack) return null;
    const tech = techForPath(stack, file);
    return tech && tech.rated ? { id: tech.id, name: tech.name, level: tech.level } : null;
  };

  /** A level the user set on the Levels page or by accepting a suggestion. */
  set(tech: string, level: number): void {
    const root = this.workspaceRoot();
    if (tech === 'codebase') {
      if (!root) return;
      const from = this.currentStack()?.codebase?.level ?? null;
      setCodebaseLevel(root, level);
      this.announce('codebase', 'This codebase', from, level);
    } else {
      const name = techName(tech);
      const from = setLevel(tech, level, { name });
      this.runs.delete(tech);
      this.announce(tech, name, from, level);
    }
    this.refresh(true);
  }

  private announce(tech: string, name: string, from: number | null, to: number): void {
    if (from === to) return;
    const change =
      tech === 'codebase'
        ? 'Senior explains where things live and which existing pattern each piece copies at this level.'
        : `${profile(to).change} It starts with the next piece, and the plan stays the same.`;
    this.session.add({ kind: 'level', tech, name, from, to, change });
    this.session.noteLevelChange({ tech, name, from, to });
    this.session.record({ type: 'level', tech, from, to });
  }

  /**
   * Count each finished piece the user wrote, and ask once a session whether a level suits them.
   * Typing over a full trace proves little, so at levels 0 to 2 a piece counts as easy when it held
   * no word that was new to the user. From level 3 it counts as easy when they wrote it without
   * asking to see the code. Skipping, filling in or asking to see the code counts as needing help.
   */
  onPiece = (piece: FinishedPiece): void => {
    const { tech, level } = piece;
    if (!tech || typeof level !== 'number' || level >= 7 || piece.kind !== 'spine' || this.asked.has(tech)) return;
    const wrote = piece.status === 'typed' || piece.status === 'kept_own';
    const helped = piece.revealed || piece.status === 'filled' || piece.status === 'skipped' || piece.status === 'accepted' || piece.status === 'watched';
    const easy = wrote && !helped && (level > 2 || piece.newWords === 0);
    const run = this.runs.get(tech) ?? { clean: 0, recent: [] };
    run.clean = easy ? run.clean + 1 : 0;
    run.recent = [...run.recent, helped].slice(-DOWN_WINDOW);
    this.runs.set(tech, run);
    const name = techName(tech);
    if (run.clean >= UP_AFTER && level < 10) {
      const why =
        level <= 2
          ? `The last ${run.clean} ${name} pieces had no words that were new to you.`
          : `You wrote the last ${run.clean} ${name} pieces without asking to see the code.`;
      this.suggest(tech, name, level, level + 1, why);
    } else if (run.recent.length >= DOWN_WINDOW && run.recent.filter(Boolean).length >= DOWN_AFTER && level > 0) {
      const count = run.recent.filter(Boolean).length;
      this.suggest(tech, name, level, level - 1, `You needed the full code for ${count} of the last ${DOWN_WINDOW} ${name} pieces.`);
    }
  };

  private suggest(tech: string, name: string, from: number, to: number, why: string): void {
    this.asked.add(tech);
    const text = `${why} ${name} is at ${from}. Would ${to} suit you better? ${profile(to).change}`;
    this.session.add({ kind: 'suggestion', tech, name, from, to, text });
  }

  /** The user's answer to a suggestion. Only a yes changes anything. */
  answerSuggestion(id: string, answer: 'yes' | 'no'): void {
    const entry = this.session.entry(id);
    if (!entry || entry.kind !== 'suggestion' || entry.answer) return;
    this.session.update({ ...entry, answer });
    if (answer === 'yes') this.set(entry.tech, entry.to);
  }

  dispose(): void {
    this.runs.clear();
  }
}
