import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Decision } from '../../../../plugin/core/index.mjs';
import { decisionDetail, groupTitle, hoverMarkdown, md, placeDecisions, shortName } from '../../src/decisions/text.ts';

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

const reserve = ["import { db } from '../db';", '', 'export async function reserveSlot(memberId, classId, slotStart) {', '  return db.booking.create({ memberId, classId, slotStart });', '}', ''].join('\n');
const places = [{ name: 'reserveSlot', line: 2, character: 22 }];

test('a decision with a linked symbol shows above the place the symbol is defined', () => {
  const d = decision({ id: 'D-004', files: ['src/bookings/reserve.ts'], symbols: ['reserveSlot'] });
  const placed = placeDecisions([d], 'src/bookings/reserve.ts', reserve, places);
  assert.deepEqual(placed.map((p) => [p.line, p.character, p.symbol, p.decisions.map((x) => x.id)]), [[2, 22, 'reserveSlot', ['D-004']]]);
});

test('a symbol that appears several times shows once, above its first definition', () => {
  const d = decision({ id: 'D-004', files: ['src/bookings/reserve.js'], symbols: ['reserveSlot'] });
  const exported = [
    { name: 'reserveSlot', line: 6, character: 19, property: true },
    { name: 'reserveSlot', line: 2, character: 15 },
    { name: 'reserveSlot', line: 9, character: 2 },
  ];
  assert.deepEqual(placeDecisions([d], 'src/bookings/reserve.js', reserve, exported).map((p) => [p.line, p.character]), [[2, 15]]);
  // When the only places are properties, the first of them is used.
  const onlyKeys = [{ name: 'reserveSlot', line: 6, character: 19, property: true }];
  assert.deepEqual(placeDecisions([d], 'src/bookings/reserve.js', reserve, onlyKeys).map((p) => p.line), [6]);
});

test('a decision linked only by path shows at the top of the file, globs included', () => {
  const d = decision({ id: 'D-002', files: ['src/bookings/**'] });
  const placed = placeDecisions([d], 'src/bookings/reserve.ts', reserve, places);
  assert.deepEqual(placed.map((p) => [p.line, p.character, p.symbol]), [[0, 0, undefined]]);
  assert.deepEqual(placeDecisions([d], 'src/other.ts', reserve, places), []);
});

test('a symbol that is only used in another file does not show there', () => {
  const d = decision({ id: 'D-004', files: ['src/bookings/reserve.ts'], symbols: ['reserveSlot'] });
  const caller = "import { reserveSlot } from './bookings/reserve';\nawait reserveSlot(a, b, c);\n";
  assert.deepEqual(placeDecisions([d], 'src/routes.ts', caller, [{ name: 'handler', line: 1, character: 0 }]), []);
  // Without a symbol provider, an unlinked file never guesses from a name.
  assert.deepEqual(placeDecisions([d], 'src/routes.ts', caller, null), []);
});

test('without a symbol provider, a linked file uses the first line that names the symbol', () => {
  const d = decision({ id: 'D-004', files: ['src/bookings/reserve.ts'], symbols: ['reserveSlot'] });
  const placed = placeDecisions([d], 'src/bookings/reserve.ts', reserve, null);
  assert.deepEqual(placed.map((p) => [p.line, p.character]), [[2, 22]]);
});

test('a linked file whose symbol is not defined in it shows the decision at the top instead', () => {
  const d = decision({ id: 'D-004', files: ['src/bookings/reserve.ts'], symbols: ['cancelBooking'] });
  const placed = placeDecisions([d], 'src/bookings/reserve.ts', reserve, places);
  assert.deepEqual(placed.map((p) => p.line), [0]);
});

test('replaced decisions do not show, and decisions on one line are grouped in id order', () => {
  const old = decision({ id: 'D-004', status: 'superseded', supersededBy: 'D-009', symbols: ['reserveSlot'] });
  const b = decision({ id: 'D-011', symbols: ['reserveSlot'] });
  const a = decision({ id: 'D-009', symbols: ['reserveSlot'], supersedes: 'D-004' });
  const placed = placeDecisions([old, b, a], 'src/bookings/reserve.ts', reserve, places);
  assert.equal(placed.length, 1);
  assert.deepEqual(placed[0].decisions.map((x) => x.id), ['D-009', 'D-011']);
  assert.equal(groupTitle(placed[0]), '2 decisions are about reserveSlot.');
});

test('symbol names match on their last part', () => {
  assert.equal(shortName('Cart.total'), 'total');
  assert.equal(shortName('total()'), 'total');
  assert.equal(shortName('billing::Invoice::issue'), 'issue');
  // In a linked file, `Bookings.reserveSlot` is placed at the definition of `reserveSlot`.
  const d = decision({ files: ['x.ts'], symbols: ['Bookings.reserveSlot'] });
  assert.deepEqual(placeDecisions([d], 'x.ts', reserve, places).map((p) => p.line), [2]);
  // Elsewhere, as for callbacks, a symbol must be named as it was linked, so a common short name
  // such as `total` never pulls a decision into an unrelated file.
  assert.deepEqual(placeDecisions([decision({ symbols: ['Bookings.reserveSlot'] })], 'y.ts', reserve, places), []);
});

test('the hover card shows the parts a reader needs, escaped, with a link to the full record', () => {
  const old = decision({ id: 'D-004', status: 'superseded', supersededBy: 'D-009', chosen: 'A unique rule in the database' });
  const d = decision({
    id: 'D-009',
    title: 'Hold a spot for *ten* minutes',
    reversibility: 'one-way',
    supersedes: 'D-004',
    chosen: 'Hold the spot while the member pays',
    why: 'Members lost spots while paying.',
    rejected: [{ option: 'Charge first', why: 'Refunds are slow.' }],
    guards: 'Losing a spot mid-payment',
    payoff: 'A slow card payment',
  });
  const text = hoverMarkdown(d, [old, d], 'C:/Users/Some One/gym');
  assert.match(text, /^\*\*D\\-009\*\* · Hard to undo · Still in force/);
  assert.match(text, /\*\*Hold a spot for \\\*ten\\\* minutes\*\*/);
  for (const part of ['What we chose', 'Why', 'What we turned down', 'It protects against', 'When you will see it matter', 'What changed']) {
    assert.ok(text.includes(`**${part}**`), part);
  }
  assert.match(text, /- \*\*Charge first\.\*\* Refunds are slow\\\./);
  assert.match(text, /Before, D\\-004 chose this: A unique rule in the database/);
  const link = /\(command:senior\.showDecision\?([^)]+)\)/.exec(text);
  assert.ok(link);
  assert.deepEqual(JSON.parse(decodeURIComponent(link[1])), ['D-009', 'C:/Users/Some One/gym']);
  assert.equal(md('a_b [c](d)'), 'a\\_b \\[c\\]\\(d\\)');
});

test('the full record holds every field, the history from session records, and the stored JSON', () => {
  const old = decision({ id: 'D-004', title: 'Unique rule', chosen: 'A unique rule', status: 'superseded', supersededBy: 'D-009', supersededAt: '2026-10-22T12:00:00.000Z' });
  const d = decision({
    id: 'D-009',
    supersedes: 'D-004',
    feature: 'class-booking',
    files: ['src/bookings/payments.ts', 'db/migrations/*.sql'],
    symbols: ['holdSlot'],
    examples: ['Two people press Book together.'],
    regrets: ['double-booking'],
    checks: { regretLibrary: 'applies and is avoided', openSource: 'skipped: no web search' },
  });
  const sessions = [
    {
      id: 's1',
      startedAt: '',
      endedAt: '',
      events: [
        { at: '2026-10-24T12:00:00.000Z', type: 'callback', decision: 'D-009', trigger: 'failure', reasons: ['holdSlot'] },
        { at: '2026-10-23T12:00:00.000Z', type: 'callback', decision: 'D-009', trigger: 'edit', reasons: ['src/bookings/payments.ts'] },
        { at: '2026-10-23T12:00:00.000Z', type: 'callback', decision: 'D-001', trigger: 'edit', reasons: ['x'] },
      ],
    },
  ];
  const detail = decisionDetail(d, [old, d], sessions, '.senior/ledger/D-009-hold.json');
  assert.equal(detail.undo, 'Easy to undo');
  assert.deepEqual(detail.replaces, { id: 'D-004', title: 'Unique rule', chosen: 'A unique rule' });
  assert.deepEqual(detail.files, [
    { path: 'src/bookings/payments.ts', open: true },
    { path: 'db/migrations/*.sql', open: false },
  ]);
  assert.deepEqual(detail.checks, [
    { label: 'The regret library', result: 'applies and is avoided' },
    { label: 'Established practice', result: 'skipped: no web search' },
  ]);
  assert.deepEqual(detail.history, [
    'Decided on 12 October 2026, for the feature "class-booking".',
    'It replaced D-004, "Unique rule".',
    'On 23 October 2026, an edit touched src/bookings/payments.ts, and the senior brought this decision back.',
    'On 24 October 2026, a failing command named holdSlot, and the senior brought this decision back.',
  ]);
  assert.deepEqual(JSON.parse(detail.record.json), JSON.parse(JSON.stringify(d)));

  const oldDetail = decisionDetail(old, [old, d], [], '.senior/ledger/D-004.json');
  assert.equal(oldDetail.replacedBy, 'D-009');
  assert.deepEqual(oldDetail.history.slice(1), ['No session recorded on this computer has brought it back yet.', 'On 22 October 2026, it was replaced by D-009.']);
});
