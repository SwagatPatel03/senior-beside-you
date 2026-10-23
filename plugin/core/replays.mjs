// Replays: what the fast lane did, told afterwards as a few short scenes.
// Each replay is one JSON file in `.senior/replays/`, plus a Markdown copy for reading in a terminal.

import fs from 'node:fs';
import path from 'node:path';
import { readJson, seniorPath, slugify, writeJson } from './paths.mjs';

const SCENE_KINDS = ['build', 'bug', 'decision', 'skipped', 'check'];
const MAX_FILE_TEXT = 20000;

export function replaysDir(root) {
  return seniorPath(root, 'replays');
}

export function validateReplay(replay) {
  const problems = [];
  if (!replay || typeof replay !== 'object') return ['The replay must be an object.'];
  if (!replay.title || typeof replay.title !== 'string') problems.push('"title" is required and must be text.');
  if (!Array.isArray(replay.scenes) || !replay.scenes.length) {
    problems.push('"scenes" must be a list with at least one scene.');
    return problems;
  }
  replay.scenes.forEach((scene, i) => {
    if (!scene || typeof scene.title !== 'string' || !scene.title.trim()) problems.push(`Scene ${i + 1} needs a "title".`);
    if (!scene || typeof scene.narration !== 'string' || !scene.narration.trim()) problems.push(`Scene ${i + 1} needs "narration".`);
    if (scene && scene.kind !== undefined && !SCENE_KINDS.includes(scene.kind)) {
      problems.push(`Scene ${i + 1}: "kind" must be one of ${SCENE_KINDS.join(', ')}.`);
    }
    if (scene && scene.files !== undefined && !Array.isArray(scene.files)) problems.push(`Scene ${i + 1}: "files" must be a list.`);
  });
  return problems;
}

function clip(text) {
  if (typeof text !== 'string') return undefined;
  return text.length > MAX_FILE_TEXT ? `${text.slice(0, MAX_FILE_TEXT)}\n[cut: the rest of this file is not stored in the replay]` : text;
}

export function saveReplay(root, input, { now = new Date() } = {}) {
  const problems = validateReplay(input);
  if (problems.length) throw new Error(`The replay was not saved:\n- ${problems.join('\n- ')}`);
  const id = `${now.toISOString().slice(0, 10)}-${slugify(input.title, 40)}-${now.getTime().toString(36).slice(-4)}`;
  const replay = {
    id,
    title: input.title,
    task: input.task || '',
    source: input.source || 'claude-code',
    createdAt: now.toISOString(),
    scenes: input.scenes.map((s) => ({
      title: s.title,
      narration: s.narration,
      kind: s.kind || 'build',
      decisions: Array.isArray(s.decisions) ? s.decisions : [],
      files: (s.files || []).map((f) => ({
        path: String(f.path || '').replace(/\\/g, '/'),
        before: clip(f.before),
        after: clip(f.after),
      })),
    })),
    skipped: Array.isArray(input.skipped) ? input.skipped : [],
    verified: Array.isArray(input.verified) ? input.verified : [],
    notVerified: Array.isArray(input.notVerified) ? input.notVerified : [],
  };
  writeJson(path.join(replaysDir(root), `${id}.json`), replay);
  fs.writeFileSync(path.join(replaysDir(root), `${id}.md`), renderReplayMarkdown(replay));
  return replay;
}

export function loadReplay(root, id) {
  // Ids come from tools and the command line; only plain ids may name a file in the folder.
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) return null;
  return readJson(path.join(replaysDir(root), `${id}.json`), null);
}

export function listReplays(root) {
  const dir = replaysDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(dir, f), null))
    .filter((r) => r && r.id)
    .map((r) => ({ id: r.id, title: r.title, createdAt: r.createdAt, scenes: r.scenes.length, source: r.source }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function renderReplayMarkdown(replay) {
  const lines = [`# Replay: ${replay.title}`, ''];
  if (replay.task) lines.push(`The task: ${replay.task}`, '');
  replay.scenes.forEach((scene, i) => {
    lines.push(`## Scene ${i + 1}: ${scene.title}`, '', scene.narration, '');
    if (scene.decisions.length) lines.push(`Decisions: ${scene.decisions.join(', ')}`, '');
    for (const f of scene.files) lines.push(`- Changed \`${f.path}\``);
    if (scene.files.length) lines.push('');
  });
  if (replay.skipped.length) {
    lines.push('## What was skipped', '');
    for (const s of replay.skipped) lines.push(`- ${s}`);
    lines.push('');
  }
  if (replay.verified.length || replay.notVerified.length) {
    lines.push('## Checks', '');
    for (const v of replay.verified) lines.push(`- Verified: ${v}`);
    for (const v of replay.notVerified) lines.push(`- Not verified: ${v}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
