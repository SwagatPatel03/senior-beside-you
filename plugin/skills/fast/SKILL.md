---
name: fast
description: Do a task at full speed when there is a deadline, after one quick pushback check against the decision ledger and the regret library. Every edit, command and failure is recorded with the reason for it, so the work can be replayed and understood later with /senior:replay. Use when the user says /senior:fast, mentions a deadline or a demo, or asks to just get something done quickly.
argument-hint: <the task>
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/cli/senior.mjs" *)
  - Read
  - Glob
  - Grep
---

# The fast lane

The user asked: $ARGUMENTS

The user is short of time. Do the task at full speed now, and make sure they can understand it later without slowing them down today. Write in plain, simple English with full sentences.

The Senior CLI is `node "${CLAUDE_PLUGIN_ROOT}/cli/senior.mjs"`. Below it is written as `senior`.

## 1. Push back once, quickly

Spend less than a minute on this, and say nothing if there is nothing worth saying.

1. If the project has no `.senior/` folder, run `senior init` so the work is recorded.
2. Find the files the task will touch with a quick Glob or Grep. Run `senior ledger find <path>` for each of them, and `senior ledger find <words>` for the main idea of the task.
3. Run `senior regrets list`, and read the one or two topics that match the task with `senior regrets show <topic>`.
4. Push back only when the task, done the way it was asked, breaks a recorded decision or walks into a known failure. Then write two sentences: the consequence in concrete terms, and a better option that costs about the same time. Ask which way to go, and do what the user chooses without arguing again.

   For example: "Retrying the payment call five times can charge a customer twice, because the provider may have taken the money even when we saw a timeout. An idempotency key on the request makes the retries safe and takes about the same time. Shall I add it, or retry as asked?"

5. If the user chooses a way that goes against a recorded decision, record the change as an announced decision with `senior ledger add --supersedes <id>`, passing the JSON on stdin with a heredoc. Say that it was chosen under a deadline, and what to revisit and when. Later callbacks will bring it back at the right moment.

## 2. Work at full speed

- Do the task the way you normally would, without stopping to teach.
- Narrate briefly, the way a senior talks to a colleague at the next desk: before each edit or command, one short sentence on what you are about to do and what it is for. These sentences appear in the replay later.
- When something fails, say in one sentence what you will check next.
- Keep a list of what you skip because of the deadline: tests not written, cases not handled, a cleaner design left for later.

## 3. Finish

End with three short parts:

- What was done.
- **Verified:** what you checked by running something. **Not verified:** what you did not check.
- **Skipped for now:** what you left out because of the deadline, and the risk of leaving it.

Then add one sentence: "When you have ten minutes, run /senior:replay to walk through what I did and why."
