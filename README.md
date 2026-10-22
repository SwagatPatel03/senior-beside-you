# A Senior Developer Beside You

This project builds the feeling of a senior developer sitting next to you while you code. The design is in [docs/architectures.md](docs/architectures.md). It is built in the order that tests the riskiest idea first:

| Stage | What | Status |
| --- | --- | --- |
| Week 1 | **Architecture A**: senior mode for Claude Code, as a plugin | Built, in testing |
| Weeks 2 to 4 | **Architecture B**: planner and fast narrator on the Agent SDK | Not started |
| Weeks 4 to 8 | **Architecture C**: ghost pair VS Code extension on B | Not started |
| Any time | **Architecture D**: shadow senior with replays | The recorder exists; the replay does not |

## What Architecture A gives you

| Part | Where it lives | What it does |
| --- | --- | --- |
| Design session | `/senior:design` | Before code, asks the two or three questions that change the design, names the three things most likely to hurt later, confirms examples that become the first tests, sorts decisions into one-way and two-way, and records them |
| Narration rules | the **Senior** output style | One line before each step, quiet during boilerplate, expected results written before running, thinking out loud on failures, pushback on brute force, and "Verified / Not verified" at the end |
| Decision ledger | `.senior/ledger/` in your project | One JSON file per decision: chosen, rejected, why, risk guarded, payoff, and where it lives in the code |
| Consequence callbacks | hooks | When an edit or a failure touches code linked to an earlier decision, the senior brings that decision back. Matching is by file path and symbol name, never by guessing from words |
| Regret library | `plugin/regrets/` and `.senior/regrets/` | Ten seed topics of known failures, read during the design session. `/senior:regret` adds your own |
| Repo onboarding | `/senior:onboard` | Maps a large codebase once and writes `.senior/repo-map.md` |
| Project story | `/senior:story` | Turns the ledger and session records into one page per module, written so you can tell it in an interview |
| Why | `/senior:why` | Answers "why is it like this?" from the ledger, then carries on |
| Decide | `/senior:decide` | Records a decision mid-build, or replaces one through an announced change |

## Install it on your own project

You need Node.js 20 or later and Claude Code.

**Option 1: install it from GitHub.** Inside Claude Code:

```
/plugin marketplace add SwagatPatel03/senior-beside-you
/plugin install senior@senior-local
```

**Option 2: load it from a local clone for one session.**

```
git clone https://github.com/SwagatPatel03/senior-beside-you.git
cd your-project
claude --plugin-dir "<path to>/senior-beside-you/plugin"
```

Then, in your project:

1. Switch on the narration rules: run `/output-style senior:Senior`, or pick **Senior** from the `/output-style` menu. In a settings file, the name must include the plugin prefix: `"outputStyle": "senior:Senior"`. A plain `"Senior"` silently falls back to the default style.
2. Start a feature with the design session: `/senior:design a gym class booking app where members book limited places`.

The design session creates `.senior/` in your project. The hooks do nothing in projects without that folder, so the plugin stays out of the way elsewhere. Commit `.senior/` to git, except `sessions/` and `state/`, which its own `.gitignore` already excludes.

## The Week 1 tests

The architecture document asks two questions of Week 1. Here is how to answer each one.

**1. Does the design session catch the risks you would have missed?** Run the foresight test:

```
npm run eval:foresight -- --conditions with,without,plain
```

It runs the design session in dry-run mode on eight feature requests that each hide a known trap. Five traps are in the regret library (double booking, timezones, a query inside a loop, unlimited uploads, duplicate payment webhooks). Three are deliberately left out of it (soft-deleted users signing up again, an email sent before the database commit, offset pagination on a live feed), so the test also shows whether the senior generalises or only repeats the library. A separate judge model decides whether each trap was named before code. The proposed pass mark is at least 4 of the 5 library traps named with the library.

Each run calls Claude, so it uses your plan's usage. Start with `--tasks double-booking,timezones` and `--runs 1`, and use `--runs 3` before trusting a result, because one run can be lucky. `--regrade <results folder>` re-judges saved transcripts without rerunning the design sessions.

**2. Do callbacks land at the right moments?** This needs real use. Build a small feature on your own project across at least two sessions on different days. In the second session, note each time a "Senior ledger callback" appeared and whether the senior's comment was useful, noise, or missing when it should have appeared. `.senior/sessions/` records every callback, so `node plugin/cli/senior.mjs sessions --all` shows them afterwards.

## The Senior CLI

The skills call it, and you can too. Run it from your project folder:

```
node "<path to>/plugin/cli/senior.mjs" status
node "<path to>/plugin/cli/senior.mjs" ledger list
node "<path to>/plugin/cli/senior.mjs" ledger find src/bookings/service.py
node "<path to>/plugin/cli/senior.mjs" regrets list
```

Run it with no arguments to see every command.

## Developing

```
npm test           # unit tests and simulated hook sessions
npm run validate   # claude plugin validate on the plugin and the marketplace
```

Set `SENIOR_DEBUG=1` before starting Claude Code to log every hook input and error to `.senior/state/debug.log`.

## What is not built yet

These parts of the design are not in Architecture A and are left for later stages:

- **The sandbox.** Destructive commands are discouraged by the output style, which is only an instruction. The design calls for a sandbox that makes them impossible. Until then, turn on Claude Code's sandbox (`/sandbox`) and keep production credentials out of the project.
- **Mechanical checks.** Secret scanning, database access rule checks, and the "a fix's test must fail without the fix" check are not automated yet. The output style asks for them, which is weaker.
- **Live narration.** A still works in bursts. Silence while it thinks (H1) and line-by-line writing (H2) need Architectures B and C.
- **Replays.** The recorder from Architecture D exists, because the project story needs it. The narrated replay does not.

## Regret library sources

The seed entries describe well-known failure patterns from sources such as the OWASP cheat sheets, payment provider documentation and ORM guides. Each entry names its source in general terms. When you find a real postmortem or issue thread for an entry, add the link to its **Source** line.
