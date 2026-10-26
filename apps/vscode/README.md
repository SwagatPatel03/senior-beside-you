# Senior

**A senior developer beside you, in your editor.**

You write the lines that carry the logic. Senior fills in the routine code around them, explains each decision at the moment it matters, and remembers why it was made. You keep your speed, and you understand every line you ship.

Senior works with [Claude Code](https://claude.com/claude-code). Claude Code does the thinking: it plans each step, writes the code and runs the checks. Senior is how that work reaches you. It arrives as a plan traced on the lines of your file, with a short reason for every piece and a journal you can scroll back through.

## How a step feels

1. The senior introduces the step in a sentence or two the moment it starts. With **Read aloud** on, your computer's voice says it too.
2. The routine parts, such as imports and error messages, appear in your file on their own.
3. For the lines that matter, Senior opens one empty line for each line of the piece and traces the plan on them in a faint brass colour. You type over it, and Enter takes you to the next planned line. A line above the piece says what it is for, with **Why?**, **Fill in** and **Skip**, and the panel tells you what detail to notice in it.
4. Claude Code runs the check it named before you started, and the panel shows whether the result was the one expected.
5. The step ends with what was verified, what was not, and one takeaway worth remembering. The next step opens in the same moment.

## No waiting between steps

You and Claude Code work like a human pair: you are the driver for the important lines, and Claude Code is the navigator who thinks ahead. While you type one step, a helper prepares the next one in the background, with its pieces and what the senior will say about them. When your check passes, the next step is already there.

A quiet line under the Senior heading always shows what Claude Code is doing, such as reading a file, running the tests or thinking, and for how long. You are never left wondering whether anything is happening.

## Asking why

Put the cursor on any line and press Ctrl+Alt+/ (Cmd+Alt+/ on a Mac). If the line came from a guided piece or carries out a recorded decision, the answer appears at once: why the piece exists, what to notice, the decision behind it and the options that were turned down. **Ask more about this line** sends your own question to Claude Code, which answers in the panel and carries on where it was.

## Decisions in the code

You never need to open `.senior/ledger/` to know why the code is the way it is. Each recorded decision shows as one quiet line above the code it is about, such as "D-004: Stop double bookings with a unique rule in the database". The line also says whether the decision is hard or easy to undo, and it has two links, **Why?** and **Full record**.

- **Why?** opens a card with what was chosen, why, what was turned down and why, what it protects against, and when you will see it matter. The same card opens when you hover over the linked name.
- **Full record** opens every detail in the Senior panel. That includes examples, the checks done before a hard-to-undo decision, where the decision lives in the code, and its history: when it was made, each time the senior brought it back, and whether it was replaced. At the bottom, **Show the original record** shows the stored JSON exactly as it is, so nothing is ever hidden.
- When a decision replaces an older one, the line says so, and the card shows what changed.
- When two or more decisions are about the same code, they share one line, "2 decisions are about reserveSlot.", with **Show them**.
- The status bar counts the decisions linked to the open file. Click the count to choose one.

A decision shows above the first definition of each symbol linked to it. A decision linked only by a path shows at the top of the file. As with callbacks, nothing is guessed from words. The lines update by themselves when a decision is recorded, linked or replaced. The history of when a decision was brought back comes from `.senior/sessions/`, which is not committed, so each computer shows its own.

## Three gears

| Gear | What happens | When it helps |
| --- | --- | --- |
| **Type** | You type the important lines over the traced plan. | You want to learn the code by writing it. |
| **Accept** | The plan is traced the same way, and Tab accepts the whole piece while you read why. | You understand the idea and want to move faster. |
| **Watch** | Senior types the piece at reading speed, and Escape hands it back to you. | The code is new to you and you want to see it built first. |

You can change gear at any time from the panel, from the status bar, or with Ctrl+Alt+G. The change applies to the piece you are on.

## When your line differs from the plan

Senior notices when what you typed is different from the plan. The line gets a dotted underline and a note that shows what the plan has. Senior never overwrites your code. You can keep your version, and Claude Code adapts the rest of the step to it, or you can ask to see the plan again.

## Senior and other suggestions

Senior's plan is drawn in its own colour and does not use VS Code's inline suggestions, so IntelliSense can never hide it or be mistaken for it. The IntelliSense popup keeps working as usual, and Tab and Enter still accept its suggestions while it is open.

Ghost text from other extensions, such as GitHub Copilot, would appear on the same lines as the plan. While you write a piece, Senior turns off `editor.inlineSuggest.enabled` in your user settings, and it puts your setting back when the guide ends. If VS Code closes in the middle of a piece, Senior puts the setting back the next time it starts. To keep other ghost text on, turn off **Senior: Quiet Other Ghost Text** in the settings.

## When something fails

Claude Code says what it expects before it runs a check. When a check fails, Senior opens the line the failure points at, marks it, and reminds you of the risk the plan named for this step, while Claude Code is still thinking. You look at the same evidence as the senior. Then it says what it thinks went wrong, and it may ask you to type a short probe, such as a print statement, to test that guess. You see the hunt, not only the fix.

## The journal

The Senior panel keeps a journal of the session: each step, its pieces, your questions and the answers, the checks and the takeaways. A quiet meter at the bottom counts the lines you wrote by hand and the lines Senior wrote, so you can see how hands-on you have been.

When your project has a `.senior` folder, which the Claude Code plugin creates, Senior also records what happened in the editor in `.senior/sessions/`. The plugin uses these records to write the story of your project with `/senior:story`.

## Replays of fast work

Some days there is no time to type anything. In Claude Code, `/senior:fast <task>` does the work at full speed. It pushes back once if the task as asked would break a recorded decision or walk into a known failure. It records every step with the reason given at the time. Later, `/senior:replay` turns that record into a few short scenes and opens them in the Senior panel. You move through the scenes at your own pace, open each change side by side, and ask why on any scene. Claude Code answers in the panel while the replay is running.

Saved replays stay in `.senior/replays/`. Watch one again at any time with **Senior: Watch a replay**, or from the list in the panel.

## Getting started

You need:

- VS Code 1.95 or later.
- Claude Code, signed in with your own account.
- Node.js 20 or later, which the senior plugin for Claude Code uses.

Then:

1. Install this extension and open your project folder.
2. Open the Senior panel from the activity bar (the spectacles icon). If the senior plugin is not installed in Claude Code yet, click **Set it up**. Senior shows you the two commands it will run before it runs them.
3. Start Claude Code in the same folder, in the integrated terminal or in the Claude Code extension, and run:

   ```
   /senior:pair add CSV export for bookings
   ```

If the feature has no plan yet, Claude Code starts with a short design session. Then it guides you through the first step in the editor.

## Commands and keys

| Command | Key |
| --- | --- |
| Senior: Why is this line here? | Ctrl+Alt+/ (Cmd+Alt+/ on a Mac) |
| Senior: Change gear | Ctrl+Alt+G (Cmd+Alt+G on a Mac) |
| Senior: Take over typing | Escape, while Senior is typing |
| Senior: Fill in this piece for me | |
| Senior: Skip this piece | |
| Senior: Show the decisions linked to this file | |
| Senior: Watch a replay | Left and right arrows move between scenes |
| Senior: Show the Senior panel | |
| Senior: Set up Claude Code for Senior | |

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `senior.gear` | `type` | How hands-on you want to be: `type`, `accept` or `watch`. |
| `senior.watchSpeed` | `40` | Characters per second when Senior types in the watch gear. |
| `senior.readAloud` | `false` | Reads the narration aloud with your computer's own voice: the built-in speech on Windows, `say` on macOS, and `spd-say` or `espeak` on Linux. |
| `senior.decisionLenses` | `true` | Shows a line above the code each ledger decision is about, with the whole decision on hover. |

The colours of the slot you are writing in, the hints and the highlights follow your theme. You can change them in `workbench.colorCustomizations` with the `senior.*` colour ids.

## Privacy and security

- Senior does not call any AI service and sends nothing over the internet. Claude Code does the model work under your own account.
- Claude Code reaches the editor through a small server that listens only on 127.0.0.1, on a random port. Each window makes a new random token and keeps it in a lock file in `~/.senior/ide/` that only your user can read. Requests without the token, and every request from a web page, are refused.
- Senior opens and edits only files inside the open workspace.

## Troubleshooting

- **The panel says "Waiting for Claude Code".** Claude Code must run in the window's folder or in a folder inside it. Run `claude plugin list` to check that the senior plugin is installed and enabled.
- **The line above the piece does not appear.** It is a CodeLens, so check that `editor.codeLens` is on. The panel shows the same piece, and the Fill in and Skip commands are in the Command Palette.
- **Other ghost text stayed off after a session.** Senior puts `editor.inlineSuggest.enabled` back when a guide ends and again when VS Code starts. If you changed that setting yourself during a piece, Senior keeps your choice.
- **Several VS Code windows are open.** Senior connects Claude Code to the window whose folder contains the folder Claude Code is working in.
- **There is no Read aloud switch.** Senior found no voice on this computer. On Linux, install `speech-dispatcher` (for `spd-say`) or `espeak`, then reload the window.

## License

MIT
