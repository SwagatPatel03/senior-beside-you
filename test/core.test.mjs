import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { computeCallbacks, describeTouch } from '../plugin/core/callbacks.mjs';
import { activeEntries, addEntry, entriesTouching, linkEntry, loadLedger, searchEntries, validateEntry, warningsFor } from '../plugin/core/ledger.mjs';
import { matchesAny, pathsInText, toRel } from '../plugin/core/paths.mjs';
import { formatTopicList, loadRegrets, showTopics } from '../plugin/core/regrets.mjs';

function tempProject() {
  // A space in the folder name, as in many Windows home folders, catches quoting bugs.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'senior test '));
  fs.mkdirSync(path.join(root, '.senior', 'ledger'), { recursive: true });
  return root;
}

const booking = {
  title: 'Bookings are atomic',
  reversibility: 'one-way',
  chosen: 'A unique index on the slot',
  why: 'The database sees every request at once.',
  guards: 'Double bookings',
  payoff: 'When two people book the last slot together',
  files: ['src/bookings/**'],
  symbols: ['create_booking'],
};

test('globs match project-relative paths', () => {
  assert.ok(matchesAny('src/bookings/models.py', ['src/bookings/**']));
  assert.ok(matchesAny('src/bookings/models.py', ['src/bookings']));
  assert.ok(matchesAny('src/bookings.py', ['src/*.py']));
  assert.ok(matchesAny('a/b/c/export.ts', ['**/export.ts']));
  assert.ok(matchesAny('export.ts', ['**/export.ts']));
  assert.ok(!matchesAny('src/bookingsx/models.py', ['src/bookings']));
  assert.ok(!matchesAny('src/other.py', ['src/bookings/**']));
});

test('paths are normalised from absolute Windows-style input', () => {
  const root = tempProject();
  const abs = path.join(root, 'src', 'bookings', 'models.py');
  assert.equal(toRel(root, abs), 'src/bookings/models.py');
  assert.equal(toRel(root, abs.replace(/\//g, '\\')), 'src/bookings/models.py');
  assert.equal(toRel(root, path.join(os.tmpdir(), 'elsewhere.py')), null);
});

test('paths are found inside stack traces even when the root has a space', () => {
  const root = tempProject();
  const trace = `Traceback (most recent call last):\n  File "${path.join(root, 'src', 'bookings', 'service.py')}", line 12, in create_booking\nAssertionError`;
  assert.deepEqual(pathsInText(root, trace), ['src/bookings/service.py']);
  const jsonEscaped = JSON.stringify({ stderr: trace });
  assert.ok(pathsInText(root, jsonEscaped).includes('src/bookings/service.py'));
  assert.ok(pathsInText(root, 'FAIL tests/export.test.ts > streams rows').includes('tests/export.test.ts'));
  // Node writes stack frames as file URLs, with the space as %20. Found in the first live test.
  const url = `file:///${path.join(root, 'src', 'bookings.mjs').replace(/\\/g, '/').replace(/^\//, '').replace(/ /g, '%20')}`;
  assert.deepEqual(pathsInText(root, `    at createBooking (${url}:3:22)`), ['src/bookings.mjs']);
});

test('ledger validates, numbers, links and supersedes decisions', () => {
  const root = tempProject();
  assert.ok(validateEntry({ title: 'x' }).length > 0);
  assert.ok(validateEntry({ ...booking, reversibility: 'maybe' }).some((p) => p.includes('one-way')));
  assert.throws(() => addEntry(root, { title: 'only a title' }), /not recorded/);

  const first = addEntry(root, booking);
  assert.equal(first.id, 'D-001');
  assert.ok(warningsFor(first).some((w) => w.includes('independentReview')));

  const second = addEntry(root, { title: 'Store times in UTC', reversibility: 'two-way', chosen: 'timestamptz', why: 'Zones differ.' });
  assert.equal(second.id, 'D-002');
  linkEntry(root, 'D-002', { files: ['.\\src\\time.py'], symbols: ['to_utc'] });
  assert.deepEqual(loadLedger(root)[1].files, ['src/time.py']);

  const replacement = addEntry(root, { title: 'Bookings use a row lock', reversibility: 'one-way', chosen: 'SELECT FOR UPDATE', why: 'Capacity is more than one.' }, { supersedes: 'D-001' });
  assert.equal(replacement.supersedes, 'D-001');
  assert.deepEqual(replacement.files, ['src/bookings/**'], 'a replacement keeps the old code links');
  const all = loadLedger(root);
  assert.equal(all.find((e) => e.id === 'D-001').status, 'superseded');
  assert.equal(all.find((e) => e.id === 'D-001').supersededBy, 'D-003');
  assert.deepEqual(activeEntries(root).map((e) => e.id), ['D-002', 'D-003']);
  assert.throws(() => addEntry(root, booking, { supersedes: 'D-001' }), /already superseded/);
});

test('ledger search finds decisions by path, symbol, id and words', () => {
  const root = tempProject();
  addEntry(root, booking);
  const entries = loadLedger(root);
  assert.equal(searchEntries(entries, 'src/bookings/models.py')[0].id, 'D-001');
  assert.equal(searchEntries(entries, 'create_booking')[0].id, 'D-001');
  assert.equal(searchEntries(entries, 'd-001')[0].id, 'D-001');
  assert.equal(searchEntries(entries, 'why a unique index?')[0].id, 'D-001');
  assert.equal(searchEntries(entries, 'kafka').length, 0);
  assert.equal(entriesTouching(entries, { text: 'recreate_booking()' }).length, 0, 'symbols match whole words only');
});

test('callbacks fire once per decision per session, and never for fresh decisions', () => {
  const root = tempProject();
  addEntry(root, booking, { now: new Date('2026-10-18T10:00:00Z') });
  const entries = activeEntries(root);
  const edit = {
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: path.join(root, 'src', 'bookings', 'service.py'), old_string: 'a', new_string: 'b' },
  };

  let state = { startedAt: '2026-10-20T09:00:00Z', fired: {} };
  let result = computeCallbacks({ touch: describeTouch(root, edit), entries, state });
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].trigger, 'edit');

  result = computeCallbacks({ touch: describeTouch(root, edit), entries, state: result.state });
  assert.equal(result.hits.length, 0, 'the same decision does not fire twice in a session');

  const failure = {
    hook_event_name: 'PostToolUseFailure',
    tool_name: 'Bash',
    tool_input: { command: 'pytest' },
    error: 'FAILED tests/test_x.py::test_last_slot - AssertionError in create_booking',
  };
  result = computeCallbacks({ touch: describeTouch(root, failure), entries, state: result.state });
  assert.equal(result.hits.length, 1, 'a failure is a separate trigger from an edit');
  assert.equal(result.hits[0].trigger, 'failure');

  state = { startedAt: '2026-10-17T09:00:00Z', fired: {} };
  result = computeCallbacks({ touch: describeTouch(root, edit), entries, state });
  assert.equal(result.hits.length, 0, 'a decision made during this session is too fresh to call back');
});

test('a symbol written into another file links the edit to the decision', () => {
  const root = tempProject();
  addEntry(root, booking, { now: new Date('2026-10-18T10:00:00Z') });
  const write = {
    hook_event_name: 'PostToolUse',
    tool_name: 'Write',
    tool_input: { file_path: path.join(root, 'src', 'api', 'routes.py'), content: 'from bookings import create_booking\n' },
  };
  const { hits } = computeCallbacks({ touch: describeTouch(root, write), entries: activeEntries(root), state: { startedAt: '2026-10-20T00:00:00Z', fired: {} } });
  assert.deepEqual(hits[0].reasons, ['create_booking']);
});

test('successful commands are recorded but never fire callbacks', () => {
  const root = tempProject();
  const ok = { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls src/bookings' }, tool_response: { stdout: 'service.py', stderr: '' } };
  assert.equal(describeTouch(root, ok).kind, 'command');
});

test('the regret library loads, lists and can be switched off', () => {
  const topics = loadRegrets(null);
  const names = topics.map((t) => t.topic);
  for (const expected of ['bookings', 'time', 'payments', 'file-uploads', 'database', 'exports', 'background-jobs', 'auth', 'permissions', 'retries']) {
    assert.ok(names.includes(expected), `seed topic ${expected} exists`);
  }
  for (const t of topics) {
    assert.ok(t.entries.length >= 3, `${t.topic} has entries`);
    for (const e of t.entries) assert.match(e.id, /^R-[\w-]+-\d+$/, `${t.topic} entry ids are well formed`);
  }
  assert.match(showTopics(topics, ['R-payments-01']), /arrive twice/);
  assert.match(formatTopicList(topics), /R-database-01/);

  process.env.SENIOR_REGRETS = 'off';
  try {
    assert.equal(loadRegrets(null).length, 0);
    assert.match(formatTopicList([]), /switched off/);
  } finally {
    delete process.env.SENIOR_REGRETS;
  }
});

test('held-out foresight traps stay out of the seed library', () => {
  // These traps measure whether the senior generalises beyond the library. If one is added
  // to the library, move it out of evals/foresight/tasks/held-out or this test will catch it.
  const text = loadRegrets(null)
    .flatMap((t) => t.entries.map((e) => e.text))
    .join('\n')
    .toLowerCase();
  for (const phrase of ['soft delete', 'soft-delete', 'offset pagination', 'rolled back', 'rollback', 'after commit', 'on_commit']) {
    assert.ok(!text.includes(phrase), `the seed library must not mention "${phrase}"`);
  }
});
