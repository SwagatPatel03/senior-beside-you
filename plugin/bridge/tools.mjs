// The editor bridge's tools, as Claude sees them. The descriptions are the contract: they tell
// Claude what each piece kind means and how a guided step flows.

const piece = {
  type: 'object',
  properties: {
    file: { type: 'string', description: 'Project-relative path of the file, with forward slashes.' },
    kind: {
      type: 'string',
      enum: ['spine', 'flesh', 'probe'],
      description: 'spine: logic or a decision the user writes by hand. flesh: imports, boilerplate or repeated setup the editor fills in. probe: a temporary debugging line the user writes to test a guess.',
    },
    where: {
      type: 'string',
      enum: ['after', 'before', 'replace', 'start', 'end', 'new_file'],
      description: 'Where the text goes. after, before and replace need an anchor. new_file creates the file with this text.',
    },
    anchor: {
      type: 'string',
      description: 'Exact text copied from the file as it will be when this piece runs (after earlier pieces). It must appear exactly once. Use one or two whole lines.',
    },
    text: { type: 'string', description: 'The new code, with the indentation it should have in the file.' },
    why: { type: 'string', description: 'One plain sentence the user reads while this piece is in front of them.' },
    notice: { type: 'string', description: 'Optional, spine pieces: one plain sentence on the detail worth noticing while typing it, such as the condition that does the real work.' },
    decision: { type: 'string', description: 'Optional: the ledger decision this piece carries out, such as "D-002". The editor shows it when the user asks why.' },
    expect: { type: 'string', description: 'Probes only: what the user should see when they run the check, if your guess is right.' },
  },
  required: ['file', 'kind', 'where', 'text', 'why'],
  additionalProperties: false,
};

const step = {
  type: 'object',
  properties: {
    feature: { type: 'string', description: 'The feature slug from the brief, for example "gym-bookings".' },
    index: { type: 'integer', minimum: 1 },
    total: { type: 'integer', minimum: 1 },
    title: { type: 'string' },
    why: { type: 'string', description: 'One or two plain sentences: the prepared narration when the step was prepared ahead.' },
    expect: { type: 'string', description: 'The result you expect when the step is done, such as "two tests pass".' },
    risk: { type: 'string', description: 'The risk named for this step in the plan. The editor recalls it if the check fails.' },
  },
  required: ['index', 'total', 'title', 'why', 'expect'],
  additionalProperties: false,
};

const questionsNote = 'Questions the user asks in the editor come back in any result under userQuestions; answer each with say (kind "answer", replyTo its id).';

export const TOOLS = [
  {
    name: 'status',
    description: `Check whether the user's editor is connected to this project, and read their gear (type, accept or watch), active file and cursor line. Call it once before guiding. ${questionsNote}`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'begin_step',
    description: 'Show the step the user is about to work on in the Senior panel: its title, why it matters (the prepared narration, when the step was prepared ahead), the result you expect, and its risk. The panel shows it at once and can read it aloud. Call it before the first piece of each step.',
    inputSchema: step,
  },
  {
    name: 'guide',
    description: [
      'Guide the user through writing code in their own editor, one piece at a time.',
      'Spine pieces carry the logic and the decisions: the user writes them over your text, which is traced on one empty line per planned line.',
      'Flesh pieces are imports, boilerplate and repeated setup: the editor fills them in with a one-line note.',
      'Probe pieces are temporary debugging lines that test a guess; put what the user should see in expect.',
      'Keep each spine piece to one idea and at most about 8 lines. Pieces run in order, and each anchor is looked up after the earlier pieces are applied.',
      'The call returns when every piece is done, when the user asks a question (answer with say, then call wait), or after about 90 seconds (call wait to keep waiting).',
      'Each result says whether the user typed the piece, accepted it with Tab, watched it typed, kept their own version (with their text), or skipped it. Files are saved before the call returns.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: { pieces: { type: 'array', minItems: 1, maxItems: 12, items: piece } },
      required: ['pieces'],
      additionalProperties: false,
    },
  },
  {
    name: 'wait',
    description: 'Keep waiting for the pieces from the last guide call. It returns the same shape as guide.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'say',
    description: `Show a short message in the Senior panel. kind "narration": what you are about to do and why. "answer": an answer to a question the user asked in the editor (set replyTo). "callback": an earlier decision that matters right now. "takeaway": the one thing worth remembering. "warning": a risk. One to three plain sentences. ${questionsNote}`,
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        kind: { type: 'string', enum: ['narration', 'answer', 'callback', 'takeaway', 'warning'] },
        replyTo: { type: 'string', description: 'The id of the user question this answers.' },
      },
      required: ['text', 'kind'],
      additionalProperties: false,
    },
  },
  {
    name: 'show_check',
    description: 'Show the result of a check you ran yourself with your shell tool (tests, a build, or the command itself) in the Senior panel, next to what you expected. When it did not match, the editor opens the code the output points at and recalls the step\'s risk, so the user looks at the evidence while you think; then say your guess.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        expected: { type: 'string' },
        passed: { type: 'boolean', description: 'True when the outcome matched what you expected.' },
        output: { type: 'string', description: 'The end of the output, at most about 40 lines.' },
      },
      required: ['command', 'expected', 'passed'],
      additionalProperties: false,
    },
  },
  {
    name: 'open_file',
    description: 'Open a file in the user\'s editor at a line, so they can read existing code while you explain it. Say why in one sentence.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        line: { type: 'integer', minimum: 1 },
        why: { type: 'string' },
      },
      required: ['file', 'why'],
      additionalProperties: false,
    },
  },
  {
    name: 'show_replay',
    description: [
      'Open a saved replay in the Senior panel and wait while the user watches it.',
      'The user moves between scenes on their own and opens each change side by side.',
      'Returns status "question" when the user asks something (answer each userQuestions item with say, then call show_replay again with the same id),',
      '"waiting" after about 90 seconds (call it again to keep waiting), or "finished" or "closed" when the user is done.',
      'Calling it again for the replay that is open keeps the user on the scene they are reading.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The replay id printed by "replay save" or "replay list".' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'end_step',
    description: 'Close the current step in the Senior panel: what changed, what you verified by running something, what you did not verify, and one takeaway. The takeaway is saved for the project story. Pass the next step in next when it is ready, so it opens in the same moment and the user does not wait for a separate begin_step.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        verified: { type: 'array', items: { type: 'string' } },
        notVerified: { type: 'array', items: { type: 'string' } },
        takeaway: { type: 'string', description: 'One sentence worth remembering, tied to this step.' },
        next: { ...step, description: 'The next step, with the same fields as begin_step. It opens at once.' },
      },
      required: ['summary', 'verified', 'notVerified'],
      additionalProperties: false,
    },
  },
];

export const INSTRUCTIONS =
  'These tools drive the Senior panel and the traced plan in the user\'s editor during /senior:pair, and show replays during /senior:replay. The user writes the spine of the code by hand; flesh is filled in for them. ' + questionsNote;
