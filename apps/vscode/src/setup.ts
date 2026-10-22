// Connecting Senior to Claude Code: checking that Claude Code is installed, that the senior plugin
// is enabled, and installing it on request. Nothing here runs without the user asking.

import { exec, execFile } from 'node:child_process';
import * as vscode from 'vscode';

const MARKETPLACE = 'SwagatPatel03/senior-beside-you';
const PLUGIN = 'senior@senior-beside-you';

function run(args: string[], timeoutMs = 60_000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const done = (err: Error | null, stdout: string, stderr: string) => resolve({ ok: !err, out: `${stdout}${stderr}`.trim() });
    const options = { timeout: timeoutMs, windowsHide: true };
    // On Windows a shell finds both claude.exe (native installer) and claude.cmd (npm).
    // The arguments are fixed strings from this file, never user input.
    if (process.platform === 'win32') exec(`claude ${args.join(' ')}`, options, done);
    else execFile('claude', args, options, done);
  });
}

export async function detect(): Promise<{ claudeFound: boolean; pluginInstalled: boolean | 'unknown' }> {
  const version = await run(['--version'], 15_000);
  if (!version.ok) return { claudeFound: false, pluginInstalled: false };
  const plugins = await run(['plugin', 'list'], 20_000);
  if (!plugins.ok) return { claudeFound: true, pluginInstalled: 'unknown' };
  return { claudeFound: true, pluginInstalled: /\bsenior@/.test(plugins.out) };
}

export async function installPlugin(log: vscode.LogOutputChannel): Promise<boolean> {
  const choice = await vscode.window.showInformationMessage(
    'Senior will run two Claude Code commands to add its plugin:',
    { modal: true, detail: `claude plugin marketplace add ${MARKETPLACE}\nclaude plugin install ${PLUGIN}` },
    'Run them',
    'Copy them',
  );
  if (choice === 'Copy them') {
    await vscode.env.clipboard.writeText(`claude plugin marketplace add ${MARKETPLACE}\nclaude plugin install ${PLUGIN}`);
    void vscode.window.showInformationMessage('The commands are on your clipboard. Run them in a terminal.');
    return false;
  }
  if (choice !== 'Run them') return false;

  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Setting up Claude Code for Senior' }, async () => {
    for (const args of [['plugin', 'marketplace', 'add', MARKETPLACE], ['plugin', 'install', PLUGIN]]) {
      log.info(`claude ${args.join(' ')}`);
      const result = await run(args, 120_000);
      log.info(result.out);
      // Adding a marketplace that is already there is not a failure.
      if (!result.ok && !/already/i.test(result.out)) {
        void vscode.window.showErrorMessage(`"claude ${args.join(' ')}" failed. The Senior output channel has the details.`, 'Show details').then((c) => {
          if (c) log.show();
        });
        return false;
      }
    }
    void vscode.window.showInformationMessage('Claude Code is ready. In Claude Code, run /senior:pair followed by what you want to build.');
    return true;
  });
}
