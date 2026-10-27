// The technologies a project uses, found from its own files, and which technology a file belongs to.
// The stack is the project's; the levels are the user's (levels.mjs). Together they say how Senior
// works with this user on each piece of this project.

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_LEVEL, effectiveLevel, levelOf, loadLevels, techId } from './levels.mjs';
import { matchesAny, readJson, seniorPath, writeJson } from './paths.mjs';

const SKIP = new Set(['node_modules', '.git', '.senior', 'target', 'build', 'dist', 'out', 'bin', 'obj', '.venv', 'venv', 'env', '__pycache__', 'vendor', '.gradle', '.idea', '.vscode', '.next', 'coverage']);
// Java keeps its sources six folders down (src/main/java/com/example/app), so the walk goes deep and
// is bounded by the number of files instead.
const MAX_DEPTH = 10;
const MAX_FILES = 4000;

/**
 * Every technology Senior knows how to find. `files` are path globs that belong to it; `within`
 * names the technology a framework lives inside, so a Spring Boot project's .java files count for
 * both Java and Spring Boot.
 */
export const CATALOG = [
  { id: 'java', name: 'Java', files: ['**/*.java'] },
  { id: 'kotlin', name: 'Kotlin', files: ['**/*.kt', '**/*.kts'] },
  { id: 'spring-boot', name: 'Spring Boot', within: 'java', files: ['**/application.properties', '**/application.yml', '**/application.yaml'] },
  { id: 'maven', name: 'Maven', files: ['pom.xml', '**/pom.xml'] },
  { id: 'gradle', name: 'Gradle', files: ['**/build.gradle', '**/build.gradle.kts', '**/settings.gradle', '**/settings.gradle.kts'] },
  { id: 'javascript', name: 'JavaScript', files: ['**/*.js', '**/*.mjs', '**/*.cjs', '**/*.jsx'] },
  { id: 'typescript', name: 'TypeScript', files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'] },
  { id: 'react', name: 'React', within: 'javascript', files: ['**/*.jsx', '**/*.tsx'] },
  { id: 'nextjs', name: 'Next.js', within: 'react', files: ['next.config.*'] },
  { id: 'express', name: 'Express', within: 'javascript', files: [] },
  { id: 'python', name: 'Python', files: ['**/*.py'] },
  { id: 'django', name: 'Django', within: 'python', files: [] },
  { id: 'flask', name: 'Flask', within: 'python', files: [] },
  { id: 'fastapi', name: 'FastAPI', within: 'python', files: [] },
  { id: 'go', name: 'Go', files: ['**/*.go', 'go.mod'] },
  { id: 'rust', name: 'Rust', files: ['**/*.rs', 'Cargo.toml'] },
  { id: 'csharp', name: 'C#', files: ['**/*.cs', '**/*.csproj'] },
  { id: 'ruby', name: 'Ruby', files: ['**/*.rb', 'Gemfile'] },
  { id: 'rails', name: 'Rails', within: 'ruby', files: [] },
  { id: 'php', name: 'PHP', files: ['**/*.php', 'composer.json'] },
  { id: 'postgresql', name: 'PostgreSQL', files: ['**/*.sql'] },
  { id: 'mysql', name: 'MySQL', files: ['**/*.sql'] },
  { id: 'sqlite', name: 'SQLite', files: ['**/*.sql'] },
  { id: 'mongodb', name: 'MongoDB', files: [] },
  { id: 'sql', name: 'SQL', files: ['**/*.sql'] },
  { id: 'docker', name: 'Docker', files: ['**/Dockerfile', '**/Dockerfile.*', '**/*.dockerfile', '**/docker-compose*.yml', '**/docker-compose*.yaml', '**/compose.yml', '**/compose.yaml', '.dockerignore'] },
  { id: 'html', name: 'HTML', files: ['**/*.html'] },
  { id: 'css', name: 'CSS', files: ['**/*.css', '**/*.scss'] },
];

const byId = new Map(CATALOG.map((t) => [t.id, t]));

/** Project files, project-relative with forward slashes, without dependency and build folders. */
function listFiles(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      if (e.isDirectory()) {
        if (!SKIP.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), depth + 1);
      } else if (e.isFile()) {
        out.push(path.relative(root, path.join(dir, e.name)).replace(/\\/g, '/'));
      }
    }
  };
  walk(root, 0);
  return out;
}

function read(root, rel) {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8').slice(0, 200_000);
  } catch {
    return '';
  }
}

/**
 * Find the technologies a project uses. Each one comes with the files that gave it away, so the
 * user can see why Senior thinks the project uses it.
 */
export function detectStack(root) {
  const files = listFiles(root);
  const found = new Map();
  const add = (id, file) => {
    if (!byId.has(id)) return;
    const list = found.get(id) ?? [];
    if (file && !list.includes(file) && list.length < 3) list.push(file);
    found.set(id, list);
  };
  const named = (re) => files.filter((f) => re.test(f.split('/').pop()));

  // Languages, from their source files.
  for (const t of ['java', 'kotlin', 'python', 'go', 'rust', 'csharp', 'ruby', 'php', 'html', 'css']) {
    const hit = files.find((f) => matchesAny(f, byId.get(t).files));
    if (hit) add(t, hit);
  }
  const ts = files.find((f) => /\.(ts|tsx|mts|cts)$/.test(f) && !f.endsWith('.d.ts'));
  if (ts) add('typescript', ts);
  const js = files.find((f) => /\.(js|mjs|cjs|jsx)$/.test(f) && !/(^|\/)(\.?eslintrc|prettier|jest|vite|webpack|babel|postcss|tailwind)\b/.test(f));
  if (js) add('javascript', js);

  // Build tools and frameworks, from their manifests.
  const manifests = [];
  for (const f of named(/^pom\.xml$/)) {
    add('maven', f);
    add('java', f);
    manifests.push(f);
  }
  for (const f of named(/^(build|settings)\.gradle(\.kts)?$/)) {
    add('gradle', f);
    manifests.push(f);
  }
  for (const f of named(/^package\.json$/)) manifests.push(f);
  for (const f of named(/^(requirements.*\.txt|pyproject\.toml|setup\.py|setup\.cfg|Pipfile)$/)) {
    add('python', f);
    manifests.push(f);
  }
  for (const f of named(/^(Gemfile|composer\.json|go\.mod|Cargo\.toml)$/)) manifests.push(f);
  for (const f of named(/\.csproj$/)) {
    add('csharp', f);
    manifests.push(f);
  }
  const config = named(/^(application(-\w+)?\.(properties|ya?ml)|docker-compose.*\.ya?ml|compose\.ya?ml|\.env\.example|settings\.py|knexfile\.\w+|ormconfig\.\w+|prisma\.schema|schema\.prisma)$/);

  const text = (list) => list.map((f) => [f, read(root, f)]);
  const scan = (pairs, id, re) => {
    for (const [f, body] of pairs) if (re.test(body)) return add(id, f);
  };
  const m = text(manifests);
  const c = text(config);
  scan(m, 'spring-boot', /spring-boot/);
  scan(m, 'react', /"react"\s*:/);
  scan(m, 'nextjs', /"next"\s*:/);
  scan(m, 'express', /"express"\s*:/);
  scan(m, 'typescript', /"typescript"\s*:/);
  scan(m, 'django', /\bdjango\b/i);
  scan(m, 'flask', /\bflask\b/i);
  scan(m, 'fastapi', /\bfastapi\b/i);
  scan(m, 'rails', /gem ['"]rails['"]/);
  // Data stores, from drivers in manifests and from configuration such as compose files.
  scan([...m, ...c], 'postgresql', /postgres|psycopg|org\.postgresql|"pg"\s*:/i);
  scan([...m, ...c], 'mysql', /\bmysql\b|mariadb/i);
  scan([...m, ...c], 'mongodb', /\bmongo(db|ose)?\b/i);
  scan([...m, ...c], 'sqlite', /sqlite/i);

  // Docker, from its files.
  for (const f of files) if (matchesAny(f, byId.get('docker').files)) add('docker', f);

  // Plain SQL only when no data store claims the .sql files.
  const sqlFile = files.find((f) => f.endsWith('.sql'));
  if (sqlFile && !['postgresql', 'mysql', 'sqlite'].some((id) => found.has(id))) add('sql', sqlFile);

  return CATALOG.filter((t) => found.has(t.id)).map((t) => ({
    id: t.id,
    name: t.name,
    found: found.get(t.id),
    ...(t.within && found.has(t.within) ? { within: t.within } : {}),
  }));
}

// The stack file ------------------------------------------------------------------------------------

export function stackPath(root) {
  return seniorPath(root, 'stack.json');
}

/** The stack as saved for this project, or null when it has not been saved yet. */
export function loadStack(root) {
  const data = readJson(stackPath(root), null);
  if (!data || !Array.isArray(data.technologies)) return null;
  return {
    technologies: data.technologies.filter((t) => t && typeof t.id === 'string'),
    codebase: data.codebase && typeof data.codebase === 'object' ? data.codebase : { level: null },
  };
}

export function saveStack(root, stack) {
  writeJson(stackPath(root), { technologies: stack.technologies, codebase: stack.codebase ?? { level: null } });
  return stack;
}

/**
 * Find the stack and save it, keeping technologies someone added by hand and the codebase level.
 * Returns the saved stack and the ids that are new since the last save.
 */
export function refreshStack(root) {
  const old = loadStack(root);
  const detected = detectStack(root);
  const ids = new Set(detected.map((t) => t.id));
  const kept = (old?.technologies ?? []).filter((t) => t.added && !ids.has(t.id));
  const before = new Set((old?.technologies ?? []).map((t) => t.id));
  const stack = { technologies: [...detected, ...kept], codebase: old?.codebase ?? { level: null } };
  saveStack(root, stack);
  return { stack, added: detected.filter((t) => !before.has(t.id)).map((t) => t.id) };
}

/** Add a technology Senior could not find by itself, such as "Kafka", with the files it owns. */
export function addTechnology(root, name, files = []) {
  const id = techId(name);
  if (!id) throw new Error('Name the technology, for example "Kafka".');
  const stack = loadStack(root) ?? { technologies: [], codebase: { level: null } };
  const known = byId.get(id);
  const entry = { id, name: known?.name ?? name.trim(), found: [], added: true, ...(files.length ? { files: files.map((f) => f.replace(/\\/g, '/')) } : {}) };
  stack.technologies = [...stack.technologies.filter((t) => t.id !== id), entry];
  saveStack(root, stack);
  return entry;
}

/** The stack to work with: the saved one, or a fresh look at the files when none is saved yet. */
export function currentStack(root) {
  return loadStack(root) ?? { technologies: detectStack(root), codebase: { level: null } };
}

function filesOf(tech) {
  return tech.files ?? byId.get(tech.id)?.files ?? [];
}

/**
 * The technology a file belongs to, with the level to work at. When a file belongs to more than
 * one technology in the stack (a .java file in a Spring Boot project), the lower level wins: too
 * much explanation costs a few seconds, too little costs the whole step. Returns null for files no
 * technology in the stack claims.
 */
export function techForPath(stack, rel, data = loadLevels()) {
  if (!rel) return null;
  const file = rel.replace(/\\/g, '/');
  const techs = stack.technologies;
  const direct = techs.filter((t) => filesOf(t).length && matchesAny(file, filesOf(t)));
  if (!direct.length) return null;
  // Frameworks that live inside a matching language count for its files too.
  const ids = new Set(direct.map((t) => t.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of techs) {
      if (!ids.has(t.id) && t.within && ids.has(t.within)) {
        ids.add(t.id);
        grew = true;
      }
    }
  }
  // At the same level, a framework is the more specific answer: Spring Boot says more than Java.
  const candidates = techs.filter((t) => ids.has(t.id));
  let best = null;
  for (const t of candidates) {
    const level = effectiveLevel(t.id, data);
    if (!best || level < best.level || (level === best.level && t.within && !best.within)) {
      best = { id: t.id, name: t.name, level, rated: levelOf(t.id, data) !== null, within: t.within };
    }
  }
  if (!best) return null;
  const { within, ...tech } = best;
  return tech;
}

/** Every technology in the stack with the user's level, for the rating card and the status text. */
export function stackLevels(stack, data = loadLevels()) {
  return stack.technologies.map((t) => ({ id: t.id, name: t.name, found: t.found ?? [], level: levelOf(t.id, data) }));
}

/** Technologies in the stack the user has not rated yet. */
export function unratedTechnologies(stack, data = loadLevels()) {
  return stackLevels(stack, data).filter((t) => t.level === null);
}

/** The display name of a technology id, from the catalog or the id itself. */
export function techName(id) {
  return byId.get(techId(id))?.name ?? id;
}

/**
 * The levels part of the session start text: the user's level for each technology in this
 * project, and what to do about the ones not rated yet. Empty when the project has no code.
 */
export function levelsText(root, data = loadLevels()) {
  const stack = currentStack(root);
  if (!stack.technologies.length) return '';
  const rows = stackLevels(stack, data);
  const rated = rows.filter((t) => t.level !== null);
  const unrated = rows.filter((t) => t.level === null);
  const lines = [];
  lines.push(
    rated.length
      ? `Knowledge levels (0 to 10, the user's own rating): ${rated.map((t) => `${t.name} ${t.level}`).join(', ')}.${unrated.length ? ` Not rated: ${unrated.map((t) => t.name).join(', ')}, so Senior works at level ${DEFAULT_LEVEL} for them.` : ''}`
      : `Knowledge levels: the user has not rated this project's technologies (${unrated.map((t) => t.name).join(', ')}), so Senior works at level ${DEFAULT_LEVEL}, as it did before levels existed. /senior:level sets them.`,
  );
  if (stack.codebase?.level !== null && stack.codebase?.level !== undefined) lines.push(`The user rated this codebase ${stack.codebase.level} of 10: it decides how much to explain about where things live and which existing pattern a piece copies.`);
  lines.push('Before preparing pieces, explaining code or writing a replay, run "level profile <technology or path>" and follow it. The level changes how much the user types and how much is explained, never the plan.');
  return lines.join('\n');
}

export function setCodebaseLevel(root, level) {
  const stack = currentStack(root);
  stack.codebase = { level };
  saveStack(root, stack);
}
