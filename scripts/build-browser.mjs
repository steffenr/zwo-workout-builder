#!/usr/bin/env node
// build-browser.mjs — inject index data into the catalog browser page.
// Usage: node scripts/build-browser.mjs <dataDir> <out.html>
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || 'data';
const out = process.argv[3] || 'dist/library-index.html';
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const catalog = read('catalog.json').map(({ zonesMin, workMin, ...w }) => ({ ...w, zonesMin, workMin }));
const plans = read('plans.json').map((p) => ({ ...p, weeksDetail: p.weeksDetail?.map(({ ids, mix, ...w }) => w) }));
const patterns = read('patterns.json').slice(0, 60).map(({ examples, items, ...p }) => p);
const data = { catalog, plans, patterns, rules: read('rules.json'), summary: read('summary.json') };
const tpl = fs.readFileSync(new URL('../src/browser/template.html', import.meta.url), 'utf8');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, tpl.replace('__DATA__', JSON.stringify(data).replace(/</g, '\\u003c')));
console.log(`${out}: ${(fs.statSync(out).size / 1e6).toFixed(2)} MB`);
