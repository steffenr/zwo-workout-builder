#!/usr/bin/env node
// test-engine.mjs — generate plans for sample athletes and check them.
import fs from 'node:fs';
import { buildPlan, buildSingle, planFiles, keyList, DAY_NAMES } from '../src/engine/plan.js';
import { parseZwo, computeMetrics } from '../src/core/zwo.js';
import { classify } from '../src/core/classify.js';
import { makeZip } from '../src/engine/export.js';
import { HARD } from '../src/engine/compose.js';
import { blocksDuration } from '../src/engine/blocks.js';

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
  { label: 'Comeback: 2 h now, 8 h available', ftp: 250, weight: 75, hours: 2, years: 2, intensity: 4, goal: 'ftp', weeks: 8,
    days: [{ day: 2, minutes: 75 }, { day: 3, minutes: 60 }, { day: 4, minutes: 75 }, { day: 6, minutes: 150 }, { day: 7, minutes: 120 }], style: 'auto', source: 'mixed' },
  { label: 'Time-crunched sweet spot, 2 days', ftp: 260, weight: 80, hours: 3, years: 1, intensity: 3, goal: 'ftp', weeks: 6,
    days: [{ day: 3, minutes: 45 }, { day: 6, minutes: 60 }], style: 'sweetspot', source: 'composed' },
];

// ICTX file checks: well-formed envelope, balanced tags, leg durations equal the
// block durations, level badges and the effort classification stay consistent.
function checkIctx(file, blocks, order) {
  const xml = file.data;
  const fails = [];
  if (!xml.startsWith('\uFEFF<?xml version="1.0" ?>')) fails.push('missing BOM/xml decl');
  for (const t of ['icTrainer', 'icTrainerExercise', 'sequence', 'leg']) {
    const open = (xml.match(new RegExp(`<${t}>`, 'g')) || []).length;
    const close = (xml.match(new RegExp(`</${t}>`, 'g')) || []).length;
    if (open !== close) fails.push(`unbalanced <${t}> (${open}/${close})`);
  }
  if ((xml.match(/<icTrainerExercise>/g) || []).length !== 1) fails.push('not exactly one exercise');
  const doMatch = xml.match(/<displayOrder>(\d+)<\/displayOrder>/);
  if (!doMatch || +doMatch[1] !== order) fails.push(`displayOrder ${doMatch?.[1]} != ${order}`);
  const seqXml = [...xml.matchAll(/<sequence>[\s\S]*?<\/sequence>/g)].map((m) => m[0]);
  // leg durations (times loops) must equal the block duration
  const total = seqXml.reduce((sum, s) => {
    const loops = +s.match(/<loops>(\d+)<\/loops>/)[1];
    const secs = [...s.matchAll(/<duration>(\d+):(\d{2})<\/duration>/g)].reduce((a, x) => a + +x[1] * 60 + +x[2], 0);
    return sum + secs * loops;
  }, 0);
  if (total !== blocksDuration(blocks)) fails.push(`leg total ${total}s != blocks ${blocksDuration(blocks)}s`);
  // level badges: <55 XS, <80 S, <106 L, else XL (ramps count at the midpoint)
  for (const m of xml.matchAll(/<leg>[\s\S]*?<\/leg>/g)) {
    const leg = m[0];
    const lvl = leg.match(/<level>(\w+)<\/level>/)[1];
    const r = +leg.match(/<levelRatio>(\d+)<\/levelRatio>/)[1];
    const re = leg.match(/<levelRatioEnd>(\d+)<\/levelRatioEnd>/);
    const mid = re ? Math.round((r + +re[1]) / 2) : r;
    const exp = mid < 55 ? 'XS' : mid < 80 ? 'S' : mid < 106 ? 'L' : 'XL';
    if (lvl !== exp) fails.push(`level ${lvl} != ${exp} (mid ${mid})`);
  }
  const et = xml.match(/<exerciseType>(\w+)<\/exerciseType>/)[1];
  if (!['RECOM', 'ENDURANCE', 'SPEED', 'POWER', 'HIIT'].includes(et)) fails.push(`exerciseType ${et} not in allowed set`);
  // workoutStruct parts (loops expanded) must equal the loop-expanded leg count
  const parts = xml.match(/<workoutStruct>ratio;([\s\S]*?)<\/workoutStruct>/)[1].split(';').length;
  const expanded = seqXml.reduce((a, s) => a + (s.match(/<leg>/g) || []).length * +s.match(/<loops>(\d+)<\/loops>/)[1], 0);
  if (parts !== expanded) fails.push(`workoutStruct ${parts} parts != ${expanded} loop-expanded legs`);
  // maxLevelRatioDisplay: 10-step ceiling over the max leg ratio (ramp peak)
  const maxR = Math.max(0, ...[...xml.matchAll(/<levelRatio>(\d+)<\/levelRatio>/g)].map((m) => +m[1]), ...[...xml.matchAll(/<levelRatioEnd>(\d+)<\/levelRatioEnd>/g)].map((m) => +m[1]));
  const maxD = +xml.match(/<maxLevelRatioDisplay>(\d+)<\/maxLevelRatioDisplay>/)[1];
  if (maxD !== Math.max(100, Math.ceil(maxR / 10) * 10)) fails.push(`maxLevelRatioDisplay ${maxD} != ${Math.max(100, Math.ceil(maxR / 10) * 10)}`);
  return fails.map((f) => `ictx ${file.name.split('/').pop()}: ${f}`);
}

let problems = 0;
const warn = (msg) => { problems++; console.log('  ⚠ ' + msg); };
const agree = { yes: 0, no: 0 };
const mismatches = [];

for (const sc of scenarios) {
  const t0 = Date.now();
  const plan = buildPlan(sc, ctx);
  const ms = Date.now() - t0;
  console.log(`\n### ${sc.label} → ${plan.name}  (${plan.athlete.levelLabel}, style ${plan.style}, ${ms} ms)`);
  if (plan.weeks[0].tss > plan.athlete.startTss * 1.3) warn(`week 1 load ${plan.weeks[0].tss} > 1.3 × current ${plan.athlete.startTss}`);
  for (const wk of plan.weeks) {
    const cells = wk.sessions.map((s) => s.outdoor ? `${DAY_NAMES[s.day - 1]} outdoor ${s.minutes}` : `${DAY_NAMES[s.day - 1]} ${s.category}${s.workout.source ? '*' : ''} ${s.workout.durMin}`);
    console.log(`W${String(wk.week).padStart(2)} ${wk.kind.padEnd(8)} ${wk.phase.padEnd(6)} TSS ${String(wk.tss).padStart(4)}/${String(wk.targetTss).padStart(4)}  ${wk.hours}h | ${cells.join(' · ')}`);
    if (wk.tss > wk.targetTss * 1.15) warn(`week ${wk.week} over target`);
    // back-to-back hard
    const hardDays = wk.sessions.filter((s) => HARD.has(s.category)).map((s) => s.day);
    for (let i = 1; i < hardDays.length; i++) if (hardDays[i] - hardDays[i - 1] === 1) console.log(`  · back-to-back hard days in week ${wk.week}`);
    // FTP test: no hard session on the day before or after it, not right after the long ride
    for (const t of wk.sessions.filter((s) => s.category === 'test')) {
      const prev = wk.sessions.find((x) => x.day === ((t.day + 5) % 7) + 1);
      const next = wk.sessions.find((x) => x.day === (t.day % 7) + 1);
      if (prev && !prev.outdoor && HARD.has(prev.category)) warn(`W${wk.week}: hard session the day before the FTP test`);
      if (next && !next.outdoor && HARD.has(next.category)) warn(`W${wk.week}: hard session the day after the FTP test`);
      if (prev && prev.role === 'long') warn(`W${wk.week}: FTP test right after the long ride`);
    }
    // no key session on the day after a long ride (>= 150 min) for levels <= 3
    if (plan.athlete.level <= 3) {
      for (const s of wk.sessions) {
        const len = s.outdoor ? s.minutes : s.workout.durMin;
        const next = wk.sessions.find((x) => x.day === (s.day % 7) + 1);
        if (len >= 150 && next && !next.outdoor && HARD.has(next.category)) warn(`W${wk.week} ${DAY_NAMES[next.day - 1]}: key session after a ${len} min ride`);
      }
    }
    for (const s of wk.sessions) {
      if (s.outdoor) continue;
      const w = s.workout;
      if (Math.abs(w.durMin - s.dur) > 2) warn(`W${wk.week} ${DAY_NAMES[s.day - 1]}: duration ${w.durMin} vs slot ${s.dur}`);
      if (verbose) console.log(`     ${w.file}  [${w.label}] TSS ${Math.round(w.metrics.tss)} IF ${w.metrics.IF.toFixed(2)}`);
    }
  }
  // every key category of a phase appears in that phase (when it has enough key slots)
  {
    const byPhase = {};
    for (const wk of plan.weeks.filter((w) => w.kind === 'load')) {
      const e = (byPhase[wk.phase] ||= { slots: 0, cats: new Set() });
      for (const s of wk.sessions) if (s.role === 'key') { e.slots++; e.cats.add(s.category); }
    }
    for (const [ph, e] of Object.entries(byPhase)) {
      const L = keyList(sc, ph, plan.style);
      const missing = L.filter((c) => !e.cats.has(c));
      if (e.slots >= L.length + 1 && missing.length) warn(`${ph} phase never uses ${missing.join(', ')}`);
    }
  }
  // round trip + classifier agreement
  const files = planFiles(plan);
  {
    let order = 0;
    for (const f of files.filter((x) => x.name.endsWith('.ictx'))) {
      order++;
      const w = plan.weeks.flatMap((x) => x.sessions).find((s) => !s.outdoor && f.name.endsWith(s.workout.file.replace(/\.zwo$/, '.ictx')));
      for (const fail of checkIctx(f, w.workout.blocks, order)) warn(fail);
    }
  }
  for (const f of files.filter((x) => x.name.endsWith('.zwo'))) {
    const parsed = parseZwo(f.data);
    const m = computeMetrics(parsed);
    const c = classify(parsed, m);
    const s = plan.weeks.flatMap((w) => w.sessions).find((x) => x.workout && f.name.endsWith(x.workout.file));
    // the ramp test's TSS is estimated for a typical finish, not for the full file
    if (s.category !== 'test' && Math.abs(m.tss - s.workout.metrics.tss) > 1) warn(`round-trip TSS differs for ${f.name}`);
    if (s.category === 'test') continue;
    const ok = c.primary === s.category || c.secondary === s.category || (s.category === 'recovery' && c.primary === 'endurance');
    agree[ok ? 'yes' : 'no']++;
    if (!ok) mismatches.push(`${s.category} → classified ${c.primary}/${c.secondary}: ${s.workout.name}`);
  }
  const zip = makeZip(files);
  console.log(`  files: ${files.length} (${files.filter((f) => f.name.endsWith('.ictx')).length} ictx), zip ${(zip.length / 1024).toFixed(0)} kB, names unique: ${new Set(files.map((f) => f.name)).size === files.length}`);
}

console.log('\n### Single workouts');
for (const [cat, dur] of [['vo2max', 60], ['threshold', 75], ['sweetspot', 45], ['endurance', 90], ['sprint', 60], ['auto', 60]]) {
  const opts = buildSingle({ ftp: 250, weight: 75, hours: 6, years: 2, intensity: 3, goal: 'racing', category: cat, durMin: dur, source: 'mixed' }, ctx);
  console.log(`${cat} ${dur}: ` + opts.map((o) => `${o.name} [${o.durMin}min TSS ${Math.round(o.metrics.tss)}]`).join(' | '));
}

console.log(`\nclassifier agrees with intended type: ${agree.yes}/${agree.yes + agree.no}`);
mismatches.slice(0, 15).forEach((x) => console.log('  ' + x));
console.log(`problems: ${problems}`);
if (problems) process.exitCode = 1; // fail CI when a check found a problem
