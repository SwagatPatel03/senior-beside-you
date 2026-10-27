// Serves the Senior panel outside VS Code, with VS Code's theme colours and a sample session, for
// working on the design. Run `npm run build`, then `npm run preview`, and open the printed address.
// Add ?theme=light for the light theme, and ?state=welcome, watch, diverged or memory for the other states.
// The memory page shows a sample project, or a real one when SENIOR_PREVIEW_PROJECT names its folder.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { briefPath, listPlans, loadLedger, loadPlan, PROFILES, readSessions } from '../../../plugin/core/index.mjs';
import { memoryView } from '../src/decisions/memory.ts';

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
  view: 'session',
  focus: null,
  memory: null,
  gear: 'type',
  workspace: '/projects/gym',
  readAloud: false,
  speech: true,
  activity: { state: 'working', label: 'Reading src/bookings/errors.py', helper: true, since: Date.now() - 7000 },
  replay: null,
  replays: [
    { id: '2026-10-22-retry-the-payment-call-safely-k2x9', title: 'Retry the payment call safely', createdAt: new Date().toISOString(), scenes: 4 },
  ],
  step: { index: 2, total: 5, title: 'Make a booking atomic', why: 'Two members can tap Book on the last place at the same moment.', expect: 'The race test passes.', feature: 'gym-bookings' },
  stats: { typed: 14, accepted: 3, watched: 0, filled: 31, steps: 1, takeaways: 1 },
  connection: { lastCallSecondsAgo: 4, claudeFound: true, pluginInstalled: true },
  active: { index: 1, total: 3, kind: 'spine', file: 'src/bookings/service.py', why: 'The database, not our code, decides who gets the last place.', notice: 'There is no capacity check before the insert; the index is the check.', decision: 'D-001', watching: false },
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
    { id: 'e8', at: at(2), kind: 'check', command: 'pytest tests/test_bookings.py -k race', expected: 'One booking succeeds and the other is told the slot is taken.', passed: false, output: 'FAILED tests/test_bookings.py::test_last_place_race\nAssertionError: 2 bookings for slot 9', evidence: [{ file: 'src/bookings/service.py', line: 18 }, { file: 'tests/test_bookings.py', line: 41 }], risk: 'A check-then-insert lets two members take the last place.' },
    { id: 'e9', at: at(1), kind: 'narration', text: 'That is the race. My guess: the insert and the capacity check are two statements, so both requests pass the check. Let us look at what each request saw.' },
    {
      id: 'e10',
      at: at(0),
      kind: 'explain',
      where: 'src/bookings/service.py:16: return bookings.insert(member, slot)',
      why: 'The database, not our code, decides who gets the last place.',
      notice: 'There is no capacity check before the insert; the index is the check.',
      decisions: [{ id: 'D-001', title: 'Bookings are atomic', chosen: 'A unique index on confirmed bookings per slot', why: 'The database sees every request at once.', rejected: [{ option: 'Check if the slot is free, then insert', why: 'Two requests can pass the check at the same moment.' }] }],
    },
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
  memory: {
    ...SAMPLE,
    view: 'memory',
    active: null,
    step: null,
    memory: {
      plans: [
        {
          feature: 'class-booking',
          title: 'Book a place in a class',
          goal: 'Members book a place in a class, and two members can never hold the same place.',
          done: 1,
          total: 4,
          decisions: [{ id: 'D-001', title: 'Bookings are atomic' }],
          examples: ['Two members press Book for the last place at the same second: one gets it, and the other is told it was just taken.'],
          steps: [
            { id: 'S1', title: 'Set up the project with a passing test', why: 'Every later step needs a place to prove itself.', expect: 'One test passes.', risk: '', files: ['pyproject.toml'], check: 'pytest', status: 'done', summary: 'The smoke test passes.' },
            { id: 'S2', title: 'Turn the examples into failing tests', why: 'They define done.', expect: 'Three tests fail.', risk: '', files: ['tests/test_bookings.py'], check: 'pytest', status: 'pending' },
            { id: 'S3', title: 'Make a booking atomic', why: 'The database must refuse a second booking for one place.', expect: 'The race test passes.', risk: 'A check then insert lets two members take the last place.', files: ['src/bookings/service.py'], check: 'pytest -k race', status: 'pending' },
            { id: 'S4', title: 'Tell the loser kindly', why: 'A refused booking is normal, not an error.', expect: 'The message test passes.', risk: '', files: [], check: '', status: 'pending' },
          ],
          brief: '.senior/features/class-booking.md',
          updatedAt: at(1),
        },
      ],
      decisions: [
        {
          id: 'D-001',
          title: 'Bookings are atomic',
          undo: 'Hard to undo',
          chosen: 'A unique index on confirmed bookings per slot, so the database refuses a second booking for the same place.',
          why: 'Only the database sees two requests that arrive at the same moment. Code that checks first and saves second can be fooled by them.',
          rejected: [
            { option: 'Check if the slot is free, then insert', why: 'Two requests can pass the check at the same moment.' },
            { option: 'Lock the whole class while booking', why: 'Every booking for a busy class would wait in line.' },
          ],
          guards: 'Two members holding the same place in a class.',
          payoff: 'The first time two people press Book in the same second.',
          examples: ['Two members press Book for the 7 am spin class at the same second. One gets the place, and the other sees "This place was just taken."'],
          files: [
            { path: 'src/bookings/service.py', open: true },
            { path: 'migrations/*.sql', open: false },
          ],
          symbols: ['book'],
          regrets: ['R-bookings-01'],
          checks: [
            { label: 'The regret library', result: 'R-bookings-01 applies and is avoided' },
            { label: 'An independent review', result: 'Agreed; suggested also handling cancellations' },
            { label: 'Established practice', result: 'skipped: no web search' },
          ],
          history: [
            'Decided on 12 October 2026, for the feature "class-booking".',
            'On 14 October 2026, an edit touched book, and the senior brought this decision back.',
          ],
          record: { file: '.senior/ledger/D-001-bookings-are-atomic.json', json: '{\n  "id": "D-001",\n  "title": "Bookings are atomic",\n  "status": "active",\n  "reversibility": "one-way"\n}' },
        },
        {
          id: 'D-002',
          title: 'Times are stored in UTC and shown in the gym\'s time zone',
          undo: 'Hard to undo',
          chosen: 'Every time is stored in UTC, and the gym\'s time zone is applied only when a time is shown.',
          why: 'A class at 7 am must stay at 7 am when the clocks change.',
          rejected: [],
          guards: 'Classes that move by an hour twice a year.',
          payoff: 'The first weekend the clocks change.',
          examples: [],
          files: [],
          symbols: [],
          regrets: ['R-time-01'],
          checks: [],
          history: ['Decided on 12 October 2026, for the feature "class-booking".', 'No session recorded on this computer has brought it back yet.'],
          record: { file: '.senior/ledger/D-002-times-are-stored-in-utc.json', json: '{\n  "id": "D-002"\n}' },
        },
      ],
    },
    focus: null,
  },
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

// Knowledge levels, on the seat reservation project the levels were designed on.
const SCALE = PROFILES.map(({ level, name, anchor, change }) => ({ level, name, anchor, change }));
const LEVELS = {
  technologies: [
    { id: 'java', name: 'Java', found: ['src/main/java/com/example/seats/SeatService.java'], level: 0 },
    { id: 'spring-boot', name: 'Spring Boot', found: ['pom.xml'], level: 0 },
    { id: 'maven', name: 'Maven', found: ['pom.xml'], level: null },
    { id: 'postgresql', name: 'PostgreSQL', found: ['docker-compose.yml'], level: 1 },
    { id: 'docker', name: 'Docker', found: ['docker-compose.yml'], level: 1 },
  ],
  codebase: null,
  hasCode: true,
  elsewhere: [{ id: 'python', name: 'Python', level: 4 }],
  words: [{ id: 'java', name: 'Java', words: ['package', 'class', 'public', 'private', 'final', 'new', 'return', 'this'] }],
  scale: SCALE,
};
for (const state of Object.values(STATES)) state.levels ??= LEVELS;

const SEAT_STEP = { index: 3, total: 7, title: 'Hold a seat while the customer pays', why: 'A held seat is kept for ten minutes, so two customers never pay for the same seat.', expect: 'The hold test passes.', feature: 'seat-holds' };
const java = (level, extra) => ({ tech: 'java', techName: 'Java', level, ...extra });
const seatPieces = (level, active, done = []) => [
  ...done,
  { index: done.length, kind: 'spine', file: 'src/main/java/com/example/seats/SeatService.java', lines: 2, status: 'active', ...active, teach: java(level, active.teach) },
  { index: done.length + 1, kind: 'spine', file: 'src/main/java/com/example/seats/SeatService.java', why: 'Stop here and report that the seat is taken.', lines: 1, status: 'waiting', teach: java(level) },
];
const lessonState = (level, active, extra = {}) => ({
  ...SAMPLE,
  activity: { state: 'working', label: 'Preparing the next part', helper: true, since: Date.now() - 4000 },
  step: SEAT_STEP,
  stats: { typed: 21, accepted: 0, watched: 0, filled: 0, steps: 2, takeaways: 2 },
  active: { index: 1, total: 2, kind: 'spine', file: 'src/main/java/com/example/seats/SeatService.java', why: active.why, watching: false, teach: java(level, active.teach), ...extra },
  journal: [
    { id: 'l1', at: at(2), kind: 'step', step: SEAT_STEP },
    { id: 'l2', at: at(2), kind: 'narration', text: 'This part stops the hold when someone else already has the seat.' },
    { id: 'l3', at: at(1), kind: 'pieces', pieces: seatPieces(level, { ...active, ...extra }, [{ index: 0, kind: 'spine', file: 'src/main/java/com/example/seats/SeatService.java', why: 'Read the clock once and keep the time.', lines: 1, status: 'typed', teach: java(level, { words: [{ text: 'Instant', meaning: 'Java’s type for a moment in time.' }] }) }]) },
  ],
});
STATES.level0 = lessonState(0, {
  why: 'Ask whether someone is holding the seat right now.',
  teach: {
    trace: 'full',
    concept: { title: 'Choosing with if', text: 'An if asks a yes-or-no question. When the answer is yes, Java runs the lines inside the curly brackets. When the answer is no, Java skips them.', bridge: 'You rated Python 4. This is the if you know from Python. Java puts the question in round brackets and uses { } where Python uses a colon and an indent.' },
    words: [
      { text: 'if', meaning: 'Run the block below only when the test is true.' },
      { text: '( )', meaning: 'The test always goes inside round brackets in Java.' },
      { text: 'seat.isHeld', meaning: 'Ask the seat whether someone is holding it. The dot means “ask this object”.' },
      { text: '(now)', meaning: 'Ask about this moment: the time you saved on the line above.' },
      { text: '{ }', meaning: 'The block. Type both brackets now; the line inside comes next, on its own.' },
    ],
  },
});
STATES.level1 = lessonState(1, {
  why: 'Stop the hold when someone already has the seat.',
  teach: {
    trace: 'full',
    lines: [
      { code: 'if (seat.isHeld(now)) {', text: 'Ask the seat whether someone holds it at this moment.' },
      { code: '    throw new SeatTaken(seatId);', text: 'If someone does, stop here and report that the seat is taken.' },
      { code: '}', text: 'This closes the if.' },
    ],
    words: [{ text: 'throw', meaning: 'Stops the method at once and hands an error back to the code that called it.' }],
  },
});
STATES.level3 = lessonState(3, { why: 'Refuse a seat that is already held.', teach: { trace: 'shape', blanks: [{ text: 'isHeld', hint: 'is it held?' }] } });
STATES.level4 = lessonState(4, {
  why: 'Refuse a held seat, then hold it and return the hold.',
  notice: 'The method reads the clock once, so the check and the hold agree about the time.',
  teach: { trace: 'first', outline: ['If it is held, stop and throw SeatTaken.', 'Hold it for this customer until now plus HOLD_TIME.', 'Return a new Hold with the seat’s id and its end time.'] },
});
STATES.level5 = lessonState(5, {
  why: 'Write the body of holdSeat.',
  teach: {
    trace: 'none',
    todo: ['Load the seat with seats.findByIdForUpdate(seatId). If it is missing, throw SeatNotFound.', 'Read the clock once and keep the time.', 'If the seat is held at that time, throw SeatTaken.', 'Hold it for this customer until that time plus HOLD_TIME, and return a new Hold.'],
    names: ['findByIdForUpdate', 'SeatNotFound', 'SeatTaken', 'holdFor', 'Hold'],
  },
});
STATES.idiom = {
  ...STATES.level5,
  active: null,
  journal: [
    ...STATES.level5.journal.slice(0, 2),
    { id: 'i1', at: at(1), kind: 'check', command: 'mvn -q test -Dtest=SeatServiceTest', expected: 'Three tests pass.', passed: true },
    { id: 'i2', at: at(0), kind: 'idiom', file: 'src/main/java/com/example/seats/SeatService.java', mine: 'Optional<Seat> found = seats.findByIdForUpdate(seatId);\nif (!found.isPresent()) {\n    throw new SeatNotFound(seatId);\n}\nSeat seat = found.get();', usual: 'Seat seat = seats.findByIdForUpdate(seatId)\n        .orElseThrow(() -> new SeatNotFound(seatId));', why: 'Yours works, and the check passed. The usual way is one statement, and it cannot forget the missing case, because orElseThrow makes you say what happens.' },
    { id: 'i3', at: at(0), kind: 'suggestion', tech: 'java', name: 'Java', from: 6, to: 7, text: 'You wrote the last 10 Java pieces without asking to see the code. Java is at 6. Would 7 suit you better? Senior as it was before levels. You type the spine over the trace, and the flesh fills itself in.' },
  ],
};
STATES.choice = {
  ...SAMPLE,
  step: SEAT_STEP,
  active: null,
  activity: null,
  journal: [
    { id: 'c1', at: at(1), kind: 'step', step: SEAT_STEP },
    {
      id: 'c2',
      at: at(0),
      kind: 'choice',
      question: 'How should a hold stop two customers from taking the same seat?',
      options: [
        { label: 'Lock the seat’s row while holding it', detail: 'The database makes the second customer wait, then they see the seat is held. Simple, but each hold on a seat waits for the one before it.', pick: true },
        { label: 'Keep each hold as its own row, one per seat', detail: 'The database refuses a second hold at once. It needs a holds table and a job that clears old holds.' },
        { label: 'Check if the seat is free, then save', detail: 'The fewest lines. Two customers can pass the check at the same moment.', risk: 'R-bookings-01', pushback: 'With this, two customers who tap Hold at the same moment can both get the seat. You can still choose it.' },
      ],
    },
    { id: 'c3', at: at(0), kind: 'level', tech: 'java', name: 'Java', from: 0, to: 10, change: 'You make the choices. Senior writes every line, runs the check and shows you the result. It starts with the next piece, and the plan stays the same.' },
  ],
};
STATES.levels = { ...SAMPLE, view: 'levels', active: null, step: null };

// A real project's memory, read the same way the extension reads it.
const real = process.env.SENIOR_PREVIEW_PROJECT;
if (real) {
  const rel = (file) => path.relative(real, file).replace(/\\/g, '/');
  STATES.memory.memory = memoryView({
    ledger: loadLedger(real),
    plans: listPlans(real).map((p) => loadPlan(real, p.feature)).filter(Boolean),
    sessions: readSessions(real),
    recordFile: (e) => (e._file ? rel(e._file) : `.senior/ledger/${e.id}.json`),
    brief: (feature) => (fs.existsSync(briefPath(real, feature)) ? rel(briefPath(real, feature)) : null),
  });
}
for (const state of Object.values(STATES)) state.memory ??= STATES.memory.memory;

function page(theme, name, focus) {
  const state = focus ? { ...STATES[name], focus: { id: focus, n: 1 } } : STATES[name];
  const t = THEMES[theme] ?? THEMES.dark;
  const vars = Object.entries(t.vars).map(([k, v]) => `${k}: ${v};`).join(' ');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Senior panel preview</title>
<link rel="stylesheet" href="/webview.css">
<style>${WEBVIEW_DEFAULTS}
html { ${vars} } body { width: 340px; margin: 0 auto; border-left: 1px solid #8884; border-right: 1px solid #8884; }</style>
<script>
  window.acquireVsCodeApi = () => ({ postMessage: (m) => {
    console.log('to extension', m);
    if (m.type === 'ready') window.postMessage({ type: 'state', state: ${JSON.stringify(state ?? SAMPLE).replace(/</g, '\\u003c')} }, '*');
  } });
</script></head>
<body class="${t.class}"><div id="app"></div><script type="module" src="/webview.js"></script></body></html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html' }).end(page(url.searchParams.get('theme') || 'dark', url.searchParams.get('state') || 'session', url.searchParams.get('focus')));
    return;
  }
  const file = path.join(dist, path.basename(url.pathname));
  if (!fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  const type = { '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(file)] ?? 'text/javascript';
  res.writeHead(200, { 'content-type': type }).end(fs.readFileSync(file));
});

server.listen(Number(process.env.PORT) || 5317, '127.0.0.1', () => {
  console.log(`Senior panel preview: http://127.0.0.1:${server.address().port}/  (add ?theme=light for the light theme)`);
});
