// Runs inside VS Code against Senior installed from dist/senior.vsix, the way a user gets it. Checks
// that the package carries everything it needs, that it activates, and that a guided piece works.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const workspace = process.env.SENIOR_TEST_WORKSPACE;

exports.run = async function run() {
  const extension = vscode.extensions.getExtension('swagatpatel.senior');
  assert.ok(extension, 'Senior is installed');
  const installed = path.resolve(extension.extensionPath).toLowerCase();
  assert.ok(installed.startsWith(path.resolve(process.env.SENIOR_TEST_EXTENSIONS_DIR).toLowerCase()), `Senior runs from the installed package, not from ${extension.extensionPath}`);

  for (const rel of ['dist/extension.js', 'dist/webview.js', 'dist/webview.css', 'media/senior-icons.ttf', 'media/spectacles.svg']) {
    assert.ok(fs.existsSync(path.join(extension.extensionPath, rel)), `the package contains ${rel}`);
  }
  // vsce renames these (readme.md, LICENSE.txt), and only some file systems ignore case.
  const top = fs.readdirSync(extension.extensionPath).map((f) => f.toLowerCase());
  for (const name of ['readme.md', 'changelog.md', 'license.txt']) assert.ok(top.includes(name), `the package contains ${name}`);
  const regrets = fs.readdirSync(path.join(extension.extensionPath, 'dist', 'regrets')).filter((f) => f.endsWith('.md'));
  assert.ok(regrets.length >= 10, 'the package carries the regret library');
  for (const rel of ['src', 'test', 'webview', 'node_modules']) assert.ok(!fs.existsSync(path.join(extension.extensionPath, rel)), `the package leaves out ${rel}/`);
  assert.ok(!fs.readdirSync(path.join(extension.extensionPath, 'dist')).some((f) => f.endsWith('.map')), 'the package has no source maps');

  const api = await extension.activate();
  assert.ok(fs.existsSync(path.join(process.env.SENIOR_IDE_DIR, `${api.bridge.port}.json`)), 'the bridge wrote its lock file');
  await vscode.commands.executeCommand('senior.focus');

  const call = async (name, args = {}) => {
    const res = await fetch(`http://127.0.0.1:${api.bridge.port}/tool`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${api.bridge.token}` },
      body: JSON.stringify({ name, args, project: workspace }),
    });
    return res.json();
  };

  assert.equal((await call('status')).result.connected, true);
  await call('begin_step', { index: 1, total: 1, title: 'Add a greeting', why: 'The first line of a new module.', expect: 'The file exports greet.' });
  fs.writeFileSync(path.join(workspace, 'src', 'greet.js'), "'use strict';\n\nmodule.exports = { greet };\n");
  const pending = call('guide', {
    pieces: [
      { file: 'src/greet.js', kind: 'spine', where: 'before', anchor: 'module.exports = { greet };', text: "function greet(name) {\n  return `Hello, ${name}`;\n}", why: 'The one thing this module does.' },
    ],
  });
  const end = Date.now() + 20000;
  while (!api.session.active && Date.now() < end) await sleep(40);
  assert.ok(api.session.active, 'the piece reached the editor');
  // The panel was focused above, and on a slow machine it can finish loading after the guide has
  // opened the file. A person would click into the editor; the test does the same.
  await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
  await sleep(200);
  for (const ch of "function greet(name) {\n  return `Hello, ${name}`;\n}") {
    if (!api.session.active) break;
    await vscode.commands.executeCommand('type', { text: ch });
    await sleep(15);
  }
  const { result } = await pending;
  assert.equal(result.status, 'done', `${JSON.stringify(result)}\nThe piece holds: ${JSON.stringify(api.guide.inspect())}`);
  assert.equal(result.results[0].status, 'typed');
  const written = fs.readFileSync(path.join(workspace, 'src', 'greet.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(written, "'use strict';\n\nfunction greet(name) {\n  return `Hello, ${name}`;\n}\nmodule.exports = { greet };\n");
  await call('end_step', { summary: 'The module greets by name.', verified: ['The file reads back as planned.'], takeaway: 'Name the one thing a module does.' });
  assert.ok(api.session.snapshot().journal.some((e) => e.kind === 'summary'), 'the step summary reached the panel journal');

  await vscode.commands.executeCommand('workbench.action.files.saveAll');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  console.log('  The packaged extension installs, activates and guides a piece.');
};
