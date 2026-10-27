// Setting up `.senior/` in a project. Every host calls this the same way.

import fs from 'node:fs';
import { seniorPath } from './paths.mjs';

const FOLDERS = ['ledger', 'features', 'regrets', 'sessions', 'state', 'story', 'replays'];

// Files and folders that a project has before anyone writes code in it.
const NOT_CODE = /^(\.senior|\.git|\.gitignore|\.gitattributes|\.vscode|\.idea|\.claude|\.DS_Store|Thumbs\.db|CLAUDE\.md|README(\..*)?|LICENSE(\..*)?)$/i;

/** True when the project root holds anything besides a README, a licence and editor or git files. */
export function hasSourceCode(root) {
  try {
    return fs.readdirSync(root).some((name) => !NOT_CODE.test(name));
  } catch {
    return false;
  }
}

/** Creates `.senior/` and its folders. Safe to call again; nothing existing is overwritten. */
export function initProject(root) {
  for (const dir of FOLDERS) fs.mkdirSync(seniorPath(root, dir), { recursive: true });
  const gitignore = seniorPath(root, '.gitignore');
  // Decisions, briefs, regrets, replays and the story belong in git. Raw session records, hook state
  // and inbox files waiting for the CLI do not.
  if (!fs.existsSync(gitignore)) fs.writeFileSync(gitignore, 'sessions/\nstate/\ninbox/\n');
  return seniorPath(root);
}
