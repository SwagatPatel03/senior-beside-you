import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Decision, Plan } from '../../../../plugin/core/index.mjs';
import { memoryCount, memoryView, planDecision } from '../../src/decisions/memory.ts';

const decision = (over: Partial<Decision>): Decision => ({
  id: 'D-001',
  title: 'A decision',
  status: 'active',
  reversibility: 'two-way',
  chosen: 'Something',
  rejected: [],
  why: 'Because.',
  guards: '',
  payoff: '',
  files: [],
  symbols: [],
  examples: [],
  regrets: [],
  feature: '',
  created: '2026-10-12T12:00:00.000Z',
  ...over,
});

const plan = (over: Partial<Plan>): Plan => ({
  feature: 'seat-reservations',
  title: 'Seat reservations',
  goal: 'A seat is never given out twice.',
  decisions: [],
  examples: [],
  steps: [],
  createdAt: '2026-10-26T22:00:00.000Z',
  updatedAt: '2026-10-26T22:00:00.000Z',
  ...over,
});

const files = { recordFile: (e: Decision) => `.senior/ledger/${e.id}.json`, brief: (f: string) => `.senior/features/${f}.md` };

test('every decision is on the page, linked to code or not, with the active ones first in id order', () => {
  const ledger = [
    decision({ id: 'D-010', title: 'Ten' }),
    decision({ id: 'D-002', title: 'Old two', status: 'superseded', supersededBy: 'D-003' }),
    decision({ id: 'D-003', title: 'Three', supersedes: 'D-002', files: ['src/a.ts'] }),
    decision({ id: 'D-001', title: 'One' }),
  ];
  const m = memoryView({ ledger, plans: [], sessions: [], ...files });
  assert.deepEqual(
    m.decisions.map((d) => [d.id, d.replacedBy ?? null]),
    [['D-001', null], ['D-003', null], ['D-010', null], ['D-002', 'D-003']],
  );
  // The full record is the same one the code's "Full record" shows.
  assert.equal(m.decisions[0].record.file, '.senior/ledger/D-001.json');
  assert.deepEqual(m.decisions[1].replaces, { id: 'D-002', title: 'Old two', chosen: 'Something' });
  assert.equal(memoryCount(m), '3 decisions');
});

test('a plan becomes a checklist that counts done and skipped steps, and names its decisions by the ledger title', () => {
  const ledger = [decision({ id: 'D-001', title: 'One active reservation per seat' })];
  const p = plan({
    decisions: ['D-001 One active reservation per seat is enforced by a partial index', 'D-009: Not in the ledger', 'Use Maven'],
    examples: ['100 users ask for the last seat: one gets it.'],
    steps: [
      { id: 'S1', title: 'Set up', why: 'A place to prove things.', expect: 'One test passes.', risk: '', files: ['pom.xml'], check: 'mvn -q test', status: 'done', summary: 'The smoke test passes.' },
      { id: 'S2', title: 'Write the tests', why: 'They define done.', expect: 'Five fail.', risk: '', files: [], check: '', status: 'skipped' },
      { id: 'S3', title: 'Schema', why: 'The database enforces it.', expect: 'A second row is refused.', risk: 'Check then insert.', files: [], check: '', status: 'pending' },
    ],
  });
  const m = memoryView({ ledger, plans: [p], sessions: [], ...files });
  const view = m.plans[0];
  assert.deepEqual([view.done, view.total], [2, 3]);
  assert.deepEqual(view.decisions, [
    { id: 'D-001', title: 'One active reservation per seat' },
    { id: 'D-009', title: 'Not in the ledger' },
    { id: '', title: 'Use Maven' },
  ]);
  assert.equal(view.steps[0].summary, 'The smoke test passes.');
  assert.equal(view.steps[2].risk, 'Check then insert.');
  assert.equal(view.brief, '.senior/features/seat-reservations.md');
  assert.equal(memoryCount(m), '1 decision and 1 plan');
});

test('the most recently changed plan comes first, and a step with an unknown status reads as not started', () => {
  const older = plan({ feature: 'a', updatedAt: '2026-10-01T00:00:00.000Z' });
  const newer = plan({ feature: 'b', updatedAt: '2026-10-20T00:00:00.000Z', steps: [{ id: 'S1', title: 'x', why: 'y', expect: 'z', risk: '', files: [], check: '', status: 'paused' as never }] });
  const m = memoryView({ ledger: [], plans: [older, newer], sessions: [], ...files });
  assert.deepEqual(m.plans.map((p) => p.feature), ['b', 'a']);
  assert.equal(m.plans[0].steps[0].status, 'pending');
});

test('a plan decision is matched to the ledger without regard to case', () => {
  assert.deepEqual(planDecision('d-001 lower case', [decision({ id: 'D-001', title: 'From the ledger' })]), { id: 'D-001', title: 'From the ledger' });
});
