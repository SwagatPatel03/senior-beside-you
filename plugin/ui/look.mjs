// Pure helpers for Senior's look in Claude Code: labels, lines and the shape of Senior's files.
// Nothing here calls the engine or Node, so the hooks module and node:test both import it.

export const MARK = '◆';
export const AMBER = '#f0a830';

const MAX = 60;

/** The skills that put a session in a mode. The others (why, decide, story) are moments, not modes. */
const MODES = ['design', 'pair', 'fast', 'replay'];

/** The tools whose PostToolUse hook can fire a ledger callback. */
export const CALLBACK_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell']);

export const LEDGER_FILE = /^D-\d+.*\.json$/;

export function clip(text, max = MAX) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function toSlash(p) {
  return p.replace(/\\/g, '/');
}

/** A file as the user knows it: project-relative when it lies inside the project, else its own name. */
export function shown(root, file) {
  if (typeof file !== 'string' || !file) return 'a file';
  const f = toSlash(file);
  if (root) {
    const r = `${toSlash(root).replace(/\/$/, '')}/`;
    if (f.toLowerCase().startsWith(r.toLowerCase())) return f.slice(r.length);
  }
  if (!/^([a-zA-Z]:)?\//.test(f)) return f.replace(/^\.\//, '');
  return f.split('/').pop() || f;
}

/** What a call of the Senior CLI is doing, in the user's words. */
export function seniorCommandLabel(command) {
  const m = /senior\.mjs"?\s+(\S+)(?:\s+(\S+))?/.exec(command);
  const area = m?.[1];
  const verb = m?.[2];
  if (area === 'ledger' && verb === 'add') return 'Recording a decision in the ledger';
  if (area === 'ledger' && verb === 'link') return 'Linking a decision to the code';
  if (area === 'ledger') return 'Checking the decision ledger';
  if (area === 'plan' && (verb === 'list' || verb === 'show')) return 'Reading the feature plan';
  if (area === 'plan') return 'Updating the feature plan';
  if (area === 'regrets') return 'Checking the regret library';
  if (area === 'replay') return 'Building the replay';
  if (area === 'story') return 'Writing the project story';
  return "Checking Senior's memory";
}

/** One short line for the spinner while a tool runs, or null when the tool has no words of its own. */
export function activityLabel(tool, input, root) {
  if (tool.startsWith('mcp__plugin_senior_editor__')) return 'Updating the Senior panel';
  const file = input.file_path ?? input.notebook_path;
  if (tool === 'Read') return `Reading ${shown(root, file)}`;
  if (tool === 'Write') return `Writing ${shown(root, file)}`;
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') return `Editing ${shown(root, file)}`;
  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = String(input.command ?? '');
    if (/senior\.mjs/.test(command)) return seniorCommandLabel(command);
    return input.description ? clip(input.description) : `Running ${clip(command, 40)}`;
  }
  if (tool === 'Grep') return `Searching the code for "${clip(input.pattern, 30)}"`;
  if (tool === 'Glob') return `Looking for files like ${clip(input.pattern, 30)}`;
  if (tool === 'Agent' || tool === 'Task') {
    if (input.subagent_type === 'senior:navigator') return 'The navigator is preparing the next step';
    return input.description ? clip(input.description) : 'Asking a helper';
  }
  if (tool === 'Skill' && typeof input.skill === 'string' && input.skill.startsWith('senior:')) return `Opening /${input.skill}`;
  if (tool === 'WebFetch') return 'Reading a web page';
  if (tool === 'WebSearch') return `Searching the web for "${clip(input.query, 30)}"`;
  return null;
}

/** The spinner's words while no tool runs, from what Claude Code says the turn is doing. */
export function phaseLabel(mode) {
  if (mode === 'responding') return 'Writing the answer';
  if (mode === 'tool-input') return 'Getting the next step ready';
  if (mode === 'tool-use') return 'Working';
  return 'Thinking it through';
}

/** A spinner text with exactly one ellipsis at its end. */
export function withEllipsis(text) {
  return `${String(text).replace(/(…|\.\.\.)\s*$/, '')}…`;
}

/** The mode a Senior skill puts the session in, or null for any other skill. */
export function modeForSkill(skill, pluginName) {
  const isSenior = pluginName === 'senior' || skill.startsWith('senior:');
  if (!isSenior) return null;
  const name = skill.split(':').pop() ?? '';
  return MODES.find((m) => m === name) ?? null;
}

/** A duration the way Claude Code writes it: 3s, 1m 4s, 1h 2m. */
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function turnLine(ms, note) {
  return `Done in ${formatDuration(ms)}${note ? ` · ${note}` : ''}`;
}

/** The note for a turn that added decisions to the ledger, or null when it added none. */
export function decisionsNote(added) {
  if (added <= 0) return null;
  return `${added} decision${added === 1 ? '' : 's'} recorded`;
}

/** The welcome line after the mark: dim words, then the command to try. */
export function welcomeParts(active) {
  if (!active) return { words: 'Senior is beside you · No decisions on record yet · ', command: '/senior:design' };
  return { words: `Senior is beside you · ${active} decision${active === 1 ? '' : 's'} on record · `, command: '/senior:story' };
}

/** The session file name the Senior plugin uses (core/sessions.mjs), so the UI reads the same state file. */
export function safeId(sessionId) {
  return String(sessionId || 'unknown').replace(/[^\w-]/g, '-').slice(0, 80);
}

/** The callbacks that fired since `known` was taken. Keys look like `D-003:edit`. */
export function newCallbacks(known, fired) {
  return Object.keys(fired)
    .filter((key) => !known.has(key))
    .map((key) => {
      const [id = key, trigger = 'edit'] = key.split(':');
      return { key, id, trigger };
    });
}

function sentence(text) {
  return text.replace(/[.\s]+$/, '');
}

export function callbackToast(id, title, trigger, file) {
  const what = `decision ${id}. ${sentence(clip(title, 90))}.`;
  if (trigger === 'failure') return `${MARK} Senior · This failure touches ${what}`;
  return `${MARK} Senior · ${file ?? 'This file'} is linked to ${what}`;
}

export function recallLabel(id, title) {
  return `Checking decision ${id} (${sentence(clip(title, 50))})`;
}

/** A folder path in a form two spellings of the same folder share: forward slashes, no trailing slash, lower case for Windows drive paths. */
export function sameKey(dir) {
  const d = toSlash(dir).replace(/\/+$/, '');
  return /^[a-zA-Z]:/.test(d) ? d.toLowerCase() : d;
}

/** The folder above `dir`, or null at the top of the drive. Works with either slash. */
export function parentDir(dir) {
  const d = toSlash(dir).replace(/\/+$/, '');
  const i = d.lastIndexOf('/');
  if (i <= 0) return null;
  const parent = d.slice(0, i);
  return /^[a-zA-Z]:$/.test(parent) ? `${parent}/` : parent;
}
