// A short summary of the senior's memory for this project. The SessionStart hook injects it,
// so every session begins knowing the decisions that already exist.

import fs from 'node:fs';
import path from 'node:path';
import { activeEntries, formatLine } from './ledger.mjs';
import { seniorPath } from './paths.mjs';
import { hasSourceCode } from './project.mjs';
import { unstoriedSessions } from './sessions.mjs';

const MAX_LISTED = 15;

export function features(root) {
  const dir = seniorPath(root, 'features');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => path.basename(f, '.md'));
}

export function statusText(root, { cli, currentSession } = {}) {
  const entries = activeEntries(root);
  const code = hasSourceCode(root);
  const lines = ['Senior is active in this project. Its memory lives in .senior/.'];
  if (cli) lines.push(`Senior CLI for this session: ${cli}`);

  if (entries.length) {
    lines.push(`Decision ledger: ${entries.length} active decision${entries.length === 1 ? '' : 's'}.`);
    for (const e of entries.slice(-MAX_LISTED)) lines.push(`- ${formatLine(e)}`);
    if (entries.length > MAX_LISTED) lines.push(`- ...and ${entries.length - MAX_LISTED} older ones ("ledger list" shows all).`);
  } else if (code) {
    lines.push('Decision ledger: empty. This project already has code, so /senior:onboard is the place to start. It maps the code and asks the user which of the choices already in it were deliberate.');
  } else {
    lines.push('Decision ledger: empty. The project has no code yet, so the design session (/senior:design, which /senior:onboard also starts) writes the first decisions.');
  }

  const briefs = features(root);
  lines.push(briefs.length ? `Feature briefs from design sessions: ${briefs.join(', ')}.` : 'Feature briefs: none yet.');
  if (fs.existsSync(seniorPath(root, 'repo-map.md'))) lines.push('Repo map: .senior/repo-map.md exists.');
  else if (code) lines.push('Repo map: none. /senior:onboard builds one.');

  const pending = unstoriedSessions(root).filter((s) => s.id !== currentSession);
  if (pending.length) {
    lines.push(`${pending.length} earlier session${pending.length === 1 ? ' is' : 's are'} not yet in the project story. /senior:story writes ${pending.length === 1 ? 'it' : 'them'} up.`);
  }
  return lines.join('\n');
}
