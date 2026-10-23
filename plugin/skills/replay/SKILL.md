---
name: replay
description: Walk the user through work that was done at full speed, as a short replay in scenes they can pause and ask "why?" about. Builds the replay from the session recording and the reasons stated at the time. Use after /senior:fast, when the user says /senior:replay, or when they ask what was done in a session and why.
argument-hint: "[a saved replay id, or a session id; empty means the latest session]"
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/cli/senior.mjs" *)
  - Read
  - Glob
  - Grep
  - mcp__plugin_senior_editor__status
  - mcp__plugin_senior_editor__show_replay
  - mcp__plugin_senior_editor__say
---

# Replay

The user asked: $ARGUMENTS

Turn a session into a replay: a few short scenes that tell what was done and why, in the order that makes it easiest to follow. Afterwards the user should be able to explain the work as if they had sat beside you while it was built. Write in plain, simple English with full sentences.

The Senior CLI is `node "${CLAUDE_PLUGIN_ROOT}/cli/senior.mjs"`. Below it is written as `senior`.

## 1. Find or build the replay

- If the argument is the id of a saved replay (`senior replay list` shows them), go to step 2.
- Otherwise run `senior replay material <session id, if one was given>`. It lists what the session did in order: the user's request, each edit with the text before and after, each command and failure, ledger callbacks, and the reason given just before each step.
- Read the changed files as they are now when you need more context.

Write the replay as JSON and save it with `senior replay save`, passing the JSON on stdin with a heredoc. It prints the replay id.

```json
{
  "title": "Retry the payment call safely",
  "task": "The user's request, in one sentence.",
  "scenes": [
    {
      "kind": "bug",
      "title": "A timeout is not a failure",
      "narration": "Two to four plain sentences.",
      "decisions": ["D-004"],
      "files": [{ "path": "src/payments/client.py", "before": "...", "after": "..." }]
    }
  ],
  "skipped": ["What was left out because of the deadline, and the risk of leaving it."],
  "verified": ["What was checked by running something."],
  "notVerified": ["What was not checked."]
}
```

How to write the scenes:

- Use three to eight scenes. Group steps by purpose; do not make one scene per edit. Keep the order in which things happened, unless another order is much easier to follow.
- Give each scene a `kind`: `build` for code that was written, `bug` for something that failed with the guesses and the fix, `decision` for a choice between options, `skipped` for something left out on purpose, and `check` for how the result was verified.
- The narration says what happened and why, in two to four sentences. In bug scenes, tell the hunt, including the wrong guesses, because that is where the learning is.
- Be honest about reasons. When the material has the reason given at the time, use it. When it does not, write "No reason was recorded here. The likely reason is ..." Never present a guess as the reason that was given.
- `files` holds the most telling change of the scene, before and after, copied from the material. Leave it out for scenes without code. Leave out `before` when a file was created.
- `decisions` lists the ledger ids the scene carries out or touches.
- Never quiz the user.

## 2. Watch it together

Call `status`.

**If the editor is connected**, call `show_replay` with the replay id. The replay opens in the Senior panel. The user moves between scenes there and opens each change side by side. The call returns:

- `question`: answer each item in `userQuestions` with `say` (kind `answer`, `replyTo` its id) in one to three sentences, using the material and the code. Then call `show_replay` again with the same id.
- `waiting`: call `show_replay` again with the same id.
- `finished` or `closed`: go to step 3.

**If the editor is not connected**, tell the replay in chat one scene at a time: the scene number and title, the narration, and the change as a short diff. After each scene, ask whether to go on or whether they want to ask why. Answer a question in one to three sentences, then continue.

## 3. Finish

In a few short lines, repeat what was skipped and the risk of each item, and what was verified and what was not. If a skipped item is worth doing now, offer it in one sentence.
