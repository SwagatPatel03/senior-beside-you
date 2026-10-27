# Senior in Codex

Senior uses the same project memory, CLI and VS Code extension with Codex and Claude Code.
The Codex package is generated from the maintained workflows; changes to those workflows
carry into both hosts. Node.js 22 or later is needed to build the package and extension.
The runtime integration has been checked with Codex CLI 0.164.0.

## Install from this checkout

In the repository:

```powershell
npm install
npm run build:codex
codex plugin marketplace add ./dist
codex plugin add senior@senior-beside-you
node ./dist/codex/codex/install-hooks.mjs "C:\path\to\your-project"
```

Keep this checkout in place when using the last command: its project hooks point to the
built runtime. Re-run it after moving the checkout. Installing from the VS Code panel
instead points the hooks to Codex's installed plugin copy.

Open that project in Codex, accept its normal project trust prompt, and use `/hooks` to
review and trust Senior's handlers. Start a new conversation, then use `$senior:onboard`.
Codex skips hooks awaiting review or hooks in an untrusted project. Setup does not change
trust settings. Onboarding also installs the project hooks if you skipped the last command.

In VS Code, install the extension as usual, select **Codex** in the Senior welcome panel,
then click **Set it up**. The command **Senior: Set up Codex for Senior** does the same work:
it installs the bundled Codex plugin and merges hooks into the open project. Existing
project hooks are preserved. The setting `senior.agent` can also select the agent.

```powershell
npm run package -w apps/vscode
code --install-extension apps/vscode/dist/senior.vsix
```

These commands install a local plugin. There is no new model account or API key. Use
Codex's existing login and permissions. Hook scripts and the editor bridge require local
execution; installing the package in a cloud-only conversation cannot run them.

## Workflows

Codex namespaces plugin skills automatically. Type `$` to select one, or use `/skills`.

| Claude Code | Codex |
| --- | --- |
| `/senior:onboard` | `$senior:onboard` |
| `/senior:design` | `$senior:design` |
| `/senior:pair` | `$senior:pair` |
| `/senior:level` | `$senior:level` |
| `/senior:fast` | `$senior:fast` |
| `/senior:replay` | `$senior:replay` |
| `/senior:why` | `$senior:why` |
| `/senior:decide` | `$senior:decide` |
| `/senior:regret` | `$senior:regret` |
| `/senior:story` | `$senior:story` |

For example: `$senior:pair add CSV export for bookings` or
`$senior:pair continue bookings-export`. The navigator uses available Codex helpers;
if helpers are unavailable, the main agent prepares the next step. A specific model
is not required. Public assistant commentary supplies replay reasons when the Codex
transcript exposes it. Transcript formats can change; absent reasons are not invented.
Edits performed through `apply_patch` are recorded per file. Shell commands are recorded
as commands; arbitrary file writes inside a shell script do not provide edit diffs.

## Appearance and interaction

| Surface | Codex support |
| --- | --- |
| Senior's VS Code panel, Type/Accept/Watch, traced pieces and knowledge cards | Same extension and controls |
| Questions, choices, decision lenses, narration and replay viewer | Same editor bridge and UI |
| Live editor activity | Project hooks report Codex tool activity and interruptions |
| Plugin and skill appearance | Senior icon and amber brand color |
| Terminal feedback | `◆` hook status messages and the optional Senior syntax theme |
| Claude's native spinner, footer, welcome and turn-ending UI modifications | No equivalent public Codex mod API was found; these are not ported |

The theme colors code and diffs; it does not replace the whole Codex interface. To use it
in PowerShell:

```powershell
$seniorCodexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
New-Item -ItemType Directory -Force (Join-Path $seniorCodexHome 'themes')
Copy-Item ./dist/codex/codex/senior.tmTheme (Join-Path $seniorCodexHome 'themes/senior.tmTheme')
```

Select **Senior** using `/theme` in Codex. Exact native terminal parity would require a
Codex extension point beyond the documented theme and status-message interfaces, or a
separately maintained Codex fork. This package does not patch Codex binaries.

Project hooks are used consistently on CLI and desktop, rather than relying on the
plugin hook loader, which did not expose bundled hooks in CLI 0.164.0 during testing.
The manifest disables bundled hook discovery to prevent duplicate recording on hosts
that support it. The bundled `hooks/hooks.json` remains the template for project setup.

## Verify changes

```powershell
npm run typecheck
npm test
npm run test:codex
npm run test:integration -w apps/vscode
npm run test:vsix -w apps/vscode
```

`test:codex` requires a Codex CLI on PATH. It builds and installs into a temporary
profile, checks actual skill discovery, MCP startup and hook discovery, and removes
that profile. It makes no model requests and does not use your account credentials.
Full model-driven pairing in Codex is a separate manual check.

References: [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins),
[local MCP packages](https://developers.openai.com/plugins/deploy/desktop-only),
[Codex hooks](https://learn.chatgpt.com/docs/hooks),
[Codex CLI customization](https://learn.chatgpt.com/docs/cli-customization).
