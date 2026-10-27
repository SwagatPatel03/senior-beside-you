// Decisions in the code: which line each ledger decision belongs above, and the words it shows with.
// Pure, with no VS Code in it, so the unit tests run it directly. The matching is the same as for
// callbacks: linked paths and linked symbols only, never guesses from words.

import { entriesTouching, matchesAny, symbolPattern } from '../../../../plugin/core/index.mjs';
import type { Decision, SessionRecord } from '../../../../plugin/core/index.mjs';
import type { DecisionDetail } from '../panel/protocol.ts';

/** A named place in a document, from the language's symbol provider. Lines and columns start at 0. */
export interface NamedPlace {
  name: string;
  line: number;
  character: number;
  /** A property or key, such as a name in `module.exports = { reserveSlot }`, rather than a definition. */
  property?: boolean;
}

/** The decisions shown together above one line. `symbol` is the linked name found there, if any. */
export interface Placement {
  line: number;
  character: number;
  symbol?: string;
  decisions: Decision[];
}

/** From this many decisions on one line, the line shows one summary instead of a line per decision. */
export const GROUP_FROM = 2;

const CHECK_LABELS: Record<string, string> = {
  regretLibrary: 'The regret library',
  independentReview: 'An independent review',
  openSource: 'Established practice',
};

/** The last part of a symbol's name, so `Cart.total` and `total()` both match a function called `total`. */
export function shortName(name: string): string {
  return (
    name
      .replace(/\(.*$/s, '')
      .split(/[.#:/\\]+/)
      .filter(Boolean)
      .pop() ?? name
  );
}

/**
 * Where the decisions linked to this file show. A decision with linked symbols shows above each
 * place the symbol is defined. A decision linked only by path shows at the top of the file.
 * `places` comes from the language's symbol provider; null means the language has none, and then the
 * first line that names a symbol stands in for its definition, but only in a file linked by path.
 */
export function placeDecisions(entries: Decision[], rel: string, text: string, places: NamedPlace[] | null): Placement[] {
  const active = entries.filter((e) => e.status !== 'superseded');
  const lines = text.split(/\r?\n/);
  const byLine = new Map<number, Placement>();
  const put = (line: number, character: number, decision: Decision, symbol?: string) => {
    const at = byLine.get(line) ?? { line, character, ...(symbol ? { symbol } : {}), decisions: [] };
    if (!at.decisions.includes(decision)) at.decisions.push(decision);
    byLine.set(line, at);
  };
  for (const { entry } of entriesTouching(active, { files: [rel], text })) {
    const byPath = matchesAny(rel, entry.files);
    let placed = false;
    for (const symbol of entry.symbols || []) {
      for (const at of definitions(symbol, lines, places, byPath)) {
        put(at.line, at.character, entry, symbol);
        placed = true;
      }
    }
    if (!placed && byPath) put(0, 0, entry);
  }
  return [...byLine.values()].sort((a, b) => a.line - b.line).map((p) => ({ ...p, decisions: [...p.decisions].sort(byId) }));
}

/**
 * The one place a symbol's decisions show: its first definition. A symbol that is also exported or
 * used as a key appears several times in a file, and the decision belongs above only one of them.
 */
function definitions(symbol: string, lines: string[], places: NamedPlace[] | null, byPath: boolean): NamedPlace[] {
  const name = shortName(symbol);
  if (places) {
    const named = places.filter((p) => shortName(p.name) === name).sort((a, b) => a.line - b.line || a.character - b.character);
    const first = named.find((p) => !p.property) ?? named[0];
    return first ? [first] : [];
  }
  if (!byPath) return [];
  const pattern = symbolPattern(name);
  for (let line = 0; line < lines.length; line++) {
    const match = pattern.exec(lines[line]);
    if (match) return [{ name, line, character: match.index }];
  }
  return [];
}

export function byId(a: { id: string }, b: { id: string }): number {
  return (Number(a.id.replace(/\D/g, '')) || 0) - (Number(b.id.replace(/\D/g, '')) || 0);
}

export function undoLabel(e: Decision): string {
  return e.reversibility === 'one-way' ? 'Hard to undo' : 'Easy to undo';
}

/** The words above a line that holds several decisions. */
export function groupTitle(p: Placement): string {
  const about = p.symbol ? shortName(p.symbol) : 'this file';
  return `${p.decisions.length} decisions are about ${about}.`;
}

export function clip(text: string, max = 100): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** "12 October 2026". A date that cannot be read is shown as it was stored. */
export function longDate(iso: string): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return iso || 'an unknown date';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Escape text taken from the ledger so Markdown shows it as written. */
export function md(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!|<>~])/g, '\\$1');
}

/**
 * The hover card: the parts of a decision a reader needs at the code. The full record, with the
 * checks, examples and history, is one click away in the Senior panel.
 */
export function hoverMarkdown(e: Decision, ledger: Decision[], project: string): string {
  const old = e.supersedes ? ledger.find((d) => d.id === e.supersedes) : undefined;
  const state = e.status === 'superseded' ? `Replaced by ${e.supersededBy ?? 'a newer decision'}` : 'Still in force';
  const out = [`**${md(e.id)}** · ${undoLabel(e)} · ${state}`, '', `**${md(e.title)}**`, '', '**What we chose**', '', md(e.chosen), '', '**Why**', '', md(e.why)];
  if (e.rejected.length) {
    out.push('', '**What we turned down**', '');
    for (const r of e.rejected) out.push(`- **${md(r.option)}.** ${md(r.why)}`);
  }
  if (e.guards) out.push('', '**It protects against**', '', md(e.guards));
  if (e.payoff) out.push('', '**When you will see it matter**', '', md(e.payoff));
  if (e.supersedes) {
    const before = old ? `Before, ${md(old.id)} chose this: ${md(old.chosen)}` : `It replaced ${md(e.supersedes)}.`;
    out.push('', '**What changed**', '', before);
  }
  const args = encodeURIComponent(JSON.stringify([e.id, project]));
  out.push('', '---', '', `${md(decidedSentence(e))} [See every detail in the Senior panel](command:senior.showDecision?${args})`);
  return out.join('\n');
}

function decidedSentence(e: Decision): string {
  return `Decided on ${longDate(e.created)}${e.feature ? `, for the feature "${e.feature}"` : ''}.`;
}

/** Everything in a decision, in the order a person reads it, for the Senior panel. */
export function decisionDetail(e: Decision, ledger: Decision[], sessions: SessionRecord[], recordFile: string): DecisionDetail {
  const old = e.supersedes ? ledger.find((d) => d.id === e.supersedes) : undefined;
  const history = [decidedSentence(e)];
  if (e.supersedes) history.push(`It replaced ${e.supersedes}${old ? `, "${old.title}"` : ''}.`);
  const callbacks = sessions.flatMap((s) => s.events).filter((ev) => ev.type === 'callback' && ev.decision === e.id);
  callbacks.sort((a, b) => a.at.localeCompare(b.at));
  for (const ev of callbacks) {
    const reasons = Array.isArray(ev.reasons) ? ev.reasons.map(String).join(' and ') : 'its code';
    const what = ev.trigger === 'failure' ? `a failing command named ${reasons}` : `an edit touched ${reasons}`;
    history.push(`On ${longDate(ev.at)}, ${what}, and the senior brought this decision back.`);
  }
  if (!callbacks.length) history.push('No session recorded on this computer has brought it back yet.');
  if (e.supersededBy) history.push(`On ${longDate(e.supersededAt ?? '')}, it was replaced by ${e.supersededBy}.`);

  return {
    id: e.id,
    title: e.title,
    undo: undoLabel(e),
    ...(e.supersededBy ? { replacedBy: e.supersededBy } : {}),
    chosen: e.chosen,
    why: e.why,
    rejected: e.rejected.map((r) => ({ option: r.option, why: r.why })),
    guards: e.guards,
    payoff: e.payoff,
    examples: [...e.examples],
    ...(e.supersedes ? { replaces: { id: e.supersedes, title: old?.title ?? '', chosen: old?.chosen ?? '' } } : {}),
    files: e.files.map((f) => ({ path: f, open: !/[*?[\]{}]/.test(f) })),
    symbols: [...e.symbols],
    regrets: [...e.regrets],
    checks: Object.entries(e.checks ?? {}).map(([key, result]) => ({ label: CHECK_LABELS[key] ?? key, result: String(result) })),
    history,
    record: { file: recordFile, json: JSON.stringify(e, null, 2) },
  };
}
