// UserPromptSubmit: record what the user asked, for the project story. Runs in the background.

import { recordEvent, runHook } from './io.mjs';

await runHook(async (input, root) => {
  if (!input.prompt) return;
  recordEvent(root, input, { type: 'prompt', text: String(input.prompt).slice(0, 2000) });
});
