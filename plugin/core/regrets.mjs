// The regret library: failures other people already learned from, one Markdown file per topic.
// The seed library ships with the plugin in `regrets/`. A project grows its own in `.senior/regrets/`,
// and a project entry with the same topic name is shown alongside the seed, not instead of it.
//
// Setting SENIOR_REGRETS=off hides the library. The foresight test uses it to compare
// design sessions with and without the library.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seniorPath } from './paths.mjs';

export const SEED_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'regrets');

export function regretsDisabled() {
  return String(process.env.SENIOR_REGRETS || '').toLowerCase() === 'off';
}

/** Minimal frontmatter reader: `key: value` lines between `---` markers. */
export function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: text.slice(match[0].length) };
}

export function parseTopic(text, source) {
  const { meta, body } = parseFrontmatter(text);
  const entries = [];
  const parts = body.split(/^## /m).slice(1);
  for (const part of parts) {
    const [heading, ...rest] = part.split(/\r?\n/);
    const m = heading.match(/^(R-[\w-]+):\s*(.*)$/);
    entries.push({ id: m ? m[1] : '', title: (m ? m[2] : heading).trim(), text: `## ${heading}\n${rest.join('\n').trim()}` });
  }
  return {
    topic: meta.topic || path.basename(source, '.md'),
    title: meta.title || meta.topic || path.basename(source, '.md'),
    appliesTo: (meta['applies-to'] || '').split(',').map((s) => s.trim()).filter(Boolean),
    source,
    entries,
  };
}

function readDir(dir, origin) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_') && f.toLowerCase() !== 'readme.md')
    .map((f) => ({ ...parseTopic(fs.readFileSync(path.join(dir, f), 'utf8'), path.join(dir, f)), origin }));
}

export function loadRegrets(root, { seedDir = SEED_DIR } = {}) {
  if (regretsDisabled()) return [];
  const topics = readDir(seedDir, 'seed');
  if (root) topics.push(...readDir(seniorPath(root, 'regrets'), 'project'));
  return topics;
}

export function formatTopicList(topics) {
  if (!topics.length) {
    return regretsDisabled()
      ? 'The regret library is switched off for this run (SENIOR_REGRETS=off). Rely on your own judgment.'
      : 'The regret library is empty.';
  }
  const lines = ['Regret library topics. Load the ones that match the feature with "regrets show <topic> ...".', ''];
  for (const t of topics) {
    lines.push(`${t.topic}${t.origin === 'project' ? ' (this project)' : ''}: ${t.title}`);
    if (t.appliesTo.length) lines.push(`  Applies to: ${t.appliesTo.join(', ')}`);
    for (const e of t.entries) lines.push(`  ${e.id} ${e.title}`);
  }
  return lines.join('\n');
}

export function showTopics(topics, names) {
  const wanted = names.map((n) => n.toLowerCase());
  const chosen = topics.filter((t) => wanted.includes(t.topic.toLowerCase()) || t.entries.some((e) => wanted.includes(e.id.toLowerCase())));
  if (!chosen.length) return `No regret topic matches ${names.join(', ')}. Run "regrets list" to see the topics.`;
  return chosen
    .map((t) => {
      const entries = t.entries.filter((e) => wanted.includes(t.topic.toLowerCase()) || wanted.includes(e.id.toLowerCase()));
      return [`# ${t.title} (${t.topic}${t.origin === 'project' ? ', this project' : ''})`, ...entries.map((e) => e.text)].join('\n\n');
    })
    .join('\n\n');
}
