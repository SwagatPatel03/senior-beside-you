// UserPromptSubmit: record what the user asked, for the project story. Runs in the background.

import { appendEvent } from '../core/sessions.mjs';
import { runHook } from './io.mjs';

await runHook(async (input, root) => {
  if (!input.prompt) return;
  appendEvent(root, input.session_id, { type: 'prompt', text: String(input.prompt).slice(0, 2000) });
});
