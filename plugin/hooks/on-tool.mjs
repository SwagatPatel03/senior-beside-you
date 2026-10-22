// PostToolUse and PostToolUseFailure: record the step, then fire consequence callbacks
// when the step touches code linked to an earlier decision.

import { callbackMessage, computeCallbacks, describeTouch } from '../core/callbacks.mjs';
import { activeEntries } from '../core/ledger.mjs';
import { appendEvent, loadState, saveState } from '../core/sessions.mjs';
import { addContext, runHook } from './io.mjs';

const MAX_STORED = 4000;

function stored(text) {
  if (typeof text !== 'string') return undefined;
  return text.length > MAX_STORED ? `${text.slice(0, MAX_STORED)}\n[cut]` : text;
}

/** The before and after text of an edit, kept for replays. Large files are cut. */
function editChange(input) {
  const ti = input.tool_input || {};
  if (Array.isArray(ti.edits)) {
    return { old: stored(ti.edits.map((e) => e.old_string || '').join('\n...\n')), new: stored(ti.edits.map((e) => e.new_string || '').join('\n...\n')) };
  }
  if (input.tool_name === 'Write') return { new: stored(ti.content) };
  if (input.tool_name === 'NotebookEdit') return { new: stored(ti.new_source) };
  return { old: stored(ti.old_string), new: stored(ti.new_string) };
}

await runHook(async (input, root) => {
  const sessionId = input.session_id;
  const touch = describeTouch(root, input);
  const toolUseId = input.tool_use_id || undefined;

  if (touch.kind === 'edit') {
    appendEvent(root, sessionId, { type: 'edit', tool: touch.tool, file: touch.files[0] || '', toolUseId, ...editChange(input) });
  } else if (touch.kind === 'edit-failed') {
    appendEvent(root, sessionId, { type: 'edit-failed', tool: touch.tool, file: touch.files[0] || '', toolUseId });
  } else if (touch.kind === 'command') {
    appendEvent(root, sessionId, { type: 'command', command: touch.command.slice(0, 300), toolUseId });
  } else if (touch.kind === 'failure') {
    appendEvent(root, sessionId, { type: 'failure', command: touch.command.slice(0, 300), snippet: touch.snippet, toolUseId });
  } else {
    return;
  }

  const { hits, state } = computeCallbacks({ touch, entries: activeEntries(root), state: loadState(root, sessionId) });
  if (!hits.length) return;
  saveState(root, sessionId, state);
  for (const h of hits) appendEvent(root, sessionId, { type: 'callback', decision: h.entry.id, trigger: h.trigger, reasons: h.reasons });
  addContext(input.hook_event_name || 'PostToolUse', callbackMessage(hits, touch));
});
