import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expectedOf, findAnchor, ghostText, locate, progress, remainder, squash, writtenLineCount, type Piece } from '../../src/guide/text.ts';

const apply = (text: string, piece: Piece, eol = '\n') => {
  const at = locate(text, piece, eol);
  assert.ok(at.ok, at.ok ? '' : at.reason);
  return { text: text.slice(0, at.span.start) + at.insert + text.slice(at.span.end), at };
};

const file = ['import csv', '', 'def export(rows):', '    out = []', '    return out', ''].join('\n');

test('anchors are found exactly, then line by line ignoring indentation', () => {
  assert.deepEqual(findAnchor(file, 'def export(rows):', '\n'), { start: 12, end: 29 });
  assert.match((findAnchor(file, 'missing', '\n') as { error: string }).error, /not found/);
  assert.match((findAnchor('a\na\n', 'a', '\n') as { error: string }).error, /more than once/);
  const loose = findAnchor(file, 'out = []\n  return out', '\n');
  assert.ok(!('error' in loose));
  assert.equal(file.slice(loose.start, loose.end), '    out = []\n    return out');
});

test('flesh pieces insert their text after, before, at either end, or in place of an anchor', () => {
  const after = apply(file, { file: 'x', kind: 'flesh', where: 'after', anchor: 'import csv', text: 'import io\n', why: '' });
  assert.equal(after.text.split('\n').slice(0, 3).join('|'), 'import csv|import io|');

  const before = apply(file, { file: 'x', kind: 'flesh', where: 'before', anchor: 'def export(rows):', text: '# Export\n', why: '' });
  assert.match(before.text, /\n# Export\ndef export/);

  const start = apply(file, { file: 'x', kind: 'flesh', where: 'start', text: '"""Reports."""', why: '' });
  assert.ok(start.text.startsWith('"""Reports."""\nimport csv'));

  const end = apply('a = 1', { file: 'x', kind: 'flesh', where: 'end', text: 'b = 2', why: '' });
  assert.equal(end.text, 'a = 1\nb = 2\n');

  const replace = apply(file, { file: 'x', kind: 'flesh', where: 'replace', anchor: 'out = []', text: 'out = list()', why: '' });
  assert.match(replace.text, /    out = list\(\)\n/);
});

test('spine pieces open an empty slot with the first line\'s indentation', () => {
  const { text, at } = apply(file, { file: 'x', kind: 'spine', where: 'after', anchor: '    out = []', text: '    for row in rows:\n        out.append(row)', why: '' });
  assert.equal(text.slice(at.slotStart, at.slotEnd), '    ');
  assert.equal(text.split('\n')[4], '    ', 'the slot is its own line');
  assert.equal(text.split('\n')[5], '    return out', 'the following code is untouched');

  const replaced = apply(file, { file: 'x', kind: 'spine', where: 'replace', anchor: 'out = []', text: '    out = list(rows)', why: '' });
  assert.equal(replaced.text.split('\n')[3], '    ', 'replace clears the whole line it covers');

  const fresh = apply('', { file: 'x', kind: 'spine', where: 'new_file', text: 'def main():\n    pass', why: '' });
  assert.equal(fresh.text, '\n', 'a new file ends with a line break, with the slot on its first line');
  assert.equal(fresh.at.slotEnd, 0);

  const notEmpty = locate('content', { file: 'x', kind: 'spine', where: 'new_file', text: 'x', why: '' }, '\n');
  assert.ok(!notEmpty.ok);
});

test('Windows line endings are kept', () => {
  const crlf = file.replace(/\n/g, '\r\n');
  const { text } = apply(crlf, { file: 'x', kind: 'flesh', where: 'after', anchor: 'import csv', text: 'import io\nimport os', why: '' }, '\r\n');
  assert.ok(text.startsWith('import csv\r\nimport io\r\nimport os\r\n\r\ndef'));
  assert.ok(!/[^\r]\n/.test(text), 'no bare line feeds were introduced');
});

test('progress ignores whitespace and lines the editor added below the cursor', () => {
  const expected = expectedOf('def f(x):\n    if x:\n        return 1\n    return 0\n');
  assert.deepEqual(progress('def f(x):\n    if x:\n        return 1\n    return 0', expected, 3), { state: 'complete' });
  assert.deepEqual(progress('def  f( x ):\n  if x:\n return 1\n\n    return 0\n', expected, -1), { state: 'complete' });
  assert.deepEqual(progress('def f(x):\n    if', expected, 1), { state: 'writing', line: 1, typed: '    if' });
  // An auto-inserted closing line below the cursor is not a mistake.
  assert.equal(progress('def f(x):\n    \n}', expected, 1).state, 'writing');

  // The editor closed a brace on its own, and the plan has the brace too: the extra one is ignored.
  const js = expectedOf('function total(items) {\n  return items.length;\n}');
  assert.deepEqual(progress('function total(items) {\n  return items.length;\n}\n}', js, 1), { state: 'complete' });
  // The plan stops before the closing brace; the brace the editor added does not block completion.
  assert.deepEqual(progress('if (x) {\n  run();\n}', expectedOf('if (x) {\n  run();'), 1), { state: 'complete' });
  // But a missing planned line still does: after "{" and Enter the cursor waits on the empty middle line.
  assert.deepEqual(progress('function total(items) {\n  \n}', js, 1, 2), { state: 'writing', line: 1, typed: '  ' });
  assert.equal(progress('function total(items) {\n}', js, 1, 0).state, 'writing');

  const wrong = progress('def g(x):\n    ', expected, 1);
  assert.deepEqual(wrong, { state: 'diverged', line: 0, wrote: 'def g(x):', wanted: 'def f(x):' });
  assert.equal(progress('def f(x):\n    while', expected, 1).state, 'diverged');
});

test('ghost text continues the line, and the accept gear shows the rest of the piece', () => {
  const expected = expectedOf('    for row in rows:\n        out.append(row)\n\n    return out');
  assert.equal(remainder('    for row in rows:', 'for r'), 'ow in rows:');
  assert.equal(remainder('x = 1', 'x='), ' 1');
  assert.equal(remainder('x = 1', 'y'), null);

  assert.equal(ghostText(expected, 0, 'for ', 'type'), 'row in rows:');
  assert.equal(ghostText(expected, 1, '', 'type'), 'out.append(row)');
  assert.equal(ghostText(expected, 0, 'for ', 'accept'), 'row in rows:\n        out.append(row)\n\n    return out');
  assert.equal(ghostText(expected, 0, 'while', 'type'), null);
  assert.equal(ghostText(expected, 9, '', 'type'), null);
});

test('helpers', () => {
  assert.equal(squash(' a \t b\n'), 'ab');
  assert.equal(writtenLineCount('a\n\nb\n'), 2);
});
