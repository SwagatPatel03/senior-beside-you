---
name: onboard
description: The place to start in any project. In a codebase, it maps the layout, conventions, how to run and test it, and the existing patterns for common jobs, writes them to .senior/repo-map.md, and on the first day asks the user which choices already in the code were deliberate, so the ledger starts with real decisions. In an empty folder, it starts the design session instead. Use once on a new or large codebase, and again only when the user asks for a refresh.
argument-hint: "[area to focus on]"
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/cli/senior.mjs" *)
  - Read
  - Glob
  - Grep
  - Write
---

# Repo onboarding

Focus, if any: $ARGUMENTS

This runs once per codebase, not on every prompt. A map that rewrites itself constantly becomes noise, so only refresh it when the user asks.

The Senior CLI is: `node "${CLAUDE_PLUGIN_ROOT}/cli/senior.mjs"`. Below it is written as `senior`.

1. If `.senior/` does not exist, run `senior init` from the project root.
2. If the project has no source code yet, because the folder is empty or holds only files such as a README, a licence and `.gitignore`, do not write a map. Tell the user in one sentence that there is nothing to map yet, and ask what they want to build. Then run the design session from the `senior:design` skill with their answer, and stop following these steps.
3. Explore quickly and in this order. Read files rather than guessing, and stop when you can answer each point:
   - The language, framework and main entry points.
   - The folder layout, and what lives where.
   - How to install, run, test and lint, taken from the package files, Makefile, CI config or README.
   - Conventions: naming, error handling, logging, configuration, and how the database is accessed.
   - **Existing patterns for common jobs**: authentication and permissions, data access, background jobs, exports and reports, API endpoints, validation, and tests. For each one, name the best example file to copy.
   - Danger zones: generated code, vendored code, migrations, anything that touches money or production.
4. If a focus area was given, go deeper there, and find the closest existing feature to copy.
5. Write `.senior/repo-map.md` with those sections. Keep it under about 150 lines and use real file paths.
6. Tell the user in one or two sentences where the map is and which existing file you would copy for the next feature.
6b. **Levels.** Run `senior stack detect`, which saves the project's technologies to `.senior/stack.json`, and then `senior level list`. If any technology is not rated, or this codebase is not rated, ask once, in plain text: show `senior level scale` as it is, and ask for a number from 0 to 10 for each unrated technology and for this codebase, saying that a short answer such as "Java 4, PostgreSQL 1, codebase 0" is enough. This codebase decides how much Senior explains about where things live and which existing pattern a piece copies, not the language itself. Record each answer with `senior level set <technology> <number>` (`codebase` for this codebase). If the user would rather not, carry on: unrated technologies work at level 7. When the user's codebase level is 0 to 3, the repo map and every explanation from here on say why a file lives where it does, not only where.

## The first day

Run `senior ledger list`. If the ledger already has decisions, stop after step 6. Otherwise, this is the user's first day with the senior in this codebase, and the steps below give the ledger its first real decisions.

7. **Show what you noticed.** Name three to five choices that already exist in the code, in the focus area if one was given. Pick choices that someone would later ask "why?" about, such as how money, time, identity, retries, permissions or data access are handled. Number each one, and for each one give:
   - a short title,
   - the file and the function where it lives,
   - what the code does, in one or two sentences,
   - the risk it seems to guard against. If you are guessing at the reason, say so.

   Then run `senior regrets list` and `senior regrets show` for the topics that apply. If one or two places clearly match an entry, name them separately as known traps, with the entry id and the size or condition that makes them hurt. Do not offer to fix them now.

   Ask the user, in plain text, which of these were deliberate. Say that a short answer such as "1 and 2 yes, 3 no" is enough, and that they can correct you in their own words. This is not a quiz. You are asking about the user's intent, not testing what they know. Do not ask follow-up questions about their answers.

8. **Record only what the user confirmed.** For each confirmed choice, write the JSON with the Write tool to its own file in `.senior/inbox/`, such as `.senior/inbox/d-1.json`, and run `senior ledger add --file .senior/inbox/d-1.json`. Do not use a heredoc or `echo`, because they fail in PowerShell on Windows. The CLI removes the file once the decision is saved. Include:
   - `"origin": "found-in-code"`,
   - `title`, `chosen`, `reversibility`, `guards` and `payoff`,
   - `why`, taken from the user's answer. If the user only said yes, use the reason you suggested and say in `why` that the user confirmed it,
   - `files` and `symbols` for where it lives.

   Leave `rejected` empty unless the user named an alternative, because nobody may know what was turned down. A known trap that the user accepts for now becomes a two-way decision that says when it should be revisited, with the regret entry in `regrets`. Leave out anything the user said no to or did not answer.

9. **Show the recorded entries,** one line each, with the id, the title and where it lives. Then show what the user can do now, in three short points that use their own new entries and files:
   - one `/senior:why <file>` example,
   - one file that will bring a decision back on its own the next time anyone edits it, with no command needed,
   - one sentence saying that `/senior:design` checks the next feature against these decisions before any code is written.

10. **Ask what the user is working on this week.** From the answer, name one command and say why in one sentence. A new feature leads to `/senior:design`, urgent work with a deadline leads to `/senior:fast`, and an area of the code the user does not know yet leads to `/senior:onboard <that area>`. Then stop.
