---
name: story
description: Turn the decision ledger and recent session records into the project story, one short page per module, written so the user can tell it in an interview months later. Use at the end of a working session, or when the session start says sessions are not yet in the story.
argument-hint: "[module to focus on]"
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/cli/senior.mjs" *)
  - Read
  - Glob
  - Grep
---

# Project story

Focus, if any: $ARGUMENTS

The Senior CLI is: `node "${CLAUDE_PLUGIN_ROOT}/cli/senior.mjs"`. Below it is written as `senior`.

1. Gather the material:
   - `senior sessions` shows what happened since the last story: what the user asked, files changed, failures and callbacks.
   - `senior ledger list --all`, then `senior ledger show <id>` for each decision that the sessions touched.
   - The feature briefs in `.senior/features/` and the existing pages in `.senior/story/`.
2. Group the work by module. A module is a part of the system the user would name in a conversation, such as "bookings", "payments" or "CSV export", not a single file.
3. For each module that changed, create or update `.senior/story/<module>.md`. Keep earlier content and add to it. Use these sections:
   - **What it does**: two or three sentences a non-programmer could follow.
   - **Key decisions**: each with its ledger id, what was chosen, what was rejected, and why. A decision found in the existing code and confirmed by the user was already there before the senior arrived, so describe it that way and not as a choice made in a design session.
   - **Bugs and how they were found**: the symptom, the wrong first guess if there was one, what found the real cause, and the fix. Take these from the failures in the session records.
   - **Trade-offs we accepted**: what we gave up and why it was acceptable.
   - **How I would explain it in an interview**: four to six sentences in the first person, as the user would say them.
4. Write in plain, simple English with full sentences. Do not invent events. If the records do not say why something happened, say that it was not recorded.
5. Run `senior story mark`.
6. Tell the user which pages changed and the one thing from this session most worth remembering.
