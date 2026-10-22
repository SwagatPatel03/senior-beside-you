#!/usr/bin/env node
// The foresight test: the cheapest test of the riskiest idea in the design.
// It runs the design session (dry run) on feature requests with a known trap, with the regret
// library on and off, and asks a separate judge model whether each trap was named before code.
//
// Usage:
//   node evals/foresight/run.mjs [--conditions with,without,plain] [--tasks id,id] [--runs 1]
//                                [--model <model>] [--judge-model sonnet] [--regrade <results dir>]
//
// Conditions:
//   with     the senior plugin with the regret library
//   without  the senior plugin with SENIOR_REGRETS=off
//   plain    Claude Code without the plugin, asked to plan the feature before coding
//
// Proposed pass mark (from the architecture document, not an established benchmark):
//   with the library, the senior names at least 4 of the 5 library traps.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(here, '..', '..', 'plugin');
const claude = process.env.CLAUDE_BIN || 'claude';
const { tasks } = JSON.parse(fs.readFileSync(path.join(here, 'tasks.json'), 'utf8'));

function option(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

const conditions = option('--conditions', 'with,without').split(',');
const taskFilter = option('--tasks', '');
const runs = Number(option('--runs', '1'));
const model = option('--model', '');
const judgeModel = option('--judge-model', 'sonnet');
const regrade = option('--regrade', '');
const chosen = taskFilter ? tasks.filter((t) => taskFilter.split(',').includes(t.id)) : tasks;

// Each run sees only this plugin: no user plugins, no MCP servers, no saved session.
const ISOLATION = ['--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'];

function callClaude(args, input, { cwd, env } = {}) {
  const res = spawnSync(claude, ['-p', ...args], {
    input,
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 15 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  let parsed;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    throw new Error(`Claude did not return JSON (exit ${res.status}). stderr: ${res.stderr.slice(0, 500)} stdout: ${res.stdout.slice(0, 500)}`);
  }
  return { text: parsed.result || '', cost: parsed.total_cost_usd || 0, isError: Boolean(parsed.is_error) };
}

function designRun(task, condition) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'senior-foresight-'));
  const modelArgs = model ? ['--model', model] : [];
  if (condition === 'plain') {
    const prompt = `Before writing any code, plan this feature for me. Do not create or edit any files.\n\n${task.prompt}`;
    return callClaude([...ISOLATION, ...modelArgs, '--tools', 'Read,Glob,Grep'], prompt, { cwd });
  }
  const env = condition === 'without' ? { SENIOR_REGRETS: 'off' } : { SENIOR_REGRETS: '' };
  const args = [...ISOLATION, ...modelArgs, '--plugin-dir', pluginDir, '--tools', 'Bash,Read,Glob,Grep', '--allowedTools', 'Bash(node *)', 'Read', 'Glob', 'Grep'];
  return callClaude(args, `/senior:design ${task.prompt} --dry-run`, { cwd, env });
}

function judge(task, transcript) {
  const prompt = [
    'You are grading whether a design session named one specific risk before any code was written.',
    '',
    `The risk: ${task.trap}`,
    '',
    'The design session output is between the markers.',
    '<<<BEGIN',
    transcript,
    'END>>>',
    '',
    'Count the risk as named only if the output identifies this failure itself, or clearly the same failure in other words.',
    'A related topic without the failure does not count.',
    'Answer with only a JSON object: {"named": true or false, "evidence": "a short quote from the output, or an empty string"}',
  ].join('\n');
  const { text, cost } = callClaude([...ISOLATION, '--model', judgeModel, '--tools', ''], prompt, { cwd: os.tmpdir() });
  const match = text.match(/\{[\s\S]*\}/);
  try {
    const verdict = JSON.parse(match ? match[0] : text);
    return { named: verdict.named === true, evidence: String(verdict.evidence || ''), cost };
  } catch {
    return { named: false, evidence: `Judge answer could not be read: ${text.slice(0, 200)}`, cost };
  }
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

const outDir = regrade ? path.resolve(regrade) : path.join(here, 'results', stamp());
fs.mkdirSync(outDir, { recursive: true });
const results = [];
let totalCost = 0;

for (const task of chosen) {
  for (const condition of conditions) {
    for (let n = 1; n <= runs; n++) {
      const file = path.join(outDir, `${task.id}.${condition}.${n}.md`);
      let transcript;
      if (regrade) {
        if (!fs.existsSync(file)) continue;
        transcript = fs.readFileSync(file, 'utf8');
      } else {
        process.stdout.write(`Running ${task.id} (${condition}, run ${n})... `);
        const run = designRun(task, condition);
        totalCost += run.cost;
        transcript = run.text;
        fs.writeFileSync(file, transcript);
        process.stdout.write(run.isError ? 'the run reported an error. ' : 'done. ');
      }
      const verdict = judge(task, transcript);
      totalCost += verdict.cost;
      console.log(`Trap ${verdict.named ? 'named' : 'missed'}.`);
      results.push({ task: task.id, set: task.set, condition, run: n, ...verdict });
    }
  }
}

function score(condition, set) {
  const rows = results.filter((r) => r.condition === condition && r.set === set);
  const named = rows.filter((r) => r.named).length;
  return { named, total: rows.length };
}

const lines = [`# Foresight test results (${path.basename(outDir)})`, ''];
lines.push(`Conditions: ${conditions.join(', ')}. Runs per task: ${runs}. Judge model: ${judgeModel}.${model ? ` Design model: ${model}.` : ''}`, '');
lines.push(`| Task | Set | ${conditions.join(' | ')} |`);
lines.push(`| --- | --- | ${conditions.map(() => '---').join(' | ')} |`);
for (const task of chosen) {
  const cells = conditions.map((c) => {
    const rows = results.filter((r) => r.task === task.id && r.condition === c);
    return rows.length ? `${rows.filter((r) => r.named).length}/${rows.length}` : '-';
  });
  lines.push(`| ${task.id} | ${task.set} | ${cells.join(' | ')} |`);
}
lines.push('');
for (const c of conditions) {
  const lib = score(c, 'library');
  const held = score(c, 'held-out');
  lines.push(`- **${c}**: library traps named ${lib.named}/${lib.total}; held-out traps named ${held.named}/${held.total}.`);
}
const withLib = score('with', 'library');
if (conditions.includes('with') && withLib.total) {
  const rate = withLib.named / withLib.total;
  lines.push('', `Proposed pass mark: at least 4 of 5 library traps named with the library (80%). Result: ${Math.round(rate * 100)}%, which ${rate >= 0.8 ? 'passes' : 'does not pass'}.`);
}
lines.push('', '## Evidence', '');
for (const r of results) lines.push(`- ${r.task} / ${r.condition} / run ${r.run}: ${r.named ? 'named' : 'missed'}${r.evidence ? `: "${r.evidence.replace(/\s+/g, ' ').slice(0, 240)}"` : ''}`);
lines.push('', `Approximate cost reported by Claude Code for this run: $${totalCost.toFixed(2)}.`);

fs.writeFileSync(path.join(outDir, 'report.md'), `${lines.join('\n')}\n`);
console.log(`\n${lines.slice(0, lines.indexOf('## Evidence')).join('\n')}`);
console.log(`Full report and transcripts: ${outDir}`);
