import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildCodex } from '../scripts/build-codex.mjs';
import { addEntry } from '../plugin/core/ledger.mjs';
import { readSessions } from '../plugin/core/sessions.mjs';
import { buildMaterial, closingWords, reasonsFromTranscript } from '../plugin/cli/material.mjs';
import { normalizeInput, patchEdits } from '../plugin/codex/normalize.mjs';
import { describeActivity } from '../plugin/hooks/on-activity.mjs';
import { installHooks } from '../plugin/codex/install-hooks.mjs';

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'senior codex '));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'project with spaces');
  fs.mkdirSync(path.join(root, '.senior'), { recursive: true });
  const plugin = buildCodex(path.join(temp, 'marketplace'));
  return { root, plugin, temp };
}

function hook(plugin, root, action, input) {
  const result = spawnSync(process.execPath, [path.join(plugin, 'codex/hook.mjs'), action], {
    cwd: root, encoding: 'utf8', input: JSON.stringify({ cwd: root, session_id: 'codex-thread', ...input }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: path.dirname(root), SENIOR_LEVELS_FILE: path.join(root, 'levels-test.json') },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout ? JSON.parse(result.stdout) : null;
}

const patch = '*** Begin Patch\n*** Update File: src/booking.js\n@@\n-oldBooking\n+newBooking\n*** Add File: src/payment.js\n+newPayment\n*** Add File: .senior/inbox/decision.json\n+{}\n*** End Patch';

test('the Codex package contains every workflow and resolves all runtime entry points', (t) => {
  const { plugin } = fixture(t);
  const manifest = JSON.parse(fs.readFileSync(path.join(plugin, 'plugin.json')));
  assert.equal(fs.readdirSync(path.join(plugin, 'skills')).length, 10);
  for (const file of ['skills', 'mcp.json', 'hooks/hooks.json']) assert.ok(fs.existsSync(path.resolve(plugin, file)));
  assert.deepEqual(manifest.extensions['com.openai'].hooks, [], 'hooks are installed at project scope to avoid duplicate recording');
  const mcp = JSON.parse(fs.readFileSync(path.join(plugin, 'mcp.json')));
  assert.ok(fs.existsSync(mcp.mcpServers.editor.args[0].replace('${PLUGIN_ROOT}', plugin)));
  const pair = fs.readFileSync(path.join(plugin, 'skills/pair/SKILL.md'), 'utf8');
  assert.ok(fs.existsSync(path.join(plugin, 'skills/pair/references/navigator.md')));
  assert.doesNotMatch(pair, /\$ARGUMENTS|\$\{CLAUDE_PLUGIN_ROOT\}|allowed-tools:|the Agent tool/);
  const start = hook(plugin, path.join(plugin, 'skills'), 'session', { hook_event_name: 'SessionStart' });
  assert.equal(start, null, 'no project means no memory injection');
});

test('Codex project setup preserves other hooks and is safe to repeat', (t) => {
  const { root, plugin } = fixture(t);
  const file = path.join(root, '.codex/hooks.json');
  const existing = { description: 'My project hooks', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node my-own-check.mjs' }] }] } };
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(existing));
  installHooks(root, plugin);
  const first = fs.readFileSync(file, 'utf8');
  installHooks(root, plugin);
  assert.equal(fs.readFileSync(file, 'utf8'), first);
  const saved = JSON.parse(first);
  assert.equal(saved.description, existing.description);
  assert.equal(saved.hooks.Stop[0].hooks[0].command, 'node my-own-check.mjs');
  assert.equal(saved.hooks.Stop.length, 2);
  assert.ok(saved.hooks.SessionStart[0].hooks[0].command.includes(plugin.replaceAll('\\', '/')));
  fs.writeFileSync(file, '{broken');
  assert.throws(() => installHooks(root, plugin));
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken', 'invalid existing configuration is not overwritten');
});

test('packaged Codex hooks record each patch file, recall decisions and build replay material', (t) => {
  const { root, plugin } = fixture(t);
  for (const file of ['src/booking.js', 'src/payment.js']) addEntry(root, {
    title: file, chosen: 'Use a unique key', why: 'Prevent duplicates', reversibility: 'two-way', files: [file],
  }, { now: new Date(Date.now() - 86400000) });
  const start = hook(plugin, root, 'session', { hook_event_name: 'SessionStart', source: 'startup' });
  assert.match(start.hookSpecificOutput.additionalContext, /\$senior:onboard/);
  assert.match(start.hookSpecificOutput.additionalContext, /Never quiz/);
  hook(plugin, root, 'prompt', { hook_event_name: 'UserPromptSubmit', prompt: 'Build bookings' });
  const payload = { hook_event_name: 'PostToolUse', tool_name: 'apply_patch', tool_use_id: 'patch-1', tool_input: { command: patch }, tool_response: 'Success. Updated files.' };
  const out = hook(plugin, root, 'tool', payload);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(out.hookSpecificOutput.additionalContext, /D-001[\s\S]*D-002/);
  assert.equal(hook(plugin, root, 'tool', payload), null, 'callbacks do not repeat');
  const events = readSessions(root)[0].events;
  assert.deepEqual(events.filter((e) => e.type === 'edit').map((e) => e.file), ['src/booking.js', 'src/payment.js', 'src/booking.js', 'src/payment.js']);
  assert.match(buildMaterial(root), /newBooking[\s\S]*newPayment/);
  hook(plugin, root, 'tool', { ...payload, tool_response: 'apply_patch verification failed: missing anchor' });
  assert.equal(readSessions(root)[0].events.at(-1).type, 'edit-failed');
});

test('Codex command failures use exit codes even without a familiar error message', (t) => {
  const { root, plugin } = fixture(t);
  hook(plugin, root, 'tool', { hook_event_name: 'PostToolUse', tool_name: 'exec_command', tool_input: { cmd: 'node check.mjs' }, tool_response: { exit_code: 7, output: 'unexpected value' } });
  assert.equal(readSessions(root)[0].events.at(-1).type, 'failure');
  hook(plugin, root, 'tool', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'node check.mjs' }, tool_response: 'Process exited with code 2\nno match' });
  assert.equal(readSessions(root)[0].events.at(-1).type, 'failure');
  assert.equal(hook(plugin, root, 'tool', { tool_input: null }), null);
});

test('patch moves and deletes retain their linked paths; activity handles Codex tools and interruptions', () => {
  assert.deepEqual(patchEdits('*** Delete File: src/old.js\n*** Update File: src/from.js\n*** Move to: src/to.js').map((e) => e.file_path), ['src/old.js', 'src/from.js', 'src/to.js']);
  const input = normalizeInput({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: patch });
  assert.match(describeActivity(input, process.cwd()).label, /Editing src\/booking.js/);
  assert.deepEqual(describeActivity({ hook_event_name: 'Interrupt' }, process.cwd()), { state: 'idle' });
});

test('Codex replay reasons include public commentary and exclude private reasoning', (t) => {
  const { temp } = fixture(t);
  const file = path.join(temp, 'rollout.jsonl');
  const entries = [
    { type: 'response_item', payload: { type: 'message', role: 'assistant', channel: 'commentary', content: [{ type: 'output_text', text: 'I will check duplicate bookings.' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', channel: 'analysis', content: [{ type: 'output_text', text: 'PRIVATE' }] } },
    { type: 'response_item', payload: { type: 'function_call', call_id: 'tool-1' } },
    { type: 'response_item', payload: { type: 'reasoning', summary: [{ text: 'PRIVATE' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', channel: 'final', content: [{ type: 'output_text', text: 'Verified duplicate prevention.' }] } },
  ];
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n'));
  assert.equal(reasonsFromTranscript(file).get('tool-1'), 'I will check duplicate bookings.');
  assert.equal(closingWords(file), 'Verified duplicate prevention.');
  assert.doesNotMatch(JSON.stringify([...reasonsFromTranscript(file)]), /PRIVATE/);
});
