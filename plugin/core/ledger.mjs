// The decision ledger: one JSON file per decision in `.senior/ledger/`.
// A decision is written at design time and changes only through an announced
// decision that supersedes it. Nothing edits an entry's substance in place.

import fs from 'node:fs';
import path from 'node:path';
import { matchesAny, readJson, seniorPath, slugify, writeJson } from './paths.mjs';

const REQUIRED = ['title', 'chosen', 'why', 'reversibility'];
const LIST_FIELDS = ['rejected', 'files', 'symbols', 'examples', 'regrets'];
const REVERSIBILITY = ['one-way', 'two-way'];
// A decision without an origin was made with the senior. "found-in-code" means onboarding found it
// in existing code and the user confirmed it was deliberate.
const ORIGINS = ['found-in-code'];

export function ledgerDir(root) {
  return seniorPath(root, 'ledger');
}

export function loadLedger(root) {
  const dir = ledgerDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^D-\d+.*\.json$/.test(f))
    .map((f) => {
      const entry = readJson(path.join(dir, f), null);
      if (entry) Object.defineProperty(entry, '_file', { value: path.join(dir, f), enumerable: false });
      return entry;
    })
    .filter(Boolean)
    .sort((a, b) => idNumber(a.id) - idNumber(b.id));
}

export function activeEntries(root) {
  return loadLedger(root).filter((e) => e.status !== 'superseded');
}

function idNumber(id) {
  return Number(String(id).replace(/\D/g, '')) || 0;
}

/** Returns a list of problems. An empty list means the entry can be written. */
export function validateEntry(entry) {
  const problems = [];
  for (const field of REQUIRED) {
    if (!entry[field] || typeof entry[field] !== 'string') problems.push(`"${field}" is required and must be text.`);
  }
  if (entry.reversibility && !REVERSIBILITY.includes(entry.reversibility)) {
    problems.push(`"reversibility" must be "one-way" or "two-way", not "${entry.reversibility}".`);
  }
  if (entry.origin !== undefined && !ORIGINS.includes(entry.origin)) {
    problems.push(`"origin" must be "found-in-code" or left out, not "${entry.origin}".`);
  }
  for (const field of LIST_FIELDS) {
    if (entry[field] !== undefined && !Array.isArray(entry[field])) problems.push(`"${field}" must be a list.`);
  }
  for (const r of entry.rejected || []) {
    if (!r || typeof r.option !== 'string' || typeof r.why !== 'string') {
      problems.push('Each item in "rejected" needs an "option" and a "why".');
      break;
    }
  }
  return problems;
}

/** Warnings do not block a write, but the CLI prints them so the gap is visible. */
export function warningsFor(entry) {
  const warnings = [];
  if (!entry.guards) warnings.push('No "guards" given: which risk does this decision protect against?');
  if (!entry.payoff) warnings.push('No "payoff" given: when will the user see this decision matter?');
  // The design checks are for choosing. A decision found in existing code was not chosen here.
  if (entry.reversibility === 'one-way' && entry.origin !== 'found-in-code') {
    const checks = entry.checks || {};
    for (const check of ['regretLibrary', 'independentReview', 'openSource']) {
      if (!checks[check]) warnings.push(`One-way decision without the "${check}" check recorded. Record "skipped" and the reason if it was not run.`);
    }
  }
  return warnings;
}

export function nextId(entries) {
  const max = entries.reduce((m, e) => Math.max(m, idNumber(e.id)), 0);
  return `D-${String(max + 1).padStart(3, '0')}`;
}

export function addEntry(root, input, { now = new Date(), supersedes } = {}) {
  const problems = validateEntry(input);
  if (problems.length) throw new Error(`The decision was not recorded:\n- ${problems.join('\n- ')}`);
  const entries = loadLedger(root);
  const old = supersedes ? entries.find((e) => e.id === supersedes) : null;
  if (supersedes && !old) throw new Error(`There is no decision ${supersedes} to supersede.`);
  if (old && old.status === 'superseded') throw new Error(`${supersedes} was already superseded by ${old.supersededBy}.`);

  const entry = {
    id: nextId(entries),
    title: input.title,
    status: 'active',
    reversibility: input.reversibility,
    chosen: input.chosen,
    rejected: input.rejected || [],
    why: input.why,
    guards: input.guards || '',
    payoff: input.payoff || '',
    files: input.files || [],
    symbols: input.symbols || [],
    examples: input.examples || [],
    regrets: input.regrets || [],
    feature: input.feature || '',
    created: now.toISOString(),
  };
  if (input.checks) entry.checks = input.checks;
  if (input.origin) entry.origin = input.origin;
  if (old) {
    entry.supersedes = old.id;
    // A replacement inherits the old links unless it names its own, so callbacks keep firing.
    if (!entry.files.length) entry.files = old.files || [];
    if (!entry.symbols.length) entry.symbols = old.symbols || [];
  }

  writeJson(path.join(ledgerDir(root), `${entry.id}-${slugify(entry.title)}.json`), entry);
  if (old) {
    old.status = 'superseded';
    old.supersededBy = entry.id;
    old.supersededAt = now.toISOString();
    writeJson(old._file, old);
  }
  return entry;
}

/** Linking adds where a decision lives in the code. It is the only in-place change the ledger allows. */
export function linkEntry(root, id, { files = [], symbols = [] }) {
  const entry = loadLedger(root).find((e) => e.id === id);
  if (!entry) throw new Error(`There is no decision ${id}.`);
  const clean = (list) => list.map((s) => s.replace(/\\/g, '/').replace(/^\.\//, '')).filter(Boolean);
  entry.files = [...new Set([...(entry.files || []), ...clean(files)])];
  entry.symbols = [...new Set([...(entry.symbols || []), ...symbols.filter(Boolean)])];
  writeJson(entry._file, entry);
  return entry;
}

export function symbolPattern(symbol) {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`);
}

/** Decisions that live in this file, either by a linked path or by a linked symbol named in `text`. */
export function entriesTouching(entries, { files = [], text = '' }) {
  const hits = [];
  for (const entry of entries) {
    const reasons = [];
    for (const rel of files) if (matchesAny(rel, entry.files)) reasons.push(rel);
    if (text) for (const symbol of entry.symbols || []) if (symbolPattern(symbol).test(text)) reasons.push(symbol);
    if (reasons.length) hits.push({ entry, reasons: [...new Set(reasons)] });
  }
  return hits;
}

/** Loose search for "why?" questions: a path, a symbol, an id or plain words. */
export function searchEntries(entries, query) {
  const q = query.trim();
  if (!q) return [];
  const byId = entries.filter((e) => e.id.toLowerCase() === q.toLowerCase());
  if (byId.length) return byId;
  const touching = entriesTouching(entries, { files: [q.replace(/\\/g, '/').replace(/^\.\//, '')], text: q }).map((h) => h.entry);
  if (touching.length) return touching;
  const words = q.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  return entries
    .map((e) => {
      const hay = [e.title, e.chosen, e.why, e.guards, e.payoff, ...(e.rejected || []).map((r) => r.option)].join(' ').toLowerCase();
      return { e, score: words.filter((w) => hay.includes(w)).length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.e);
}

export function formatEntry(e) {
  const lines = [`${e.id} ${e.title}  [${e.reversibility}${e.status === 'superseded' ? `, superseded by ${e.supersededBy}` : ''}]`];
  const when = e.origin === 'found-in-code' ? 'Found in the existing code and confirmed by the user' : 'Decided';
  lines.push(`  ${when}: ${e.created.slice(0, 10)}${e.feature ? ` for ${e.feature}` : ''}${e.supersedes ? `, replacing ${e.supersedes}` : ''}`);
  lines.push(`  Chosen: ${e.chosen}`);
  for (const r of e.rejected || []) lines.push(`  Rejected: ${r.option}, because ${r.why}`);
  lines.push(`  Why: ${e.why}`);
  if (e.guards) lines.push(`  Guards against: ${e.guards}`);
  if (e.payoff) lines.push(`  Pays off: ${e.payoff}`);
  if (e.examples?.length) lines.push(`  Examples: ${e.examples.join(' | ')}`);
  if (e.files?.length) lines.push(`  Lives in: ${e.files.join(', ')}`);
  if (e.symbols?.length) lines.push(`  Symbols: ${e.symbols.join(', ')}`);
  if (e.regrets?.length) lines.push(`  From the regret library: ${e.regrets.join(', ')}`);
  if (e.checks) for (const [k, v] of Object.entries(e.checks)) lines.push(`  Check ${k}: ${v}`);
  return lines.join('\n');
}

export function formatLine(e) {
  const where = e.files?.length ? ` (lives in ${e.files.slice(0, 3).join(', ')}${e.files.length > 3 ? ', ...' : ''})` : ' (not linked to code yet)';
  return `${e.id} [${e.reversibility}] ${e.title}${where}`;
}
