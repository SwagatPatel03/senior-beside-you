import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildMaterial, reasonsFromTranscript } from '../plugin/cli/material.mjs';
import * as core from '../plugin/core/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'plugin', 'cli', 'senior.mjs');

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'senior memory '));
  core.initProject(root);
  return root;
}

const planInput = {
  title: 'Gym bookings',
  goal: 'Members book limited places in weekly classes.',
  steps: [
    { title: 'Turn the examples into tests', why: 'They define done.', expect: 'Three tests fail because booking does not exist yet.' },
    { title: 'Add the booking table', why: 'Capacity lives in the database.', expect: 'The migration runs and the first test passes.', files: ['db\\migrations'] },
  ],
};

test('initProject creates every folder and is safe to call twice', () => {
  const root = project();
  for (const dir of ['ledger', 'features', 'regrets', 'sessions', 'state', 'story', 'replays']) {
    assert.ok(fs.existsSync(path.join(root, '.senior', dir)), `${dir} exists`);
  }
  fs.writeFileSync(path.join(root, '.senior', '.gitignore'), 'custom\n');
  core.initProject(root);
  assert.equal(fs.readFileSync(path.join(root, '.senior', '.gitignore'), 'utf8'), 'custom\n');
});

test('plans validate, save with step ids, and track step status', () => {
  const root = project();
  assert.ok(core.validatePlan({ title: 'x' }).length > 0);
  assert.ok(core.validatePlan({ ...planInput, steps: [{ title: 'only a title' }] }).some((p) => p.includes('"why"')));

  const plan = core.savePlan(root, planInput, { now: new Date('2026-10-22T10:00:00Z') });
  assert.equal(plan.feature, 'gym-bookings');
  assert.deepEqual(plan.steps.map((s) => s.id), ['S1', 'S2']);
  assert.deepEqual(plan.steps[1].files, ['db/migrations']);
  assert.equal(core.nextStep(plan).id, 'S1');

  const updated = core.setStepStatus(root, 'gym-bookings', 'S1', 'done', { summary: 'Three tests fail as expected.' });
  assert.equal(core.nextStep(updated).id, 'S2');
  assert.deepEqual(core.listPlans(root).map((p) => [p.feature, p.done, p.steps]), [['gym-bookings', 1, 2]]);
  assert.throws(() => core.setStepStatus(root, 'gym-bookings', 'S9', 'done'), /no step S9/);

  const again = core.savePlan(root, { ...planInput, feature: 'gym-bookings' }, { now: new Date('2026-10-23T10:00:00Z') });
  assert.equal(again.createdAt, '2026-10-22T10:00:00.000Z', 'saving again keeps the creation date');

  const brief = core.renderBrief(plan, { risks: [{ title: 'Double booking', scene: 'Two members take the last place.', cause: 'Check then insert.', prevention: 'A unique index.', regret: 'R-bookings-01' }] });
  assert.match(brief, /## Risks[\s\S]*Double booking[\s\S]*R-bookings-01/);
  assert.match(brief, /## Steps[\s\S]*Add the booking table/);
});

test('replays validate, save as JSON and Markdown, and list newest first', () => {
  const root = project();
  assert.ok(core.validateReplay({ title: 'x', scenes: [{ title: 'a' }] }).some((p) => p.includes('narration')));
  assert.ok(core.validateReplay({ title: 'x', scenes: [{ title: 'a', narration: 'b', kind: 'odd' }] }).some((p) => p.includes('kind')));

  const first = core.saveReplay(root, {
    title: 'CSV export',
    scenes: [{ title: 'Why the export streams rows', narration: 'A month of bookings does not fit in memory.', files: [{ path: 'reports\\export.py', after: 'def export(): ...' }] }],
    notVerified: ['The export with a full month of data'],
  }, { now: new Date('2026-10-22T12:00:00Z') });
  core.saveReplay(root, { title: 'Second', scenes: [{ title: 'One', narration: 'Two' }] }, { now: new Date('2026-10-22T13:00:00Z') });

  assert.deepEqual(core.listReplays(root).map((r) => r.title), ['Second', 'CSV export']);
  const loaded = core.loadReplay(root, first.id);
  assert.equal(loaded.scenes[0].files[0].path, 'reports/export.py');
  // An id that is not a plain id never names a file, even one that exists.
  fs.writeFileSync(path.join(root, '.senior', 'elsewhere.json'), '{"id":"x","scenes":[]}');
  assert.equal(core.loadReplay(root, '../elsewhere'), null);
  const markdown = fs.readFileSync(path.join(root, '.senior', 'replays', `${first.id}.md`), 'utf8');
  assert.match(markdown, /## Scene 1: Why the export streams rows/);
  assert.match(markdown, /Not verified: The export with a full month of data/);
});

test('replay material pairs each change with the reason given before it', () => {
  const root = project();
  const transcript = path.join(root, 'transcript.jsonl');
  fs.writeFileSync(transcript, [
    JSON.stringify({ type: 'user', message: { content: 'add the export' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'I will stream rows so memory stays flat.' }, { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: {} }] } }),
    'not json',
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_2', name: 'Bash', input: {} }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done. Skipped for now: a test for an empty month.' }] } }),
  ].join('\n'));

  const reasons = reasonsFromTranscript(transcript);
  assert.equal(reasons.get('toolu_1'), 'I will stream rows so memory stays flat.');
  assert.equal(reasons.get('toolu_2'), '', 'a call with no words before it has an empty reason');

  core.appendEvent(root, 's1', { type: 'start', transcript });
  core.appendEvent(root, 's1', { type: 'prompt', text: 'Add the CSV export' });
  core.appendEvent(root, 's1', { type: 'edit', tool: 'Edit', file: 'reports/export.py', toolUseId: 'toolu_1', old: 'pass', new: 'yield row' });
  core.appendEvent(root, 's1', { type: 'failure', command: 'pytest', snippet: 'AssertionError', toolUseId: 'toolu_2' });

  const material = buildMaterial(root);
  assert.match(material, /The user asked: Add the CSV export/);
  assert.match(material, /Reason the agent gave: I will stream rows so memory stays flat\.[\s\S]*Edited reports\/export\.py[\s\S]*yield row/);
  assert.match(material, /Command failed: pytest[\s\S]*AssertionError/);
  assert.match(material, /## How the agent finished\nDone\. Skipped for now: a test for an empty month\./);

  // A later session that only built a replay changed no project file, so it is not picked.
  core.appendEvent(root, 's2', { type: 'command', command: 'senior replay save' }, new Date(Date.now() + 60000));
  assert.match(buildMaterial(root), /Add the CSV export/);
});

test('the CLI saves a plan with its brief and a replay', () => {
  const root = project();
  const save = spawnSync(process.execPath, [cli, 'plan', 'save'], { cwd: root, encoding: 'utf8', input: JSON.stringify(planInput) });
  assert.equal(save.status, 0, save.stderr);
  assert.ok(fs.existsSync(path.join(root, '.senior', 'features', 'gym-bookings.md')));

  const step = spawnSync(process.execPath, [cli, 'plan', 'step', 'gym-bookings', 'S1', 'done', 'Tests', 'fail', 'as', 'expected'], { cwd: root, encoding: 'utf8' });
  assert.match(step.stdout, /S1 is now done\. 1 of 2 steps are finished\./);

  const replay = spawnSync(process.execPath, [cli, 'replay', 'save'], {
    cwd: root, encoding: 'utf8', input: JSON.stringify({ title: 'Export', scenes: [{ title: 'Streaming', narration: 'Rows are written as they are read.' }] }),
  });
  assert.equal(replay.status, 0, replay.stderr);
  assert.match(replay.stdout, /Saved replay .* with 1 scenes/);
  const list = spawnSync(process.execPath, [cli, 'replay', 'list'], { cwd: root, encoding: 'utf8' });
  assert.match(list.stdout, /Export \(1 scenes\)/);
});

test('the regret library can be pointed at a bundled copy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed '));
  fs.writeFileSync(path.join(dir, 'only.md'), '---\ntopic: only\ntitle: Only topic\n---\n\n## R-only-01: The one entry\nText.\n');
  assert.deepEqual(core.loadRegrets(null, { seedDir: dir }).map((t) => t.topic), ['only']);
  const before = core.defaultSeedDir();
  core.setSeedDir(dir);
  try {
    assert.deepEqual(core.loadRegrets(null).map((t) => t.topic), ['only']);
  } finally {
    core.setSeedDir(before);
  }
});

test('the CLI moves a plan to its next step in one call', () => {
  const root = project();
  core.savePlan(root, planInput);
  const first = spawnSync(process.execPath, [cli, 'plan', 'advance', 'gym-bookings', 'S1', 'The', 'tests', 'fail', 'as', 'expected'], { cwd: root, encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /S1 is done\. 1 of 2 steps are finished\. S2 is now active: Add the booking table/);
  assert.deepEqual(core.loadPlan(root, 'gym-bookings').steps.map((s) => [s.status, s.summary]), [['done', 'The tests fail as expected'], ['active', undefined]]);

  const last = spawnSync(process.execPath, [cli, 'plan', 'advance', 'gym-bookings', 'S2'], { cwd: root, encoding: 'utf8' });
  assert.match(last.stdout, /S2 is done\. 2 of 2 steps are finished\. Every step is finished\./);
  const unknown = spawnSync(process.execPath, [cli, 'plan', 'advance', 'gym-bookings', 'S9'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /has no step S9/);
});
