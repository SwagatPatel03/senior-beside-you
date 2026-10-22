// The session recorder. Hooks append one JSON line per event to `.senior/sessions/<session>.jsonl`.
// The project story is built from these records and the ledger. Architecture D's replay
// will read the same records later.

import fs from 'node:fs';
import path from 'node:path';
import { readJson, seniorPath, writeJson } from './paths.mjs';

function safeId(sessionId) {
  return String(sessionId || 'unknown').replace(/[^\w-]/g, '-').slice(0, 80);
}

export function sessionLogPath(root, sessionId) {
  return seniorPath(root, 'sessions', `${safeId(sessionId)}.jsonl`);
}

export function appendEvent(root, sessionId, event, now = new Date()) {
  const file = sessionLogPath(root, sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ at: now.toISOString(), ...event })}\n`);
}

function statePath(root, sessionId) {
  return seniorPath(root, 'state', `${safeId(sessionId)}.json`);
}

/** Per-session state: when the session started and which callbacks already fired. */
export function loadState(root, sessionId, now = new Date()) {
  const state = readJson(statePath(root, sessionId), null);
  if (state) return state;
  return { startedAt: now.toISOString(), fired: {} };
}

export function saveState(root, sessionId, state) {
  writeJson(statePath(root, sessionId), state);
}

export function readSessions(root) {
  const dir = seniorPath(root, 'sessions');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => {
      const events = fs
        .readFileSync(path.join(dir, f), 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      return { id: path.basename(f, '.jsonl'), events, startedAt: events[0]?.at || '', endedAt: events.at(-1)?.at || '' };
    })
    .filter((s) => s.events.length)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

const cursorFile = (root) => seniorPath(root, 'story', '.cursor.json');

export function storyCursor(root) {
  return readJson(cursorFile(root), { lastStoryAt: '' }).lastStoryAt;
}

export function markStory(root, now = new Date()) {
  writeJson(cursorFile(root), { lastStoryAt: now.toISOString() });
}

/** Sessions that have events newer than the last story run. */
export function unstoriedSessions(root) {
  const since = storyCursor(root);
  return readSessions(root).filter((s) => s.endedAt > since);
}

/** A compact, readable digest of sessions for the story builder. */
export function digestSessions(sessions, { since = '' } = {}) {
  const out = [];
  for (const s of sessions) {
    const events = s.events.filter((e) => e.at > since);
    if (!events.length) continue;
    out.push(`## Session ${s.id.slice(0, 8)} (${events[0].at.slice(0, 16).replace('T', ' ')} to ${events.at(-1).at.slice(11, 16)})`);
    const edited = new Set();
    let commands = 0;
    for (const e of events) {
      if (e.type === 'prompt') out.push(`- The user asked: ${oneLine(e.text, 300)}`);
      else if (e.type === 'edit' && e.file) edited.add(e.file);
      else if (e.type === 'command') commands++;
      else if (e.type === 'failure') out.push(`- Failure in \`${oneLine(e.command || e.tool, 120)}\`: ${oneLine(e.snippet, 300)}`);
      else if (e.type === 'callback') out.push(`- Callback fired: ${e.decision} because ${e.reasons.join(', ')} was ${e.trigger === 'failure' ? 'in a failure' : 'edited'}.`);
      else if (e.type === 'step') out.push(`- Step ${e.status}: ${oneLine(e.title, 160)}${e.summary ? `. ${oneLine(e.summary, 240)}` : ''}`);
      else if (e.type === 'takeaway') out.push(`- Takeaway: ${oneLine(e.text, 300)}`);
      else if (e.type === 'typed') out.push(`- The user wrote ${e.lines} line${e.lines === 1 ? '' : 's'} by hand in ${e.file}${e.gear ? ` (${e.gear} gear)` : ''}.`);
      else if (e.type === 'replay') out.push(`- A replay was built: ${oneLine(e.title, 160)} (${e.id}).`);
    }
    if (edited.size) out.push(`- Files changed: ${[...edited].join(', ')}`);
    if (commands) out.push(`- Commands that ran cleanly: ${commands}`);
    out.push('');
  }
  return out.length ? out.join('\n') : 'No recorded sessions since the last story.';
}

function oneLine(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}
