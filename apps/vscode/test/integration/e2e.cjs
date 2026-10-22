// End to end: a real Claude Code session runs /senior:pair through the senior plugin, and this test
// plays the user in the editor. It types each spine piece key by key, asks one question partway,
// and checks that the step ends with passing tests, a done plan step and a full panel journal.

const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const workspace = process.env.SENIOR_TEST_WORKSPACE;

function startClaude() {
  const args = [
    '-p',
    '--plugin-dir', process.env.SENIOR_PLUGIN_DIR,
    '--setting-sources', 'project',
    '--no-session-persistence',
    '--output-format', 'json',
    '--model', 'sonnet',
    '--allowedTools',
    'Bash(npm test)', 'Bash(npm test *)', 'Bash(node *)', 'Read', 'Glob', 'Grep',
    'mcp__plugin_senior_editor__status', 'mcp__plugin_senior_editor__begin_step', 'mcp__plugin_senior_editor__guide',
    'mcp__plugin_senior_editor__wait', 'mcp__plugin_senior_editor__say', 'mcp__plugin_senior_editor__show_check',
    'mcp__plugin_senior_editor__open_file', 'mcp__plugin_senior_editor__end_step',
  ];
  const child = spawn(process.env.CLAUDE_BIN, args, { cwd: workspace, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }, windowsHide: true });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  child.stdin.end('/senior:pair continue cart-total');
  const done = new Promise((resolve) => child.on('close', (code) => resolve({ code, out, err })));
  return { child, done };
}

exports.run = async function run() {
  const api = await vscode.extensions.getExtension('swagatpatel.senior').activate();
  const claude = startClaude();
  let finished = null;
  claude.done.then((r) => (finished = r));

  let asked = false;
  const typed = [];
  const deadline = Date.now() + 9 * 60 * 1000;

  // Play the user until Claude Code finishes.
  while (!finished && Date.now() < deadline) {
    const slot = api.guide.inspect();
    if (slot && (slot.kind === 'spine' || slot.kind === 'probe')) {
      if (!asked) {
        api.session.ask('Why do we keep prices in whole cents instead of decimals?', `${slot.file}`);
        asked = true;
      }
      const text = slot.expected;
      for (const ch of text) {
        if (!api.guide.inspect()) break;
        await vscode.commands.executeCommand('type', { text: ch });
        await sleep(20);
      }
      typed.push({ file: slot.file, text });
      // If auto-closing left the piece one keystroke short, give the editor a moment, then fill it in.
      await sleep(800);
      if (api.guide.inspect()?.expected === text) await api.guide.action('fillIn');
    }
    await sleep(200);
  }

  if (!finished) {
    claude.child.kill();
    throw new Error('Claude Code did not finish within nine minutes.');
  }

  const journal = api.session.snapshot().journal;
  const kinds = journal.map((e) => e.kind);
  const summary = JSON.parse(finished.out || '{}');
  console.log(`  Claude Code exited with ${finished.code}; cost $${(summary.total_cost_usd ?? 0).toFixed(2)}`);
  console.log(`  Journal: ${kinds.join(', ')}`);
  console.log(`  Pieces typed by the test user: ${typed.length}`);
  console.log(`  Stats: ${JSON.stringify(api.session.stats)}`);
  for (const e of journal.filter((x) => ['narration', 'answer', 'takeaway', 'callback'].includes(x.kind))) console.log(`  ${e.kind}: ${e.text}`);
  for (const e of journal.filter((x) => x.kind === 'check' || x.kind === 'summary')) console.log(`  ${e.kind}: ${JSON.stringify(e)}`);
  if (finished.code !== 0) console.log(`  stderr: ${finished.err.slice(-2000)}`);

  assert.equal(finished.code, 0, 'Claude Code exits cleanly');
  assert.ok(typed.length >= 1, 'at least one spine piece reached the user');
  assert.ok(api.session.stats.typed >= 1, 'the user wrote lines by hand');
  for (const kind of ['step', 'pieces', 'check', 'summary']) assert.ok(kinds.includes(kind), `the journal has a ${kind} entry`);
  assert.ok(journal.some((e) => e.kind === 'check' && e.passed), 'a check passed');
  assert.ok(journal.some((e) => e.kind === 'answer'), 'the question asked in the editor was answered in the panel');

  const testRun = execFileSync(process.execPath, ['--test'], { cwd: workspace, encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  assert.match(testRun, /pass 2/, 'the project tests pass');

  const plan = JSON.parse(fs.readFileSync(path.join(workspace, '.senior', 'features', 'cart-total.plan.json'), 'utf8'));
  assert.equal(plan.steps[0].status, 'done', 'the plan step is marked done');
  console.log('\n  The end-to-end pairing session passed.');
};
