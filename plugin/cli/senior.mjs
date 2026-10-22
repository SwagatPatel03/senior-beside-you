#!/usr/bin/env node
// The senior CLI. Skills and the agent call it; people can call it too.
// It is the only writer of the ledger, so every entry is validated the same way.

import fs from 'node:fs';
import path from 'node:path';
import { activeEntries, addEntry, formatEntry, formatLine, linkEntry, loadLedger, searchEntries, warningsFor } from '../core/ledger.mjs';
import { findRoot, seniorPath, SENIOR_DIR } from '../core/paths.mjs';
import { formatTopicList, loadRegrets, showTopics } from '../core/regrets.mjs';
import { digestSessions, markStory, readSessions, storyCursor } from '../core/sessions.mjs';
import { statusText } from '../core/status.mjs';

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

Regret library
  regrets list                  Topics and their entries.
  regrets show <topic|id> ...   Full entries for the chosen topics or entry ids.

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

function init() {
  const r = process.cwd();
  for (const dir of ['ledger', 'features', 'regrets', 'sessions', 'state', 'story']) fs.mkdirSync(seniorPath(r, dir), { recursive: true });
  const gitignore = seniorPath(r, '.gitignore');
  if (!fs.existsSync(gitignore)) {
    // Decisions, briefs, regrets and the story belong in git. Raw session records and hook state do not.
    fs.writeFileSync(gitignore, 'sessions/\nstate/\n');
  }
  console.log(`Senior is set up in ${path.join(r, SENIOR_DIR)}.`);
}

const [command, sub, ...rest] = process.argv.slice(2);
const args = [...rest];

switch (command) {
  case 'init':
    init();
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
      const file = takeOption(args, '--file')[0];
      const supersedes = takeOption(args, '--supersedes')[0];
      const raw = file ? fs.readFileSync(file, 'utf8') : readStdin();
      let input;
      try {
        input = JSON.parse(raw);
      } catch (err) {
        fail(`The decision must be JSON. ${err.message}`);
      }
      try {
        const entry = addEntry(r, input, { supersedes });
        console.log(`Recorded ${entry.id}: ${entry.title}${supersedes ? ` (replaces ${supersedes})` : ''}`);
        for (const w of warningsFor(entry)) console.log(`Warning: ${w}`);
      } catch (err) {
        fail(err.message);
      }
    } else if (sub === 'link') {
      const symbols = takeOption(args, '--symbol');
      const [id, ...files] = args;
      if (!id) fail('Usage: ledger link <id> [paths...] [--symbol name ...]');
      try {
        const entry = linkEntry(r, id, { files, symbols });
        console.log(`${entry.id} now lives in: ${entry.files.join(', ') || '(no files)'}${entry.symbols.length ? `; symbols: ${entry.symbols.join(', ')}` : ''}`);
      } catch (err) {
        fail(err.message);
      }
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
