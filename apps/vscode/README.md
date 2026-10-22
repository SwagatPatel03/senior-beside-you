# Senior

**A senior developer beside you, in your editor.**

You write the lines that carry the logic. Senior fills in the routine code around them, explains each decision at the moment it matters, and remembers why it was made. You keep your speed, and you understand every line you ship.

Senior works with [Claude Code](https://claude.com/claude-code). Claude Code does the thinking: it plans each step, writes the code and runs the checks. Senior is how that work reaches you. It arrives as ghost text in your editor, with a short reason for every piece and a journal you can scroll back through.

## How a step feels

1. Claude Code explains the next step in a sentence or two in the Senior panel.
2. The routine parts, such as imports and error messages, appear in your file on their own.
3. For the lines that matter, Senior shows the code as ghost text and you type it. The panel tells you why the piece exists while you write it.
4. Claude Code runs the check it named before you started, and the panel shows whether the result was the one expected.
5. The step ends with what was verified, what was not, and one takeaway worth remembering.

If you are curious about a line, put the cursor on it and press Ctrl+Alt+/ (Cmd+Alt+/ on a Mac). The answer appears in the panel, and the step carries on.

## Three gears

| Gear | What happens | When it helps |
| --- | --- | --- |
| **Type** | You type the important lines. Ghost text shows the rest of each line. | You want to learn the code by writing it. |
| **Accept** | The whole piece shows as ghost text, and Tab accepts it while you read why. | You understand the idea and want to move faster. |
| **Watch** | Senior types the piece at reading speed, and Escape hands it back to you. | The code is new to you and you want to see it built first. |

You can change gear at any time from the panel, from the status bar, or with Ctrl+Alt+G. The change applies to the piece you are on.

## When your line differs from the plan

Senior notices when what you typed is different from the plan. It never overwrites your code. You can keep your version, and Claude Code adapts the rest of the step to it, or you can ask to see the plan again.

## When something fails

Claude Code says what it expects before it runs a check. When a check fails, it says what it thinks went wrong, and it may ask you to type a short probe, such as a print statement, to test that guess. You see the reasoning, not only the fix.

## The journal

The Senior panel keeps a journal of the session: each step, its pieces, your questions and the answers, the checks and the takeaways. A quiet meter at the bottom counts the lines you wrote by hand and the lines Senior wrote, so you can see how hands-on you have been.

When your project has a `.senior` folder, which the Claude Code plugin creates, Senior also records what happened in the editor in `.senior/sessions/`. The plugin uses these records to write the story of your project with `/senior:story`.

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
| Senior: Show the Senior panel | |
| Senior: Set up Claude Code for Senior | |

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `senior.gear` | `type` | How hands-on you want to be: `type`, `accept` or `watch`. |
| `senior.watchSpeed` | `40` | Characters per second when Senior types in the watch gear. |
| `senior.readAloud` | `false` | Reads the narration aloud with your system voice. |

The colours of the slot you are writing in, the hints and the highlights follow your theme. You can change them in `workbench.colorCustomizations` with the `senior.*` colour ids.

## Privacy and security

- Senior does not call any AI service and sends nothing over the internet. Claude Code does the model work under your own account.
- Claude Code reaches the editor through a small server that listens only on 127.0.0.1, on a random port. Each window makes a new random token and keeps it in a lock file in `~/.senior/ide/` that only your user can read. Requests without the token, and every request from a web page, are refused.
- Senior opens and edits only files inside the open workspace.

## Troubleshooting

- **The panel says "Waiting for Claude Code".** Claude Code must run in the window's folder or in a folder inside it. Run `claude plugin list` to check that the senior plugin is installed and enabled.
- **The ghost text does not appear.** Check that `editor.inlineSuggest.enabled` is on. Other extensions that show inline suggestions, such as GitHub Copilot, can take the place of Senior's ghost text, so pause them while you pair.
- **Several VS Code windows are open.** Senior connects Claude Code to the window whose folder contains the folder Claude Code is working in.

## License

MIT
