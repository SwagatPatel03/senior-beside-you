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

const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.join(here, '..', 'plugin', 'bridge', 'server.mjs');

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
