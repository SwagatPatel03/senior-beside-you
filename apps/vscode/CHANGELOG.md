# Changelog

## Unreleased

- Knowledge levels. You rate each technology in the project from 0 to 10 on the new **Levels** page, and every piece is cut and taught at your level in its technology: a card for each new idea and every word explained at the lowest levels, a fading trace in the middle (a shape with blanks, then only the first line, then nothing but a list of what to write), and choices instead of typing at level 10. **Show me** (Alt+S) brings back the full trace, and **Done** (Ctrl+Alt+Enter) finishes a piece written from a description. Below level 7 you type every piece yourself, so the gears are hidden. The page also lists the words you have learned.
- The panel is quieter. Senior's words no longer sit in coloured boxes; the user's own questions carry a quiet rule, checks a thin green or red one, and boxes are kept for things you act on. The current piece no longer repeats its reason in the footer.

- Decisions in the code. Each ledger decision shows as a line above the code it is about, with **Why?** for a card with the whole decision and **Full record** for every detail in the Senior panel, including its history and the stored JSON. The status bar counts the decisions linked to the open file. The new setting `senior.decisionLenses` turns the lines off.
- "About this line" has a **Full record** link for each decision it names.
- A **Decisions and plans** page in the Senior panel shows every decision in the project, including the ones no code carries out yet, and each plan as a checklist of its steps. It opens by itself after a design session, and **Full record** now opens the decision there. When the open file has no linked decisions, the status bar counts the project's decisions and opens this page.

- The plan for a piece you write is traced on its own lines in Senior's colour, so you see the whole piece before you start. It replaces the ghost text, so IntelliSense can no longer hide the plan or be mistaken for it.
- A line above the piece says which piece it is and what it is for, with Why?, Fill in and Skip.
- Enter takes you to the next planned line, and brackets the editor closed by itself are tidied away.
- While you write a piece, ghost text from other extensions, such as GitHub Copilot, is turned off, and your setting comes back afterwards. The new setting `senior.quietOtherGhostText` turns this off.

## 0.1.0 (2026-10-23)

The first release.

- Guided pieces in the editor. Routine code is filled in for you, and the lines that carry the logic appear as ghost text for you to type.
- Three gears: type, accept and watch. You can switch at any time, even in the middle of a piece.
- When your line differs from the plan, you can keep your version or see the plan again. Senior never overwrites what you typed.
- The Senior panel: a journal of steps, pieces, questions, answers, checks and takeaways, with a meter of the lines you wrote by hand.
- Ask why about any line with Ctrl+Alt+/ (Cmd+Alt+/ on a Mac).
- A local bridge that lets Claude Code guide the editor through the senior plugin, and setup of that plugin from the panel.
- Session records in `.senior/sessions/` for the project story.
- Replays of fast work: scene by scene in the panel, each change side by side, and questions answered by Claude Code while `/senior:replay` runs.
- No waiting between steps: while you type one step, a navigator prepares the next, and it opens the moment the current step closes.
- A live line showing what Claude Code is doing and for how long.
- "Why?" on a line answers at once from the piece it came from and the decision behind it.
- A failed check opens the line it points at and recalls the step's risk.
- Read aloud with the computer's own voice on Windows, macOS and Linux.
