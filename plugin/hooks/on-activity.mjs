// PreToolUse, PostToolUse, UserPromptSubmit and Stop, in the background: tell the Senior editor
// extension what Claude Code is doing right now, so the panel is never silent while it works. Does
// nothing when no editor is open for this project, and never slows Claude Code down.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callEditor, findEditor } from '../bridge/editor.mjs';
import { readInput } from './io.mjs';

const MAX = 70;

function clip(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s;
}

function shown(project, file) {
  if (!file) return 'a file';
  const rel = path.relative(project, path.resolve(project, String(file)));
  return (rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : path.basename(String(file))).replace(/\\/g, '/');
}

/** One short line for the panel, or null for calls the panel shows on its own. */
export function describeActivity(input, project) {
  const event = input.hook_event_name;
  if (event === 'Stop') return { state: 'idle' };
  if (event === 'SubagentStop') return { state: 'idle', helper: true };
  if (event === 'UserPromptSubmit' || event === 'PostToolUse' || event === 'PostToolUseFailure') return { state: 'thinking' };
  if (event !== 'PreToolUse') return null;

  const tool = String(input.tool_name || '');
  const ti = input.tool_input || {};
  // The editor's own tools already appear in the panel as they happen.
  if (tool.startsWith('mcp__plugin_senior_editor__')) return null;
  let label;
  if (tool === 'Read') label = `Reading ${shown(project, ti.file_path)}`;
  else if (tool === 'Write') label = `Writing ${shown(project, ti.file_path)}`;
  else if (['Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) label = `Editing ${shown(project, ti.file_path || ti.notebook_path)}`;
  else if (tool === 'Bash' || tool === 'PowerShell') label = ti.description ? clip(ti.description) : `Running ${clip(ti.command)}`;
  else if (tool === 'Grep') label = `Searching the code for ${clip(JSON.stringify(String(ti.pattern || '')))}`;
  else if (tool === 'Glob') label = `Looking for files matching ${clip(ti.pattern)}`;
  else if (tool === 'Agent' || tool === 'Task') label = /navigator/i.test(String(ti.subagent_type || '')) ? 'Asking the navigator to prepare the next step' : `Asking a helper: ${clip(ti.description)}`;
  else if (tool === 'WebSearch' || tool === 'WebFetch') label = 'Reading on the web';
  else if (tool === 'Skill') label = `Starting ${clip(ti.skill || ti.command || 'a skill')}`;
  else if (tool === 'ToolSearch') label = 'Getting a tool ready';
  else if (tool === 'TodoWrite') label = 'Updating its to-do list';
  else label = `Using ${clip(tool.replace(/^mcp__/, '').replace(/__/g, ' '))}`;
  return { state: 'working', label: clip(label), ...(input.agent_id ? { helper: true } : {}) };
}

async function main() {
  try {
    const input = await readInput();
    const project = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    const activity = describeActivity(input, project);
    const editor = activity && findEditor(project);
    if (editor) await callEditor(editor, 'activity', { ...activity, at: Date.now() }, { project, signal: AbortSignal.timeout(2000) });
  } catch {
    // The activity line is a convenience. Nothing here may disturb the session.
  }
}

// Run as a hook; imported by tests, only describe.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await main();
