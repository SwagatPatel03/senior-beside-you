---
name: level
description: Rate how well the user knows each technology in the project, from 0 (never written it) to 10 (wants to decide while Senior types), or change one rating. Senior then changes how much the user types and how much it explains, separately for each technology. Use when the user says /senior:level, says they do not know a language or tool, says the explanations are too much or too little, or when the session start says the project's technologies are not rated.
argument-hint: "[technology] [0-10]"
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/cli/senior.mjs" *)
  - Read
---

# Knowledge levels

The user asked: $ARGUMENTS

Senior's main goal is that the user learns. A level is how well the user knows one technology, from 0 to 10, in their own judgment. It decides how much they type, how small each piece is, and how much Senior explains for that technology. It is a fact about the user that only they know, so you ask for it and never test for it. Write in plain, simple English with full sentences.

The Senior CLI is `node "${CLAUDE_PLUGIN_ROOT}/cli/senior.mjs"`. Below it is written as `senior`.

## When a technology and a number were given

For example "java 2" or "docker 6": run `senior level set <technology> <number>`, then say in one or two sentences what the user will notice from the next piece. The CLI prints it. If pairing is in progress, prepare the next piece again at the new level. The piece the user is typing stays as it is.

If only a technology was given, show its line from `senior level scale` around the user's current level and ask which number fits.

## When nothing was given

1. If the project has no `.senior/` folder, run `senior init` from the project root.
2. Run `senior stack detect` to find the project's technologies, then `senior level list`. If the stack is empty because the project has no code yet, say that the design session chooses the stack and asks for the levels then, and stop.
3. Run `senior level scale` and show it to the user as it is: eleven short lines, one per level. Each line describes a person at that level, so the user can pick the sentence that sounds like them.
4. Ask the user, in plain text, for a number for each technology in the list, and for **This codebase** when the project already has code. Say that a short answer such as "Java 0, Spring Boot 0, PostgreSQL 1, Docker 1, codebase 2" is enough, and that a technology they leave out keeps working at level 7, the way Senior always worked. Also ask, as an optional extra, whether they know another language better, because Senior uses it for comparisons.
5. Record each answer with `senior level set <technology> <number>`. Use the ids from `senior level list`, and `codebase` for the codebase.
6. Show the result in a short list: each technology, its number and the name of the level. Then add one sentence for the lowest one, saying what the user will notice first. For example: "At Java 0 you type every line yourself, one line at a time, and each word is explained before you type it."
7. Say that the levels follow the user to every project, and that they can change any of them at any time with `/senior:level <technology> <number>`, or on the Levels page of the Senior panel in VS Code.

Never suggest a level for the user, and never ask questions to test what they know. If the user asks which number to pick, read them the sentences for the two or three levels around what they described, and let them choose.
