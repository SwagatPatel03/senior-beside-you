---
name: regret
description: Add a failure from this project to the project's own regret library, so the senior warns about it next time. Use after a real incident, a painful bug, or a design choice that had to be undone.
argument-hint: <what went wrong>
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/cli/senior.mjs" *)
  - Read
  - Write
  - Edit
---

# Record a regret

What went wrong: $ARGUMENTS

1. Run `node "${CLAUDE_PLUGIN_ROOT}/cli/senior.mjs" regrets list` to find the closest topic.
2. Open or create `.senior/regrets/<topic>.md`. A new file starts with this frontmatter:

```markdown
---
topic: <topic-slug>
title: <Readable topic title>
applies-to: <comma-separated words for features this applies to>
---
```

3. Add one entry in the same format as the seed library at `${CLAUDE_PLUGIN_ROOT}/regrets/`. Use the id `R-<topic>-p<number>`, where the `p` marks a project entry, and fill in **How it shows up**, **Why it happens**, **What a senior decides up front**, **One-way or two-way**, **Test that proves it**, and **Source**. For the source, describe this project's incident: the date, what broke, and how it was found.
4. Write it so someone who was not there can follow it. Use plain, simple English with full sentences.
5. Tell the user the entry id and which future features it will be checked against.
