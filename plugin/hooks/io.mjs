// Shared plumbing for the hook scripts. A hook must never break the user's session,
// so every failure here ends in a silent exit 0. SENIOR_DEBUG=1 writes errors and raw
// inputs to `.senior/state/debug.log` so problems can still be found.

import fs from 'node:fs';
import path from 'node:path';
import { findRoot, seniorPath } from '../core/paths.mjs';
import { appendEvent, sessionLogPath } from '../core/sessions.mjs';
import { normalizeInput } from '../codex/normalize.mjs';

/**
 * Record an event for this session. When `.senior/` was created partway through a session (the
 * fast lane runs init itself), SessionStart never wrote this session's opening event, so the first
 * event written here opens the record with the transcript path that replays need.
 */
export function recordEvent(root, input, event) {
  const sessionId = input.session_id;
  if (!fs.existsSync(sessionLogPath(root, sessionId))) {
    appendEvent(root, sessionId, { type: 'start', source: 'joined', transcript: input.transcript_path || '' });
  }
  appendEvent(root, sessionId, event);
}

export async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  const input = raw.trim() ? JSON.parse(raw) : {};
  return process.env.SENIOR_HOST === 'codex' ? normalizeInput(input) : input;
}

/** The project root that holds `.senior/`, or null when senior is not set up in this project. */
export function projectRoot(input) {
  return process.env.SENIOR_HOST === 'codex'
    ? findRoot(input.cwd)
    : findRoot(process.env.CLAUDE_PROJECT_DIR) || findRoot(input.cwd);
}

export function debug(root, label, value) {
  if (!process.env.SENIOR_DEBUG || !root) return;
  try {
    const file = seniorPath(root, 'state', 'debug.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${new Date().toISOString()} ${label} ${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
  } catch {
    // Debug logging is best effort.
  }
}

export function addContext(eventName, text) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext: text } }));
}

/** Run a hook body and swallow every error, so a bug in senior never blocks Claude. */
export async function runHook(body) {
  let input = {};
  let root = null;
  try {
    input = await readInput();
    root = projectRoot(input);
    if (!root) return;
    debug(root, `${input.hook_event_name || 'hook'} input`, input);
    await body(input, root);
  } catch (err) {
    debug(root, 'error', err && err.stack ? err.stack : String(err));
  }
}
