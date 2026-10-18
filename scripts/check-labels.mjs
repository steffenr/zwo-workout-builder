// Compare classification against types implied by workout titles (rough ground truth).
import fs from 'node:fs';
const c = JSON.parse(fs.readFileSync(process.argv[2] || 'data/catalog.json', 'utf8'));
const rules = [
  ['vo2max', /\bvo2|v02|max aerobic/i],
  ['sweetspot', /sweet ?spot|\bsst\b/i],
  ['threshold', /threshold|\bftp interval|2x20|\bover.?under/i],
  ['tempo', /\btempo\b/i],
  ['sprint', /\bsprint/i],
  ['anaerobic', /anaerobic/i],
  ['recovery', /recovery/i],
  ['endurance', /endurance|zone ?2|\bz2\b|aerobic base|long ride/i],
];
const conf = {};
const misses = {};
for (const w of c) {
  const hit = rules.filter(([, re]) => re.test(w.title));
  if (hit.length !== 1) continue;
  const exp = hit[0][0];
  conf[exp] ||= {};
  conf[exp][w.primary] = (conf[exp][w.primary] || 0) + 1;
  if (w.primary !== exp && w.secondary !== exp) (misses[exp] ||= []).push(`${w.primary}/${w.secondary} IF${w.IF} ${w.durMin}m ${w.title} | ${w.structure.slice(0, 90)}`);
}
let ok = 0, okLoose = 0, tot = 0;
for (const [exp, row] of Object.entries(conf)) {
  const n = Object.values(row).reduce((a, b) => a + b, 0);
  tot += n; ok += row[exp] || 0;
  console.log(exp.padEnd(10), n, JSON.stringify(row));
}
for (const w of c) {
  const hit = rules.filter(([, re]) => re.test(w.title));
  if (hit.length === 1 && (w.primary === hit[0][0] || w.secondary === hit[0][0])) okLoose++;
}
console.log(`\nprimary matches title: ${ok}/${tot} = ${Math.round(ok / tot * 100)}%   primary-or-secondary: ${okLoose}/${tot} = ${Math.round(okLoose / tot * 100)}%`);
if (process.argv[3]) for (const [k, l] of Object.entries(misses)) { console.log('\n## miss', k); l.slice(0, +process.argv[3]).forEach((x) => console.log('  ' + x)); }
