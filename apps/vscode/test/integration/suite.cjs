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

test('the whole plan is traced on its own lines, Enter goes to the next planned line, and other ghost text is quiet meanwhile', async () => {
  const setting = () => vscode.workspace.getConfiguration('editor').inspect('inlineSuggest.enabled').globalValue;
  const before = setting();
  const pending = call('guide', { pieces: [{ file: 'src/trace.js', kind: 'spine', where: 'new_file', text: 'if (ready) {\n  start();\n}', why: 'Start once ready.' }] });
  await until(() => api.session.active, 'the piece');
  const editor = vscode.window.activeTextEditor;
  assert.equal(editor.document.getText().replace(/\r\n/g, '\n'), '\n  \n\n', 'one empty line per planned line');
  assert.deepEqual(api.guide.inspect().lines.map((l) => l.trace.map((t) => t.text).join('')), ['if (ready) {', 'start();', '}']);
  await until(() => setting() === false, 'other ghost text to be turned off');

  await typeLikeAPerson('if (ready) {', { untilDone: false });
  // The editor closed the brace by itself. Enter goes to the planned line below, and the stray brace goes.
  await vscode.commands.executeCommand('senior.nextLine');
  await until(() => editor.document.lineAt(0).text === 'if (ready) {', 'the stray brace to go');
  assert.equal(editor.selection.active.line, 1);
  assert.equal(editor.document.lineCount, 4, 'Enter made no new line');

  // After "start(" the editor adds ")" by itself; the plan's ";" is traced after it.
  // "(" would accept whatever IntelliSense offers for "start", so close its popup first, as a person would.
  await typeLikeAPerson('start', { untilDone: false });
  await vscode.commands.executeCommand('hideSuggestWidget');
  await typeLikeAPerson('(', { untilDone: false });
  assert.equal(editor.document.lineAt(1).text, '  start()');
  assert.deepEqual(api.guide.inspect().lines[1].trace, [{ column: 9, text: ';' }]);
  await typeLikeAPerson(');', { untilDone: false });
  await vscode.commands.executeCommand('senior.nextLine');
  await typeLikeAPerson('}');
  const { result } = await pending;
  assert.equal(result.results[0].status, 'typed');
  assert.equal(read('src/trace.js'), 'if (ready) {\n  start();\n}\n');
  await until(() => setting() === before, 'the user\'s own setting to come back');
});

test('in the accept gear, Tab takes the whole piece as planned', async () => {
  await api.session.setGear('accept');
  const pending = call('guide', { pieces: [{ file: 'src/accept.js', kind: 'spine', where: 'new_file', text: 'const a = 1;\nconst b = 2;', why: 'Two constants.' }] });
  await until(() => api.session.active, 'the piece');
  await typeLikeAPerson('const a', { untilDone: false });
  assert.deepEqual(api.guide.inspect().lines.map((l) => l.trace.map((t) => t.text).join('')), [' = 1;', 'const b = 2;']);
  await vscode.commands.executeCommand('senior.acceptPiece');
  const { result } = await pending;
  assert.equal(result.results[0].status, 'accepted');
  assert.equal(read('src/accept.js'), 'const a = 1;\nconst b = 2;\n');
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

test('a replay opens scene by scene, shows a change side by side, and waits for questions until the user finishes', async () => {
  const id = '2026-10-22-retry-the-payment-call-a1b2';
  const before = 'def charge(order):\n    return provider.charge(order.total)\n';
  const after = 'def charge(order):\n    return provider.charge(order.total, key=order.id)\n';
  fs.mkdirSync(file('.senior/replays'), { recursive: true });
  fs.writeFileSync(
    file(`.senior/replays/${id}.json`),
    JSON.stringify({
      id,
      title: 'Retry the payment call safely',
      task: 'Retry payments that time out.',
      source: 'claude-code',
      createdAt: '2026-10-22T12:00:00.000Z',
      scenes: [
        { title: 'Where the call lives', narration: 'One call, no retry.', kind: 'build', decisions: [], files: [] },
        { title: 'A timeout is not a failure', narration: 'The provider had taken the money.', kind: 'bug', decisions: ['D-004'], files: [{ path: 'src/payments.py', before, after }] },
      ],
      skipped: ['A test against the provider sandbox.'],
      verified: ['pytest: 6 passed'],
      notVerified: [],
    }),
  );

  const first = call('show_replay', { id });
  await until(() => api.session.replay, 'the replay to open');
  assert.equal(api.session.replay.index, 0);
  assert.deepEqual(api.session.replay.scenes[1].files, [{ path: 'src/payments.py', change: 'changed' }]);
  assert.deepEqual(api.session.replay.scenes[1].decisions, [{ id: 'D-004' }]);

  api.replays.go(1);
  assert.equal(api.session.replay.index, 1);
  await api.replays.showChange(0);
  const diffSide = await until(() => vscode.window.activeTextEditor?.document.uri.scheme === 'senior-replay' && vscode.window.activeTextEditor, 'the change to open');
  assert.equal(diffSide.document.getText(), after);

  const place = api.replays.place();
  api.session.ask('Why does the key fix it?', place.where, place.at);
  const asked = (await first).result;
  assert.equal(asked.status, 'question');
  assert.equal(asked.scene, 2);
  assert.match(asked.userQuestions[0].where, /scene 2 of 2/);
  await call('say', { kind: 'answer', text: 'The provider sees the same key and returns the first charge.', replyTo: asked.userQuestions[0].id });

  // Asking again for the open replay keeps the user's scene, and the call ends when they finish.
  const second = call('show_replay', { id });
  await sleep(200);
  assert.equal(api.session.replay.index, 1);
  api.replays.go(2);
  api.replays.finish();
  assert.equal((await second).result.status, 'finished');
  assert.equal(api.session.replay, null);

  // A later run opens it again from the start.
  const third = call('show_replay', { id });
  await until(() => api.session.replay, 'the replay to open again');
  assert.equal(api.session.replay.index, 0);
  api.replays.close();
  assert.equal((await third).result.status, 'closed');
  assert.equal(api.session.snapshot().journal.filter((e) => e.kind === 'replay').length, 1);
  assert.ok(api.session.replays.some((r) => r.id === id), 'the saved replay is listed');

  const missing = await call('show_replay', { id: '../outside' });
  assert.equal(missing.status, 400);
});

test('the activity line follows Claude Code, credits work during the user\'s turn to the navigator, and never takes questions', async () => {
  const t0 = Date.now();
  await call('activity', { state: 'working', label: 'Reading src/cart.js', at: t0 });
  assert.deepEqual(api.session.activity, { state: 'working', label: 'Reading src/cart.js', since: t0 });
  await call('activity', { state: 'thinking', at: t0 - 1000 });
  assert.equal(api.session.activity.label, 'Reading src/cart.js', 'an older report that arrives late is ignored');

  api.session.ask('Why cents?', 'src/cart.js:1');
  await call('activity', { state: 'thinking', at: t0 + 1 });
  assert.equal(api.session.activity.state, 'thinking');
  const status = await call('status');
  assert.equal(status.result.userQuestions?.[0]?.text, 'Why cents?', 'the question is still there for Claude');

  // While the user types a guided piece, Claude Code is waiting for them: any work is the navigator's.
  fs.writeFileSync(file('src/turn.js'), 'module.exports = {};\n');
  const pending = call('guide', { pieces: [{ file: 'src/turn.js', kind: 'spine', where: 'start', text: 'const a = 1;', why: 'One.' }] });
  await until(() => api.session.active, 'the piece');
  await call('activity', { state: 'working', label: 'Reading src/next.js', at: t0 + 2 });
  assert.deepEqual(api.session.activity, { state: 'working', label: 'Reading src/next.js', helper: true, since: t0 + 2 });
  await call('activity', { state: 'thinking', at: t0 + 3 });
  assert.equal(api.session.activity.label, 'Reading src/next.js', 'Claude Code itself is not thinking while it waits for the user');
  await call('activity', { state: 'idle', helper: true, at: t0 + 4 });
  assert.deepEqual(api.session.activity, { state: 'idle', helper: true, since: t0 + 4 });
  await typeLikeAPerson('const a = 1;');
  assert.equal((await pending).result.status, 'done');

  const bad = await call('activity', { state: 'sleeping' });
  assert.equal(bad.status, 400);
});

test('ending a step can open the next one in the same moment', async () => {
  const before = api.session.snapshot().journal.length;
  const next = { index: 2, total: 2, title: 'Tax in whole cents', why: 'Now the tax, rounded to whole cents.', expect: 'The tax test passes.', risk: 'Fractions of a cent.' };
  const result = (await call('end_step', { summary: 'The total works.', verified: ['2 tests passed'], notVerified: [], takeaway: 'Count money in cents.', next })).result;
  assert.equal(result.ok, true);
  const added = api.session.snapshot().journal.slice(before);
  assert.deepEqual(added.map((e) => e.kind), ['summary', 'step']);
  assert.deepEqual(added[1].step, next);
  assert.equal(api.session.step.title, 'Tax in whole cents');

  const broken = await call('end_step', { summary: 'x', verified: [], notVerified: [], next: { index: 3, total: 3, why: 'No title.', expect: 'x' } });
  assert.equal(broken.status, 400);
  assert.equal(api.session.snapshot().journal.length, before + 2, 'a malformed next step leaves the journal as it was');
});

test('a failed check opens the line it points at and recalls the step\'s risk', async () => {
  fs.writeFileSync(file('src/money.js'), 'function total(items) {\n  return items.length * 0.1;\n}\nmodule.exports = { total };\n');
  await call('begin_step', { index: 1, total: 1, title: 'Totals in cents', why: 'Money is counted in whole cents.', expect: 'The total test passes.', risk: 'Floating point drifts by fractions of a cent.' });
  const output = `AssertionError: 0.30000000000000004 !== 0.3\n    at total (${file('src/money.js')}:2:23)\n    at node:internal/test_runner:1:1`;
  const result = (await call('show_check', { command: 'npm test', expected: 'The total test passes.', passed: false, output })).result;
  assert.equal(result.openedForTheUser, 'src/money.js:2');
  const check = api.session.snapshot().journal.filter((e) => e.kind === 'check').pop();
  assert.deepEqual(check.evidence, [{ file: 'src/money.js', line: 2 }]);
  assert.equal(check.risk, 'Floating point drifts by fractions of a cent.');
  const editor = vscode.window.activeTextEditor;
  assert.ok(editor.document.uri.fsPath.endsWith(path.join('src', 'money.js')));
  assert.equal(editor.selection.active.line, 1);

  const passed = (await call('show_check', { command: 'npm test', expected: 'It passes.', passed: true, output })).result;
  assert.equal(passed.openedForTheUser, undefined, 'a check that went as expected opens nothing');
});

test('"why?" on a written line answers at once from its piece and the decision behind it', async () => {
  const core = await import(require('node:url').pathToFileURL(path.resolve(__dirname, '../../../../plugin/core/index.mjs')).href);
  const decision = core.addEntry(workspace, {
    title: 'Money is kept in whole cents',
    reversibility: 'one-way',
    chosen: 'Integers of cents everywhere',
    why: 'Floating point cannot hold 0.1 exactly.',
    rejected: [{ option: 'Decimals in floats', why: 'They drift by fractions of a cent.' }],
  });
  fs.writeFileSync(file('src/price.js'), 'module.exports = {};\n');
  const pending = call('guide', {
    pieces: [{ file: 'src/price.js', kind: 'spine', where: 'start', text: 'const toCents = (euros) => Math.round(euros * 100);', why: 'Prices arrive in euros and leave in cents.', notice: 'Math.round, not Math.floor.', decision: decision.id }],
  });
  await until(() => api.session.active, 'the piece');
  assert.equal(api.session.active.notice, 'Math.round, not Math.floor.');
  await typeLikeAPerson('const toCents = (euros) => Math.round(euros * 100);');
  assert.equal((await pending).result.status, 'done');

  const editor = vscode.window.activeTextEditor;
  editor.selection = new vscode.Selection(0, 5, 0, 5);
  const before = api.session.snapshot().journal.length;
  await vscode.commands.executeCommand('senior.askWhy');
  const added = api.session.snapshot().journal.slice(before);
  assert.equal(added.length, 1);
  assert.equal(added[0].kind, 'explain');
  assert.equal(added[0].why, 'Prices arrive in euros and leave in cents.');
  assert.equal(added[0].notice, 'Math.round, not Math.floor.');
  assert.deepEqual(added[0].decisions.map((d) => [d.id, d.title, d.rejected[0].option]), [[decision.id, 'Money is kept in whole cents', 'Decimals in floats']]);
  assert.match(added[0].where, /^src\/price\.js:1: const toCents/);
  assert.ok(!api.session.hasPendingQuestions(), 'nothing was sent to Claude Code');
});

test('a decision shows above the code it is about, with the whole decision on hover and every detail in the panel', async () => {
  const core = await import(require('node:url').pathToFileURL(path.resolve(__dirname, '../../../../plugin/core/index.mjs')).href);
  fs.mkdirSync(file('src/bookings'), { recursive: true });
  fs.writeFileSync(file('src/bookings/reserve.js'), "'use strict';\n\nasync function reserveSlot(memberId, slotStart) {\n  return { memberId, slotStart };\n}\n\nmodule.exports = { reserveSlot };\n");
  const decision = core.addEntry(workspace, {
    title: 'Stop double bookings with a unique rule',
    reversibility: 'one-way',
    chosen: 'A unique rule on the class and the start time',
    why: 'Only the database sees two requests that arrive at the same moment.',
    rejected: [{ option: 'Check in code, then save', why: 'Two requests at once both see the spot as free.' }],
    guards: 'Two members holding the same spot',
    payoff: 'Two people press Book in the same second',
    files: ['src/bookings/reserve.js'],
    symbols: ['reserveSlot'],
    checks: { regretLibrary: 'applies and is avoided', independentReview: 'agreed', openSource: 'skipped: no web search' },
  });
  core.appendEvent(workspace, 'test-callbacks', { type: 'callback', decision: decision.id, trigger: 'edit', reasons: ['reserveSlot'] });
  api.decisions.reload();

  const doc = await vscode.workspace.openTextDocument(file('src/bookings/reserve.js'));
  const editor = await vscode.window.showTextDocument(doc);
  const ours = async () => ((await vscode.commands.executeCommand('vscode.executeCodeLensProvider', doc.uri)) || []).filter((l) => l.command && /^\$\(layers\)|^(Hard|Easy) to undo$|^Replaced |^Why\?$|^What changed\?$|^Full record$/.test(l.command.title));
  let seen = [];
  const lenses = await until(async () => {
    seen = ((await vscode.commands.executeCommand('vscode.executeCodeLensProvider', doc.uri)) || []).map((l) => `${l.range.start.line}:${l.command ? JSON.stringify(l.command.title) : 'none'}`);
    const found = await ours();
    return found.length === 4 ? found : null;
  }, 'the decision line above reserveSlot', 8000).catch((err) => {
    throw new Error(`${err.message}. Lenses: ${seen.join(', ') || 'none'}. Root: ${core.findRoot(path.dirname(doc.uri.fsPath))}. Ledger: ${core.loadLedger(workspace).map((e) => e.id).join(',')}`);
  });
  assert.deepEqual(
    lenses.map((l) => l.command.title),
    [`$(layers) ${decision.id}: Stop double bookings with a unique rule`, 'Hard to undo', 'Why?', 'Full record'],
  );
  assert.ok(lenses.every((l) => l.range.start.line === 2), 'every part sits above the definition');

  // The card shows over the linked name, and not over other words on the line.
  const hoverText = async (character) => {
    const hovers = (await vscode.commands.executeCommand('vscode.executeHoverProvider', doc.uri, new vscode.Position(2, character))) || [];
    return hovers.flatMap((h) => h.contents.map((c) => (typeof c === 'string' ? c : c.value))).join('\n');
  };
  const card = await hoverText(18);
  for (const part of ['What we chose', 'Why', 'What we turned down', 'It protects against', 'When you will see it matter', 'See every detail in the Senior panel']) {
    assert.ok(card.includes(part), `the card has "${part}"`);
  }
  assert.ok(!(await hoverText(30)).includes('What we chose'), 'no card over memberId');

  await vscode.commands.executeCommand('senior.decisionWhy', doc.uri, 2, 15);
  assert.deepEqual([editor.selection.active.line, editor.selection.active.character], [2, 15]);

  // "Full record" opens the memory page at the decision, with its record read fresh.
  await vscode.commands.executeCommand('senior.showDecision', decision.id);
  const shown = api.session.snapshot();
  assert.equal(shown.view, 'memory');
  assert.equal(shown.focus.id, decision.id);
  const detail = shown.memory.decisions.find((d) => d.id === decision.id);
  assert.equal(detail.undo, 'Hard to undo');
  assert.deepEqual(detail.checks.map((c) => c.label), ['The regret library', 'An independent review', 'Established practice']);
  assert.ok(detail.history.some((h) => /an edit touched reserveSlot, and the senior brought this decision back/.test(h)), detail.history.join(' | '));
  assert.match(detail.record.file, /^\.senior\/ledger\/D-\d+-[\w-]+\.json$/);
  assert.equal(JSON.parse(detail.record.json).id, decision.id);

  // A replacement is picked up from the ledger folder without a reload.
  const next = core.addEntry(workspace, { title: 'Hold a spot while the member pays', reversibility: 'two-way', chosen: 'A ten minute hold', why: 'Members lost spots while paying.' }, { supersedes: decision.id });
  const replaced = await until(async () => {
    const found = await ours();
    return found.some((l) => l.command.title === `Replaced ${decision.id}`) ? found : null;
  }, 'the line for the replacement');
  assert.deepEqual(
    replaced.map((l) => l.command.title),
    [`$(layers) ${next.id}: Hold a spot while the member pays`, `Replaced ${decision.id}`, 'What changed?', 'Full record'],
  );

  await vscode.workspace.getConfiguration('senior').update('decisionLenses', false, vscode.ConfigurationTarget.Global);
  try {
    await until(async () => (await ours()).length === 0, 'the lines to go when they are turned off');
  } finally {
    await vscode.workspace.getConfiguration('senior').update('decisionLenses', undefined, vscode.ConfigurationTarget.Global);
  }
});

test('decisions that no code carries out yet, and the plans, are on the memory page and open it when recorded', async () => {
  const core = await import(require('node:url').pathToFileURL(path.resolve(__dirname, '../../../../plugin/core/index.mjs')).href);
  // Right after a design session, no step is running.
  api.session.step = null;
  api.session.active = null;
  api.session.setView('session');

  const decision = core.addEntry(workspace, {
    title: 'Send email after the booking is saved',
    reversibility: 'two-way',
    chosen: 'An outbox row written in the same transaction',
    why: 'An email sent before the commit can describe a booking that never happened.',
    feature: 'class-booking',
  });
  core.savePlan(workspace, {
    feature: 'class-booking',
    title: 'Book a class',
    goal: 'Members book a place without double bookings.',
    decisions: [`${decision.id} Send email after the booking is saved`],
    examples: ['Two members press Book at once: one gets the place.'],
    steps: [
      { title: 'Set up the project with a passing test', why: 'Every later step needs a place to prove itself.', expect: 'One test passes.', status: 'done' },
      { title: 'Write the outbox', why: 'The email must wait for the commit.', expect: 'The outbox test passes.', risk: 'An email for a booking that rolled back.' },
    ],
  });

  const memory = await until(() => {
    const s = api.session.snapshot();
    return s.view === 'memory' && s.memory?.plans.some((p) => p.feature === 'class-booking') && s.memory.decisions.some((d) => d.id === decision.id) ? s.memory : null;
  }, 'the memory page to open with the new decision and plan');
  const unlinked = memory.decisions.find((d) => d.id === decision.id);
  assert.deepEqual([unlinked.files, unlinked.symbols], [[], []]);
  const plan = memory.plans.find((p) => p.feature === 'class-booking');
  assert.deepEqual([plan.done, plan.total], [1, 2]);
  assert.deepEqual(plan.decisions, [{ id: decision.id, title: 'Send email after the booking is saved' }]);
  assert.equal(plan.steps[1].risk, 'An email for a booking that rolled back.');

  // The command from the status bar opens the same page.
  api.session.setView('session');
  await vscode.commands.executeCommand('senior.showMemory');
  assert.equal(api.session.snapshot().view, 'memory');
});

test('the computer\'s own voice reads narration aloud, and the panel only offers it when there is one', async () => {
  const available = await api.voice.ready;
  await until(() => api.session.speech !== 'unknown', 'the voice check');
  assert.equal(api.session.speech, available);
  if (process.platform === 'win32' || process.platform === 'darwin') assert.equal(available, true);
  if (!available) {
    console.log('        This computer has no voice, so Read aloud is hidden.');
    return;
  }
  // The test run sets the volume to zero on Windows, so nothing is heard. Turning Read aloud on warms
  // the speaker, so a sentence then takes only as long as it takes to say.
  await api.voice.warm();
  const started = Date.now();
  await api.voice.say('Then the tax.');
  assert.equal(api.voice.lastError, null);
  console.log(`        Spoke a short sentence in ${Date.now() - started} ms after warming up.`);
  api.voice.stop();
  await api.voice.say('This sentence starts the speaker again after a stop.');
  assert.equal(api.voice.lastError, null);
});

// Knowledge levels. These run last: the level set here would change how earlier pieces are guided.

test('at level 3 names hide behind hints, Show me brings the line back, and the user still types it', async () => {
  const pending = call('guide', {
    pieces: [{ file: 'src/shape.js', kind: 'spine', where: 'new_file', text: 'const total = sum(items);', why: 'Add the prices up.', tech: 'javascript', level: 3, blanks: [{ text: 'sum', hint: 'add them up' }] }],
  });
  await until(() => api.session.active, 'the piece');
  assert.equal(api.session.active.teach.trace, 'shape');
  assert.deepEqual(api.guide.inspect().shown, ['const total = ⟨add them up⟩(items);']);
  // Tab never takes a piece the user is learning to write, whatever the gear.
  await api.session.setGear('accept');
  await vscode.commands.executeCommand('senior.acceptPiece');
  assert.ok(api.session.active, 'the piece is still the user\'s to type');
  await api.session.setGear('type');
  await vscode.commands.executeCommand('senior.showMe');
  await until(() => api.guide.inspect() && api.guide.inspect().revealed, 'the full trace');
  assert.deepEqual(api.guide.inspect().shown, ['const total = sum(items);']);
  assert.equal(api.session.active.revealed, true);
  await typeLikeAPerson('const total = sum(items);');
  const { result } = await pending;
  assert.equal(result.results[0].status, 'typed');
  const pieces = api.session.snapshot().journal.filter((e) => e.kind === 'pieces').pop();
  assert.equal(pieces.pieces[0].revealed, true, 'the panel remembers that the user asked to see the code');
});

test('at level 4 only the first line is traced, plain sentences say what the rest does, and Done keeps the user\'s version', async () => {
  const pending = call('guide', {
    pieces: [
      {
        file: 'src/area.js',
        kind: 'spine',
        where: 'new_file',
        text: 'function area(w, h) {\n  return w * h;\n}',
        why: 'The area of a rectangle.',
        tech: 'javascript',
        level: 4,
        outline: ['Return the width times the height.', 'Close the function.'],
      },
    ],
  });
  await until(() => api.session.active, 'the piece');
  const shown = api.guide.inspect();
  assert.equal(shown.trace, 'first');
  assert.deepEqual(shown.shown, ['function area(w, h) {', '', '']);
  assert.deepEqual(shown.notes, ['Return the width times the height.', 'Close the function.']);
  await typeLikeAPerson('function area(w, h) {', { untilDone: false });
  await vscode.commands.executeCommand('senior.nextLine');
  // The editor closed the brace by itself; it goes when the cursor leaves the line, as a person pauses.
  await until(() => vscode.window.activeTextEditor.document.lineAt(0).text === 'function area(w, h) {', 'the stray brace to go');
  await typeLikeAPerson('return h * w;', { untilDone: false });
  await sleep(100);
  assert.equal(api.session.active.diverged, undefined, 'a version written from a description is not flagged as wrong');
  await vscode.commands.executeCommand('senior.pieceDone');
  const { result } = await pending;
  assert.equal(result.results[0].status, 'kept_own');
  assert.match(result.results[0].text, /return h \* w;/);
});

test('at level 5 nothing is traced, and the panel carries the list and the names', async () => {
  const pending = call('guide', {
    pieces: [{ file: 'src/half.js', kind: 'spine', where: 'new_file', text: 'const half = (n) => n / 2;', why: 'Half of a number.', tech: 'javascript', level: 5, todo: ['Divide the number by two.'], names: ['half'] }],
  });
  await until(() => api.session.active, 'the piece');
  assert.deepEqual(api.guide.inspect().shown, ['']);
  assert.deepEqual(api.session.active.teach.todo, ['Divide the number by two.']);
  assert.deepEqual(api.session.active.teach.names, ['half']);
  // Done does nothing on an empty piece: there is nothing of the user's to keep yet.
  await api.guide.action('done');
  assert.ok(api.session.active);
  await typeLikeAPerson('const half = (n) => n / 2;');
  const { result } = await pending;
  assert.equal(result.results[0].status, 'typed', 'a version that matches the plan completes by itself');
});

test('a choice waits for the user\'s pick and reports it to Claude', async () => {
  const options = [
    { label: 'Lock the row', detail: 'The second customer waits.', pick: true },
    { label: 'Check, then save', detail: 'Two customers can pass the check together.', risk: 'R-bookings-01', pushback: 'Two customers can both get the seat.' },
  ];
  const pending = call('offer_choice', { question: 'How should a hold stop two customers?', options });
  const entry = await until(() => api.session.snapshot().journal.find((e) => e.kind === 'choice' && e.chosen === undefined), 'the choice');
  api.handlers.choose(entry.id, 1);
  const { result } = await pending;
  assert.deepEqual([result.status, result.option, result.label, result.pushedBack], ['chosen', 1, 'Check, then save', true]);
  assert.equal(api.session.snapshot().journal.find((e) => e.id === entry.id).chosen, 1);
});

test('a level set in the editor reaches Claude, and a piece without a level takes the user\'s level for its file', async () => {
  try {
    api.levels.set('javascript', 2);
    const notice = api.session.snapshot().journal.filter((e) => e.kind === 'level').pop();
    assert.deepEqual([notice.tech, notice.from, notice.to], ['javascript', null, 2]);
    const { result } = await call('status');
    assert.deepEqual(result.levelsChanged.map((c) => [c.tech, c.to]), [['javascript', 2]]);
    assert.ok(result.levels.some((t) => t.tech === 'javascript' && t.level === 2));

    const pending = call('guide', { pieces: [{ file: 'src/two.js', kind: 'spine', where: 'new_file', text: 'const two = 2;', why: 'A constant.' }] });
    await until(() => api.session.active, 'the piece');
    assert.deepEqual([api.session.active.teach.tech, api.session.active.teach.level], ['javascript', 2]);
    await typeLikeAPerson('const two = 2;');
    await pending;

    // Ten easy pieces in a row at level 3 bring one suggestion, and a yes moves the level.
    api.levels.set('javascript', 3);
    for (let i = 0; i < 10; i++) api.levels.onPiece({ tech: 'javascript', level: 3, kind: 'spine', status: 'typed', revealed: false, newWords: 0 });
    const suggestion = api.session.snapshot().journal.filter((e) => e.kind === 'suggestion').pop();
    assert.deepEqual([suggestion.from, suggestion.to], [3, 4]);
    api.levels.answerSuggestion(suggestion.id, 'yes');
    assert.equal(JSON.parse(fs.readFileSync(process.env.SENIOR_LEVELS_FILE, 'utf8')).levels.javascript.level, 4);
    // Only once a session.
    for (let i = 0; i < 10; i++) api.levels.onPiece({ tech: 'javascript', level: 4, kind: 'spine', status: 'typed', revealed: false, newWords: 0 });
    assert.equal(api.session.snapshot().journal.filter((e) => e.kind === 'suggestion').length, 1);
  } finally {
    fs.rmSync(process.env.SENIOR_LEVELS_FILE, { force: true });
    api.levels.refresh(true);
  }
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
      api.replays.close();
      await api.session.setGear('type');
      await vscode.workspace.getConfiguration('senior').update('watchSpeed', undefined, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand('workbench.action.files.saveAll');
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  }
  console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  if (failed) throw new Error(`${failed} integration test${failed === 1 ? '' : 's'} failed`);
};
