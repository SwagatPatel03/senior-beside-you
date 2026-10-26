// The drawn pieces of Senior's look, run in Claude Code's own test kit: npm run test:ui.

import { expect, test } from 'claude-code/testing';

test('the terminal spinner shows the mark and Senior words in place of Claude Code\'s word', async ($) => {
  const props = { word: 'Lollygagging', message: null, suffix: '…', mode: 'thinking' };
  const ui = await $.ui.mount({ plugin: 'senior', surface: 'terminal', component: 'Spinner', props });
  expect(await ui.find({ type: 'Text', text: '◆' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: 'Thinking it through…' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /Lollygagging/ })).toBeUndefined();
  await ui.unmount();
});

test('the end of a turn says how long it took', async ($) => {
  const ui = await $.ui.mount({ plugin: 'senior', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 14200 } });
  expect(await ui.find({ type: 'Text', text: 'Done in 14s' })).toBeDefined();
  await ui.unmount();
});

test('the footer shows the mark beside the modes Claude Code already shows', async ($) => {
  const ui = await $.ui.mount({ plugin: 'senior', surface: 'terminal', component: 'SessionMode', props: { modes: ['focus'] } });
  expect(await ui.find({ type: 'Text', text: 'focus · ' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: ' senior' })).toBeDefined();
  await ui.unmount();
});

test('outside the terminal Claude Code draws its own spinner, turn line and footer', async ($, on) => {
  // Stands for Claude Code's own drawing beneath the plugin.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e);
    return h(Text, null, `engine ${e.component}`);
  });
  const pieces = [
    { component: 'Spinner', props: { word: 'Lollygagging', message: null, suffix: '…', mode: 'thinking' } },
    { component: 'TurnDuration', props: { word: 'Baked', durationMs: 3000 } },
    { component: 'SessionMode', props: { modes: [] } },
  ];
  for (const surface of ['desktop', 'vscode']) {
    for (const piece of pieces) {
      if (surface === 'vscode' && piece.component !== 'Spinner') continue;
      const ui = await $.ui.mount({ plugin: 'senior', surface, ...piece });
      expect(await ui.find({ type: 'Text', text: `engine ${piece.component}` })).toBeDefined();
      expect(await ui.find({ type: 'Text', text: '◆' })).toBeUndefined();
      await ui.unmount();
    }
  }
});
