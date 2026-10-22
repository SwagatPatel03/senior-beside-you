// Finding the Senior editor extension for this project, and talking to it.
// The extension listens on a random local port and writes a lock file to ~/.senior/ide/ with the
// port, a secret token and its workspace folders. We pick the editor whose workspace holds our folder.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function lockDir() {
  return process.env.SENIOR_IDE_DIR || path.join(os.homedir(), '.senior', 'ide');
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to someone else.
    return err.code === 'EPERM';
  }
}

function normal(p) {
  const resolved = path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function contains(folder, target) {
  const a = normal(folder);
  const b = normal(target);
  return b === a || b.startsWith(`${a}${path.sep}`);
}

/** All live editors, newest first. Stale lock files from crashed editors are skipped. */
export function listEditors() {
  const dir = lockDir();
  if (!fs.existsSync(dir)) return [];
  const editors = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const lock = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (lock.port && lock.token && alive(lock.pid)) editors.push(lock);
    } catch {
      // A lock file being written or removed right now. Ignore it.
    }
  }
  return editors.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

/** The editor whose workspace contains `cwd`, choosing the most specific folder. */
export function findEditor(cwd) {
  let best = null;
  let bestLength = -1;
  for (const editor of listEditors()) {
    for (const folder of editor.workspaceFolders || []) {
      if (contains(folder, cwd) && folder.length > bestLength) {
        best = editor;
        bestLength = folder.length;
      }
    }
  }
  return best;
}

export async function callEditor(editor, name, args, { signal, project } = {}) {
  const response = await fetch(`http://127.0.0.1:${editor.port}/tool`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${editor.token}` },
    body: JSON.stringify({ name, args, project }),
    signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `The editor answered with HTTP ${response.status}.`);
  return body.result;
}
