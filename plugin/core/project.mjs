// Setting up `.senior/` in a project. Every host calls this the same way.

import fs from 'node:fs';
import { seniorPath } from './paths.mjs';

const FOLDERS = ['ledger', 'features', 'regrets', 'sessions', 'state', 'story', 'replays'];

/** Creates `.senior/` and its folders. Safe to call again; nothing existing is overwritten. */
export function initProject(root) {
  for (const dir of FOLDERS) fs.mkdirSync(seniorPath(root, dir), { recursive: true });
  const gitignore = seniorPath(root, '.gitignore');
  // Decisions, briefs, regrets, replays and the story belong in git. Raw session records and hook state do not.
  if (!fs.existsSync(gitignore)) fs.writeFileSync(gitignore, 'sessions/\nstate/\n');
  return seniorPath(root);
}
