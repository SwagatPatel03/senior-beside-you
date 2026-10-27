import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLearning, maskBlanks, teachingOf, traceFor, traceLines, expectedOf, type Piece } from '../../src/guide/text.ts';

const piece = (extra: Partial<Piece> = {}): Piece => ({
  file: 'src/main/java/com/example/seats/SeatService.java',
  kind: 'spine',
  where: 'end',
  text: '        if (seat.isHeld(now)) {\n            throw new SeatTaken(seatId);\n        }',
  why: 'Refuse a seat that is already held.',
  ...extra,
});

test('a piece fades with the level, and only spine pieces fade', () => {
  assert.equal(traceFor(piece()), 'full', 'no level: traced in full, as before levels');
  assert.equal(traceFor(piece({ level: 0 })), 'full');
  assert.equal(traceFor(piece({ level: 3 })), 'shape');
  assert.equal(traceFor(piece({ level: 4 })), 'first');
  assert.equal(traceFor(piece({ level: 5 })), 'none');
  assert.equal(traceFor(piece({ level: 7 })), 'full');
  assert.equal(traceFor(piece({ level: 3, trace: 'full' })), 'full', 'the planner can trace a new pattern in full');
  assert.equal(traceFor(piece({ level: 5, kind: 'probe' })), 'full', 'a probe tests a guess and is always shown');
});

test('below level 7 the user is learning and types every piece', () => {
  assert.equal(isLearning({ level: 0 }), true);
  assert.equal(isLearning({ level: 6 }), true);
  assert.equal(isLearning({ level: 7 }), false);
  assert.equal(isLearning({}), false);
});

test('blanks hide names behind their hints, and never the rest of the line', () => {
  const blanks = [
    { text: 'isHeld', hint: 'is it held?' },
    { text: 'SeatTaken', hint: 'the seat-taken error' },
  ];
  assert.equal(maskBlanks('if (seat.isHeld(now)) {', blanks), 'if (seat.⟨is it held?⟩(now)) {');
  assert.equal(maskBlanks('throw new SeatTaken(seatId);', blanks), 'throw new ⟨the seat-taken error⟩(seatId);');
  // Halfway through a name, the user is already typing it from memory: the rest is not hidden again.
  const expected = expectedOf('if (seat.isHeld(now)) {');
  const [line] = traceLines('if (seat.isH', expected, 0, 'if (seat.isH'.length);
  assert.equal(maskBlanks(line.trace.map((t) => t.text).join(''), blanks), 'eld(now)) {');
});

test('the panel gets what a piece teaches, and nothing empty', () => {
  assert.equal(teachingOf(piece({ kind: 'flesh' })), undefined);
  const zero = teachingOf(piece({ tech: 'java', level: 0, words: [{ text: 'if', meaning: 'Run the block only when the test is true.' }], concept: { title: 'Choosing with if', text: 'An if asks a yes-or-no question.' }, todo: [] }), 'Java');
  assert.deepEqual(Object.keys(zero ?? {}).sort(), ['concept', 'level', 'tech', 'techName', 'trace', 'words']);
  assert.equal(zero?.trace, 'full');
  const five = teachingOf(piece({ tech: 'java', level: 5, todo: ['If the seat is held, throw SeatTaken.'], names: ['SeatTaken'] }), 'Java');
  assert.equal(five?.trace, 'none');
  assert.deepEqual(five?.names, ['SeatTaken']);
});
