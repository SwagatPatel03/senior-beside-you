// Runs the real hook scripts as Claude Code would: JSON on stdin, JSON on stdout.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { addEntry } from '../plugin/core/ledger.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const hooks = path.join(here, '..', 'plugin', 'hooks');
const cli = path.join(here, '..', 'plugin', 'cli', 'senior.mjs');

function runHook(script, input, root) {
  const res = spawnSync(process.execPath, [path.join(hooks, script)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, SENIOR_DEBUG: '1' },
  });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout ? JSON.parse(res.stdout) : null;
}

function events(root, session) {
  const file = path.join(root, '.senior', 'sessions', `${session}.jsonl`);
  return fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'senior hooks '));
  const res = spawnSync(process.execPath, [cli, 'init'], { cwd: root, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  return root;
}

test('hooks stay silent in a project without .senior/', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plain project '));
  const out = runHook('session-start.mjs', { session_id: 's1', cwd: root, hook_event_name: 'SessionStart' }, root);
  assert.equal(out, null);
  assert.ok(!fs.existsSync(path.join(root, '.senior')));
});

test('a full session: start, prompt, edit, failure, callback', () => {
  const root = project();
  addEntry(root, {
    title: 'Bookings are atomic',
    reversibility: 'one-way',
    chosen: 'A unique index on the slot',
    why: 'The database sees every request at once.',
    files: ['src/bookings/**'],
  }, { now: new Date(Date.now() - 86_400_000) });

  const start = runHook('session-start.mjs', { session_id: 'abc', cwd: root, hook_event_name: 'SessionStart', source: 'startup' }, root);
  const context = start.hookSpecificOutput.additionalContext;
  assert.equal(start.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(context, /D-001 \[one-way\] Bookings are atomic/);
  assert.match(context, /Senior CLI for this session: node ".*senior\.mjs"/);

  runHook('on-prompt.mjs', { session_id: 'abc', cwd: root, hook_event_name: 'UserPromptSubmit', prompt: 'Add waitlists' }, root);

  const winPath = path.join(root, 'src', 'bookings', 'service.py').replace(/\//g, '\\');
  const edit = runHook('on-tool.mjs', {
    session_id: 'abc', cwd: root, hook_event_name: 'PostToolUse', tool_name: 'Edit',
    tool_input: { file_path: winPath, old_string: 'x', new_string: 'y' }, tool_response: { filePath: winPath },
  }, root);
  assert.equal(edit.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(edit.hookSpecificOutput.additionalContext, /Senior ledger callback[\s\S]*D-001/);

  const again = runHook('on-tool.mjs', {
    session_id: 'abc', cwd: root, hook_event_name: 'PostToolUse', tool_name: 'Edit',
    tool_input: { file_path: winPath, old_string: 'y', new_string: 'z' },
  }, root);
  assert.equal(again, null, 'the second edit in the same session stays quiet');

  const failure = runHook('on-tool.mjs', {
    session_id: 'abc', cwd: root, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash',
    tool_input: { command: 'pytest' }, error: `Exit code 1\n  File "${path.join(root, 'src', 'bookings', 'service.py')}", line 3\nAssertionError: two bookings`,
  }, root);
  assert.equal(failure.hookSpecificOutput.hookEventName, 'PostToolUseFailure');
  assert.match(failure.hookSpecificOutput.additionalContext, /failing command's output mentions src\/bookings\/service\.py/);

  const types = events(root, 'abc').map((e) => e.type);
  assert.deepEqual(types, ['start', 'prompt', 'edit', 'callback', 'edit', 'failure', 'callback']);

  const digest = spawnSync(process.execPath, [cli, 'sessions'], { cwd: root, encoding: 'utf8' }).stdout;
  assert.match(digest, /The user asked: Add waitlists/);
  assert.match(digest, /Files changed: src\/bookings\/service\.py/);
  assert.match(digest, /Callback fired: D-001/);
});

test('a session that creates .senior/ partway through still records its transcript, and edits outside the project are left out', () => {
  // The fast lane runs init itself, after SessionStart has already passed over the project.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'senior joined '));
  runHook('session-start.mjs', { session_id: 'late', cwd: root, hook_event_name: 'SessionStart' }, root);
  assert.equal(spawnSync(process.execPath, [cli, 'init'], { cwd: root, encoding: 'utf8' }).status, 0);

  const transcript = path.join(root, 'transcript.jsonl');
  const base = { session_id: 'late', cwd: root, transcript_path: transcript, hook_event_name: 'PostToolUse' };
  runHook('on-tool.mjs', { ...base, tool_name: 'Write', tool_input: { file_path: path.join(os.tmpdir(), 'scratch.json'), content: '{}' } }, root);
  runHook('on-tool.mjs', { ...base, tool_name: 'Edit', tool_input: { file_path: path.join(root, 'src', 'invoice.js'), old_string: 'a', new_string: 'b' } }, root);

  const recorded = events(root, 'late');
  assert.deepEqual(recorded.map((e) => e.type), ['start', 'edit']);
  assert.equal(recorded[0].transcript, transcript);
  assert.equal(recorded[1].file, 'src/invoice.js');
});

test('a broken ledger file never breaks the session', () => {
  const root = project();
  fs.writeFileSync(path.join(root, '.senior', 'ledger', 'D-001-broken.json'), '{ not json');
  const out = runHook('on-tool.mjs', {
    session_id: 'x', cwd: root, hook_event_name: 'PostToolUse', tool_name: 'Write',
    tool_input: { file_path: path.join(root, 'a.py'), content: 'print(1)' },
  }, root);
  assert.equal(out, null);
});

test('the CLI records a decision from stdin and refuses an incomplete one', () => {
  const root = project();
  const ok = spawnSync(process.execPath, [cli, 'ledger', 'add'], {
    cwd: root, encoding: 'utf8',
    input: JSON.stringify({ title: 'Stream the CSV export', reversibility: 'two-way', chosen: 'Write rows as they are read', why: 'A month of rows will not fit in memory.' }),
  });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Recorded D-001: Stream the CSV export/);

  const bad = spawnSync(process.execPath, [cli, 'ledger', 'add'], { cwd: root, encoding: 'utf8', input: '{"title":"x"}' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /"chosen" is required/);

  const link = spawnSync(process.execPath, [cli, 'ledger', 'link', 'D-001', 'reports/bookings.py', '--symbol', 'export_bookings'], { cwd: root, encoding: 'utf8' });
  assert.match(link.stdout, /lives in: reports\/bookings\.py; symbols: export_bookings/);

  const find = spawnSync(process.execPath, [cli, 'ledger', 'find', 'export_bookings'], { cwd: root, encoding: 'utf8' });
  assert.match(find.stdout, /Rejected|Chosen: Write rows as they are read/);
});
