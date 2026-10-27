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

// The voice test speaks real sentences; on Windows they are spoken at zero volume. The levels tests
// write the user's levels, so they get their own file instead of the one in the home folder.
const env = { SENIOR_IDE_DIR: ideDir, SENIOR_TEST_WORKSPACE: workspace, SENIOR_VOICE_VOLUME: '0', SENIOR_LEVELS_FILE: path.join(base, 'levels.json') };

if (e2e) {
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(workspace, rel)), { recursive: true });
    fs.writeFileSync(path.join(workspace, rel), text);
  };
  write('package.json', `${JSON.stringify({ name: 'cart', private: true, scripts: { test: 'node --test' } }, null, 2)}\n`);
  write('src/cart.js', "'use strict';\n\nmodule.exports = {};\n");
  write(
    'test/total.test.js',
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
    'test/tax.test.js',
    [
      "'use strict';",
      "const assert = require('node:assert/strict');",
      "const { test } = require('node:test');",
      "const { withTax } = require('../src/cart.js');",
      '',
      "test('tax is added and the result stays in whole cents', () => {",
      '  assert.equal(withTax([{ priceCents: 999 }], 7), 1069);',
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
        examples: ['Two items at 250 and 199 cents cost 449 cents.', 'An empty cart costs 0.', 'One item at 999 cents with 7% tax costs 1069 cents.'],
        steps: [
          {
            id: 'S1',
            title: 'Add the cart total',
            why: 'Checkout needs one trusted number to charge.',
            expect: 'Both tests in test/total.test.js pass.',
            risk: 'Prices stored as floating point drift by fractions of a cent.',
            files: ['src/cart.js'],
            check: 'node --test test/total.test.js',
            status: 'pending',
          },
          {
            id: 'S2',
            title: 'Add tax in whole cents',
            why: 'The amount charged must be a whole number of cents, or the payment provider rejects it.',
            expect: 'The test in test/tax.test.js passes.',
            risk: 'Multiplying by 1.07 gives fractions of a cent.',
            files: ['src/cart.js'],
            check: 'node --test test/tax.test.js',
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
  // SENIOR_E2E_LEVEL=0 pairs as someone who has never written JavaScript.
  const level = process.env.SENIOR_E2E_LEVEL;
  if (level !== undefined && level !== '') {
    const now = new Date().toISOString();
    fs.writeFileSync(env.SENIOR_LEVELS_FILE, `${JSON.stringify({ version: 1, levels: { javascript: { level: Number(level), name: 'JavaScript', history: [{ level: Number(level), at: now }] } }, words: {} }, null, 2)}\n`);
    env.SENIOR_E2E_LEVEL = level;
  }
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
