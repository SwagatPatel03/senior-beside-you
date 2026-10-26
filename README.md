# Senior: a senior developer beside you

Coding with an AI agent is fast, but it is easy to end up with code you cannot explain. Senior keeps the speed and gives back the understanding. It works the way a good senior developer does when they sit next to you:

- It settles the big decisions before any code is written, and names the traps most likely to hurt later.
- It lets you write the lines that carry the logic, and fills in the routine code around them.
- It explains each decision at the moment it matters, not in a lecture before or a summary after.
- It remembers why things were done, and brings that reason back when you touch the code again.

The design behind it is in [docs/architectures.md](docs/architectures.md).

## The two parts

| Part | What it is | Where |
| --- | --- | --- |
| **The senior plugin for Claude Code** | Design sessions, a decision ledger with callbacks, a regret library of known failures, narration rules, onboarding for large repos, the project story, pairing in your editor, and a fast lane whose work you can replay afterwards. | [`plugin/`](plugin) |
| **Senior for VS Code** | The editor side of pairing: the plan traced on the lines you write, routine code filled in, three gears for how hands-on you want to be, a journal of the session, and a viewer for replays. | [`apps/vscode/`](apps/vscode) |

The plugin works on its own in any terminal. The extension needs the plugin, because Claude Code does the thinking and the extension is how it reaches your editor.

## Install

You need [Claude Code](https://claude.com/claude-code) and Node.js 20 or later. Building the VS Code extension from source needs Node.js 22 or later.

**The plugin.** Inside Claude Code:

```
/plugin marketplace add SwagatPatel03/senior-beside-you
/plugin install senior@senior-beside-you
```

**The VS Code extension.** Build it from this repository and install the package:

```
git clone https://github.com/SwagatPatel03/senior-beside-you.git
cd senior-beside-you
npm install
npm run package -w apps/vscode
code --install-extension apps/vscode/dist/senior.vsix
```

If you install the extension first, its panel offers to install the plugin for you. It shows the two commands before it runs them.

## Use it

Open your project and start Claude Code in its folder. Start with `/senior:onboard`, whether your project is big or empty. In a codebase, the senior reads the code, tells you what it noticed, and asks which of those choices were deliberate, so its memory starts with your real decisions. In an empty folder, it asks what you want to build and starts a design session. Either way, it ends by showing you what the other commands do, using your own code and decisions.

| Command | What it does |
| --- | --- |
| `/senior:onboard [area]` | The place to start. Maps the codebase once, writes `.senior/repo-map.md`, and on the first day records the existing choices you confirm as decisions. In an empty folder, it starts the design session. |
| `/senior:design <feature>` | Before code: asks the two or three questions that change the design, names the three things most likely to hurt later, confirms examples that become the first tests, sorts decisions into one-way and two-way, records them, and saves a step-by-step plan. |
| `/senior:pair <feature>` | Builds the plan with you in VS Code. You type the important lines over a plan traced in your file, the routine code is filled in, each step is checked by running it, and each decision is linked to the code that carries it out. While you type one step, a navigator prepares the next in the background, so there is no wait between steps. Runs the design session first if there is no plan. Use `/senior:pair continue <feature>` to pick up a plan. |
| `/senior:fast <task>` | The fast lane for deadline days. One quick pushback when the task as asked breaks a recorded decision or walks into a known failure, then full speed. Every edit and command is recorded with the reason given for it. |
| `/senior:replay` | Turns the last session into a replay of three to eight scenes, and walks you through it in the Senior panel or in the terminal. You can stop on any scene and ask why. |
| `/senior:why <question>` | Answers "why is it like this?" from the decision ledger, then carries on. |
| `/senior:decide <decision>` | Records a decision in the middle of a build, or replaces one through an announced change. |
| `/senior:regret <lesson>` | Adds a failure you learned from to your project's regret library, so the next design session checks for it. |
| `/senior:story` | Turns the ledger and session records into one page per module, written so you can tell it in an interview. |

For narration in the terminal that follows the senior's rules (one line before each step, quiet during boilerplate, expected results written before running, and "Verified / Not verified" at the end), run `/output-style senior:Senior`. In a settings file the name needs the plugin prefix: `"outputStyle": "senior:Senior"`.

Callbacks need no command. When an edit or a failure touches code linked to an earlier decision, the senior brings that decision back. Matching is by file path and symbol name, never by guessing from words.

### What it keeps in your project

The first design session creates `.senior/` in your project. The hooks do nothing in projects without it, so the plugin stays out of the way elsewhere.

| Folder | What is in it |
| --- | --- |
| `ledger/` | One JSON file per decision: what was chosen, what was rejected and why, the risk it guards, and where it lives in the code. |
| `features/` | The plan for each feature and its design brief. |
| `regrets/` | Your own regret library entries, read alongside the seed library in [`plugin/regrets/`](plugin/regrets). |
| `story/` | The project story, one page per module. |
| `replays/` | Replays of fast work, as JSON for the editor and Markdown for reading. |
| `sessions/`, `state/` | Records of what happened in each session, used for the story. Not committed: `.senior/.gitignore` leaves them out. |

Commit the rest of `.senior/` with your code. It is the memory of why your code is the way it is.

You do not have to read these files yourself. In VS Code, each decision shows as a line above the code it is about, and its whole record opens in the Senior panel. See [Decisions in the code](apps/vscode/README.md#decisions-in-the-code).

## How the editor connection works

```
Claude Code ── senior plugin ── editor bridge (MCP, stdio)
                                      │
                                      │  HTTP on 127.0.0.1, random port, per-window token
                                      ▼
                         VS Code ── Senior extension ── traced plan, panel, journal
```

Each VS Code window with the extension writes a lock file to `~/.senior/ide/` with its port and a random token, readable only by your user. The bridge picks the window whose folder contains the folder Claude Code is working in. The extension refuses requests without the token and every request that comes from a web page. Neither part sends anything over the internet; Claude Code does the model work under your own account.

The plugin's hooks also tell the editor, in the background, what Claude Code is doing at each moment, which the panel shows as a live line. The navigator that prepares the next step is a Claude Code subagent (`plugin/agents/navigator.md`) that only reads the code, so it never needs to ask for permission while it works.

## Does the design session catch the risks you would miss?

This is the riskiest idea in the design, so it has its own test. Run:

```
npm run eval:foresight -- --conditions with,without,plain
```

It runs the design session in dry-run mode on eight feature requests that each hide a known trap. Five traps are in the regret library: double booking, timezones, a query inside a loop, unlimited uploads and duplicate payment webhooks. Three are deliberately left out of it: soft-deleted users signing up again, an email sent before the database commit, and offset pagination on a live feed. That way the test also shows whether the senior generalises or only repeats the library. A separate judge model decides whether each trap was named before code. The pass mark is at least four of the five library traps named with the library.

Each run calls Claude, so it uses your plan's usage. Start with `--tasks double-booking,timezones` and `--runs 1`, and use `--runs 3` before trusting a result, because one run can be lucky. `--regrade <results folder>` judges saved transcripts again without rerunning the design sessions.

## The Senior CLI

The skills use it, and you can too. Run it from your project folder:

```
node "<path to>/plugin/cli/senior.mjs" status
node "<path to>/plugin/cli/senior.mjs" ledger find src/bookings/service.py
node "<path to>/plugin/cli/senior.mjs" plan list
node "<path to>/plugin/cli/senior.mjs" sessions --all
```

Run it with no arguments to see every command.

## Develop

```
npm install
npm test                                   # plugin tests and the extension's unit tests
npm run typecheck
npm run build
npm run test:integration -w apps/vscode    # the extension inside a real VS Code
npm run test:vsix -w apps/vscode           # packages the extension and tests the installed package
npm run test:e2e -w apps/vscode            # a real Claude Code session pairing in VS Code
npm run validate                           # checks the plugin and marketplace manifests
```

The integration tests download VS Code into `apps/vscode/.vscode-test/` the first time. The end-to-end test uses your Claude Code login and takes a few minutes. Set `SENIOR_DEBUG=1` before starting Claude Code to log every hook input and error to `.senior/state/debug.log`.

| Folder | What is in it |
| --- | --- |
| `plugin/core/` | The shared library: ledger, plans, regret library, callbacks, session records. No dependencies and no knowledge of Claude Code or VS Code. |
| `plugin/cli/` | The Senior CLI, the only writer of the ledger. |
| `plugin/hooks/`, `plugin/bridge/` | Thin wrappers that connect the core to Claude Code and to the editor. |
| `plugin/skills/`, `plugin/agents/`, `plugin/output-styles/`, `plugin/regrets/` | Prompts and data. |
| `apps/vscode/` | The VS Code extension. |
| `evals/foresight/` | The test of the design session. |
| `test/` | Tests for the plugin. |

## Limits

- **Destructive commands** are discouraged by the senior's rules, which are only instructions. Turn on Claude Code's sandbox (`/sandbox`) and keep production credentials out of the project.
- **Mechanical checks** such as secret scanning and "a fix's test must fail without the fix" are asked for by the narration rules, not enforced by code.
- **Other inline suggestion extensions**, such as GitHub Copilot, are quieted while you write a piece by turning off `editor.inlineSuggest.enabled` in your user settings for that time. VS Code has no way to hide another extension's suggestions for only a few lines. Settings Sync can copy that temporary change to other machines, and other open VS Code windows lose ghost text for that time too.

## Regret library sources

The seed entries describe well-known failure patterns from sources such as the OWASP cheat sheets, payment provider documentation and ORM guides. Each entry names its source in general terms. When you find a real postmortem or issue thread for an entry, add the link to its **Source** line.

## License

MIT
