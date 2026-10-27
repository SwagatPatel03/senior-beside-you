// SessionStart: open the session record and tell Claude what the senior already remembers.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { appendEvent, loadState, saveState } from '../core/sessions.mjs';
import { statusText } from '../core/status.mjs';
import { addContext, runHook } from './io.mjs';

const cliPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'senior.mjs').replace(/\\/g, '/');

await runHook(async (input, root) => {
  const sessionId = input.session_id;
  // Status is computed before this session's first event exists, so it lists only earlier sessions.
  let text = statusText(root, { cli: `node "${cliPath}"` });
  if (process.env.SENIOR_HOST === 'codex') {
    text = text.replace(/\/senior:([a-z-]+)/g, '$senior:$1');
    text += '\n\n' + fs.readFileSync(new URL('../codex/rules.md', import.meta.url), 'utf8');
  }
  const state = loadState(root, sessionId);
  saveState(root, sessionId, state);
  appendEvent(root, sessionId, { type: 'start', source: input.source || '', transcript: input.transcript_path || '' });
  addContext('SessionStart', text);
});
