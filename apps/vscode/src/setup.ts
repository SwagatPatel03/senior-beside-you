// Detect the selected coding agent and install Senior when the user requests setup.

import { exec, execFile } from 'node:child_process';
import * as vscode from 'vscode';
import path from 'node:path';

export type AgentHost = 'claude' | 'codex';
export const agentHost = (): AgentHost => vscode.workspace.getConfiguration('senior').get<AgentHost>('agent', 'claude');

const MARKETPLACE = 'SwagatPatel03/senior-beside-you';
const PLUGIN = 'senior@senior-beside-you';

function run(args: string[], timeoutMs = 60_000, host: AgentHost = 'claude'): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const done = (err: Error | null, stdout: string, stderr: string) => resolve({ ok: !err, out: `${stdout}${stderr}`.trim() });
    const options = { timeout: timeoutMs, windowsHide: true };
    // On Windows a shell finds both claude.exe (native installer) and claude.cmd (npm).
    // Arguments include the extension's installation path, which can contain spaces.
    if (process.platform === 'win32') {
      // Reject cmd expansion and metacharacters rather than interpolating an unsafe install path.
      if (args.some((arg) => /["%!&|<>^\r\n]/.test(arg))) {
        resolve({ ok: false, out: 'This install path contains shell characters. Install the plugin manually using the documented commands.' });
        return;
      }
      exec(`${host} ${args.map((arg) => `"${arg}"`).join(' ')}`, options, done);
    } else execFile(host, args, options, done);
  });
}

export async function detect(host: AgentHost = agentHost()): Promise<{ claudeFound: boolean; pluginInstalled: boolean | 'unknown' }> {
  const version = await run(['--version'], 15_000, host);
  if (!version.ok) return { claudeFound: false, pluginInstalled: false };
  const plugins = await run(host === 'codex' ? ['plugin', 'list', '--json'] : ['plugin', 'list'], 20_000, host);
  if (!plugins.ok) return { claudeFound: true, pluginInstalled: 'unknown' };
  if (host === 'codex') {
    try {
      const list = JSON.parse(plugins.out) as { installed: { pluginId: string; installed: boolean; enabled: boolean }[] };
      return { claudeFound: true, pluginInstalled: list.installed.some((p) => p.pluginId === PLUGIN && p.installed && p.enabled) };
    } catch {
      return { claudeFound: true, pluginInstalled: 'unknown' };
    }
  }
  return { claudeFound: true, pluginInstalled: /\bsenior@/.test(plugins.out) };
}

export async function installPlugin(log: vscode.LogOutputChannel, extensionPath?: string, host: AgentHost = agentHost(), project?: string | null): Promise<boolean> {
  if (host === 'codex') {
    if (!extensionPath) return false;
    const source = path.join(extensionPath, 'dist', 'senior-codex');
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Setting up Codex for Senior' }, async () => {
      let installedPath: string | undefined;
      for (const args of [['plugin', 'marketplace', 'add', source], ['plugin', 'add', PLUGIN, '--json']]) {
        const result = await run(args, 120_000, 'codex');
        log.info(result.out);
        if (!result.ok && !/already/i.test(result.out)) {
          void vscode.window.showErrorMessage('Codex setup failed. The Senior output channel has the details.');
          log.show();
          return false;
        }
        if (args[1] === 'add') {
          try { installedPath = (JSON.parse(result.out) as { installedPath?: string }).installedPath; } catch { /* Older CLI; use the bundled source. */ }
        }
      }
      if (project) {
        const plugin = installedPath ?? path.join(source, 'codex');
        const result = await new Promise<{ ok: boolean; out: string }>((resolve) => {
          execFile('node', [path.join(plugin, 'codex/install-hooks.mjs'), project], { timeout: 15_000, windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}`.trim() }));
        });
        log.info(result.out);
        if (!result.ok) {
          void vscode.window.showErrorMessage('The Codex plugin is installed, but project hook setup failed. The Senior output channel has the details.');
          log.show();
          return false;
        }
      }
      void vscode.window.showInformationMessage('Senior is installed for Codex. Restart Codex, review Senior in /hooks, then use $senior:onboard or $senior:pair.');
      return true;
    });
  }
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
