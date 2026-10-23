// Path helpers shared by the CLI and the hooks.
// Every path the senior stores is project-relative with forward slashes,
// so the same ledger works on Windows, macOS and Linux.

import fs from 'node:fs';
import path from 'node:path';

export const SENIOR_DIR = '.senior';
const caseInsensitive = process.platform === 'win32';

/** Walk up from `start` to the nearest folder that holds `.senior/`. Returns null when there is none. */
export function findRoot(start = process.cwd()) {
  if (!start) return null;
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, SENIOR_DIR))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function seniorPath(root, ...parts) {
  return path.join(root, SENIOR_DIR, ...parts);
}

/** Turn any path (absolute or relative, either slash) into a project-relative path, or null when it lies outside the project. */
export function toRel(root, p) {
  if (!p || typeof p !== 'string') return null;
  const abs = path.resolve(root, p.replace(/\\/g, '/'));
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.replace(/\\/g, '/');
}

function fold(s) {
  return caseInsensitive ? s.toLowerCase() : s;
}

function cleanGlob(glob) {
  return glob.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}

/** Convert a glob (`*`, `**`, `?`) to a regular expression over forward-slash paths. */
export function globToRegExp(glob) {
  const g = cleanGlob(glob);
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      // `**/` matches zero or more folders; a `**` anywhere else matches everything below.
      if (g[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`, caseInsensitive ? 'i' : '');
}

/** True when `rel` matches one of the globs. A plain path without wildcards also matches everything inside it. */
export function matchesAny(rel, globs = []) {
  if (!rel) return false;
  return globs.some((glob) => {
    const g = cleanGlob(glob);
    if (!g) return false;
    if (!/[*?]/.test(g)) {
      const a = fold(rel);
      const b = fold(g);
      return a === b || a.startsWith(`${b}/`);
    }
    return globToRegExp(g).test(rel);
  });
}

/** Pull path-like tokens out of free text, such as a stack trace or a test report. */
export function pathsInText(root, text) {
  if (!text) return [];
  const stripped = relativeText(root, text);
  const found = new Set();
  const tokens = stripped.match(/(?:[A-Za-z]:)?[\w./\\-]*[\w-]+\.[A-Za-z][\w]{0,7}/g) || [];
  for (const token of tokens) {
    const rel = toRel(root, token);
    if (rel) found.add(rel);
  }
  return [...found];
}

/**
 * Places a failure points at: file and line pairs in free text, such as the frames of a stack trace
 * or a test report, in the order they appear. Only files that exist in the project count, and never
 * files under node_modules.
 */
export function locationsInText(root, text) {
  if (!text) return [];
  const stripped = relativeText(root, text);
  const found = [];
  const seen = new Set();
  // "src/cart.js:12:5", "tests/test_x.py:14: AssertionError", and Python's 'File "x.py", line 12'.
  for (const m of stripped.matchAll(/((?:[A-Za-z]:)?[\w./\\-]*[\w-]+\.[A-Za-z]\w{0,7})(?:"?,? line |:)(\d+)/g)) {
    const rel = toRel(root, m[1]);
    if (!rel || rel.split('/').includes('node_modules') || !fs.existsSync(path.join(root, rel))) continue;
    const key = `${rel}:${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ file: rel, line: Number(m[2]) });
  }
  return found;
}

/** Text with file URLs decoded and the project root removed from absolute paths. */
function relativeText(root, text) {
  // Node and browsers write stack trace paths as file URLs, with spaces as %20. The slash after
  // "file://" starts the path on Linux and macOS (file:///tmp/x), but not before a Windows drive
  // letter (file:///C:/x).
  text = text
    .replace(/file:\/\/\/?([A-Za-z]:[\\/])/gi, '$1')
    .replace(/file:\/\//gi, '')
    .replace(/((?:%[0-9A-Fa-f]{2})+)/g, (m) => {
      try {
        return decodeURIComponent(m);
      } catch {
        return m;
      }
    });
  // Strip the project root first. Absolute paths can contain spaces, which would split a token.
  const rootPattern = root
    .replace(/\\/g, '/')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\//g, '[\\\\/]+');
  return text.replace(new RegExp(`${rootPattern}[\\\\/]+`, 'gi'), '');
}

export function slugify(text, max = 48) {
  return (
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/, '') || 'item'
  );
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
