// Project-hook fallback for Codex surfaces that do not load plugin-bundled hooks yet.
// Merge only Senior's handlers; other project hooks and metadata are preserved.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export function installHooks(project, pluginRoot = path.resolve(here, '..')) {
  const root = fs.realpathSync(project);
  const file = path.join(root, '.codex', 'hooks.json');
  const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  if (config.hooks !== undefined && (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks))) throw new Error('Existing hooks must be an object.');
  const hooks = { ...config.hooks };
  const bundled = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks/hooks.json'), 'utf8')).hooks;
  const owned = (handler) => /[\\/]codex[\\/]hook\.mjs["']?\s+(?:session|prompt|tool|activity)$/.test(handler.command || '');
  for (const [event, groups] of Object.entries(bundled)) {
    if (hooks[event] !== undefined && !Array.isArray(hooks[event])) throw new Error(`Existing ${event} hooks must be an array.`);
    const kept = (hooks[event] || []).map((group) => ({ ...group, hooks: group.hooks.filter((handler) => !owned(handler)) })).filter((group) => group.hooks.length);
    const added = groups.map((group) => ({ ...group, hooks: group.hooks.map((handler) => ({ ...handler, command: handler.command.replaceAll('${PLUGIN_ROOT}', pluginRoot.replaceAll('\\', '/')) })) }));
    hooks[event] = [...kept, ...added];
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = JSON.stringify({ ...config, hooks }, null, 2) + '\n';
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text);
  return file;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node install-hooks.mjs <project-folder>');
  console.log(`Senior project hooks saved to ${installHooks(process.argv[2])}. Review them in Codex /hooks.`);
}
