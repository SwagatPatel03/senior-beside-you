// Build a self-contained Codex plugin from the maintained Senior workflows and shared runtime.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plugin = path.join(repo, 'plugin');
const read = (file) => fs.readFileSync(path.join(plugin, file), 'utf8');
const write = (root, name, value) => {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
};

export function codexText(text) {
  return text.replaceAll('${CLAUDE_PLUGIN_ROOT}', '<plugin-root>')
    .replace(/\/?senior:([a-z-]+)/g, '$senior:$1')
    .replaceAll('mcp__plugin_senior_editor__', 'editor MCP server tool ')
    .replaceAll('$ARGUMENTS', 'the user’s request in this conversation')
    .replaceAll('Claude Code', 'Codex')
    .replaceAll('the Agent tool with the `$senior:navigator` agent, in the background', 'an available background helper with the instructions in `references/navigator.md`')
    .replaceAll('the Agent tool', 'an available helper tool')
    .replaceAll('the Write tool', 'your file editing tool');
}

const intros = `Resolve \`<plugin-root>\` as the installed plugin directory, two directories above this SKILL.md.
Use its absolute path in CLI commands; the placeholder is not an environment variable.
Read \`../../codex/rules.md\` before starting. The instructions below use editor tool short names;
discover the tools on the Senior editor MCP server instead of assuming a namespace.
Use helper tools only when available and permitted. If unavailable, prepare the next step yourself.
Use a read-only helper for navigator work and give it \`references/navigator.md\` when present.
Use Codex's question tool when available, or ask in chat. Never assume Claude tool names exist.
\n`;

export function buildCodex(marketplaceRoot = path.join(repo, 'dist')) {
  const root = path.resolve(marketplaceRoot, 'codex');
  if (path.dirname(root) !== path.resolve(marketplaceRoot)) throw new Error('Invalid output directory');
  // This directory is generated; only replace an existing Senior build, never another plugin.
  if (fs.existsSync(root)) {
    const manifest = path.join(root, 'plugin.json');
    if (!fs.existsSync(manifest) || JSON.parse(fs.readFileSync(manifest)).name !== 'senior') throw new Error(`Refusing to replace ${root}`);
    fs.rmSync(root, { recursive: true, force: true });
  }
  for (const dir of ['core', 'cli', 'bridge', 'hooks', 'codex', 'regrets']) {
    fs.cpSync(path.join(plugin, dir), path.join(root, dir), { recursive: true, filter: (src) => !src.endsWith('hooks.json') });
  }
  const identity = JSON.parse(read('.claude-plugin/plugin.json'));
  const style = codexText(read('output-styles/senior.md').replace(/^---[\s\S]*?---\s*/, ''));
  write(root, 'codex/rules.md', style + '\n\n' + read('codex/rules.md'));
  for (const name of fs.readdirSync(path.join(plugin, 'skills'))) {
    const source = read(`skills/${name}/SKILL.md`);
    const description = /^description: (.+)$/m.exec(source)?.[1];
    if (!description) throw new Error(`Missing description for ${name}`);
    const body = source.replace(/^---[\s\S]*?---\s*/, '');
    const setup = name === 'onboard' ? 'Set up project recording before onboarding: run `node "<plugin-root>/codex/install-hooks.mjs" "<absolute project folder>"`. This merges Senior hooks without replacing other hooks. Tell the user to review Senior in Codex `/hooks` and restart the conversation after setup so the session-start hook runs. Do not change trust settings yourself. Continue onboarding while they review.\n\n' : '';
    write(root, `skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: ${JSON.stringify(codexText(description))}\n---\n\n${intros}${setup}${codexText(body)}`);
    write(root, `skills/${name}/agents/openai.yaml`, `interface:\n  display_name: "Senior: ${name}"\n  short_description: "${'Senior guides ' + name + ' with project memory'}"\n  brand_color: "#B59A5B"\n  icon_small: "./assets/icon.png"\n  icon_large: "./assets/icon.png"\n  default_prompt: "Use $senior:${name} to help me with this project."\n`);
    fs.mkdirSync(path.join(root, `skills/${name}/assets`), { recursive: true });
    fs.copyFileSync(path.join(repo, 'apps/vscode/media/icon.png'), path.join(root, `skills/${name}/assets/icon.png`));
  }
  const navigator = codexText(read('agents/navigator.md').replace(/^---[\s\S]*?---\s*/, ''));
  write(root, 'skills/pair/references/navigator.md', navigator);
  const hook = (action, statusMessage, async = false) => ({
    type: 'command', command: `node "${'${PLUGIN_ROOT}'}/codex/hook.mjs" ${action}`,
    timeout: action === 'activity' ? 3 : 10, statusMessage, ...(async ? { async: true } : {}),
  });
  const hooks = {
    SessionStart: [{ hooks: [hook('session', '◆ Loading Senior memory')] }],
    UserPromptSubmit: [{ hooks: [hook('prompt', '◆ Recording your request', true), hook('activity', '◆ Senior is thinking', true)] }],
    PreToolUse: [{ hooks: [hook('activity', '◆ Senior is working', true)] }],
    PostToolUse: [{ hooks: [hook('tool', '◆ Checking decisions'), hook('activity', '◆ Senior is thinking', true)] }],
  };
  for (const event of ['Stop', 'SubagentStop', 'Interrupt', 'SessionEnd']) hooks[event] = [{ hooks: [hook('activity', '◆ Senior', event !== 'SessionEnd')] }];
  write(root, 'hooks/hooks.json', { hooks });
  write(root, 'mcp.json', {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
    mcpServers: { editor: { type: 'stdio', command: 'node', args: ['${PLUGIN_ROOT}/bridge/server.mjs'], env: { SENIOR_HOST: 'codex' } } },
  });
  const presentation = { displayName: 'Senior', shortDescription: 'A senior developer beside you', brandColor: '#B59A5B', composerIcon: './assets/icon.png', logo: './assets/icon.png' };
  write(root, 'plugin.json', {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: 'senior', version: identity.version,
    description: 'A senior developer beside you in Codex: design, memory, guided pairing and replays.',
    author: identity.author, license: identity.license,
    // Project setup installs these handlers explicitly. Empty hooks disables auto-discovery,
    // preventing duplicate recording on hosts that also support plugin-bundled hooks.
    extensions: { 'com.openai': { hooks: [], requires_local_executor: true, onboardingSkill: './skills/onboard/SKILL.md', interface: presentation } },
  });
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.copyFileSync(path.join(repo, 'apps/vscode/media/icon.png'), path.join(root, 'assets/icon.png'));
  write(marketplaceRoot, '.agents/plugins/marketplace.json', {
    name: 'senior-beside-you', interface: { displayName: 'Senior Developer Beside You' },
    plugins: [{ name: 'senior', source: { source: 'local', path: './codex' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }],
  });
  return root;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Built Codex plugin: ${buildCodex()}`);
}
