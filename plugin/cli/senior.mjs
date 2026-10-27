#!/usr/bin/env node
// The senior CLI. Skills and the agent call it; people can call it too.
// It is the only writer of the ledger, plans and replays, so every entry is validated the same way.

import fs from 'node:fs';
import path from 'node:path';
import { activeEntries, addEntry, formatEntry, formatLine, linkEntry, loadLedger, searchEntries, warningsFor } from '../core/ledger.mjs';
import { addWords, bridgesFor, DEFAULT_LEVEL, effectiveLevel, isLevel, knownWords, levelOf, loadLevels, PROFILES, profile, profileBrief, setLevel, techId } from '../core/levels.mjs';
import { findRoot, inInbox, SENIOR_DIR, toRel } from '../core/paths.mjs';
import { addTechnology, currentStack, refreshStack, setCodebaseLevel, stackLevels, techForPath, techName } from '../core/stack.mjs';
import { listPlans, loadPlan, savePlan, saveBrief, setStepStatus } from '../core/plans.mjs';
import { initProject } from '../core/project.mjs';
import { formatTopicList, loadRegrets, showTopics } from '../core/regrets.mjs';
import { listReplays, loadReplay, renderReplayMarkdown, saveReplay } from '../core/replays.mjs';
import { appendEvent, digestSessions, markStory, readSessions, storyCursor } from '../core/sessions.mjs';
import { statusText } from '../core/status.mjs';
import { buildMaterial } from './material.mjs';

const HELP = `senior: the memory behind the senior developer.

Setup
  init                          Create .senior/ in the current project.
  status                        What the senior remembers about this project.

Decision ledger
  ledger list [--all]           Active decisions (--all includes superseded ones).
  ledger show <id>              One decision in full.
  ledger find <path|symbol|words>
                                Decisions linked to a file or symbol, or matching words.
  ledger add [--file f.json] [--supersedes D-001]
                                Record a decision. JSON comes from the file or from stdin.
                                A file in .senior/inbox/ is removed once it is saved.
  ledger link <id> [paths...] [--symbol name ...]
                                Record where a decision lives in the code.

Plans
  plan list                     Feature plans and how far each one has got.
  plan show <feature>           One plan with the status of each step.
  plan save [--file f.json]     Save a plan (JSON from the file or stdin) and write its brief.
  plan step <feature> <step-id> <pending|active|done|skipped> [summary...]
                                Update one step.
  plan advance <feature> <step-id> [summary...]
                                Mark a step done and make the next pending step active.

Regret library
  regrets list                  Topics and their entries.
  regrets show <topic|id> ...   Full entries for the chosen topics or entry ids.

Replays
  replay material [session-id]  Raw material for a replay of a recorded session.
  replay save [--file f.json]   Save a replay (JSON from the file or stdin).
  replay list                   Saved replays, newest first.
  replay show <id>              One replay as readable text.

Project story
  sessions [--all]              Digest of sessions since the last story (--all: every session).
  story mark                    Record that the story is up to date.

Knowledge levels (the user's own rating, 0 to 10, kept in ~/.senior/levels.json)
  level list                    The user's level for each technology in this project.
  level set <technology> <0-10> Set a level. "codebase" sets the level for this codebase.
  level profile <technology|path> [--json]
                                How to guide this technology, or the technology of this file.
  level scale                   What every level from 0 to 10 means.
  stack detect                  Find the project's technologies and save .senior/stack.json.
  stack add <name> [--files glob ...]
                                Add a technology Senior could not find by itself.
  words add <technology> <word> ...
                                Record words already explained to the user.
  words list <technology>       Words already explained to the user.
`;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function root({ required = true } = {}) {
  const r = findRoot(process.cwd());
  if (!r && required) fail(`No ${SENIOR_DIR}/ folder was found here or in any parent folder. Run "init" in the project root first.`);
  return r;
}

function takeFlag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}

function takeOption(args, name) {
  const values = [];
  let i;
  while ((i = args.indexOf(name)) !== -1) {
    if (i + 1 >= args.length) fail(`${name} needs a value.`);
    values.push(args[i + 1]);
    args.splice(i, 2);
  }
  return values;
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

let inputFile = null;

/** The JSON input from --file or stdin. A relative --file path is tried from here, then from the project root. */
function readJsonInput(args, what, r) {
  const file = takeOption(args, '--file')[0];
  let raw;
  if (file) {
    inputFile = [path.resolve(file), path.resolve(r, file)].find((p) => fs.existsSync(p));
    if (!inputFile) fail(`The file ${file} does not exist. Write the ${what} to it first.`);
    raw = fs.readFileSync(inputFile, 'utf8');
  } else {
    raw = readStdin();
  }
  try {
    return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch (err) {
    return fail(`The ${what} must be JSON. ${err.message}`);
  }
}

/** An inbox file holds one input, so it is removed once that input is saved. Other files are left alone. */
function clearInbox(r) {
  if (inputFile && inInbox(toRel(r, inputFile))) fs.rmSync(inputFile, { force: true });
}

function attempt(action) {
  try {
    return action();
  } catch (err) {
    return fail(err.message);
  }
}

const [command, sub, ...rest] = process.argv.slice(2);
const args = [...rest];

switch (command) {
  case 'init':
    console.log(`Senior is set up in ${initProject(process.cwd())}.`);
    break;

  case 'status':
    console.log(statusText(root()));
    break;

  case 'ledger': {
    const r = root();
    if (sub === 'list') {
      const entries = takeFlag(args, '--all') ? loadLedger(r) : activeEntries(r);
      console.log(entries.length ? entries.map(formatLine).join('\n') : 'The ledger has no decisions yet.');
    } else if (sub === 'show') {
      const entry = loadLedger(r).find((e) => e.id.toLowerCase() === String(args[0]).toLowerCase());
      if (!entry) fail(`There is no decision ${args[0]}.`);
      console.log(formatEntry(entry));
    } else if (sub === 'find') {
      const found = searchEntries(loadLedger(r), args.join(' '));
      console.log(found.length ? found.map(formatEntry).join('\n\n') : `No decision is linked to or mentions "${args.join(' ')}".`);
    } else if (sub === 'add') {
      const supersedes = takeOption(args, '--supersedes')[0];
      const input = readJsonInput(args, 'decision', r);
      const entry = attempt(() => addEntry(r, input, { supersedes }));
      clearInbox(r);
      console.log(`Recorded ${entry.id}: ${entry.title}${supersedes ? ` (replaces ${supersedes})` : ''}`);
      for (const w of warningsFor(entry)) console.log(`Warning: ${w}`);
    } else if (sub === 'link') {
      const symbols = takeOption(args, '--symbol');
      const [id, ...files] = args;
      if (!id) fail('Usage: ledger link <id> [paths...] [--symbol name ...]');
      const entry = attempt(() => linkEntry(r, id, { files, symbols }));
      console.log(`${entry.id} now lives in: ${entry.files.join(', ') || '(no files)'}${entry.symbols.length ? `; symbols: ${entry.symbols.join(', ')}` : ''}`);
    } else {
      fail(HELP);
    }
    break;
  }

  case 'plan': {
    const r = root();
    if (sub === 'list') {
      const plans = listPlans(r);
      console.log(plans.length ? plans.map((p) => `${p.feature}: ${p.title} (${p.done} of ${p.steps} steps done)`).join('\n') : 'There are no plans yet.');
    } else if (sub === 'show') {
      const plan = loadPlan(r, args[0] || '');
      if (!plan) fail(`There is no plan for "${args[0]}".`);
      console.log(`${plan.title}\nGoal: ${plan.goal}\n`);
      for (const s of plan.steps) console.log(`${s.id} [${s.status}] ${s.title}\n   Why: ${s.why}\n   Expected: ${s.expect}${s.check ? `\n   Check: ${s.check}` : ''}`);
    } else if (sub === 'save') {
      const input = readJsonInput(args, 'plan', r);
      const plan = attempt(() => savePlan(r, input));
      saveBrief(r, plan, input.design || {});
      clearInbox(r);
      console.log(`Saved the plan for "${plan.feature}" with ${plan.steps.length} steps, and its brief.`);
    } else if (sub === 'step') {
      const [feature, stepId, status, ...summary] = args;
      if (!feature || !stepId || !status) fail('Usage: plan step <feature> <step-id> <pending|active|done|skipped> [summary...]');
      const plan = attempt(() => setStepStatus(r, feature, stepId, status, { summary: summary.join(' ') }));
      const done = plan.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
      console.log(`${stepId} is now ${status}. ${done} of ${plan.steps.length} steps are finished.`);
    } else if (sub === 'advance') {
      // One call between steps, so the user waits as little as possible.
      const [feature, stepId, ...summary] = args;
      if (!feature || !stepId) fail('Usage: plan advance <feature> <step-id> [summary...]');
      let plan = attempt(() => setStepStatus(r, feature, stepId, 'done', { summary: summary.join(' ') }));
      const next = plan.steps.find((s) => s.status === 'pending');
      if (next) plan = attempt(() => setStepStatus(r, feature, next.id, 'active'));
      const done = plan.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
      console.log(`${stepId} is done. ${done} of ${plan.steps.length} steps are finished.${next ? ` ${next.id} is now active: ${next.title}` : ' Every step is finished.'}`);
    } else {
      fail(HELP);
    }
    break;
  }

  case 'regrets': {
    const topics = loadRegrets(root({ required: false }));
    if (sub === 'list') console.log(formatTopicList(topics));
    else if (sub === 'show' && args.length) console.log(topics.length ? showTopics(topics, args) : formatTopicList(topics));
    else fail(HELP);
    break;
  }

  case 'replay': {
    const r = root();
    if (sub === 'material') {
      console.log(buildMaterial(r, args[0]));
    } else if (sub === 'save') {
      const input = readJsonInput(args, 'replay', r);
      const replay = attempt(() => saveReplay(r, { source: 'claude-code', ...input }));
      clearInbox(r);
      const latest = readSessions(r).sort((a, b) => b.endedAt.localeCompare(a.endedAt))[0];
      if (latest) appendEvent(r, latest.id, { type: 'replay', id: replay.id, title: replay.title });
      console.log(`Saved replay ${replay.id} with ${replay.scenes.length} scenes. It is in .senior/replays/${replay.id}.md`);
    } else if (sub === 'list') {
      const replays = listReplays(r);
      console.log(replays.length ? replays.map((x) => `${x.id}: ${x.title} (${x.scenes} scenes)`).join('\n') : 'There are no replays yet.');
    } else if (sub === 'show') {
      const replay = loadReplay(r, args[0] || '');
      if (!replay) fail(`There is no replay "${args[0]}".`);
      console.log(renderReplayMarkdown(replay));
    } else {
      fail(HELP);
    }
    break;
  }

  case 'sessions': {
    const r = root();
    const all = [sub, ...args].includes('--all');
    console.log(digestSessions(readSessions(r), { since: all ? '' : storyCursor(r) }));
    break;
  }

  case 'story':
    if (sub !== 'mark') fail(HELP);
    markStory(root());
    console.log('The story is marked as up to date.');
    break;

  case 'level': {
    const r = root({ required: false });
    if (sub === 'list') {
      if (!r) fail(`No ${SENIOR_DIR}/ folder was found, so there is no project stack. Run "init" first, or "level set" to rate a technology anyway.`);
      const stack = currentStack(r);
      if (!stack.technologies.length) {
        console.log('Senior found no technologies in this project yet. The design session chooses them for a new project.');
        break;
      }
      for (const t of stackLevels(stack)) {
        const p = t.level === null ? null : profile(t.level);
        console.log(`${t.name} (${t.id}): ${p ? `${t.level} · ${p.name}` : `not rated, so Senior works at level ${DEFAULT_LEVEL}`}${t.found.length ? ` · found in ${t.found.join(', ')}` : ''}`);
      }
      const codebase = stack.codebase?.level;
      console.log(`This codebase: ${codebase === null || codebase === undefined ? 'not rated' : `${codebase} · ${profile(codebase).name}`}`);
    } else if (sub === 'set') {
      const [tech, raw] = args;
      const level = Number(raw);
      if (!tech || !isLevel(level)) fail('Usage: level set <technology> <0-10>');
      if (techId(tech) === 'codebase') {
        if (!r) fail(`No ${SENIOR_DIR}/ folder was found. The codebase level belongs to a project.`);
        setCodebaseLevel(r, level);
        console.log(`This codebase is now ${level} · ${profile(level).name}.`);
        break;
      }
      const previous = attempt(() => setLevel(tech, level, { name: techName(tech) }));
      const p = profile(level);
      console.log(`${techName(tech)} is now ${level} · ${p.name}.${previous !== null && previous !== level ? ` It was ${previous}.` : ''} ${p.change}`);
    } else if (sub === 'profile') {
      const json = takeFlag(args, '--json');
      const what = args.join(' ').trim();
      if (!what) fail('Usage: level profile <technology|path> [--json]');
      const data = loadLevels();
      // A path is looked up in the project's stack; without .senior/ yet, in the files of this folder.
      const base = r ?? process.cwd();
      const fromPath = /[\\/.]/.test(what) ? techForPath(currentStack(base), toRel(base, what) ?? what, data) : null;
      const id = techId(what);
      const tech = fromPath ?? { id, name: techName(id), level: effectiveLevel(id, data), rated: levelOf(id, data) !== null };
      if (json) console.log(JSON.stringify({ ...tech, profile: profile(tech.level), knownWords: knownWords(tech.id, data), bridges: bridgesFor(tech.id, tech.level, data) }, null, 2));
      else console.log(profileBrief(tech, data));
    } else if (sub === 'scale') {
      for (const p of PROFILES) console.log(`${p.level} · ${p.name}. ${p.anchor} ${p.change}`);
    } else {
      fail(HELP);
    }
    break;
  }

  case 'stack': {
    const r = root();
    if (sub === 'detect') {
      const { stack, added } = refreshStack(r);
      if (!stack.technologies.length) console.log('Senior found no technologies yet. Saved an empty stack to .senior/stack.json.');
      else {
        console.log(`Saved .senior/stack.json with ${stack.technologies.length} technologies:`);
        for (const t of stackLevels(stack)) console.log(`- ${t.name} (${t.id})${t.found.length ? `, found in ${t.found.join(', ')}` : ''}${t.level === null ? ', not rated yet' : `, level ${t.level}`}${added.includes(t.id) ? ' (new)' : ''}`);
      }
    } else if (sub === 'add') {
      const files = takeOption(args, '--files');
      const name = args.join(' ').trim();
      const entry = attempt(() => addTechnology(r, name, files));
      console.log(`Added ${entry.name} (${entry.id}) to the stack.${files.length ? ` Its files: ${files.join(', ')}.` : ''}`);
    } else {
      fail(HELP);
    }
    break;
  }

  case 'words': {
    const [tech, ...words] = [sub, ...args];
    if (!tech) fail('Usage: words add <technology> <word> ... | words list <technology>');
    if (tech === 'add') {
      const [id, ...list] = words;
      if (!id || !list.length) fail('Usage: words add <technology> <word> ...');
      const added = attempt(() => addWords(id, list));
      console.log(added.length ? `Recorded ${added.length} new ${added.length === 1 ? 'word' : 'words'} for ${techName(id)}: ${added.join(', ')}.` : `Those words were already recorded for ${techName(id)}.`);
    } else if (tech === 'list') {
      const id = words[0];
      if (!id) fail('Usage: words list <technology>');
      const known = knownWords(id);
      console.log(known.length ? `${techName(id)}: ${known.join(', ')}` : `No words have been explained in ${techName(id)} yet.`);
    } else {
      fail(HELP);
    }
    break;
  }

  default:
    console.log(HELP);
}
