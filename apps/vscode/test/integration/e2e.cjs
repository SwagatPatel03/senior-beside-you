// End to end: a real Claude Code session runs /senior:pair through the senior plugin on a two-step
// plan, and this test plays the user in the editor. It types each spine piece key by key and asks one
// question partway. It checks that the navigator prepared the second step while the user typed the
// first, that the second step opened with the narration prepared for it, and that both steps pass.

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
    '--output-format', 'stream-json',
    '--verbose',
    '--model', 'sonnet',
    '--allowedTools',
    'Bash(npm test)', 'Bash(npm test *)', 'Bash(node *)', 'Read', 'Glob', 'Grep', 'Agent',
    'mcp__plugin_senior_editor__status', 'mcp__plugin_senior_editor__begin_step', 'mcp__plugin_senior_editor__guide',
    'mcp__plugin_senior_editor__wait', 'mcp__plugin_senior_editor__say', 'mcp__plugin_senior_editor__show_check',
    'mcp__plugin_senior_editor__open_file', 'mcp__plugin_senior_editor__end_step',
    'mcp__plugin_senior_editor__offer_choice', 'mcp__plugin_senior_editor__show_idiom',
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

  // Keep every change of the activity line, to see the navigator at work during the user's turn.
  const activity = [];
  api.session.onMeta(() => {
    const a = api.session.activity;
    const last = activity[activity.length - 1];
    if (a && (!last || last.since !== a.since || last.label !== a.label)) activity.push({ ...a, userTurn: !!api.session.active });
  });

  const claude = startClaude();
  let finished = null;
  claude.done.then((r) => (finished = r));

  let asked = false;
  const typed = [];
  // At level 0 every piece is one line with a check every few lines, so the session takes longer.
  const minutes = process.env.SENIOR_E2E_LEVEL !== undefined ? 30 : 14;
  const deadline = Date.now() + minutes * 60 * 1000;

  // Play the user until Claude Code finishes. A person takes a moment to read the reason first.
  while (!finished && Date.now() < deadline) {
    const slot = api.guide.inspect();
    if (slot && (slot.kind === 'spine' || slot.kind === 'probe')) {
      if (!asked) {
        api.session.ask('Why do we keep prices in whole cents instead of decimals?', `${slot.file}`);
        asked = true;
      }
      await sleep(1500);
      const text = slot.expected;
      for (const ch of text) {
        if (!api.guide.inspect()) break;
        await vscode.commands.executeCommand('type', { text: ch });
        await sleep(60);
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
    throw new Error(`Claude Code did not finish within ${minutes} minutes.`);
  }

  const journal = api.session.snapshot().journal;
  const kinds = journal.map((e) => e.kind);
  const events = finished.out.split(/\r?\n/).filter((l) => l.trim().startsWith('{')).map((l) => JSON.parse(l));
  const summary = events.filter((e) => e.type === 'result').pop() ?? {};
  // The navigator's reply ends with the prepared step as JSON. Find its narration among every text in
  // the stream: the reply may arrive as a tool result or as a notification.
  const texts = [];
  const collect = (v) => {
    if (typeof v === 'string') texts.push(v);
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') Object.values(v).forEach(collect);
  };
  events.forEach(collect);
  const narrations = [];
  for (const t of texts) {
    for (const m of t.matchAll(/"narration"\s*:\s*("(?:[^"\\]|\\.)*")/g)) {
      try {
        narrations.push(JSON.parse(m[1]));
      } catch {
        // Not a complete string; ignore it.
      }
    }
  }
  const steps = journal.filter((e) => e.kind === 'step');
  const summaries = journal.filter((e) => e.kind === 'summary');
  console.log(`  Claude Code exited with ${finished.code}; cost $${(summary.total_cost_usd ?? 0).toFixed(2)}`);
  console.log(`  Journal: ${kinds.join(', ')}`);
  console.log(`  Pieces typed by the test user: ${typed.length}`);
  for (const e of journal.filter((x) => ['narration', 'answer', 'takeaway', 'callback'].includes(x.kind))) console.log(`  ${e.kind}: ${e.text}`);
  for (const s of steps) console.log(`  step ${s.step.index}: ${s.step.title}. ${s.step.why}${s.step.risk ? ` Risk: ${s.step.risk}` : ''}`);
  console.log(`  Activity (* = during the user's turn):\n${activity.map((a) => `    ${a.userTurn ? '*' : ' '} ${a.helper ? 'navigator ' : ''}${a.state}${a.label ? `: ${a.label}` : ''}`).join('\n')}`);
  if (summaries[0] && steps[1]) console.log(`  Wait between the end of step 1 and the start of step 2: ${((Date.parse(steps[1].at) - Date.parse(summaries[0].at)) / 1000).toFixed(1)} s`);
  if (finished.code !== 0) console.log(`  stderr: ${finished.err.slice(-2000)}`);

  assert.equal(finished.code, 0, 'Claude Code exits cleanly');
  assert.ok(typed.length >= 2, 'spine pieces of both steps reached the user');
  assert.equal(steps.length, 2, 'both steps were shown');
  assert.ok(journal.some((e) => e.kind === 'answer'), 'the question asked in the editor was answered in the panel');
  assert.ok(activity.some((a) => a.state === 'working' && !a.helper && a.label), 'the activity line showed what Claude Code was doing');

  console.log(`  Narration the navigator prepared: ${narrations.join(' | ') || '(none found in the stream)'}`);
  assert.ok(narrations.includes(steps[1].step.why), 'step 2 opened with the narration the navigator prepared for it');
  assert.ok(activity.some((a) => a.helper && a.userTurn), 'the navigator worked while the user was typing');

  // With a level set, every piece is cut and taught at it.
  if (process.env.SENIOR_E2E_LEVEL !== undefined) {
    const level = Number(process.env.SENIOR_E2E_LEVEL);
    const lastViews = new Map();
    for (const e of journal.filter((x) => x.kind === 'pieces')) lastViews.set(e.id, e.pieces);
    const pieces = [...lastViews.values()].flat().filter((p) => p.kind === 'spine');
    console.log(`  Spine pieces at JavaScript ${level}: ${pieces.length}`);
    for (const p of pieces) {
      const t = p.teach ?? {};
      console.log(`    ${p.lines} line${p.lines === 1 ? '' : 's'} · level ${t.level} · ${t.trace ?? 'no trace mode'} · ${p.why}`);
      if (t.concept) console.log(`      New idea: ${t.concept.title}. ${t.concept.text}${t.concept.bridge ? ` (${t.concept.bridge})` : ''}`);
      for (const w of t.words ?? []) console.log(`      ${w.text}: ${w.meaning}`);
      for (const l of t.lines ?? []) console.log(`      ${l.code}  ${l.text}`);
    }
    const known = fs.existsSync(process.env.SENIOR_LEVELS_FILE) ? JSON.parse(fs.readFileSync(process.env.SENIOR_LEVELS_FILE, 'utf8')).words : {};
    console.log(`  Words recorded as explained: ${JSON.stringify(known)}`);
    assert.ok(pieces.length > 0, 'spine pieces reached the user');
    assert.ok(pieces.every((p) => p.teach && p.teach.level === level), 'every spine piece carries the user\'s level');
    if (level === 0) {
      assert.ok(pieces.every((p) => p.lines <= 2), 'at level 0 a spine piece is one line, or one line and its closing bracket');
      assert.ok(pieces.some((p) => p.teach.words && p.teach.words.length), 'the words of a line are explained');
      assert.ok(pieces.some((p) => p.teach.concept), 'a new idea gets a card');
      assert.ok(Object.values(known).some((w) => w.length), 'explained words are remembered');
    }
  }

  for (const file of ['test/total.test.js', 'test/tax.test.js']) {
    const run = execFileSync(process.execPath, ['--test', file], { cwd: workspace, encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    assert.match(run, /fail 0/, `${file} passes`);
  }
  const plan = JSON.parse(fs.readFileSync(path.join(workspace, '.senior', 'features', 'cart-total.plan.json'), 'utf8'));
  assert.deepEqual(plan.steps.map((s) => s.status), ['done', 'done'], 'both plan steps are done');
  console.log('\n  The end-to-end pairing session passed.');
};
