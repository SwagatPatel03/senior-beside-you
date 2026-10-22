#!/usr/bin/env node
// The senior CLI. Skills and the agent call it; people can call it too.
// It is the only writer of the ledger, plans and replays, so every entry is validated the same way.

import fs from 'node:fs';
import { activeEntries, addEntry, formatEntry, formatLine, linkEntry, loadLedger, searchEntries, warningsFor } from '../core/ledger.mjs';
import { findRoot, SENIOR_DIR } from '../core/paths.mjs';
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
  ledger link <id> [paths...] [--symbol name ...]
                                Record where a decision lives in the code.

Plans
  plan list                     Feature plans and how far each one has got.
  plan show <feature>           One plan with the status of each step.
  plan save [--file f.json]     Save a plan (JSON from the file or stdin) and write its brief.
  plan step <feature> <step-id> <pending|active|done|skipped> [summary...]
                                Update one step.

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

function readJsonInput(args, what) {
  const file = takeOption(args, '--file')[0];
  const raw = file ? fs.readFileSync(file, 'utf8') : readStdin();
  try {
    return JSON.parse(raw);
  } catch (err) {
    return fail(`The ${what} must be JSON. ${err.message}`);
  }
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
      const input = readJsonInput(args, 'decision');
      const entry = attempt(() => addEntry(r, input, { supersedes }));
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
      const input = readJsonInput(args, 'plan');
      const plan = attempt(() => savePlan(r, input));
      saveBrief(r, plan, input.design || {});
      console.log(`Saved the plan for "${plan.feature}" with ${plan.steps.length} steps, and its brief.`);
    } else if (sub === 'step') {
      const [feature, stepId, status, ...summary] = args;
      if (!feature || !stepId || !status) fail('Usage: plan step <feature> <step-id> <pending|active|done|skipped> [summary...]');
      const plan = attempt(() => setStepStatus(r, feature, stepId, status, { summary: summary.join(' ') }));
      const done = plan.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
      console.log(`${stepId} is now ${status}. ${done} of ${plan.steps.length} steps are finished.`);
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
      const input = readJsonInput(args, 'replay');
      const replay = attempt(() => saveReplay(r, { source: 'claude-code', ...input }));
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

  default:
    console.log(HELP);
}
