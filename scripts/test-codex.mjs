// Optional integration check using an installed Codex CLI. No model request or account is needed.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { buildCodex } from './build-codex.mjs';
import { installHooks } from '../plugin/codex/install-hooks.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'senior codex runtime '));
const marketplace = path.join(temp, 'marketplace');
const built = buildCodex(marketplace);
installHooks(marketplace, built);
const env = { ...process.env, CODEX_HOME: path.join(temp, 'codex-home'), RUST_LOG: 'info' };
fs.mkdirSync(env.CODEX_HOME);
const windows = process.platform === 'win32';
const command = (args) => windows
  ? { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `codex ${args.join(' ')}`] }
  : { file: 'codex', args };
let child;
try {
  for (const args of [['plugin', 'marketplace', 'add', '.', '--json'], ['plugin', 'add', 'senior@senior-beside-you', '--json']]) {
    const c = command(args);
    execFileSync(c.file, c.args, { cwd: marketplace, env, windowsHide: true, stdio: 'pipe', timeout: 30000 });
  }
  fs.appendFileSync(path.join(env.CODEX_HOME, 'config.toml'), `\n[projects.${JSON.stringify(fs.realpathSync.native(marketplace))}]\ntrust_level = "trusted"\n`);
  const c = command(['app-server', '--stdio', '--enable', 'hooks']);
  child = spawn(c.file, c.args, { cwd: marketplace, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let id = 0;
  let errors = '';
  child.stderr.on('data', (data) => { errors = (errors + data).slice(-6000); });
  child.on('error', (err) => { for (const p of pending.values()) p.reject(err); });
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const p = pending.get(message.id);
    if (!p) return;
    pending.delete(message.id);
    clearTimeout(p.timer);
    if (message.error) p.reject(new Error(JSON.stringify(message.error)));
    else p.resolve(message.result);
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id;
    const timer = setTimeout(() => reject(new Error(`${method} timed out. ${errors}`)), 25000);
    pending.set(next, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id: next, method, params }) + '\n');
  });
  await request('initialize', { clientInfo: { name: 'senior-test', version: '1.0.0' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  const list = await request('skills/list', { cwds: [marketplace], forceReload: true });
  const skills = list.data.flatMap((group) => group.skills).filter((skill) => skill.pluginId === 'senior@senior-beside-you');
  assert.equal(skills.length, 10, JSON.stringify(list.data.map((group) => group.errors)));
  assert.ok(skills.some((skill) => skill.name === 'senior:pair'));
  console.log('Codex discovered all 10 installed Senior skills.');
  const servers = await request('mcpServerStatus/list', {});
  const editor = servers.data.find((server) => server.name === 'editor' && server.pluginId === 'senior@senior-beside-you');
  assert.ok(editor, JSON.stringify(servers));
  if (editor.toolsError) {
    const logs = path.join(env.CODEX_HOME, 'log');
    if (fs.existsSync(logs)) for (const file of fs.readdirSync(logs)) {
      if (file.endsWith('.log')) errors += fs.readFileSync(path.join(logs, file), 'utf8').slice(-6000);
    }
  }
  assert.ok(Object.keys(editor.tools).some((name) => name.endsWith('guide')), JSON.stringify(editor) + '\n' + errors);
  console.log(`Codex started ${editor.name} and discovered its editor tools.`);
  const hooks = await request('hooks/list', { cwds: [marketplace] });
  const handlers = hooks.data.flatMap((group) => group.hooks);
  assert.equal(handlers.length, 10, JSON.stringify(hooks));
  assert.ok(handlers.every((handler) => handler.trustStatus === 'untrusted'), 'installation must not grant hook trust');
  console.log('Codex discovered all 10 project hook handlers, awaiting native trust review.');
  const detail = await request('plugin/read', { marketplacePath: path.join(marketplace, '.agents/plugins/marketplace.json'), pluginName: 'senior' });
  assert.equal(detail.plugin.onboardingSkill.name, 'senior:onboard');
} finally {
  if (child) {
    child.stdin.end();
    await Promise.race([new Promise((resolve) => child.once('close', resolve)), new Promise((resolve) => setTimeout(resolve, 2000))]);
    if (child.exitCode === null) child.kill();
  }
  // The temporary profile and marketplace contain no user configuration.
  try {
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (err) {
    console.error(`Could not remove the temporary Codex test profile at ${temp}: ${err.message}`);
  }
}
