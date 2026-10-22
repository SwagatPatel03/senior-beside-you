---
name: design
description: The senior's design session before any feature code. Asks the two or three questions that change the design, names the three things most likely to hurt later using the regret library, confirms concrete examples that become the first tests, sorts each decision into one-way or two-way, and records the decisions in the ledger. Use before building a new feature, a new app, or any change to the data model, authentication, payments, a data store or a public API.
argument-hint: <what you want to build> [--dry-run]
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/cli/senior.mjs" *)
  - Read
  - Glob
  - Grep
---

# Design session

The user wants to build: $ARGUMENTS

You are the senior developer. Before any code, you decide the few things that are expensive to change later, because you know what hurts. The session should feel like two to five minutes with a senior, not a form to fill in. Write in plain, simple English with full sentences.

The Senior CLI is: `node "${CLAUDE_PLUGIN_ROOT}/cli/senior.mjs"`. Below it is written as `senior`.

**Dry run.** If the request above contains `--dry-run`, this is a rehearsal. Do not create or edit any file and do not run `init`, `ledger add` or `ledger link`. Do not wait for answers. Write the questions you would ask, assume the most likely answers and say what you assumed, then do every other step and show what you would have recorded. Skip the independent review and the established-practice checks in Step 5, and say that they were skipped because this is a dry run.

## Step 1. Load what is already known

1. Run `senior status`. If it says no `.senior/` folder exists and this is not a dry run, run `senior init` from the project root.
2. Run `senior ledger list`. Existing decisions are constraints. Do not contradict one silently.
3. If the project already has code and `.senior/repo-map.md` does not exist, look at the layout, the main framework, and how tests run before you advise anything. Copy the house style before inventing anything new. For a large codebase, suggest `/senior:onboard` first.
4. Run `senior regrets list`. Pick every topic that could apply to this feature, including indirect ones. For example, a booking app also touches time and timezones, payments if it charges, and background jobs if it sends reminders. Run `senior regrets show <topic> <topic> ...` for those topics and read the entries carefully.

## Step 2. Ask the questions that change the design

Ask at most three questions. Each one must be about a fact only the user knows, and each one must change what you build. Good questions are about who the users are, scale, money, deadlines, limits, and what already exists. Bad questions ask the user to pick a technology or test their knowledge.

For each question, say in one short sentence why the answer matters. Ask with the AskUserQuestion tool when it is available, otherwise ask in plain text. Then wait for the answers.

## Step 3. Name the three things most likely to hurt later

Name the three risks that would hurt this feature most, ranked. Each risk must be concrete and specific to this feature:

- **What goes wrong**, as a scene the user can picture. For example: "Two members tap 'book' on the last 9:00 spot at the same moment, and both get a confirmation."
- **Why it happens**, in one or two sentences.
- **What we decide now to prevent it**, and the regret library entry it comes from, if any.

Use the regret library as a checklist, not a script. Name a risk that is not in the library if it matters more. After the top three, you may list up to three smaller risks in one line each.

## Step 4. Confirm concrete examples

Write three to five concrete examples of expected behaviour, in the user's language, with real values. For example: "Booking a full 9:00 slot shows 'This slot is taken'." Include at least one example that exercises the top risk. Ask the user to confirm or correct them. These examples become the first tests.

## Step 5. Decide, and sort each decision

List the decisions this feature needs. For each one, decide whether it is:

- **Two-way**: easy to change later. Decide fast, in one line, and move on.
- **One-way**: expensive to undo. These are the data model, authentication, the data store, payments and public APIs. Run three checks before deciding:
  1. **Regret library**: which entries apply, and does the proposal avoid them?
  2. **Independent review**: use the Agent tool to start a fresh subagent. If the Agent tool lets you choose a model, choose one that is different from the one you are running on. Give it only the requirements and your proposal, not your reasoning, and ask it to find the strongest reason the proposal will hurt within a year. Do not tell it what you expect it to find.
  3. **Established practice**: how well-known open-source projects or the framework's own documentation solve the same problem. Use web search if it is available. If it is not, say that this check was skipped.

  If the checks disagree, show the user both sides and the trade-off in plain words, give your recommendation, and let the user choose.

Before recording, show the decisions to the user in a short list and ask them to confirm. This is the last moment the user can change direction cheaply.

## Step 6. Record

After the user confirms (skip this step in a dry run, but show what you would have recorded):

1. Record each decision with `senior ledger add`, passing JSON on stdin with a heredoc. Use this shape:

```json
{
  "title": "Bookings are made atomic with a unique constraint on the slot",
  "reversibility": "one-way",
  "chosen": "A unique index on (slot_id) for confirmed bookings, so the database rejects a second booking",
  "rejected": [{ "option": "Check if the slot is free, then insert", "why": "Two requests can pass the check at the same moment" }],
  "why": "The database is the only place that sees every request at once.",
  "guards": "Double bookings when two people take the last slot together",
  "payoff": "The first time two people book the same slot at the same moment, or when a load test runs",
  "examples": ["Booking a full 9:00 slot shows 'This slot is taken'"],
  "regrets": ["R-bookings-01"],
  "files": [],
  "symbols": [],
  "feature": "gym-bookings",
  "checks": { "regretLibrary": "R-bookings-01 applies and is avoided", "independentReview": "Agreed; suggested also handling cancellations", "openSource": "skipped: no web search" }
}
```

   `checks` is needed only for one-way decisions. Leave `files` and `symbols` empty if the code does not exist yet. You will link them while building.

2. Save the plan with `senior plan save`, passing JSON on stdin with a heredoc. It writes both the machine-readable plan and the brief in `.senior/features/`, so `/senior:pair`, the editor and the terminal app can all continue it. Use this shape:

```json
{
  "feature": "gym-bookings",
  "title": "Gym class bookings",
  "goal": "Members book a place in this week's classes. A class never holds more people than its capacity.",
  "decisions": ["D-001 Bookings are made atomic with a unique constraint on the slot"],
  "examples": ["Booking a full 9:00 slot shows 'This slot is taken'"],
  "design": {
    "answers": [{ "question": "One gym or several branches?", "answer": "One gym for now." }],
    "risks": [{ "title": "Two members take the last place", "scene": "...", "cause": "...", "prevention": "...", "regret": "R-bookings-01" }]
  },
  "steps": [
    { "title": "Turn the examples into tests", "why": "They define done.", "expect": "Three tests fail because booking does not exist yet.", "files": ["tests/test_bookings.py"], "check": "pytest tests/test_bookings.py" }
  ]
}
```

   Keep each step small enough to review in about a minute. Each step names the files it touches, the expected result, and the command that checks it. The first step is always to turn the examples into tests and see them fail.

## Step 7. Hand over

End with three or four sentences: what you decided, the one risk to keep in mind, and the first step. Then start the first step unless the user wants to pause. If the Senior editor extension is connected, build the steps with `/senior:pair continue <feature>` so the user writes the important lines themselves.
