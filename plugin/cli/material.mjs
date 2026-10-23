// Raw material for a replay of a Claude Code session: what changed, what failed, and the reason the
// agent gave before each step. The reasons come from the session transcript, matched to the
// recorder's events by tool call id. The replay skill turns this material into scenes.

import fs from 'node:fs';
import { readSessions } from '../core/sessions.mjs';

const MAX_TOTAL = 60000;
const MAX_TEXT = 2500;

function clip(text, max = MAX_TEXT) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max)}\n[cut]` : s;
}

/** Map each tool call id to the words the agent wrote just before the call. */
export function reasonsFromTranscript(file) {
  const reasons = new Map();
  if (!file || !fs.existsSync(file)) return reasons;
  let lastWords = '';
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry?.message?.content;
    if (entry?.type !== 'assistant' || !Array.isArray(content)) continue;
    for (const block of content) {
      // Only what the agent said out loud counts as its reason. Its private reasoning stays out.
      if (block.type === 'text' && block.text?.trim()) lastWords = block.text.trim();
      else if (block.type === 'tool_use' && block.id) {
        reasons.set(block.id, lastWords);
        lastWords = '';
      }
    }
  }
  return reasons;
}

/** The last thing the agent wrote after its last tool call: usually its summary of what was done and skipped. */
export function closingWords(file) {
  if (!file || !fs.existsSync(file)) return '';
  let closing = '';
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    let entry;
    try {
      entry = line.trim() ? JSON.parse(line) : null;
    } catch {
      continue;
    }
    const content = entry?.message?.content;
    if (entry?.type !== 'assistant' || !Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === 'tool_use') closing = '';
      else if (block.type === 'text' && block.text?.trim()) closing = block.text.trim();
    }
  }
  return closing;
}

export function pickSession(sessions, id) {
  if (id) return sessions.find((s) => s.id === id || s.id.startsWith(id)) || null;
  // Sessions that only built a replay change no project file, so they are passed over.
  const withWork = sessions.filter((s) => s.events.some((e) => (e.type === 'edit' && e.file) || e.type === 'failure'));
  return withWork.sort((a, b) => b.endedAt.localeCompare(a.endedAt))[0] || null;
}

export function buildMaterial(root, sessionId) {
  const session = pickSession(readSessions(root), sessionId);
  if (!session) return 'No recorded session with edits or failures was found. Work with Senior enabled first, then build the replay.';
  const transcript = [...session.events].reverse().find((e) => e.transcript)?.transcript;
  const reasons = reasonsFromTranscript(transcript);
  const out = [`# Raw material for a replay`, '', `Session ${session.id.slice(0, 8)}, from ${session.startedAt.slice(0, 16).replace('T', ' ')} to ${session.endedAt.slice(11, 16)}.`];
  if (!transcript) out.push('The transcript was not recorded, so the agent\'s reasons are missing. Say so in the replay.');
  let step = 0;
  for (const e of session.events) {
    if (e.type === 'prompt') {
      out.push('', `The user asked: ${clip(e.text, 600)}`);
      continue;
    }
    if (!['edit', 'failure', 'command', 'callback'].includes(e.type)) continue;
    step += 1;
    out.push('', `## Step ${step} (${e.at.slice(11, 19)})`);
    const reason = e.toolUseId ? reasons.get(e.toolUseId) : '';
    if (reason) out.push(`Reason the agent gave: ${clip(reason, 800)}`);
    if (e.type === 'edit') {
      out.push(`Edited ${e.file}${e.tool === 'Write' ? ' (whole file written)' : ''}.`);
      if (e.old !== undefined) out.push('Before:', '```', clip(e.old), '```');
      if (e.new !== undefined) out.push('After:', '```', clip(e.new), '```');
    } else if (e.type === 'failure') {
      out.push(`Command failed: ${clip(e.command, 300)}`, 'End of the output:', '```', clip(e.snippet, 1500), '```');
    } else if (e.type === 'command') {
      out.push(`Command ran cleanly: ${clip(e.command, 300)}`);
    } else if (e.type === 'callback') {
      out.push(`Ledger callback: ${e.decision}, because ${(e.reasons || []).join(', ')} was ${e.trigger === 'failure' ? 'in a failure' : 'edited'}.`);
    }
  }
  const closing = closingWords(transcript);
  if (closing) out.push('', '## How the agent finished', clip(closing, 3000));
  const text = out.join('\n');
  return text.length > MAX_TOTAL ? `${text.slice(0, MAX_TOTAL)}\n\n[The material was cut here. Build the replay from what is above.]` : text;
}
