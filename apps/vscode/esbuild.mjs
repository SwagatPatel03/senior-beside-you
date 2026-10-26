// Builds the extension (Node, CommonJS) and the panel (browser, ESM), and copies the regret library
// next to the bundle so the extension can read it without the plugin installed. The panel's font is
// copied into dist/ by the CSS bundle, and its licence is copied beside it.

import { context } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : 'linked',
  logLevel: 'info',
  legalComments: 'none',
};

function copyRegrets() {
  const from = path.join(here, '..', '..', 'plugin', 'regrets');
  const to = path.join(here, 'dist', 'regrets');
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) if (name.endsWith('.md')) fs.copyFileSync(path.join(from, name), path.join(to, name));
}

const builds = [
  {
    ...common,
    entryPoints: [path.join(here, 'src', 'extension.ts')],
    outfile: path.join(here, 'dist', 'extension.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
    // The core finds its regret library through import.meta.url only when nothing else is set.
    // The extension always calls setSeedDir at activation, so the empty value is never read.
    logOverride: { 'empty-import-meta': 'silent' },
  },
  {
    ...common,
    entryPoints: [path.join(here, 'webview', 'main.tsx')],
    outfile: path.join(here, 'dist', 'webview.js'),
    platform: 'browser',
    format: 'esm',
    target: 'chrome120',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    loader: { '.css': 'css', '.woff2': 'file' },
    assetNames: '[name]',
  },
];

function copyFontLicence() {
  fs.copyFileSync(path.join(here, 'webview', 'fonts', 'OFL.txt'), path.join(here, 'dist', 'source-serif-4-OFL.txt'));
}

// Start from an empty dist/ so no source map or old package from a development build is shipped.
fs.rmSync(path.join(here, 'dist'), { recursive: true, force: true });
copyRegrets();
copyFontLicence();
const contexts = await Promise.all(builds.map((b) => context(b)));
if (watch) {
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all(contexts.map((c) => c.rebuild()));
  await Promise.all(contexts.map((c) => c.dispose()));
}
