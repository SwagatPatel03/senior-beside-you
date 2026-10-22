// Launches a real VS Code with the extension loaded and runs a suite inside it.
// The first run downloads VS Code into .vscode-test/.
//
//   node test/integration/run.mjs         the editor suite (free, about a minute)
//   node test/integration/run.mjs --vsix  installs dist/senior.vsix in a clean profile and checks it
//                                         (run `npm run package` first)
//   node test/integration/run.mjs --e2e   a real Claude Code session pairing through the editor
//                                         (uses your Claude Code login; a few minutes)

import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const extension = path.resolve(here, '..', '..');
const repo = path.resolve(extension, '..', '..');
const e2e = process.argv.includes('--e2e');
const vsix = process.argv.includes('--vsix');
const version = process.env.SENIOR_VSCODE_VERSION || 'stable';

// Run from a VS Code terminal, this is set, and the test editor would start as plain Node.
delete process.env.ELECTRON_RUN_AS_NODE;

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'senior vscode '));
const workspace = path.join(base, 'workspace');
const ideDir = path.join(base, 'ide');
fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
fs.mkdirSync(path.join(workspace, '.senior', 'sessions'), { recursive: true });

const env = { SENIOR_IDE_DIR: ideDir, SENIOR_TEST_WORKSPACE: workspace };

if (e2e) {
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(workspace, rel)), { recursive: true });
    fs.writeFileSync(path.join(workspace, rel), text);
  };
  write('package.json', `${JSON.stringify({ name: 'cart', private: true, scripts: { test: 'node --test' } }, null, 2)}\n`);
  write('src/cart.js', "'use strict';\n\nmodule.exports = {};\n");
  write(
    'test/cart.test.js',
    [
      "'use strict';",
      "const assert = require('node:assert/strict');",
      "const { test } = require('node:test');",
      "const { total } = require('../src/cart.js');",
      '',
      "test('the total adds up item prices in cents', () => {",
      '  assert.equal(total([{ priceCents: 250 }, { priceCents: 199 }]), 449);',
      '});',
      '',
      "test('an empty cart costs nothing', () => {",
      '  assert.equal(total([]), 0);',
      '});',
      '',
    ].join('\n'),
  );
  write(
    '.senior/features/cart-total.plan.json',
    `${JSON.stringify(
      {
        feature: 'cart-total',
        title: 'Cart total',
        goal: 'The cart can say what it costs, in whole cents.',
        decisions: [],
        examples: ['Two items at 250 and 199 cents cost 449 cents.', 'An empty cart costs 0.'],
        steps: [
          {
            id: 'S1',
            title: 'Add the cart total',
            why: 'Checkout needs one trusted number to charge.',
            expect: 'Both tests in test/cart.test.js pass.',
            risk: 'Prices stored as floating point drift by fractions of a cent.',
            files: ['src/cart.js'],
            check: 'npm test',
            status: 'pending',
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  const finder = process.platform === 'win32' ? 'where claude' : 'command -v claude';
  env.CLAUDE_BIN = execSync(finder, { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
  env.SENIOR_PLUGIN_DIR = path.join(repo, 'plugin');
}

try {
  if (vsix) {
    // Install the package into an empty extensions folder, and load only a stand-in extension in
    // development mode, so VS Code runs Senior exactly as installed.
    const pkg = path.join(extension, 'dist', 'senior.vsix');
    if (!fs.existsSync(pkg)) throw new Error('dist/senior.vsix is missing. Run `npm run package` first.');
    const extensionsDir = path.join(base, 'extensions');
    const executable = await downloadAndUnzipVSCode(version);
    const [cli] = resolveCliArgsFromVSCodeExecutablePath(executable, { reuseMachineInstall: true });
    const args = ['--install-extension', pkg, `--extensions-dir=${extensionsDir}`, `--user-data-dir=${path.join(base, 'user-data')}`];
    // The Windows command line script needs a shell, which splits unquoted paths at spaces.
    const windows = process.platform === 'win32';
    const install = spawnSync(windows ? `"${cli}"` : cli, windows ? args.map((a) => `"${a}"`) : args, { encoding: 'utf8', shell: windows });
    if (install.status !== 0) throw new Error(`Installing the package failed:\n${install.stdout}\n${install.stderr}`);
    env.SENIOR_TEST_EXTENSIONS_DIR = extensionsDir;
    await runTests({
      version,
      extensionDevelopmentPath: path.join(here, 'packaged-host'),
      extensionTestsPath: path.join(here, 'packaged.cjs'),
      launchArgs: [workspace, `--extensions-dir=${extensionsDir}`, `--user-data-dir=${path.join(base, 'user-data')}`, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
      extensionTestsEnv: env,
    });
  } else {
    await runTests({
      version,
      extensionDevelopmentPath: extension,
      extensionTestsPath: path.join(here, e2e ? 'e2e.cjs' : 'suite.cjs'),
      launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
      extensionTestsEnv: env,
    });
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
