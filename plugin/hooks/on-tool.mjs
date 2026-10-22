// PostToolUse and PostToolUseFailure: record the step, then fire consequence callbacks
// when the step touches code linked to an earlier decision.

import { callbackMessage, computeCallbacks, describeTouch } from '../core/callbacks.mjs';
import { activeEntries } from '../core/ledger.mjs';
import { appendEvent, loadState, saveState } from '../core/sessions.mjs';
import { addContext, runHook } from './io.mjs';

await runHook(async (input, root) => {
  const sessionId = input.session_id;
  const touch = describeTouch(root, input);

  if (touch.kind === 'edit' || touch.kind === 'edit-failed') {
    appendEvent(root, sessionId, { type: touch.kind, tool: touch.tool, file: touch.files[0] || '' });
  } else if (touch.kind === 'command') {
    appendEvent(root, sessionId, { type: 'command', command: touch.command.slice(0, 300) });
  } else if (touch.kind === 'failure') {
    appendEvent(root, sessionId, { type: 'failure', command: touch.command.slice(0, 300), snippet: touch.snippet });
  } else {
    return;
  }

  const { hits, state } = computeCallbacks({ touch, entries: activeEntries(root), state: loadState(root, sessionId) });
  if (!hits.length) return;
  saveState(root, sessionId, state);
  for (const h of hits) appendEvent(root, sessionId, { type: 'callback', decision: h.entry.id, trigger: h.trigger, reasons: h.reasons });
  addContext(input.hook_event_name || 'PostToolUse', callbackMessage(hits, touch));
});
