---
name: onboard
description: Learn an unfamiliar codebase before advising on it. Maps the layout, conventions, how to run and test it, and the existing patterns for common jobs, and writes them to .senior/repo-map.md so the senior copies the house style before inventing anything. Use once on a new or large codebase, and again only when the user asks for a refresh.
argument-hint: "[area to focus on]"
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/cli/senior.mjs" *)
  - Read
  - Glob
  - Grep
---

# Repo onboarding

Focus, if any: $ARGUMENTS

This runs once per codebase, not on every prompt. A map that rewrites itself constantly becomes noise, so only refresh it when the user asks.

1. If `.senior/` does not exist, run `node "${CLAUDE_PLUGIN_ROOT}/cli/senior.mjs" init` from the project root.
2. Explore quickly and in this order. Read files rather than guessing, and stop when you can answer each point:
   - The language, framework and main entry points.
   - The folder layout, and what lives where.
   - How to install, run, test and lint, taken from the package files, Makefile, CI config or README.
   - Conventions: naming, error handling, logging, configuration, and how the database is accessed.
   - **Existing patterns for common jobs**: authentication and permissions, data access, background jobs, exports and reports, API endpoints, validation, and tests. For each one, name the best example file to copy.
   - Danger zones: generated code, vendored code, migrations, anything that touches money or production.
3. If a focus area was given, go deeper there, and find the closest existing feature to copy.
4. Write `.senior/repo-map.md` with those sections. Keep it under about 150 lines and use real file paths.
5. Tell the user the three most useful things you learned, in plain sentences, including which existing file you would copy for the next feature.
