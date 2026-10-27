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
    tech: { type: 'string', description: 'The technology id this piece is about, from "senior level profile <path>", such as "java" or "postgresql".' },
    level: { type: 'integer', minimum: 0, maximum: 10, description: 'The user\'s level in that technology. It decides the trace, what the panel teaches and which help is offered.' },
    trace: {
      type: 'string',
      enum: ['full', 'shape', 'first', 'none'],
      description: 'What the editor shows before the user types. full: the whole piece. shape: the whole piece with the blanks hidden behind their hints. first: only the first line, with the outline under it. none: nothing; the panel shows the todo and names. Leave it out to use the level\'s default.',
    },
    concept: {
      type: 'object',
      description: 'Levels 0 to 2: a short card on a new idea, shown before the user types the piece.',
      properties: {
        title: { type: 'string', description: 'The idea in a few words, such as "Choosing with if".' },
        text: { type: 'string', description: 'Two to four plain sentences on what the idea is, without jargon.' },
        bridge: { type: 'string', description: 'Optional: the same idea in a language the user knows better, and the one difference that matters.' },
      },
      required: ['title', 'text'],
      additionalProperties: false,
    },
    words: {
      type: 'array',
      description: 'Levels 0 to 2: the words and symbols of the piece in order, each with one plain sentence on what it does here. Leave out words the user already knows.',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, meaning: { type: 'string' } },
        required: ['text', 'meaning'],
        additionalProperties: false,
      },
    },
    lines: {
      type: 'array',
      description: 'Levels 1 and 2: code lines with one plain sentence each. At level 1, the whole part the user reads before typing it; at level 2, the lines of this piece.',
      items: {
        type: 'object',
        properties: { code: { type: 'string' }, text: { type: 'string' } },
        required: ['code', 'text'],
        additionalProperties: false,
      },
    },
    blanks: {
      type: 'array',
      description: 'Trace "shape": names and values in the text to hide behind a hint, such as { "text": "isHeld", "hint": "is it held?" }. Never a keyword or a bracket.',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, hint: { type: 'string' } },
        required: ['text', 'hint'],
        additionalProperties: false,
      },
    },
    outline: { type: 'array', items: { type: 'string' }, description: 'Trace "first": one plain sentence for every line after the first, in order, saying what that line should do.' },
    todo: { type: 'array', items: { type: 'string' }, description: 'Trace "none": what the piece must do, in order, as plain sentences.' },
    names: { type: 'array', items: { type: 'string' }, description: 'Trace "none": the exact names the code must use so later pieces still fit.' },
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
    name: 'offer_choice',
    description: [
      'Level 10, and any choice that is the user\'s to make: show a question with two or three options in the Senior panel and wait for the user\'s pick.',
      'Give each option a one-line trade-off. Mark your own pick with pick. Put the regret library id in risk, and one plain sentence in pushback, on an option that walks into a known trap: the panel shows the pushback when the user picks it, and they can still choose it.',
      `Returns status "chosen" with the option's index and label (and pushedBack when the user chose it after the pushback), "question", or "waiting" after about 90 seconds (call it again with the same question to keep waiting). ${questionsNote}`,
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        options: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'The option in a few words.' },
              detail: { type: 'string', description: 'The trade-off in one or two plain sentences.' },
              pick: { type: 'boolean', description: 'True for the option you recommend.' },
              risk: { type: 'string', description: 'The regret library id this option walks into, if any.' },
              pushback: { type: 'string', description: 'One plain sentence on the consequence, shown when the user picks a risky option.' },
            },
            required: ['label', 'detail'],
            additionalProperties: false,
          },
        },
      },
      required: ['question', 'options'],
      additionalProperties: false,
    },
  },
  {
    name: 'show_idiom',
    description: `Level 6: after the user kept their own version of a piece, show it beside the way experienced developers usually write it, with why, and wait while they keep theirs or take the usual one. Returns status "chosen" with choice "mine" or "usual" (the editor has already replaced their code when they take the usual one), "question" or "waiting". ${questionsNote}`,
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Project-relative path of the file that holds the user\'s version.' },
        mine: { type: 'string', description: 'The user\'s code exactly as it is in the file.' },
        usual: { type: 'string', description: 'The usual way, with the same indentation.' },
        why: { type: 'string', description: 'One or two plain sentences on why the usual way is better.' },
      },
      required: ['file', 'mine', 'usual', 'why'],
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
