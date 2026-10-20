#!/usr/bin/env node
// build-app.mjs — bundle the wizard + engine + library data into one self-contained HTML file.
// Usage: node scripts/build-app.mjs [dataDir] [out.html]
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';

const dir = process.argv[2] || 'data';
const out = process.argv[3] || 'dist/zwo-workout-builder.html';
const root = new URL('..', import.meta.url).pathname;

// PWA: manifest + service worker + PNG icons, emitted next to the HTML so the app
// folder can be added to the home screen and keep working offline.
// icons.json: { any: {192: b64, 512, 1024}, maskable: {512: b64, 1024} }
const iconSet = JSON.parse(fs.readFileSync(path.join(root, 'src/app/icons.json'), 'utf8'));
const iconEntries = [];
for (const purpose of ['any', 'maskable']) for (const [size, b64] of Object.entries(iconSet[purpose])) {
  const name = purpose === 'maskable' ? `mask-${size}.png` : `${size}.png`;
  iconEntries.push({ name, size, purpose, b64 });
}
const manifest = {
  name: 'Zwo Workout Builder',
  short_name: 'Zwo Builder',
  description: 'Build Zwift training plans and workouts in minutes. No account, no server, fully offline.',
  start_url: './',
  scope: './',
  display: 'standalone',
  background_color: '#0b0b0c',
  theme_color: '#1cc4e6',
  icons: iconEntries.map(({ name, size, purpose }) => ({
    src: name, sizes: `${size}x${size}`, type: 'image/png', purpose: purpose === 'maskable' ? 'maskable' : 'any',
  })),
};

// Only what the engine calculates with: no titles, descriptions or plan names of library workouts.
const library = JSON.parse(fs.readFileSync(path.join(dir, 'library.json'), 'utf8'))
  .map((w, i) => ({
    id: i, primary: w.primary, secondary: w.secondary, level: w.level, flags: w.flags,
    workMin: w.workMin, durMin: w.durMin, blocks: w.blocks,
  }));
const rules = JSON.parse(fs.readFileSync(path.join(dir, 'rules.json'), 'utf8'));
delete rules.typeTransitions;

// Compress the JSON data with gzip to reduce bundle size, encode as base64 for embedding.
// The browser decompresses it at runtime with the built-in DecompressionStream API.
const jsonData = JSON.stringify({ library, rules }).replace(/</g, '\u003c');
const compressed = gzipSync(Buffer.from(jsonData, 'utf8'));
const dataB64 = compressed.toString('base64');

const res = await build({
  entryPoints: [path.join(root, 'src/app/main.js')],
  bundle: true, format: 'iife', minify: true, write: false, target: 'es2020',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const tpl = fs.readFileSync(path.join(root, 'src/app/template.html'), 'utf8');
// app icon: inline in the top bar and as the favicon
const icon = fs.readFileSync(path.join(root, 'src/app/icon.svg'), 'utf8')
  .replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>|<metadata>[\s\S]*?<\/metadata>/g, '') // keep only the drawing
  .replace(/\s+xmlns:c2pa="[^"]*"/, '')
  .trim();
const iconUri = `data:image/svg+xml;base64,${Buffer.from(icon).toString('base64')}`;
const html = tpl
  .replace('__ICON_URI__', () => iconUri)
  .replace('__ICON__', () => icon.replace('<svg ', '<svg aria-hidden="true" '))
  .replace('__DATA__', () => dataB64)
  .replace('__APP__', () => js);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
// PWA assets next to the HTML: manifest, service worker, icon set.
// The worker's cached shell is generated from the same files that are shipped,
// so it never drifts from what the release and Pages deploy. Relative paths
// resolve against the worker's own URL, so one build works on any host and
// sub-path ('.' = the directory the worker lives in = the app page).
const pwaDir = path.dirname(out);
const shell = ['.', 'sw.js', 'manifest.webmanifest', ...iconEntries.map((i) => i.name)];
const sw = fs.readFileSync(path.join(root, 'src/app/sw.js'), 'utf8')
  .replace(/const APP_SHELL = \[[\s\S]*?\];/, `const APP_SHELL = ${JSON.stringify(shell, null, 2).replace(/\n/g, '')};`);
fs.writeFileSync(path.join(pwaDir, 'sw.js'), sw);
fs.writeFileSync(path.join(pwaDir, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));
for (const { name, b64 } of iconEntries) fs.writeFileSync(path.join(pwaDir, name), Buffer.from(b64, 'base64'));
const dataKb = (dataB64.length / 1024).toFixed(0);
const appKb = (js.length / 1e3).toFixed(0);
console.log(`${out}: ${(html.length / 1e6).toFixed(2)} MB (app ${appKb} kB, data ${dataKb} kB compressed) + PWA assets`);

