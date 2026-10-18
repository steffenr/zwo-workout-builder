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

// Only what the engine calculates with: no titles, descriptions or plan names of library workouts.
const library = JSON.parse(fs.readFileSync(path.join(dir, 'library.json'), 'utf8'))
  .map((w, i) => ({
    id: i, primary: w.primary, secondary: w.secondary, level: w.level, flags: w.flags,
    workMin: w.workMin, durMin: w.durMin, blocks: w.blocks,
    ...(w.primary === 'test' && /^FTP Ramp Test$/i.test(w.title) ? { ramp: true } : {}),
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
const html = tpl.replace('__DATA__', () => dataB64).replace('__APP__', () => js);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
const dataKb = (dataB64.length / 1024).toFixed(0);
const appKb = (js.length / 1e3).toFixed(0);
console.log(`${out}: ${(html.length / 1e6).toFixed(2)} MB (app ${appKb} kB, data ${dataKb} kB compressed)`);

