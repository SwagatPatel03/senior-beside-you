// The words and lines of Senior's look in Claude Code (plugin/ui/look.mjs). The drawn pieces are
// tested by `npm run test:ui`, which runs plugin/ui/draw.test.ts in Claude Code's own test kit.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import {
  activityLabel,
  callbackToast,
  decisionsNote,
  formatDuration,
  modeForSkill,
  newCallbacks,
  parentDir,
  phaseLabel,
  safeId,
  sameKey,
  seniorCommandLabel,
  shown,
  welcomeParts,
  withEllipsis,
} from '../plugin/ui/look.mjs';
import { safeId as coreSafeId } from '../plugin/core/sessions.mjs';

const ROOT = 'C:\\Users\\SWAGAT PATEL\\shop';

test('file tools name the project-relative file, with Windows paths and a space in the home folder', () => {
  assert.equal(activityLabel('Read', { file_path: 'C:\\Users\\SWAGAT PATEL\\shop\\src\\orders\\order.ts' }, ROOT), 'Reading src/orders/order.ts');
  assert.equal(activityLabel('Edit', { file_path: 'c:/users/swagat patel/shop/src/a.ts' }, ROOT), 'Editing src/a.ts');
  assert.equal(activityLabel('Write', { file_path: 'D:\\elsewhere\\notes.md' }, ROOT), 'Writing notes.md');
  assert.equal(shown(null, './src/a.ts'), 'src/a.ts');
});

test('the Senior CLI, the navigator and the editor get their own words', () => {
  const cli = 'node "C:/Users/SWAGAT PATEL/.claude/plugins/cache/senior/cli/senior.mjs" ledger add --file d.json';
  assert.equal(activityLabel('Bash', { command: cli, description: 'Record the decision' }, ROOT), 'Recording a decision in the ledger');
  assert.equal(seniorCommandLabel('node senior.mjs regrets show auth'), 'Checking the regret library');
  assert.equal(activityLabel('Agent', { subagent_type: 'senior:navigator', description: 'x' }, ROOT), 'The navigator is preparing the next step');
  assert.equal(activityLabel('mcp__plugin_senior_editor__say', {}, ROOT), 'Updating the Senior panel');
});

test('a command uses its description, and a tool with no words falls back to the turn phase', () => {
  assert.equal(activityLabel('Bash', { command: 'npm test', description: 'Run the order tests' }, ROOT), 'Run the order tests');
  assert.equal(activityLabel('Bash', { command: 'npm test' }, ROOT), 'Running npm test');
  assert.equal(activityLabel('TodoWrite', {}, ROOT), null);
  assert.equal(phaseLabel('thinking'), 'Thinking it through');
  assert.equal(phaseLabel('responding'), 'Writing the answer');
  assert.equal(withEllipsis('Compacting conversation...'), 'Compacting conversation…');
  assert.equal(withEllipsis('Reading a.ts'), 'Reading a.ts…');
});

test('only the design, pair, fast and replay skills set a mode', () => {
  assert.equal(modeForSkill('senior:pair'), 'pair');
  assert.equal(modeForSkill('fast', 'senior'), 'fast');
  assert.equal(modeForSkill('senior:why'), null);
  assert.equal(modeForSkill('pair', 'someone-else'), null);
});

test('durations read as Claude Code writes them, and a turn mentions decisions only when it recorded some', () => {
  assert.equal(formatDuration(3400), '3s');
  assert.equal(formatDuration(64000), '1m 4s');
  assert.equal(formatDuration(3720000), '1h 2m');
  assert.equal(decisionsNote(0), null);
  assert.equal(decisionsNote(1), '1 decision recorded');
  assert.equal(decisionsNote(3), '3 decisions recorded');
});

test('only callbacks fired since the last look are new, and the toast names the decision', () => {
  const hits = newCallbacks(new Set(['D-001:edit']), { 'D-001:edit': 'x', 'D-003:failure': 'y' });
  assert.deepEqual(hits, [{ key: 'D-003:failure', id: 'D-003', trigger: 'failure' }]);
  assert.equal(
    callbackToast('D-003', 'Money is stored as integer cents.', 'edit', 'src/pay.ts'),
    '◆ Senior · src/pay.ts is linked to decision D-003. Money is stored as integer cents.',
  );
});

test('the welcome line reads the same for an empty and a full ledger', () => {
  assert.deepEqual(welcomeParts(0), { words: 'Senior is beside you · No decisions on record yet · ', command: '/senior:design' });
  assert.deepEqual(welcomeParts(4), { words: 'Senior is beside you · 4 decisions on record · ', command: '/senior:story' });
});

test('paths follow the rules of core/paths.mjs and core/sessions.mjs', () => {
  for (const id of ['abc/def:1', 'b32efbf8-d5d8-46d1', '']) assert.equal(safeId(id), coreSafeId(id));
  assert.equal(parentDir('C:/Users/SWAGAT PATEL'), 'C:/Users');
  assert.equal(parentDir('C:/Users'), 'C:/');
  assert.equal(parentDir('C:/'), null);
  assert.equal(sameKey('C:\\Users\\SWAGAT PATEL\\'), sameKey('c:/users/swagat patel'));
  assert.equal(sameKey('/home/Swagat/'), '/home/Swagat');
});

test('the UI module is optional: hooks.json keeps every classic hook beside it', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../plugin/hooks/hooks.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.modules, ['../ui/register.mjs']);
  for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure']) {
    assert.ok(config.hooks[event]?.length, `${event} must stay a classic hook`);
  }
});
