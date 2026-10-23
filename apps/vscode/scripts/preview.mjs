// Serves the Senior panel outside VS Code, with VS Code's theme colours and a sample session, for
// working on the design. Run `npm run build`, then `npm run preview`, and open the printed address.
// Add ?theme=light for the light theme, and ?state=welcome, watch or diverged for the other states.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', 'dist');

const THEMES = {
  dark: {
    class: 'vscode-dark',
    vars: {
      '--vscode-foreground': '#cccccc',
      '--vscode-descriptionForeground': '#9d9d9d',
      '--vscode-sideBar-background': '#181818',
      '--vscode-editor-background': '#1f1f1f',
      '--vscode-focusBorder': '#0078d4',
      '--vscode-font-family': '"Segoe UI", system-ui, sans-serif',
      '--vscode-editor-font-family': 'Consolas, "Courier New", monospace',
      '--vscode-button-secondaryForeground': '#cccccc',
      '--vscode-button-secondaryBackground': '#313131',
      '--vscode-button-secondaryHoverBackground': '#3c3c3c',
      '--vscode-textLink-foreground': '#4daafc',
      '--vscode-textLink-activeForeground': '#4daafc',
      '--vscode-input-foreground': '#cccccc',
      '--vscode-input-background': '#313131',
      '--vscode-input-border': '#3c3c3c',
      '--vscode-input-placeholderForeground': '#989898',
      '--vscode-textCodeBlock-background': '#2b2b2b',
      '--vscode-scrollbarSlider-background': '#79797966',
      '--vscode-scrollbarSlider-hoverBackground': '#646464b3',
      '--vscode-scrollbarSlider-activeBackground': '#bfbfbf66',
    },
  },
  light: {
    class: 'vscode-light',
    vars: {
      '--vscode-foreground': '#3b3b3b',
      '--vscode-descriptionForeground': '#717171',
      '--vscode-sideBar-background': '#f8f8f8',
      '--vscode-editor-background': '#ffffff',
      '--vscode-focusBorder': '#005fb8',
      '--vscode-font-family': '"Segoe UI", system-ui, sans-serif',
      '--vscode-editor-font-family': 'Consolas, "Courier New", monospace',
      '--vscode-button-secondaryForeground': '#3b3b3b',
      '--vscode-button-secondaryBackground': '#e5e5e5',
      '--vscode-button-secondaryHoverBackground': '#cccccc',
      '--vscode-textLink-foreground': '#005fb8',
      '--vscode-textLink-activeForeground': '#005fb8',
      '--vscode-input-foreground': '#3b3b3b',
      '--vscode-input-background': '#ffffff',
      '--vscode-input-border': '#cecece',
      '--vscode-input-placeholderForeground': '#767676',
      '--vscode-textCodeBlock-background': '#f0f0f0',
      '--vscode-scrollbarSlider-background': '#64646466',
      '--vscode-scrollbarSlider-hoverBackground': '#646464b3',
      '--vscode-scrollbarSlider-activeBackground': '#00000099',
    },
  },
};

// The scrollbar styles VS Code gives every webview, so the preview scrolls the way the panel does.
const WEBVIEW_DEFAULTS = `
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-corner { background-color: transparent; }
::-webkit-scrollbar-thumb { background-color: var(--vscode-scrollbarSlider-background); }
::-webkit-scrollbar-thumb:hover { background-color: var(--vscode-scrollbarSlider-hoverBackground); }
::-webkit-scrollbar-thumb:active { background-color: var(--vscode-scrollbarSlider-activeBackground); }`;

const at = (min) => new Date(Date.now() - min * 60000).toISOString();

const SAMPLE = {
  gear: 'type',
  workspace: '/projects/gym',
  readAloud: false,
  replay: null,
  replays: [
    { id: '2026-10-22-retry-the-payment-call-safely-k2x9', title: 'Retry the payment call safely', createdAt: new Date().toISOString(), scenes: 4 },
  ],
  step: { index: 2, total: 5, title: 'Make a booking atomic', why: 'Two members can tap Book on the last place at the same moment.', expect: 'The race test passes.', feature: 'gym-bookings' },
  stats: { typed: 14, accepted: 3, watched: 0, filled: 31, steps: 1, takeaways: 1 },
  connection: { lastCallSecondsAgo: 4, claudeFound: true, pluginInstalled: true },
  active: { index: 1, total: 3, kind: 'spine', file: 'src/bookings/service.py', why: 'The database, not our code, decides who gets the last place.', watching: false },
  journal: [
    { id: 'e1', at: at(9), kind: 'summary', summary: 'The examples are now tests, and all three fail because booking does not exist yet.', verified: ['pytest: 3 failed, as expected'], notVerified: [], takeaway: 'A failing test is the cheapest way to say what done means.' },
    { id: 'e2', at: at(8), kind: 'step', step: { index: 2, total: 5, title: 'Make a booking atomic', why: 'Two members can tap Book on the last place at the same moment. The database has to be the one that says no.', expect: 'The race test passes.' } },
    { id: 'e3', at: at(8), kind: 'narration', text: 'Next we add the booking function. You write the part that asks the database for the place; I fill in the imports and the error message.' },
    { id: 'e4', at: at(7), kind: 'pieces', pieces: [
      { index: 0, kind: 'flesh', file: 'src/bookings/service.py', why: 'Imports and the error type.', lines: 4, status: 'filled' },
      { index: 1, kind: 'spine', file: 'src/bookings/service.py', why: 'The database, not our code, decides who gets the last place.', lines: 5, status: 'active' },
      { index: 2, kind: 'flesh', file: 'src/bookings/service.py', why: 'Turn the database error into a message members understand.', lines: 3, status: 'waiting' },
    ] },
    { id: 'e5', at: at(5), kind: 'question', text: 'Why not check if the slot is free first?', where: 'src/bookings/service.py:14: def book(member, slot):', answered: true },
    { id: 'e6', at: at(5), kind: 'answer', text: 'Because two requests can both see the slot as free before either one saves. The unique index means the second insert fails, whatever order they arrive in.', replyTo: 'e5' },
    { id: 'e7', at: at(3), kind: 'callback', text: 'On day one we chose a unique index for confirmed bookings (D-001). This line is where that choice does its work.' },
    { id: 'e8', at: at(2), kind: 'check', command: 'pytest tests/test_bookings.py -k race', expected: 'One booking succeeds and the other is told the slot is taken.', passed: false, output: 'FAILED tests/test_bookings.py::test_last_place_race\nAssertionError: 2 bookings for slot 9' },
    { id: 'e9', at: at(1), kind: 'narration', text: 'That is the race. My guess: the insert and the capacity check are two statements, so both requests pass the check. Let us look at what each request saw.' },
  ],
};

const STATES = {
  session: SAMPLE,
  welcome: {
    ...SAMPLE,
    step: null,
    active: null,
    journal: [],
    stats: { typed: 0, accepted: 0, watched: 0, filled: 0, steps: 0, takeaways: 0 },
    connection: { lastCallSecondsAgo: null, claudeFound: true, pluginInstalled: false },
  },
  watch: { ...SAMPLE, gear: 'watch', active: { ...SAMPLE.active, watching: true } },
  replay: {
    ...SAMPLE,
    active: null,
    replay: {
      id: '2026-10-22-retry-the-payment-call-safely-k2x9',
      title: 'Retry the payment call safely',
      task: 'Checkout fails when the payment provider times out. Make it retry before the demo tomorrow.',
      index: 1,
      scenes: [
        { title: 'Where the timeout comes from', kind: 'build', narration: 'The checkout calls the provider once and gives up after five seconds.', decisions: [], files: [] },
        {
          title: 'A timeout is not a failure',
          kind: 'bug',
          narration: 'The first guess was a slow network, so the retry went in first. The logs showed the provider had already taken the money on the timed-out call. A plain retry would charge the customer twice.',
          decisions: [{ id: 'D-004', title: 'Every payment request carries an idempotency key' }],
          files: [{ path: 'src/payments/client.py', change: 'changed' }],
        },
        { title: 'The retry, made safe', kind: 'decision', narration: 'The retry sends the same key each time.', decisions: [], files: [] },
        { title: 'What the tests show', kind: 'check', narration: 'Two tests cover it.', decisions: [], files: [] },
      ],
      skipped: ['A test against the real provider sandbox. A key the provider rejects would only show up in production.'],
      verified: ['pytest tests/test_payments.py: 6 passed'],
      notVerified: ['Retries under a real network timeout'],
    },
    replays: [],
  },
  diverged: {
    ...SAMPLE,
    active: { ...SAMPLE.active, diverged: { wrote: 'if slot.is_free(): bookings.add(member, slot)', wanted: 'bookings.insert(member, slot)' } },
  },
};

function page(theme, state) {
  const t = THEMES[theme] ?? THEMES.dark;
  const vars = Object.entries(t.vars).map(([k, v]) => `${k}: ${v};`).join(' ');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Senior panel preview</title>
<link rel="stylesheet" href="/webview.css">
<style>${WEBVIEW_DEFAULTS}
html { ${vars} } body { width: 340px; margin: 0 auto; border-left: 1px solid #8884; border-right: 1px solid #8884; }</style>
<script>
  window.acquireVsCodeApi = () => ({ postMessage: (m) => {
    console.log('to extension', m);
    if (m.type === 'ready') window.postMessage({ type: 'state', state: ${JSON.stringify(STATES[state] ?? SAMPLE)} }, '*');
  } });
</script></head>
<body class="${t.class}"><div id="app"></div><script type="module" src="/webview.js"></script></body></html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html' }).end(page(url.searchParams.get('theme') || 'dark', url.searchParams.get('state') || 'session'));
    return;
  }
  const file = path.join(dist, path.basename(url.pathname));
  if (!fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css' : 'text/javascript' }).end(fs.readFileSync(file));
});

server.listen(Number(process.env.PORT) || 5317, '127.0.0.1', () => {
  console.log(`Senior panel preview: http://127.0.0.1:${server.address().port}/  (add ?theme=light for the light theme)`);
});
