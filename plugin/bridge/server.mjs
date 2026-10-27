#!/usr/bin/env node
// The editor bridge: an MCP server that Claude Code starts for the senior plugin. It forwards each
// tool call to the Senior extension running in the user's editor for this project.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callEditor, findEditor, listEditors } from './editor.mjs';
import { serveMcp } from './mcp.mjs';
import { INSTRUCTIONS, TOOLS } from './tools.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const portable = path.join(here, '..', 'plugin.json');
const manifest = JSON.parse(fs.readFileSync(fs.existsSync(portable) ? portable : path.join(here, '..', '.claude-plugin', 'plugin.json'), 'utf8'));
const projectDir = (process.env.SENIOR_HOST !== 'codex' && process.env.CLAUDE_PROJECT_DIR) || process.cwd();

function notConnected() {
  const open = listEditors().flatMap((e) => e.workspaceFolders || []);
  return {
    connected: false,
    reason: open.length
      ? `The Senior extension is running, but not for this folder (${projectDir}). It has open: ${open.join(', ')}.`
      : 'The Senior extension is not running. Open this folder in VS Code with the Senior extension installed.',
    fallback: 'Guide the user in chat instead: show each spine piece as a short code block for them to type, and fill in flesh yourself.',
  };
}

serveMcp({
  info: { name: 'senior-editor', version: manifest.version },
  instructions: process.env.SENIOR_HOST === 'codex' ? INSTRUCTIONS.replace(/\/senior:([a-z-]+)/g, '$senior:$1') : INSTRUCTIONS,
  tools: TOOLS,
  async call(name, args, { signal }) {
    const editor = findEditor(projectDir);
    if (!editor) {
      if (name === 'status') return notConnected();
      throw new Error(`${notConnected().reason} Call status to check, and guide in chat until it is connected.`);
    }
    return callEditor(editor, name, args, { signal, project: projectDir });
  },
});
