// Consequence callbacks. When an edit or a failure touches code linked to a ledger decision,
// the senior brings that decision back at the moment it matters.
//
// The matching is mechanical: linked paths and linked symbols, never guesses from the user's words.
// Three rules keep it quiet (hurdle H5):
//   1. A decision made in this session does not fire. It is still fresh, so a callback would be noise.
//   2. Each decision fires at most once per session for edits and once for failures.
//   3. At most MAX_PER_CALL decisions are raised by one tool call.

import { entriesTouching } from './ledger.mjs';
import { pathsInText, toRel } from './paths.mjs';

export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const MAX_PER_CALL = 2;

// Strong signs that a command's output is a failure, for runners that exit 0 or for
// failures that Claude Code reports through PostToolUse rather than PostToolUseFailure.
const FAILURE_MARKERS = /(Traceback \(most recent call last\)|AssertionError|\b\d+ (?:failed|failing)\b|\bFAILED\b|\bFAIL\b|panicked at|Uncaught \w*Error|^\s*\w*Error: )/m;

function textOf(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function editedContent(toolInput = {}) {
  if (Array.isArray(toolInput.edits)) return toolInput.edits.map((e) => e.new_string || '').join('\n');
  return toolInput.new_string || toolInput.content || toolInput.new_source || '';
}

/** Describe what a tool call did, in the terms the ledger understands. */
export function describeTouch(root, input) {
  const tool = input.tool_name || '';
  const failedEvent = input.hook_event_name === 'PostToolUseFailure';
  const ti = input.tool_input || {};

  if (EDIT_TOOLS.has(tool)) {
    const rel = toRel(root, ti.file_path || ti.notebook_path);
    if (failedEvent) return { kind: 'edit-failed', tool, files: rel ? [rel] : [], text: '' };
    return { kind: 'edit', tool, files: rel ? [rel] : [], text: editedContent(ti) };
  }

  if (tool === 'Bash' || tool === 'PowerShell') {
    const output = failedEvent ? textOf(input.error) : textOf(input.tool_response);
    const failed = failedEvent || FAILURE_MARKERS.test(output);
    if (!failed) return { kind: 'command', tool, command: ti.command || '', files: [], text: '' };
    return { kind: 'failure', tool, command: ti.command || '', files: pathsInText(root, output), text: output, snippet: output.slice(-800) };
  }

  return { kind: 'other', tool, files: [], text: '' };
}

/** Decide which callbacks fire. Returns the messages and the updated state; it does not write anything. */
export function computeCallbacks({ touch, entries, state }) {
  if (touch.kind !== 'edit' && touch.kind !== 'failure') return { hits: [], state };
  const trigger = touch.kind;
  const fired = { ...(state.fired || {}) };
  const hits = [];
  for (const hit of entriesTouching(entries, touch)) {
    if (hits.length >= MAX_PER_CALL) break;
    if (hit.entry.created && state.startedAt && hit.entry.created >= state.startedAt) continue;
    const key = `${hit.entry.id}:${trigger}`;
    if (fired[key]) continue;
    fired[key] = new Date().toISOString();
    hits.push({ ...hit, trigger });
  }
  return { hits, state: { ...state, fired } };
}

export function callbackMessage(hits, touch) {
  const parts = hits.map(({ entry: e, reasons, trigger }) => {
    const where =
      trigger === 'failure'
        ? `The failing command's output mentions ${reasons.join(', ')}, which is linked to`
        : `This edit to ${touch.files[0] || 'a file'} touches ${reasons.join(', ')}, which is linked to`;
    const details = [
      `${where} decision ${e.id} "${e.title}", decided on ${e.created.slice(0, 10)}.`,
      `Chosen: ${e.chosen}.`,
      `Why: ${e.why}`,
      e.guards ? `Guards against: ${e.guards}` : '',
      e.payoff ? `Pays off: ${e.payoff}` : '',
    ];
    return details.filter(Boolean).join(' ');
  });
  return [
    'Senior ledger callback.',
    ...parts,
    overallTrigger(hits) === 'failure'
      ? 'If this failure is where that decision matters, the Senior style tells the user in one or two plain sentences, tied to this moment, before continuing the hunt. If the failure is unrelated to the decision, nothing needs to be said.'
      : 'If this edit is where that decision pays off or is at risk, the Senior style tells the user in one or two plain sentences, tied to this moment. If the edit is routine for that decision, nothing needs to be said.',
    'Each decision raises this callback once per session.',
  ].join('\n');
}

function overallTrigger(hits) {
  return hits.some((h) => h.trigger === 'failure') ? 'failure' : 'edit';
}
