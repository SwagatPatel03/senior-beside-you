---
name: why
description: Answer "why is it like this?" about a file, function, line or choice, from the senior's decision ledger, then resume the work exactly where it was. Use when the user asks why mid-build.
argument-hint: <file, symbol, decision id or question>
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/cli/senior.mjs" *)
  - Read
  - Grep
---

# Answer "why?"

The question: $ARGUMENTS

The Senior CLI is: `node "${CLAUDE_PLUGIN_ROOT}/cli/senior.mjs"`.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/cli/senior.mjs" ledger find <file, symbol or key words>`. Try the file path first, then the function name, then plain words.
2. If a decision is found, answer from it in a short paragraph: what was chosen, what was rejected and why, the risk it guards against, and when it pays off. Point to the line or function where it lives if it is linked. If the entry says it was found in the existing code and confirmed by the user, say so, because the reason came from the user and not from a design session.
3. If nothing is recorded, say so plainly. Then give your own reasoning, clearly marked as yours and not as a recorded decision. If the answer is a real decision that someone could ask about again, offer to record it with `/senior:decide`.
4. Pitch the answer at the user's level. When the question is about a file, run `node "${CLAUDE_PLUGIN_ROOT}/cli/senior.mjs" level profile <path>`. At levels 0 to 2, explain any technical word in the answer the first time you use it, and say what the line does before saying why it is there.
5. Keep the answer short. Then say in one sentence where the work was, and carry on from exactly that point.
