// Runs the editor bridge as Claude Code does: a child process speaking MCP over stdio.
// A fake editor stands in for the VS Code extension.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { describeActivity } from '../plugin/hooks/on-activity.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.join(here, '..', 'plugin', 'bridge', 'server.mjs');
const activityHook = path.join(here, '..', 'plugin', 'hooks', 'on-activity.mjs');

function startBridge(env) {
  const child = spawn(process.execPath, [server], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = new Map();
  const extra = [];
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    if (waiting.has(message.id)) {
      waiting.get(message.id)(message);
      waiting.delete(message.id);
    } else extra.push(message);
  });
  let next = 1;
  const request = (method, params = {}) =>
    new Promise((resolve) => {
      const id = next++;
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  const notify = (method, params = {}) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  return { child, request, notify, extra, stop: () => child.kill() };
}

function fakeEditor(project, ideDir, handler) {
  const token = 'secret-token';
  const calls = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Wrong token.' }));
        return;
      }
      const call = JSON.parse(body);
      calls.push(call);
      const result = await handler(call, req);
      if (result === undefined) return;
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ result }));
    });
  });
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      fs.mkdirSync(ideDir, { recursive: true });
      fs.writeFileSync(path.join(ideDir, `${port}.json`), JSON.stringify({ pid: process.pid, port, token, workspaceFolders: [project], app: 'vscode', startedAt: new Date().toISOString() }));
      resolve({ calls, close: () => srv.close(), port });
    });
  });
}

function tempDirs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'senior bridge '));
  const project = path.join(base, 'project');
  fs.mkdirSync(project);
  return { project, ideDir: path.join(base, 'ide') };
}

const parse = (response) => JSON.parse(response.result.content[0].text);

test('the bridge completes the MCP handshake and lists its tools', async () => {
  const { project, ideDir } = tempDirs();
  const bridge = startBridge({ SENIOR_IDE_DIR: ideDir, CLAUDE_PROJECT_DIR: project });
  try {
    const init = await bridge.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.serverInfo.name, 'senior-editor');
    assert.ok(init.result.capabilities.tools);
    bridge.notify('notifications/initialized');

    const unknownVersion = await bridge.request('initialize', { protocolVersion: '1999-01-01' });
    assert.equal(unknownVersion.result.protocolVersion, '2025-11-25');

    const list = await bridge.request('tools/list');
    assert.deepEqual(list.result.tools.map((t) => t.name), ['status', 'begin_step', 'guide', 'wait', 'say', 'show_check', 'open_file', 'show_replay', 'end_step']);

    const missing = await bridge.request('nope/method');
    assert.equal(missing.error.code, -32601);
  } finally {
    bridge.stop();
  }
});

test('without an editor, status explains how to connect and other tools fail clearly', async () => {
  const { project, ideDir } = tempDirs();
  const bridge = startBridge({ SENIOR_IDE_DIR: ideDir, CLAUDE_PROJECT_DIR: project });
  try {
    const status = parse(await bridge.request('tools/call', { name: 'status', arguments: {} }));
    assert.equal(status.connected, false);
    assert.match(status.reason, /not running/);
    assert.match(status.fallback, /in chat/);

    const say = await bridge.request('tools/call', { name: 'say', arguments: { text: 'hi', kind: 'narration' } });
    assert.equal(say.result.isError, true);
    assert.match(say.result.content[0].text, /not running/);
  } finally {
    bridge.stop();
  }
});

test('tool calls are forwarded to the editor for this project with its token', async () => {
  const { project, ideDir } = tempDirs();
  const editor = await fakeEditor(project, ideDir, async ({ name, args }) => ({ echoed: name, args }));
  // A stale lock file from an editor that crashed must be ignored.
  fs.writeFileSync(path.join(ideDir, '1.json'), JSON.stringify({ pid: 999999, port: 1, token: 'x', workspaceFolders: [project], startedAt: '2099-01-01' }));
  const bridge = startBridge({ SENIOR_IDE_DIR: ideDir, CLAUDE_PROJECT_DIR: path.join(project, 'src', '..') });
  try {
    const pieces = [{ file: 'a.py', kind: 'spine', where: 'end', text: 'x = 1', why: 'Because.' }];
    const result = parse(await bridge.request('tools/call', { name: 'guide', arguments: { pieces } }));
    assert.deepEqual(result, { echoed: 'guide', args: { pieces } });
    assert.equal(editor.calls.length, 1);
  } finally {
    bridge.stop();
    editor.close();
  }
});

test('an editor for a different folder is not used', async () => {
  const { project, ideDir } = tempDirs();
  const other = path.join(path.dirname(project), 'other');
  fs.mkdirSync(other);
  const editor = await fakeEditor(other, ideDir, async () => ({ connected: true }));
  const bridge = startBridge({ SENIOR_IDE_DIR: ideDir, CLAUDE_PROJECT_DIR: project });
  try {
    const status = parse(await bridge.request('tools/call', { name: 'status', arguments: {} }));
    assert.equal(status.connected, false);
    assert.match(status.reason, /not for this folder/);
    assert.equal(editor.calls.length, 0);
  } finally {
    bridge.stop();
    editor.close();
  }
});

test('the activity hook says in a few words what Claude Code is doing', () => {
  const project = path.join(os.tmpdir(), 'shop');
  const pre = (tool_name, tool_input) => describeActivity({ hook_event_name: 'PreToolUse', tool_name, tool_input }, project);
  assert.deepEqual(pre('Read', { file_path: path.join(project, 'src', 'cart.js') }), { state: 'working', label: 'Reading src/cart.js' });
  assert.equal(pre('Bash', { command: 'npm test -- --reporter dot', description: 'Run the cart tests' }).label, 'Run the cart tests');
  assert.equal(pre('Bash', { command: 'npm test' }).label, 'Running npm test');
  assert.equal(pre('Agent', { subagent_type: 'senior:navigator', description: 'Prepare S2' }).label, 'Asking the navigator to prepare the next step');
  assert.equal(pre('Edit', { file_path: path.join(os.tmpdir(), 'elsewhere', 'notes.md') }).label, 'Editing notes.md');
  assert.equal(pre('mcp__plugin_senior_editor__guide', {}), null, 'the panel already shows its own tools');
  assert.equal(pre('Bash', { command: 'x'.repeat(200) }).label.length, 70);
  assert.deepEqual(describeActivity({ hook_event_name: 'PostToolUse', tool_name: 'Read' }, project), { state: 'thinking' });
  assert.deepEqual(describeActivity({ hook_event_name: 'Stop' }, project), { state: 'idle' });
  assert.deepEqual(describeActivity({ hook_event_name: 'SubagentStop' }, project), { state: 'idle', helper: true });
});

test('the activity hook reaches the editor for this project in the background, and is silent without one', async () => {
  const { project, ideDir } = tempDirs();
  const run = (input) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [activityHook], { env: { ...process.env, SENIOR_IDE_DIR: ideDir, CLAUDE_PROJECT_DIR: project } });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.on('close', (code) => resolve({ code, out }));
      child.stdin.end(JSON.stringify(input));
    });
  const input = { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(project, 'a.py') } };

  assert.deepEqual(await run(input), { code: 0, out: '' });
  const editor = await fakeEditor(project, ideDir, async () => ({ ok: true }));
  try {
    assert.deepEqual(await run(input), { code: 0, out: '' });
    assert.equal(editor.calls.length, 1);
    assert.equal(editor.calls[0].name, 'activity');
    assert.equal(editor.calls[0].args.label, 'Reading a.py');
    assert.ok(Math.abs(editor.calls[0].args.at - Date.now()) < 10000);
  } finally {
    editor.close();
  }
});

test('a cancelled call stops waiting and the bridge keeps working', async () => {
  const { project, ideDir } = tempDirs();
  let aborted;
  const sawAbort = new Promise((resolve) => (aborted = resolve));
  const editor = await fakeEditor(project, ideDir, async ({ name }, req) => {
    if (name !== 'wait') return { ok: true };
    req.on('close', aborted);
    return undefined; // never answer
  });
  const bridge = startBridge({ SENIOR_IDE_DIR: ideDir, CLAUDE_PROJECT_DIR: project });
  try {
    bridge.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'w1', method: 'tools/call', params: { name: 'wait', arguments: {} } })}\n`);
    await new Promise((r) => setTimeout(r, 300));
    bridge.notify('notifications/cancelled', { requestId: 'w1', reason: 'user pressed escape' });
    await sawAbort;
    const ping = await bridge.request('ping');
    assert.deepEqual(ping.result, {});
    assert.ok(!bridge.extra.some((m) => m.id === 'w1'), 'no response is sent for a cancelled request');
  } finally {
    bridge.stop();
    editor.close();
  }
});
