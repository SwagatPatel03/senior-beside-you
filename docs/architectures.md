# A Senior Developer Beside You: Architectures

Oct 20, 2026 · Swagat Swaroop Patel

This is the design document the project is built from. The code follows its build order.

## The answer in short

The feeling of a senior beside you is buildable, but not as a plugin that changes how one agent talks. It needs a different way of producing code: a fast model that talks while a strong model decides, and code that appears in your editor for you to write, not in files the agent writes for you.

- Four architectures, from cheapest to most complete: **A** senior mode on your existing agent, **D** shadow senior with replays, **B** two brains (planner and fast narrator), **C** ghost pair in the editor.
- Recommended: C as the face, B as the engine, D as the fast lane for deadline days. C is the only design where you write the important lines yourself, which is what lets you explain them later.
- Shared underneath: a decision ledger, a regret library of failures other people already learned from, narration rules, consequence callbacks, repo onboarding and a project story.
- No big mistakes: destructive actions are made impossible by the sandbox, and known security holes and false "done" claims are caught by mechanical checks before they land. Hard-to-undo architecture choices get an independent second review. Zero mistakes cannot be promised; mistakes reaching you can be made rare.
- Still unproven: whether the model's foresight is good enough even with the regret library, and whether typing the important lines is fast enough for office work. Both can be tested on your own projects in the first weeks.
- Start this week with A on your own project. Its parts carry over unchanged, and it tests the design session and the regret library before you build anything bigger.

## What the feeling is made of

A senior beside you gives eight things at once. Today's coding agents give two or three of them, and the missing ones are why an agent feels like a tool rather than a person.

| # | What the senior does | What an agent does today |
| --- | --- | --- |
| F1 | Starts talking within seconds; never leaves you in silence | Thinks for seconds to minutes, then shows a block of work |
| F2 | Decides the big things before any code, because they know what will hurt later | Decides as it goes, one file at a time, unless pushed into plan mode |
| F3 | Thinks out loud, including wrong guesses and backtracking | Shows the result; the hunt stays hidden or is summarised |
| F4 | Keeps you hands-on: "write def sync()" and you type it | Writes whole files itself; you approve or reject |
| F5 | Answers "why?" at any moment, then carries on where it was | Interrupting usually derails the turn |
| F6 | Wastes none of your time: picks right the first time, skips the obvious | Picks plausible options, then fixes them; asks you to choose without knowing |
| F7 | Explains a decision when it pays off: "remember day one? This is why" | Explains at the moment it acts, when you can't yet see why it matters |
| F8 | Leaves you able to tell the story of every part months later | Leaves a chat log nobody rereads |

## Hurdles found by walking through real sessions

Sessions walked through: a gym booking app from scratch, a CSV export on a large office codebase with a demo tomorrow, a checkout error in production, a manager demanding brute force, and an interview three months later. Any design that ignores one of the first six will not feel like a senior.

| # | Hurdle | Where it showed up | Why it is hard |
| --- | --- | --- | --- |
| H1 | Silence while the model thinks | Every session, first prompt | Good decisions need the slow, strong model; fast talk needs a fast one |
| H2 | Agents write whole files; people write line by line | Building any feature | Agent edit tools replace blocks of text. Line-by-line dictation needs a different kind of output |
| H3 | Typing every line is too slow for office deadlines | CSV export with a demo tomorrow | Being hands-on and being fast pull in opposite directions |
| H4 | Foresight depends on the model, and it can be confidently wrong | Gym app: double bookings and timezones | No tool can make the model's judgment correct; it can only give it better information and check it |
| H5 | Narrating everything is noise | Every session after the first ten minutes | The tool must know which moments matter before it speaks |
| H6 | Interrupting breaks the flow | Gym app, while writing the data model | The agent must pause, answer and resume exactly where it was |
| H7 | Debugging is hidden | Checkout error | The hunt is where you learn most, and agents summarise it away |
| H8 | Office code is big and unfamiliar | CSV export on a large codebase | The senior must learn the repo's layout and conventions before advising |
| H9 | Company tool rules | Any office | A design needing its own API key or sending code to a new server may not be allowed at work |
| H10 | Manager pressure and brute force | "Just retry it five times" | The senior must push back quickly with the consequence, and offer a fast lane when the deadline is real |
| H11 | Explanations only stick when tied to a moment | Day 3 of the gym app | The tool must remember which decision lives in which code, and notice when that code matters |
| H12 | Explaining months later | Interview at a new company | You need the story of each part, not a chat log |
| H13 | Cost | Long sessions | Narration and a second model add tokens |

## Architecture A: senior mode on your existing agent

Change how Claude Code or Codex behaves, without building a new app. It fixes decisions and memory well, but the agent still works in silent bursts, so it explains around the work rather than during it.

1. **Design session first.** A skill runs before any feature: the agent asks the two or three questions that change the design, names the three things most likely to hurt later, and writes the decisions into a ledger. No code until that is done.
2. **Narration rules.** An output style tells the agent to say one line before each step (what and why), stay quiet for boilerplate, and think out loud when something fails.
3. **Consequence callbacks.** A hook watches which files each step touches. When a file linked to a past decision is edited or breaks, the hook reminds the agent to bring that decision up.
4. **Project story.** At the end of each session the ledger and the session's bugs are turned into a short story per module.

Delivers F2, F6 partly, F7 and F8 well. F1, F3, F4 and F5 poorly. H1 and H2 stay unsolved, because the agent's loop is unchanged. Interrupting mid-burst (H6) still derails the turn. The hooks only link files to decisions, which is mechanical and reliable. Effort: days.

## Architecture B: two brains, a planner and a fast narrator

1. **The planner decides up front.** A strong model runs the design session and writes a plan file: the architecture, the risks, and an ordered list of small steps. The plan changes only through an announced decision.
2. **The narrator drives in real time.** A fast model takes one step at a time, says what it is about to do, writes code in small pieces, runs it and reports, streaming words as they are generated.
3. **The planner thinks ahead in the background**, reviewing the next steps against what has been built.
4. **Escalation is visible.** When a test fails twice, an error surprises the narrator, or you ask a design question, the narrator hands over and the planner's reasoning appears as thinking out loud (H7).
5. **An interrupt controller holds the state** (plan, current step, half-written change). On "why?" it pauses, answers from the plan and ledger, then resumes at the same line (H6).

Delivers F1, F3, F5 well, F2 through the planner, F7 and F8 through the ledger, F4 only partly. Risks: narrator drift, model disagreement (the planner always wins), office access (H9), cost (H13). Effort: weeks, on the Claude Agent SDK.

## Architecture C: ghost pair in the editor

1. **Ghost text for the next lines** at your cursor (VS Code inline completions). Type over it or press Tab.
2. **Spine and flesh.** The planner marks each line as spine (logic and decisions you write yourself) or flesh (imports, boilerplate). Flesh fills in by itself; spine waits for you (H3).
3. **The senior moves you around** the codebase in the order a senior would build.
4. **The why panel** shows narration for the current line and can read it aloud. A hotkey asks "why?" about the line under the cursor (H5, H6).
5. **Debugging in place.** The senior puts the check it wants to try into the editor as ghost text and says what it expects to see (H7).
6. **Three gears.** Type, Accept, Watch.

Office access: VS Code's Language Model API lets extensions use Copilot's models with the user's consent (H9). Delivers F4 strongly, F5 and F3 well, F7 and F8 strongly. F1 and F2 depend on B underneath. Risks: large refactors, editor-bound, conflicts with Copilot ghost text, inline suggestions must be driven by the extension. Effort: weeks to months.

## Architecture D: shadow senior, full speed now, replay after

1. **A quick pushback** against the ledger and regret library before work starts (H10).
2. **A recorder with no slowdown**: hooks capture every edit, command, test result and error, plus the agent's stated reason.
3. **A story builder** turns the record into a replay in scenes you can pause and ask "why?" on.
4. **Callbacks later**, through the same ledger.

Delivers F6 fully, F8 strongly, F7 and F3 after the fact. Risks: replays go unwatched; stated reasons are not always real reasons; on its own it is watching, not living through it. Effort: days to weeks.

## Parts every architecture needs

| Part | What it holds | Hurdles |
| --- | --- | --- |
| Decision ledger | Each decision: chosen, rejected, why, which risk it guards, which files and functions it lives in, when it will pay off. Changed only by announced decisions | H4, H11, H12 |
| Regret library | For common app types: the usual decisions and the failures that taught people. Seeded from public postmortems, grown from your own incidents. Read at design time | H4, H10 |
| Narration rules | Speak at decisions, risks, surprises, failures and payoffs. One line for routine steps; silent for boilerplate. Never quiz. Ask only for facts only you know | H1, H5 |
| Consequence callbacks | When an edit, a failing test or a new feature touches code linked to a ledger entry, the senior brings that decision back | H11 |
| Repo onboarding | A first pass maps layout, conventions and existing patterns, so the senior copies the house style | H8 |
| Project story | Per module: what it does, decisions, bugs and how they were found, trade-offs | H12 |
| Pushback rule | One line on the consequence and a better option, then do what you choose | H10 |

The regret library is the most original part and the least proven. The first prototype should test it on a known failure, such as double bookings, with and without the library.

## No big mistakes: the safety layer

| Big mistake | How it is stopped | Strength |
| --- | --- | --- |
| Deleting work, wiping a database, touching production | Sandbox on its own git branch, snapshot before every step, no production credentials, destructive commands denied by the sandbox's own rules | Impossible by construction |
| Leaking secrets or shipping open data | Fixed scanners before every commit: secrets, database access rules, server-side permission checks | Caught before it lands, for known patterns |
| Choosing an architecture that is hard to undo | One-way vs two-way. One-way decisions need the regret library, an independent review by a different model that sees only requirements and proposal, and a comparison with established open-source projects | Made rare |
| Claiming done when it isn't | The tool runs the tests, not the agent. Every fix must make its test fail when the fix is removed | Caught before it lands |
| Hours spent in the wrong direction | Small steps with the expected result written down first. No step bigger than about a minute of review | Made rare, and cheap |
| Building the wrong thing | Three to five concrete examples confirmed before coding; they become the first tests | Made rare |

Every check that can be mechanical is mechanical, and the model reviews only what no tool can. What still gets through: logic errors no test covers, requirements nobody stated, mistakes the reviewer shares with the planner. The tool says plainly at the end of each task what was verified and what was not.

## Recommended combination and build order

Build C as the face, B as the engine, D as the fast lane, with the shared parts underneath. Build in the order that tests the riskiest idea first.

1. **Week 1: A on your own project.** Design session, narration rules, ledger, callbacks and a first regret library, as Claude Code skills and hooks. Test: does the design session catch the risks you would have missed, and do callbacks land at the right moments?
2. **Weeks 2 to 4: B as a terminal app.** Planner, narrator and interrupt controller on the Agent SDK. Test: does it feel live?
3. **Weeks 4 to 8: C as a VS Code extension on B.** Test: is typing the spine fast enough, and can you explain the module a week later?
4. **Any time: D.** Add it when you first hit a real deadline.

**What not to build.** No quizzes. No word-guessing hooks deciding when to interrupt. No architecture map that rewrites itself every prompt.

## What could still kill it, and the cheapest tests

| Risk | Cheapest test | Proposed pass mark |
| --- | --- | --- |
| The model's foresight is not good enough, even with the regret library | Five tasks with known traps (double bookings, timezones, a query inside a loop, unlimited uploads, payment webhooks arriving twice), with and without the library | With the library, the senior names at least 4 of the 5 traps before writing code |
| Typing the spine is too slow | Build the same small feature in C's Type gear and with a plain agent | Type gear takes no more than about twice as long, and you can explain it afterwards |
| Narration becomes noise | Three real sessions; count each mute, skip or skim | Fewer than a handful of skips per session after tuning |
| The fast narrator drifts from the plan | Log every narrator action not in the current step | Drift is rare and every drift was escalated |
| You don't actually learn | A week later, explain the module to a friend without notes | You can answer most whys |

The pass marks are proposals, not established benchmarks.

## Sources

- Claude Agent SDK: streaming output (Architecture B)
- Claude Code hooks reference: background hooks (Architectures A and D)
- VS Code Language Model API (Architecture C)
- VS Code InlineCompletionItemProvider (Architecture C)
- What Novice Vibe Coders Struggle With
