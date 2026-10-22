// Runs inside VS Code. Drives the editor bridge the way Claude Code does, and types the way a person
// does: through the editor's own "type" command, so auto-indent and auto-closed brackets happen too.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const workspace = process.env.SENIOR_TEST_WORKSPACE;
const file = (rel) => path.join(workspace, rel);
const read = (rel) => fs.readFileSync(file(rel), 'utf8').replace(/\r\n/g, '\n');

let api;

async function until(check, what, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await sleep(40);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function call(name, args = {}, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${api.bridge.port}/tool`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${api.bridge.token}`, ...headers },
    body: JSON.stringify({ name, args, project: workspace }),
  });
  return { status: res.status, ...(await res.json()) };
}

/** Type like a person: one key at a time, stopping when the piece is done. */
async function typeLikeAPerson(text, { untilDone = true } = {}) {
  for (const ch of text) {
    if (untilDone && !api.session.active) return;
    await vscode.commands.executeCommand('type', { text: ch });
    await sleep(15);
  }
}

test('the bridge writes its lock file and refuses requests without the token or from a web page', async () => {
  const lock = JSON.parse(fs.readFileSync(path.join(process.env.SENIOR_IDE_DIR, `${api.bridge.port}.json`), 'utf8'));
  assert.equal(lock.token, api.bridge.token);
  assert.equal(lock.pid, process.pid);
  assert.ok(lock.workspaceFolders.some((f) => path.resolve(f).toLowerCase() === path.resolve(workspace).toLowerCase()));

  const noToken = await fetch(`http://127.0.0.1:${api.bridge.port}/tool`, { method: 'POST', body: '{"name":"status"}' });
  assert.equal(noToken.status, 403);
  const fromPage = await call('status', {}, { origin: 'https://example.com' });
  assert.equal(fromPage.status, 403);

  const status = await call('status');
  assert.equal(status.status, 200);
  assert.equal(status.result.connected, true);
  assert.equal(status.result.gear, 'type');
});

test('flesh fills itself in, and a spine piece typed by hand completes despite auto-closed brackets', async () => {
  fs.writeFileSync(file('src/cart.js'), '// Cart helpers\n\nmodule.exports = {};\n');
  const pending = call('guide', {
    pieces: [
      { file: 'src/cart.js', kind: 'flesh', where: 'after', anchor: '// Cart helpers', text: "'use strict';", why: 'Strict mode turns silent mistakes into errors.' },
      { file: 'src/cart.js', kind: 'spine', where: 'before', anchor: 'module.exports = {};', text: 'function total(items) {\n  return items.length;\n}', why: 'The total is the heart of the cart.' },
    ],
  });
  await until(() => api.session.active, 'the spine piece');
  assert.equal(api.session.active.kind, 'spine');
  await typeLikeAPerson('function total(items) {\n  return items.length;\n}');
  const { result } = await pending;
  assert.equal(result.status, 'done', JSON.stringify(result));
  assert.deepEqual(result.results.map((r) => r.status), ['filled', 'typed']);
  assert.equal(read('src/cart.js'), "// Cart helpers\n'use strict';\n\nfunction total(items) {\n  return items.length;\n}\nmodule.exports = {};\n");
  assert.equal(api.session.stats.filled, 1);
  assert.equal(api.session.stats.typed, 3);
});

test('ghost text shows the rest of the line, and the whole piece in the accept gear', async () => {
  const pending = call('guide', { pieces: [{ file: 'src/ghost.js', kind: 'spine', where: 'new_file', text: 'const a = 1;\nconst b = 2;', why: 'Two constants.' }] });
  await until(() => api.session.active, 'the piece');
  const editor = vscode.window.activeTextEditor;
  assert.equal(api.guide.ghostAt(editor.document, editor.selection.active).insertText, 'const a = 1;');
  await typeLikeAPerson('const a', { untilDone: false });
  assert.equal(api.guide.ghostAt(editor.document, editor.selection.active).insertText, 'const a = 1;');

  await api.session.setGear('accept');
  assert.equal(api.guide.ghostAt(editor.document, editor.selection.active).insertText, 'const a = 1;\nconst b = 2;');

  // Accept the suggestion the way Tab does. If the test window does not show it, insert it as Tab would.
  await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
  await sleep(400);
  await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
  await sleep(300);
  if (api.session.active) {
    const ghost = api.guide.ghostAt(editor.document, editor.selection.active);
    await editor.edit((b) => b.replace(ghost.range, ghost.insertText));
  }
  const { result } = await pending;
  assert.equal(result.results[0].status, 'accepted');
  assert.equal(read('src/ghost.js'), 'const a = 1;\nconst b = 2;\n');
  await api.session.setGear('type');
});

test('a line that differs from the plan is flagged, and the user can keep their own version', async () => {
  fs.writeFileSync(file('src/limits.js'), 'const MAX = 10;\n');
  const pending = call('guide', { pieces: [{ file: 'src/limits.js', kind: 'spine', where: 'end', text: 'const MIN = 1;', why: 'A lower bound.' }] });
  await until(() => api.session.active, 'the piece');
  await typeLikeAPerson('const LOW = 0;', { untilDone: false });
  await until(() => api.session.active && api.session.active.diverged, 'the divergence');
  assert.equal(api.session.active.diverged.wanted, 'const MIN = 1;');
  await api.guide.action('keepMine');
  const { result } = await pending;
  assert.equal(result.results[0].status, 'kept_own');
  assert.equal(result.results[0].text.trim(), 'const LOW = 0;');
  assert.equal(read('src/limits.js'), 'const MAX = 10;\nconst LOW = 0;');
});

test('the watch gear types the piece at reading speed and records it as watched', async () => {
  await vscode.workspace.getConfiguration('senior').update('watchSpeed', 400, vscode.ConfigurationTarget.Global);
  await api.session.setGear('watch');
  const { result } = await call('guide', { pieces: [{ file: 'src/watched.js', kind: 'spine', where: 'new_file', text: 'export const ready = true;', why: 'A flag the app reads at start.' }] });
  assert.equal(result.status, 'done');
  assert.equal(result.results[0].status, 'watched');
  assert.equal(read('src/watched.js'), 'export const ready = true;\n');
  await api.session.setGear('type');
});

test('typing during the watch gear takes over, and the piece finishes by hand', async () => {
  await vscode.workspace.getConfiguration('senior').update('watchSpeed', 5, vscode.ConfigurationTarget.Global);
  await api.session.setGear('watch');
  const pending = call('guide', { pieces: [{ file: 'src/takeover.js', kind: 'spine', where: 'new_file', text: 'let count = 0;', why: 'A counter.' }] });
  await until(() => api.session.active && api.session.active.watching, 'Senior to start typing');
  await api.guide.action('takeOver');
  assert.equal(api.session.gear, 'type');
  const editor = vscode.window.activeTextEditor;
  await editor.edit((b) => b.replace(new vscode.Range(0, 0, 0, editor.document.lineAt(0).text.length), ''));
  await typeLikeAPerson('let count = 0;');
  const { result } = await pending;
  assert.equal(result.results[0].status, 'typed');
  assert.equal(read('src/takeover.js'), 'let count = 0;\n');
});

test('a question asked in the editor wakes the waiting guide call, and wait resumes the same piece', async () => {
  const pending = call('guide', { pieces: [{ file: 'src/question.js', kind: 'spine', where: 'new_file', text: 'let attempts = 0;', why: 'Nothing has been tried yet.' }] });
  await until(() => api.session.active, 'the piece');
  api.session.ask('Why start at zero?', 'src/question.js:1');
  const { result } = await pending;
  assert.equal(result.status, 'question');
  assert.equal(result.userQuestions[0].text, 'Why start at zero?');

  const answered = await call('say', { kind: 'answer', text: 'Because no attempt has happened yet.', replyTo: result.userQuestions[0].id });
  assert.equal(answered.status, 200);
  const resumed = call('wait');
  await typeLikeAPerson('let attempts = 0;');
  const done = await resumed;
  assert.equal(done.result.status, 'done');
  assert.equal(done.result.results[0].status, 'typed');
});

test('a missing anchor comes back as an error Claude can fix, and paths outside the project are refused', async () => {
  fs.writeFileSync(file('src/anchor.js'), 'const a = 1;\n');
  const { result } = await call('guide', { pieces: [{ file: 'src/anchor.js', kind: 'flesh', where: 'after', anchor: 'const zzz = 9;', text: 'x', why: 'x' }] });
  assert.equal(result.status, 'error');
  assert.match(result.error, /not found/);

  const outside = await call('guide', { pieces: [{ file: '../outside.js', kind: 'flesh', where: 'end', text: 'x', why: 'x' }] });
  assert.equal(outside.status, 400);
  assert.match(outside.error, /outside the project/);
});

test('steps, checks and takeaways reach the panel journal and the project story', async () => {
  await call('begin_step', { index: 1, total: 2, title: 'Count the items', why: 'The total drives the price.', expect: 'One test passes.' });
  await call('show_check', { command: 'npm test', expected: 'One test passes.', passed: true, output: 'ok 1 total' });
  await call('end_step', { summary: 'The cart can count.', verified: ['npm test passed'], notVerified: ['Empty carts'], takeaway: 'Name the thing you count.' });
  const kinds = api.session.snapshot().journal.map((e) => e.kind);
  for (const kind of ['step', 'check', 'summary', 'pieces', 'answer', 'question']) assert.ok(kinds.includes(kind), `the journal has a ${kind} entry`);

  const sessions = fs.readdirSync(file('.senior/sessions')).filter((f) => f.startsWith('editor-'));
  assert.equal(sessions.length, 1);
  const events = fs.readFileSync(path.join(file('.senior/sessions'), sessions[0]), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(events.some((e) => e.type === 'typed' && e.file === 'src/cart.js' && e.lines === 3));
  assert.ok(events.some((e) => e.type === 'takeaway' && e.text === 'Name the thing you count.'));
  assert.ok(events.some((e) => e.type === 'step' && e.status === 'done'));
});

exports.run = async function run() {
  const extension = vscode.extensions.getExtension('swagatpatel.senior');
  api = await extension.activate();
  let failed = 0;
  for (const t of tests) {
    const started = Date.now();
    try {
      await Promise.race([t.fn(), sleep(90000).then(() => Promise.reject(new Error('timed out after 90 seconds')))]);
      console.log(`  ok    ${t.name} (${Date.now() - started} ms)`);
    } catch (err) {
      failed++;
      console.error(`  FAIL  ${t.name}\n        ${err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n        ') : err}`);
    } finally {
      // Every test starts clean, whatever the last one left behind.
      api.guide.stop('The test ended.');
      await api.session.setGear('type');
      await vscode.workspace.getConfiguration('senior').update('watchSpeed', undefined, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand('workbench.action.files.saveAll');
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  }
  console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  if (failed) throw new Error(`${failed} integration test${failed === 1 ? '' : 's'} failed`);
};
