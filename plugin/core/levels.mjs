// Knowledge levels: how well the user knows each technology, from 0 (never written it) to 10 (wants
// to decide while Senior types). One profile table says what every level changes, and every host
// reads the same table: the skills through the CLI, the navigator, the editor and the terminal.
//
// Levels belong to the person, not the project, so they live in `~/.senior/levels.json` beside the
// editor's lock files. That folder is never treated as a project (see findRoot). The words Senior has
// already explained live there too, so a word is explained once, in whichever project it first appears.

import os from 'node:os';
import path from 'node:path';
import { readJson, writeJson } from './paths.mjs';

/** The level used for a technology the user has not rated: Senior as it was before levels existed. */
export const DEFAULT_LEVEL = 7;

/**
 * What each level changes. `typeShare` is roughly how much of the code the user types. `trace` is
 * what the editor shows before the user types: the whole piece, a shape with blanks for names
 * already met, only the first line with plain comments for the rest, or nothing at all.
 * `guide` is the instruction the pair skill and the navigator follow at this level.
 */
export const PROFILES = [
  {
    level: 0,
    name: 'Never written it',
    anchor: 'You have never written a line of it.',
    change: 'One line at a time, every word explained, and nothing ahead of you on the screen.',
    typeShare: 100,
    pieceLines: 1,
    partLines: 5,
    trace: 'full',
    words: 'every',
    concepts: true,
    readFirst: false,
    idiom: false,
    fillIn: false,
    gear: 'type',
    design: 'Senior makes every technical choice and says why in one sentence. It asks the user only about the product.',
    checks: 'A compile or run check after every part of three to five lines, so a mistake is never far from where it happened.',
    failure: 'Rewrite the error in plain English, point at the exact word it is about, and give the fix as a traced piece for the user to type.',
    guide: [
      'The user has never written this technology. Every line is new to them, so the goal of each piece is that they understand every word in it.',
      'Make every piece one line. When a line opens a block, the piece is that line and its closing bracket, so the file stays complete; the lines inside come as the next pieces.',
      'The user types everything in this technology, including the package line, imports and boilerplate. Use flesh only for files they will never need to read, such as a generated build wrapper.',
      'Before the first piece that uses a new idea (a class, a method, an if, a loop, an annotation, a dependency), give the piece a concept: a title and two to four plain sentences on what the idea is, without jargon.',
      'Give every piece words: each word or symbol of the line in order, with one plain sentence on what it does here. Skip only words listed in the user\'s known words for this technology, and mention them by name instead.',
      'When the user rated another language higher, add a bridge to the concept: the same idea written in that language, and the one difference that matters.',
      'Split each plan step into parts of three to five lines, and run a compile or run check after every part.',
    ],
  },
  {
    level: 1,
    name: 'Seen it, cannot write it',
    anchor: 'You have seen it, but you could not write a line without help.',
    change: 'You read the whole small part together with Senior first, then type it one line at a time.',
    typeShare: 95,
    pieceLines: 2,
    partLines: 5,
    trace: 'full',
    words: 'new',
    concepts: true,
    readFirst: true,
    idiom: false,
    fillIn: false,
    gear: 'type',
    design: 'Senior decides and explains each choice in one sentence.',
    checks: 'A compile or run check after every part.',
    failure: 'Rewrite the error in plain English, point at the word, and give the fix as a traced piece.',
    guide: [
      'The user has seen this technology but cannot write it alone. They learn best by reading a small part with you before typing it.',
      'Split each plan step into parts of three to five lines. Before the first piece of a part, give that piece lines: every line of the whole part with one plain sentence each, so the user reads the part once before typing any of it.',
      'Make every piece one or two lines. The user types everything except imports, which are flesh; the first time an import appears, its why says what it brings in.',
      'Give words only for words that are not in the user\'s known words for this technology.',
      'Give a short concept, two sentences, before a piece that uses a big new idea.',
      'Run a compile or run check after every part.',
    ],
  },
  {
    level: 2,
    name: 'Can read it with help',
    anchor: 'You can read a short piece and guess what it does.',
    change: 'You type the first of each kind of line. Senior fills in the repeats you have already typed once.',
    typeShare: 90,
    pieceLines: 3,
    partLines: 6,
    trace: 'full',
    words: 'new',
    concepts: 'big',
    readFirst: false,
    idiom: false,
    fillIn: false,
    gear: 'type',
    design: 'Senior decides, explains, and names the option it turned down.',
    checks: 'A compile or run check after every part.',
    failure: 'Give a one-sentence summary above the raw error, open the line, and describe the fix in words before tracing it.',
    guide: [
      'The user can read this technology with help. They should type the first of every kind of line and never type the same kind twice.',
      'Make spine pieces up to three lines. A line the user has already typed once in this session of the same kind (a second constructor, another getter, a repeated annotation) is flesh, and its why says which earlier line it copies. Imports are flesh.',
      'Give every spine piece lines: one short sentence for each line. Give words only for words that are not in the user\'s known words.',
      'Give a concept only for big ideas such as a class, an interface, a transaction or dependency injection.',
      'Split each plan step into parts of about six lines and run a check after every part.',
    ],
  },
  {
    level: 3,
    name: 'Can follow a pattern',
    anchor: 'You can change code if a similar example sits nearby.',
    change: 'The trace fades. A pattern you have typed before comes back as a shape with blanks for the names.',
    typeShare: 75,
    pieceLines: 4,
    partLines: 8,
    trace: 'shape',
    words: 'none',
    concepts: 'big',
    readFirst: false,
    idiom: false,
    fillIn: false,
    gear: 'type',
    design: 'Senior decides, and names the alternative in one line.',
    checks: 'A compile or run check after every part.',
    failure: 'Give a summary and open the line, then a hint. Trace the fix only when the user asks for it.',
    guide: [
      'The user can follow a pattern when one is nearby. The trace fades so they recall the names themselves.',
      'Make spine pieces up to four lines. The first time a pattern appears in the session, trace it in full. When a piece repeats a pattern the user has typed before, give it blanks: the names and values from the text to hide, each with a short hint such as "is it held?". Never blank a keyword or a bracket. Pressing Alt+S shows the full piece.',
      'The why says what the piece does and why, in up to two sentences. Explain a single line only when it holds a new idea.',
      'Imports, annotations and constructors the user has typed before are flesh.',
    ],
  },
  {
    level: 4,
    name: 'Can write small parts',
    anchor: 'You can write a small function if someone tells you what it should do.',
    change: 'Only the first line is traced. Plain comments under it say what the rest should do.',
    typeShare: 65,
    pieceLines: 6,
    partLines: 12,
    trace: 'first',
    words: 'none',
    concepts: false,
    readFirst: false,
    idiom: false,
    fillIn: false,
    gear: 'type',
    design: 'For hard-to-undo choices, Senior shows two options with its pick, and the user confirms.',
    checks: 'After every part, two or three parts per step.',
    failure: 'Give a summary and the line. Let the user try the fix first, and offer your fix after a second failure.',
    guide: [
      'The user can write a small function when told what it should do. They write the logic from plain descriptions.',
      'Make spine pieces up to six lines and give each an outline: one plain sentence for every line after the first, in order, saying what that line should do, not how. The editor traces only the first line and shows the outline under it. Pressing Alt+S shows the code.',
      'All logic is spine. Imports, annotations, constructors and getters are flesh.',
      'Give each spine piece a notice: the one detail that does the real work.',
      'When the user keeps their own version, read it. If it works, keep it and fit the next pieces to it.',
    ],
  },
  {
    level: 5,
    name: 'Knows the basics, slow at it',
    anchor: 'You can build a feature, but you look most things up.',
    change: 'No trace. A short list says what to write and which names to use, so your code still fits the next piece.',
    typeShare: 50,
    pieceLines: 8,
    partLines: null,
    trace: 'none',
    words: 'none',
    concepts: false,
    readFirst: false,
    idiom: false,
    fillIn: false,
    gear: 'type',
    design: 'As today, with the trade-offs explained at more length.',
    checks: 'At the end of each step, and once in the middle of a long step.',
    failure: 'Show the raw output with a one-line summary, and open the line.',
    guide: [
      'The user knows the basics and is slow at it. They write the spine from a description, without a trace.',
      'Make spine pieces up to eight lines. Give each a todo: the things the piece must do, in order, as plain sentences. Give it names: the exact names the code must use (methods, classes, fields and variables that later pieces depend on), so their version still fits. The editor shows no trace; pressing Alt+S shows the code, and the user presses Done when they finish.',
      'Expect the user\'s version to differ from your text. When they keep their own, read it and run the check. Do not correct style; fix only what breaks.',
      'The why says why the piece exists. Explain what the code does only when asked.',
    ],
  },
  {
    level: 6,
    name: 'Works alone, misses the idioms',
    anchor: 'You build features alone, but reviewers often suggest a more usual way.',
    change: 'You write it your way, then see how people who know the language usually write it, side by side, and choose.',
    typeShare: 40,
    pieceLines: 8,
    partLines: null,
    trace: 'none',
    words: 'none',
    concepts: false,
    readFirst: false,
    idiom: true,
    fillIn: false,
    gear: 'type',
    design: 'Up to three questions about facts, three risks and examples. For each hard-to-undo choice, Senior also names how the framework\'s own documentation does it.',
    checks: 'At the end of each step.',
    failure: 'Open the evidence, give your guess, a probe, then the fix.',
    guide: [
      'The user works alone in this technology but misses its idioms. They learn most from comparing their version with the usual one.',
      'Make spine pieces up to eight lines with a todo and names, as at level 5, and no trace.',
      'When the user keeps their own version and it differs from the way experienced developers usually write it, call show_idiom with their code, the usual code and one or two sentences on why the usual way is better. Do this only when the difference matters (safety, clarity or a well-known idiom), not for spacing or naming taste. Fit the next pieces to whichever version they keep.',
    ],
  },
  {
    level: 7,
    name: 'Comfortable',
    anchor: 'You work in it every week.',
    change: 'Senior as it was before levels. You type the spine over the trace, and the flesh fills itself in.',
    typeShare: 33,
    pieceLines: 8,
    partLines: null,
    trace: 'full',
    words: 'none',
    concepts: false,
    readFirst: false,
    idiom: false,
    fillIn: true,
    gear: 'type',
    design: 'As today: up to three questions about facts, three risks, and examples.',
    checks: 'At the end of each step.',
    failure: 'Open the evidence, recall the step\'s risk, give your guess, a probe, then the fix.',
    guide: [
      'The user is comfortable in this technology. Spine is what they should be able to explain later; flesh is everything else. Aim for them to type about a third of the lines.',
      'Keep each spine piece to one idea and at most about eight lines.',
    ],
  },
  {
    level: 8,
    name: 'Fluent',
    anchor: 'You write it quickly and rarely look things up.',
    change: 'Tab accepts the trace. You type only the lines that carry a decision.',
    typeShare: 20,
    pieceLines: 12,
    partLines: null,
    trace: 'full',
    words: 'none',
    concepts: false,
    readFirst: false,
    idiom: false,
    fillIn: true,
    gear: 'accept',
    design: 'Up to three questions about facts and three risks, with the trade-offs in one line each.',
    checks: 'At the end of each step.',
    failure: 'Open the evidence and give your guess. Let the user choose whether to probe or to fix.',
    guide: [
      'The user is fluent. Only pieces that carry a ledger decision need their attention; the rest they accept with Tab.',
      'Pieces can be up to twelve lines. Give a why only to pieces that carry a decision, a risk or a surprise; for the rest a few words are enough.',
      'Narrate only at decisions, risks and surprises.',
    ],
  },
  {
    level: 9,
    name: 'Could teach it',
    anchor: 'You could teach it and review other people\'s code in it.',
    change: 'Senior types while you watch, and stops only at one-way decisions and failures.',
    typeShare: 10,
    pieceLines: 40,
    partLines: null,
    trace: 'full',
    words: 'none',
    concepts: false,
    readFirst: false,
    idiom: false,
    fillIn: true,
    gear: 'watch',
    design: 'Senior writes a short proposal and the user edits it. The checks for hard-to-undo choices still run.',
    checks: 'Run routine steps one after another, and stop only at decisions and failures.',
    failure: 'Show the evidence and your guess. Fix mechanical causes without stopping.',
    guide: [
      'The user could teach this technology. They watch Senior type and write only the lines of one-way decisions.',
      'A piece can be a whole function. Mark as spine only the lines that carry a one-way decision; everything else is flesh or watched.',
      'Stay silent except at decisions, callbacks and failures.',
    ],
  },
  {
    level: 10,
    name: 'You decide, Senior types',
    anchor: 'You do not want to type it. You want to decide and review.',
    change: 'You make the choices. Senior writes every line, runs the check and shows you the result.',
    typeShare: 0,
    pieceLines: null,
    partLines: null,
    trace: 'none',
    words: 'none',
    concepts: false,
    readFirst: false,
    idiom: false,
    fillIn: true,
    gear: null,
    design: 'The user makes every choice, small ones too. Senior still reads the regret library and pushes back in one line.',
    checks: 'Run every step\'s check and show what passed and what did not.',
    failure: 'Fix it and say so in one line. Stop only if the fix would change a choice the user made.',
    guide: [
      'The user decides and Senior types. Do not send spine pieces in this technology.',
      'Before each step, find the choices in it: how something should work, not how to spell it. For each one, call offer_choice with two or three options, a one-line trade-off for each, your pick, and the regret library id on any option that walks into a known trap. Wait for the user\'s pick. Record a one-way pick in the ledger with "Decided by the user" in its why.',
      'Then write the step as flesh pieces, run its check, and end the step with what changed, what passed and what was not verified.',
    ],
  },
];

export function profile(level) {
  return PROFILES[clampLevel(level)];
}

export function clampLevel(level) {
  const n = Math.round(Number(level));
  return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : DEFAULT_LEVEL;
}

/** True when `value` is a whole number from 0 to 10. */
export function isLevel(value) {
  return Number.isInteger(value) && value >= 0 && value <= 10;
}

// The store -----------------------------------------------------------------------------------------

/** Where the user's levels live. Tests and unusual setups point SENIOR_LEVELS_FILE elsewhere. */
export function levelsFile() {
  return process.env.SENIOR_LEVELS_FILE || path.join(os.homedir(), '.senior', 'levels.json');
}

function empty() {
  return { version: 1, levels: {}, words: {} };
}

export function loadLevels(file = levelsFile()) {
  const data = readJson(file, null);
  if (!data || typeof data !== 'object') return empty();
  return {
    version: 1,
    levels: data.levels && typeof data.levels === 'object' ? data.levels : {},
    words: data.words && typeof data.words === 'object' ? data.words : {},
  };
}

/** Technology ids are lower-case slugs such as "java" or "spring-boot". */
export function techId(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\+\+/g, 'pp')
    .replace(/#/g, 'sharp')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The user's level for a technology, or null when they have not rated it. */
export function levelOf(id, data = loadLevels()) {
  const entry = data.levels[techId(id)];
  return entry && isLevel(entry.level) ? entry.level : null;
}

/** The level Senior works at: the user's rating, or the default when there is none. */
export function effectiveLevel(id, data = loadLevels()) {
  return levelOf(id, data) ?? DEFAULT_LEVEL;
}

/** Set a level and remember when it changed. Returns the previous level, or null. */
export function setLevel(id, level, { name, now = new Date(), file = levelsFile() } = {}) {
  const key = techId(id);
  if (!key) throw new Error('Name the technology, for example "java".');
  if (!isLevel(level)) throw new Error('A level is a whole number from 0 to 10.');
  const data = loadLevels(file);
  const old = data.levels[key];
  const previous = old && isLevel(old.level) ? old.level : null;
  const history = Array.isArray(old?.history) ? old.history : [];
  if (previous !== level) history.push({ level, at: now.toISOString() });
  data.levels[key] = { ...(old ?? {}), ...(name ? { name } : {}), level, history };
  writeJson(file, data);
  return previous;
}

/** Words already explained to the user for a technology, so they are not explained twice. */
export function knownWords(id, data = loadLevels()) {
  const words = data.words[techId(id)];
  return Array.isArray(words) ? words : [];
}

/** Add explained words. Returns only the ones that were new. */
export function addWords(id, words, { file = levelsFile() } = {}) {
  const key = techId(id);
  if (!key) throw new Error('Name the technology, for example "java".');
  const data = loadLevels(file);
  const have = new Set(knownWords(key, data));
  const added = [];
  for (const raw of words) {
    const word = String(raw).trim();
    if (word && !have.has(word)) {
      have.add(word);
      added.push(word);
    }
  }
  if (added.length) {
    data.words[key] = [...have];
    writeJson(file, data);
  }
  return added;
}

/** Technologies that are languages, so a higher level in one can explain another by comparison. */
const LANGUAGES = new Set(['java', 'kotlin', 'javascript', 'typescript', 'python', 'go', 'rust', 'csharp', 'ruby', 'php', 'c', 'cpp', 'swift', 'scala', 'sql']);

/** Languages the user knows clearly better than `level`, for comparisons such as "like a dict in Python". */
export function bridgesFor(id, level, data = loadLevels()) {
  const key = techId(id);
  return Object.entries(data.levels)
    .filter(([other, e]) => other !== key && LANGUAGES.has(other) && isLevel(e?.level) && e.level >= Math.max(3, level + 3))
    .sort((a, b) => b[1].level - a[1].level)
    .slice(0, 2)
    .map(([other, e]) => ({ id: other, name: e.name ?? other, level: e.level }));
}

/**
 * Everything the pair skill and the navigator need to guide one technology at the user's level, as
 * plain text. `tech` is { id, name, level, rated } as techForPath returns it.
 */
export function profileBrief(tech, data = loadLevels()) {
  const p = profile(tech.level);
  const rated = data.levels[techId(tech.id)];
  const lines = [];
  lines.push(
    tech.rated === false || !rated
      ? `${tech.name}: not rated, so Senior works at level ${p.level} (${p.name}), as it did before levels existed. If the user is pairing, suggest /senior:level once.`
      : `${tech.name}: level ${p.level} of 10 (${p.name}), set on ${dayOf(rated.history?.at(-1)?.at ?? '')}.`,
  );
  lines.push(`What the user feels at this level: ${p.change}`);
  lines.push('How to guide pieces in this technology:');
  for (const g of p.guide) lines.push(`- ${g}`);
  if (p.pieceLines) {
    const size = p.pieceLines === 1 ? 'one line, plus its closing bracket when the line opens a block' : `at most ${p.pieceLines} lines`;
    lines.push(`Spine pieces: ${size}${p.partLines ? `; parts of about ${p.partLines} lines, each with its own check` : ''}.`);
  }
  lines.push(`Editor trace for spine pieces: ${p.trace}.`);
  lines.push(`Checks: ${p.checks}`);
  lines.push(`When a check fails: ${p.failure}`);
  lines.push(`Design choices: ${p.design}`);
  if (p.words !== 'none') {
    const words = knownWords(tech.id, data);
    lines.push(words.length ? `Words already explained to the user in ${tech.name} (do not explain them again; name them if useful): ${words.join(', ')}.` : `No words have been explained to the user in ${tech.name} yet.`);
    lines.push(`After a piece with words is done, record them: senior words add ${techId(tech.id)} <word> <word> ...`);
  }
  if (p.level <= 5) {
    const bridges = bridgesFor(tech.id, p.level, data);
    if (bridges.length) lines.push(`Languages the user knows better, for comparisons in concepts: ${bridges.map((b) => `${b.name} (${b.level})`).join(', ')}.`);
  }
  return lines.join('\n');
}

/** "27 October 2026" for a stored ISO date. */
export function dayOf(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
