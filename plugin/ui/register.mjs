// Senior's look in Claude Code: one mark, ◆ in amber, in the places people already look. A welcome
// line above the prompt at the start, the spinner, the end of each turn, the footer's mode label and
// the hint line, plus a toast when a ledger callback fires.
//
// This is a hooks module for Claude Code's mod API, which is early access and may change. Senior
// must never need it: the classic hooks in hooks.json do all of Senior's work, and when this module
// fails to load or a hook here fails, Claude Code skips it and draws its own UI. So every hook here
// either passes through or draws, and none of them decides anything.
//
// Lines are drawn as trees only in the terminal, laid out the way Claude Code lays out its own (a
// blank line above, the mark in a two-column slot). Other surfaces (VS Code, the desktop app) frame
// a plugin's tree as a separate card, so there Claude Code draws its own UI unchanged.
//
// It reads Senior's files in `.senior/` and never writes them.

import { atom, read, update } from 'claude-code';
import {
  AMBER,
  CALLBACK_TOOLS,
  LEDGER_FILE,
  MARK,
  activityLabel,
  callbackToast,
  decisionsNote,
  formatDuration,
  modeForSkill,
  newCallbacks,
  parentDir,
  phaseLabel,
  recallLabel,
  safeId,
  sameKey,
  shown,
  toSlash,
  turnLine,
  welcomeParts,
  withEllipsis,
} from './look.mjs';

const label = atom({ plugin: 'senior', key: 'label' }, null);
const recall = atom({ plugin: 'senior', key: 'recall' }, null);
const mode = atom({ plugin: 'senior', key: 'mode' }, null);
const notes = atom({ plugin: 'senior', key: 'notes' }, {});
const welcomed = atom({ plugin: 'senior', key: 'welcomed' }, false);
const welcome = atom({ plugin: 'senior', key: 'welcome' }, null);
const turnStartedAt = atom({ plugin: 'senior', key: 'turnStartedAt' }, null);
const tickAt = atom({ plugin: 'senior', key: 'tickAt' }, 0);

const RECALL_MS = 6000;
const TICK_MS = 1000;
const MAX_TOASTS = 2;

// The module's own memory. A reload starts it over, and session.start fills it again.
let root = null;
let known = null;
let ledgerAtTurnStart = 0;
let recallTimer = null;
let ticker = null;

/** A folder's real long name, so C:\Users\SWAGAT~1 and C:\Users\SWAGAT PATEL compare equal. */
async function realName($, dir) {
  try {
    const { realPath } = await $.fs.stat(dir, { resolve: true });
    return sameKey(realPath ?? dir);
  } catch {
    return sameKey(dir);
  }
}

/**
 * Walk up from `start` to the nearest folder that holds `.senior/`, as core/paths.mjs does.
 * The walk stops below the home folder: `~/.senior/` holds the editor's lock files for the whole
 * machine, and treating it as a project would pull every folder under home into Senior.
 */
async function findRoot($, start) {
  const homeDir = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'));
  const home = homeDir ? await realName($, homeDir) : null;
  for (let dir = toSlash(start).replace(/\/+$/, ''); dir; dir = parentDir(dir)) {
    const base = dir.replace(/\/+$/, '');
    if (home !== null && (await realName($, base)) === home) return null;
    if (await $.fs.exists(`${base}/.senior`)) return base;
  }
  return null;
}

async function readJson($, path) {
  try {
    const value = JSON.parse(await $.fs.read(path));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

async function ledgerNames($, dir) {
  try {
    const entries = await $.fs.list(`${dir}/.senior/ledger`);
    return entries.filter((f) => f.kind === 'file' && LEDGER_FILE.test(f.name)).map((f) => f.name);
  } catch {
    return [];
  }
}

async function activeCount($, dir) {
  let n = 0;
  for (const name of await ledgerNames($, dir)) {
    const entry = await readJson($, `${dir}/.senior/ledger/${name}`);
    if (entry && entry.status !== 'superseded') n += 1;
  }
  return n;
}

async function decisionTitle($, dir, id) {
  const name = (await ledgerNames($, dir)).find((n) => n === `${id}.json` || n.startsWith(`${id}-`));
  if (!name) return null;
  const entry = await readJson($, `${dir}/.senior/ledger/${name}`);
  return typeof entry?.title === 'string' ? entry.title : null;
}

/** The callbacks Senior has fired this session, from its per-session state file. */
async function firedMap($, dir, sessionId) {
  const state = await readJson($, `${dir}/.senior/state/${safeId(sessionId)}.json`);
  const fired = state?.fired;
  return fired && typeof fired === 'object' ? fired : {};
}

async function showRecall($, text) {
  await update($, recall, () => text);
  recallTimer?.cancel();
  recallTimer = $.clock.after(RECALL_MS, () => {
    void update($, recall, (v) => (v === text ? null : v));
  });
}

/** Toast each callback Senior's own PostToolUse hook fired since the last look. */
async function checkCallbacks($, sessionId, toolInput) {
  if (!root) return;
  const fired = await firedMap($, root, sessionId);
  known ??= new Set();
  const hits = newCallbacks(known, fired);
  for (const h of hits) known.add(h.key);
  for (const h of hits.slice(0, MAX_TOASTS)) {
    const title = (await decisionTitle($, root, h.id)) ?? 'an earlier decision';
    const file = typeof toolInput?.file_path === 'string' ? shown(root, toolInput.file_path) : null;
    $.ui.toast(callbackToast(h.id, title, h.trigger, file));
    await showRecall($, recallLabel(h.id, title));
  }
}

/** @type {import('claude-code').Register} */
export const register = (on) => {
  on('session.start', async ($, e, next) => {
    const result = await next(e);
    try {
      root = await findRoot($, e.cwd);
      known = new Set(root ? Object.keys(await firedMap($, root, await $.session.id())) : []);
      // The welcome line is drawn above the prompt until the first prompt is sent.
      if (e.isInteractive && !(await read($, welcomed))) {
        const active = root ? await activeCount($, root) : 0;
        await update($, welcomed, () => true);
        await update($, welcome, () => active);
      }
    } catch {
      // The look is optional; the session goes on without it.
    }
    return result;
  });

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e);
    try {
      const now = await $.clock.now();
      await update($, welcome, () => null);
      await update($, turnStartedAt, () => now);
      await update($, tickAt, () => now);
      ticker?.cancel();
      ticker = $.clock.every(TICK_MS, () => {
        void $.clock.now().then((t) => update($, tickAt, () => t));
      });
    } catch {
      // Without the clock the spinner simply shows no elapsed time.
    }
    try {
      root ??= await findRoot($, await $.session.cwd());
      ledgerAtTurnStart = root ? (await ledgerNames($, root)).length : 0;
    } catch {
      ledgerAtTurnStart = 0;
    }
    return next(e);
  });

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e);
    ticker?.cancel();
    ticker = null;
    try {
      await update($, label, () => null);
      await update($, turnStartedAt, () => null);
      // The design session can create `.senior/` partway through a turn.
      root ??= await findRoot($, await $.session.cwd());
      if (root) {
        await checkCallbacks($, await $.session.id(), null);
        const note = decisionsNote((await ledgerNames($, root)).length - ledgerAtTurnStart);
        if (note) await update($, notes, (n) => ({ ...n, [String(e.durationMs)]: note }));
      }
    } catch {
      // Leave the end of the turn as it is.
    }
    return next(e);
  });

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e);
    let mine = null;
    try {
      mine = activityLabel(e.tool, e, root);
      if (mine) await update($, label, () => mine);
    } catch {
      mine = null;
    }
    try {
      return await next(e);
    } finally {
      if (mine) await update($, label, (v) => (v === mine ? null : v)).catch(() => undefined);
    }
  }).catch(($, e, next) => next(e));

  // Senior's own PostToolUse hook runs beneath these, so once `next` resolves its callbacks are written.
  on('classic.PostToolUse', async ($, e, next) => {
    const result = await next(e);
    if (root && CALLBACK_TOOLS.has(e.tool_name)) await checkCallbacks($, e.session_id, e.tool_input).catch(() => undefined);
    return result;
  }).catch(($, e, next) => next(e));

  on('classic.PostToolUseFailure', async ($, e, next) => {
    const result = await next(e);
    if (root && CALLBACK_TOOLS.has(e.tool_name)) await checkCallbacks($, e.session_id, e.tool_input).catch(() => undefined);
    return result;
  }).catch(($, e, next) => next(e));

  on('skill.prompt', async ($, e, next) => {
    const m = modeForSkill(e.skill, e.pluginName);
    if (m) await update($, mode, () => m).catch(() => undefined);
    return next(e);
  });

  // Like Claude Code's own spinner row: a blank line above, the mark in a two-column slot, then the words.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e);
    const text = e.props.message ?? (await read($, recall)) ?? (await read($, label)) ?? phaseLabel(e.props.mode);
    const started = await read($, turnStartedAt);
    const now = await read($, tickAt);
    const elapsed = started !== null && now >= started ? ` (${formatDuration(now - started)})` : '';
    const { Box, Text } = $.ui.resolve(e);
    return h(
      Box,
      { flexDirection: 'row', width: '100%', marginTop: 1 },
      h(Box, { width: 2, flexShrink: 0 }, h(Text, { color: AMBER }, MARK)),
      h(Text, { color: AMBER }, withEllipsis(text)),
      h(Text, { dimColor: true }, elapsed),
    );
  });

  // Like Claude Code's own "Baked for 3s" row: a blank line above, the mark in a two-column slot.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e);
    const note = (await read($, notes))[String(e.props.durationMs)];
    const { Box, Text } = $.ui.resolve(e);
    return h(
      Box,
      { flexDirection: 'row', width: '100%', marginTop: 1 },
      h(Box, { minWidth: 2, flexShrink: 0 }, h(Text, { color: AMBER }, MARK)),
      h(Text, { dimColor: true }, turnLine(e.props.durationMs, note)),
    );
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e);
    const active = await read($, welcome);
    if (active === null) return next(e);
    const { words, command } = welcomeParts(active);
    const { Box, Text } = $.ui.resolve(e);
    return h(
      Box,
      { flexDirection: 'row' },
      h(Box, { width: 2, flexShrink: 0 }, h(Text, { color: AMBER }, MARK)),
      h(Text, { dimColor: true }, words),
      h(Text, null, command),
    );
  });

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e);
    const m = await read($, mode);
    const others = e.props.modes.join(' & ');
    const { Box, Text } = $.ui.resolve(e);
    return h(
      Box,
      { flexDirection: 'row' },
      others ? h(Text, { dimColor: true }, `${others} · `) : null,
      h(Text, { color: AMBER }, MARK),
      h(Text, { dimColor: true }, m ? ` senior · ${m}` : ' senior'),
    );
  });

  on('ui.render', { component: 'PromptHint' }, ($, e, next) =>
    e.surface !== 'terminal' || e.props.isWorking || e.props.isDraft
      ? next(e)
      : next({ ...e, props: { ...e.props, tail: ' · /senior:why to ask why' } }),
  );
};
