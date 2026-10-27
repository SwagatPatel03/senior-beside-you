---
name: decide
description: Record a decision in the senior's ledger mid-build, or replace an earlier decision through an announced change. Use when a choice is made that someone would later ask "why?" about, or when the plan has to change.
argument-hint: <the decision, or "replace D-00N because ...">
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/cli/senior.mjs" *)
  - Read
  - Write
---

# Record a decision

The decision: $ARGUMENTS

The Senior CLI is: `node "${CLAUDE_PLUGIN_ROOT}/cli/senior.mjs"`. Below it is written as `senior`.

To pass JSON to the CLI, write it with the Write tool to a file in `.senior/inbox/`, such as `.senior/inbox/decision.json`, and then add `--file .senior/inbox/decision.json` to the command. Do not use a heredoc or `echo`, because they fail in PowerShell on Windows. The CLI removes the file once the decision is saved.

1. Run `senior ledger find <a few key words>` to see whether an earlier decision covers the same ground.
2. Decide whether this is **one-way** (data model, authentication, data store, payments, public API, or anything else expensive to undo) or **two-way** (easy to change later).
   - For a two-way decision, record it straight away.
   - For a one-way decision, stop and run the three checks from the design session: the regret library (`senior regrets list` and `senior regrets show`), an independent review by a fresh subagent that sees only the requirements and the proposal, and established practice. Record the outcome of each check in `checks`, including "skipped" and the reason.
3. If this replaces an earlier decision, first tell the user in one or two plain sentences what is changing and why. Then record it with `senior ledger add --supersedes D-00N --file <the JSON file>`. The old entry is kept and marked as replaced, and the new one inherits its code links.
4. Otherwise record it with `senior ledger add --file <the JSON file>`. Required fields: `title`, `reversibility` ("one-way" or "two-way"), `chosen`, `why`. Also fill in `rejected` (each with `option` and `why`), `guards`, `payoff`, `files`, `symbols` and `feature` when you know them.
5. If the code for this decision already exists, link it: `senior ledger link <id> <path> --symbol <name>`.
6. Tell the user the decision id and its title in one sentence, then carry on with the work.
