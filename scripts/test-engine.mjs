#!/usr/bin/env node
// test-engine.mjs — generate plans for sample athletes and check them.
import fs from 'node:fs';
import { buildPlan, buildSingle, planFiles, DAY_NAMES } from '../src/engine/plan.js';
import { parseZwo, computeMetrics } from '../src/core/zwo.js';
import { classify } from '../src/core/classify.js';
import { makeZip } from '../src/engine/export.js';
import { HARD } from '../src/engine/compose.js';

const dir = process.argv[2] || 'data';
const ctx = {
  library: JSON.parse(fs.readFileSync(`${dir}/library.json`, 'utf8')),
  rules: JSON.parse(fs.readFileSync(`${dir}/rules.json`, 'utf8')),
};
const verbose = process.argv.includes('-v');

const scenarios = [
  { label: 'Beginner fitness, 3 days', ftp: 180, weight: 82, hours: 2.5, years: 0, intensity: 2, goal: 'fitness', weeks: 8,
    days: [{ day: 2, minutes: 45 }, { day: 4, minutes: 45 }, { day: 6, minutes: 90 }], style: 'auto', source: 'mixed', includeTest: true },
  { label: 'Intermediate FTP, 4 days', ftp: 250, weight: 75, hours: 6, years: 2, intensity: 3, goal: 'ftp', weeks: 10,
    days: [{ day: 2, minutes: 60 }, { day: 3, minutes: 60 }, { day: 5, minutes: 60 }, { day: 7, minutes: 120 }], style: 'auto', source: 'mixed', includeTest: true },
  { label: 'Advanced racer, 6 days, polarized', ftp: 310, weight: 70, hours: 11, years: 3, intensity: 4, goal: 'racing', weeks: 12, eventDate: '2027-03-01',
    days: [1, 2, 3, 4, 6, 7].map((d) => ({ day: d, minutes: d >= 6 ? 180 : 75 })), style: 'polarized', riderType: 'sprinter', weaknesses: ['vo2', 'punch'], source: 'mixed' },
  { label: 'Fondo with outdoor Sunday', ftp: 230, weight: 78, hours: 7, years: 2, intensity: 3, goal: 'fondo', weeks: 12, eventDate: '2027-06-01',
    days: [{ day: 2, minutes: 60 }, { day: 4, minutes: 75 }, { day: 6, minutes: 120 }, { day: 7, minutes: 240, outdoor: true }], style: 'auto', source: 'library' },
  { label: 'Time-crunched sweet spot, 2 days', ftp: 260, weight: 80, hours: 3, years: 1, intensity: 3, goal: 'ftp', weeks: 6,
    days: [{ day: 3, minutes: 45 }, { day: 6, minutes: 60 }], style: 'sweetspot', source: 'composed' },
];

let problems = 0;
const warn = (msg) => { problems++; console.log('  ⚠ ' + msg); };
const agree = { yes: 0, no: 0 };
const mismatches = [];

for (const sc of scenarios) {
  const t0 = Date.now();
  const plan = buildPlan(sc, ctx);
  const ms = Date.now() - t0;
  console.log(`\n### ${sc.label} → ${plan.name}  (${plan.athlete.levelLabel}, style ${plan.style}, ${ms} ms)`);
  for (const wk of plan.weeks) {
    const cells = wk.sessions.map((s) => s.outdoor ? `${DAY_NAMES[s.day - 1]} outdoor ${s.minutes}` : `${DAY_NAMES[s.day - 1]} ${s.category}${s.workout.source ? '*' : ''} ${s.workout.durMin}`);
    console.log(`W${String(wk.week).padStart(2)} ${wk.kind.padEnd(8)} ${wk.phase.padEnd(6)} TSS ${String(wk.tss).padStart(4)}/${String(wk.targetTss).padStart(4)}  ${wk.hours}h | ${cells.join(' · ')}`);
    if (wk.tss > wk.targetTss * 1.15) warn(`week ${wk.week} over target`);
    // back-to-back hard
    const hardDays = wk.sessions.filter((s) => HARD.has(s.category)).map((s) => s.day);
    for (let i = 1; i < hardDays.length; i++) if (hardDays[i] - hardDays[i - 1] === 1) console.log(`  · back-to-back hard days in week ${wk.week}`);
    for (const s of wk.sessions) {
      if (s.outdoor) continue;
      const w = s.workout;
      if (Math.abs(w.durMin - s.dur) > 2) warn(`W${wk.week} ${DAY_NAMES[s.day - 1]}: duration ${w.durMin} vs slot ${s.dur}`);
      if (verbose) console.log(`     ${w.file}  [${w.label}] TSS ${Math.round(w.metrics.tss)} IF ${w.metrics.IF.toFixed(2)}`);
    }
  }
  // round trip + classifier agreement
  const files = planFiles(plan);
  for (const f of files.filter((x) => x.name.endsWith('.zwo'))) {
    const parsed = parseZwo(f.data);
    const m = computeMetrics(parsed);
    const c = classify(parsed, m);
    const s = plan.weeks.flatMap((w) => w.sessions).find((x) => x.workout && f.name.endsWith(x.workout.file));
    if (Math.abs(m.tss - s.workout.metrics.tss) > 1) warn(`round-trip TSS differs for ${f.name}`);
    if (s.category === 'test') continue;
    const ok = c.primary === s.category || c.secondary === s.category || (s.category === 'recovery' && c.primary === 'endurance');
    agree[ok ? 'yes' : 'no']++;
    if (!ok) mismatches.push(`${s.category} → classified ${c.primary}/${c.secondary}: ${s.workout.name}`);
  }
  const zip = makeZip(files);
  console.log(`  files: ${files.length}, zip ${(zip.length / 1024).toFixed(0)} kB, names unique: ${new Set(files.map((f) => f.name)).size === files.length}`);
}

console.log('\n### Single workouts');
for (const [cat, dur] of [['vo2max', 60], ['threshold', 75], ['sweetspot', 45], ['endurance', 90], ['sprint', 60], ['auto', 60]]) {
  const opts = buildSingle({ ftp: 250, weight: 75, hours: 6, years: 2, intensity: 3, goal: 'racing', category: cat, durMin: dur, source: 'mixed' }, ctx);
  console.log(`${cat} ${dur}: ` + opts.map((o) => `${o.name} [${o.durMin}min TSS ${Math.round(o.metrics.tss)}]`).join(' | '));
}

console.log(`\nclassifier agrees with intended type: ${agree.yes}/${agree.yes + agree.no}`);
mismatches.slice(0, 15).forEach((x) => console.log('  ' + x));
console.log(`problems: ${problems}`);
