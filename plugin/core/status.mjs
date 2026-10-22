// A short summary of the senior's memory for this project. The SessionStart hook injects it,
// so every session begins knowing the decisions that already exist.

import fs from 'node:fs';
import path from 'node:path';
import { activeEntries, formatLine } from './ledger.mjs';
import { seniorPath } from './paths.mjs';
import { unstoriedSessions } from './sessions.mjs';

const MAX_LISTED = 15;

export function features(root) {
  const dir = seniorPath(root, 'features');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => path.basename(f, '.md'));
}

export function statusText(root, { cli, currentSession } = {}) {
  const entries = activeEntries(root);
  const lines = ['Senior is active in this project. Its memory lives in .senior/.'];
  if (cli) lines.push(`Senior CLI for this session: ${cli}`);

  if (entries.length) {
    lines.push(`Decision ledger: ${entries.length} active decision${entries.length === 1 ? '' : 's'}.`);
    for (const e of entries.slice(-MAX_LISTED)) lines.push(`- ${formatLine(e)}`);
    if (entries.length > MAX_LISTED) lines.push(`- ...and ${entries.length - MAX_LISTED} older ones ("ledger list" shows all).`);
  } else {
    lines.push('Decision ledger: empty. The design session (/senior:design) writes the first decisions.');
  }

  const briefs = features(root);
  lines.push(briefs.length ? `Feature briefs from design sessions: ${briefs.join(', ')}.` : 'Feature briefs: none yet.');
  lines.push(fs.existsSync(seniorPath(root, 'repo-map.md')) ? 'Repo map: .senior/repo-map.md exists.' : 'Repo map: none. For an existing codebase, /senior:onboard builds one.');

  const pending = unstoriedSessions(root).filter((s) => s.id !== currentSession);
  if (pending.length) {
    lines.push(`${pending.length} earlier session${pending.length === 1 ? ' is' : 's are'} not yet in the project story. /senior:story writes ${pending.length === 1 ? 'it' : 'them'} up.`);
  }
  return lines.join('\n');
}
