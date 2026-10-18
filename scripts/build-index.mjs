#!/usr/bin/env node
// build-index.mjs — index a folder of .zwo workouts into catalog/plans/patterns JSON.
// Usage: node scripts/build-index.mjs <libraryDir> <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { parseZwo, computeMetrics, ZONES, r1, r2 } from '../src/core/zwo.js';
import { encodeBlocks } from '../src/engine/blocks.js';
import {
  classify, mergeSegments, compress, describeStructure, motifs, effortCategory, CATEGORIES,
} from '../src/core/classify.js';

const [libDir, outDir] = process.argv.slice(2);
if (!libDir || !outDir) {
  console.error('Usage: build-index.mjs <libraryDir> <outDir>');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const FILE_RE = /^Week(\d+)_Day(\d+)_(.*)\.zwo$/i;

// ---------------------------------------------------------------- collect files
const folders = fs.readdirSync(libDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
  .map((d) => d.name).sort();

const catalog = [];
const planMeta = {};

for (const folder of folders) {
  const files = fs.readdirSync(path.join(libDir, folder)).filter((f) => f.toLowerCase().endsWith('.zwo'));
  const parsedNames = files.map((f) => {
    const m = f.match(FILE_RE);
    return { f, week: m ? +m[1] : null, day: m ? +m[2] : null };
  }).sort((a, b) => (a.week - b.week) || (a.day - b.day) || a.f.localeCompare(b.f));

  const weeks = new Set(parsedNames.map((p) => p.week));
  const kind = weeks.size >= 2 ? 'plan' : 'collection';
  let planTag = '';

  parsedNames.forEach(({ f, week, day }, order) => {
    const xml = fs.readFileSync(path.join(libDir, folder, f), 'utf8');
    const parsed = parseZwo(xml);
    const m = computeMetrics(parsed);
    const c = classify(parsed, m);
    const merged = mergeSegments(m.segs);
    const items = compress(merged);
    planTag ||= parsed.tags[0] || folder;

    const nameParts = parsed.name.split(' - ');
    let title = nameParts.length >= 3 ? nameParts.slice(2).join(' - ') : nameParts[nameParts.length - 1];
    // generic titles ("Day 1") — the real session name sits in a short description
    if (/^(day|session|workout)?\s*\d+$/i.test(title.trim()) && parsed.description && parsed.description.length <= 60) {
      title = `${title}: ${parsed.description}`;
    }

    catalog.push({
      id: `${folder}/${f.replace(/\.zwo$/i, '')}`,
      file: `${folder}/${f}`,
      plan: folder,
      planKind: kind,
      week, day, order,
      name: parsed.name,
      title,
      description: parsed.description,
      durMin: r1(m.dur / 60),
      tss: Math.round(m.tss),
      IF: r2(m.IF),
      np: r2(m.np),
      avg: r2(m.avg),
      maxPower: r2(m.maxPower),
      level: c.level,
      primary: c.primary,
      secondary: c.secondary,
      labelSource: c.labelSource,
      flags: c.flags,
      workShare: c.workShare,
      longestEffortMin: r1(c.longestEffort / 60),
      zonesMin: Object.fromEntries(ZONES.map((z, i) => [z.id, r1(m.zoneSec[i] / 60)]).concat([['free', r1(m.freeSec / 60)]])),
      workMin: Object.fromEntries(Object.entries(c.workSec).map(([k, v]) => [k, r1(v / 60)])),
      cadenceTargetsPct: Math.round((m.cadence.targetSec / Math.max(1, m.dur)) * 100),
      structure: describeStructure(items),
      motifs: motifs(items),
      blocks: encodeBlocks(parsed.blocks),
      profile: merged.map((s) => (s.free ? [Math.round(s.dur), null, null] : [Math.round(s.dur), r2(s.p0), r2(s.p1)])),
    });
  });
  planMeta[folder] = { id: folder, kind, tag: planTag, weeks: weeks.size, files: files.length };
}

// ---------------------------------------------------------------- plans
const plans = Object.values(planMeta).map((p) => {
  const ws = catalog.filter((w) => w.plan === p.id);
  const byWeek = {};
  for (const w of ws) (byWeek[w.week ?? 0] ||= []).push(w);
  const weeks = Object.entries(byWeek).sort((a, b) => a[0] - b[0]).map(([wk, list]) => {
    const tssBy = {};
    for (const w of list) tssBy[w.primary] = (tssBy[w.primary] || 0) + w.tss;
    return {
      week: +wk,
      workouts: list.length,
      hours: r1(list.reduce((a, w) => a + w.durMin, 0) / 60),
      tss: list.reduce((a, w) => a + w.tss, 0),
      longestMin: Math.max(...list.map((w) => w.durMin)),
      hardSessions: list.filter((w) => ['threshold', 'vo2max', 'anaerobic', 'sprint'].includes(w.primary)).length,
      mix: tssBy,
      ids: list.map((w) => w.id),
    };
  });
  // recovery weeks: noticeably lower load than the average of the previous (up to) 3 weeks
  weeks.forEach((w, i) => {
    const prev = weeks.slice(Math.max(0, i - 3), i);
    const ref = prev.length ? prev.reduce((a, x) => a + x.tss, 0) / prev.length : null;
    w.recoveryWeek = p.kind === 'plan' && ref != null && w.tss < ref * 0.75 && w.workouts <= Math.max(...prev.map((x) => x.workouts));
  });
  const totalTss = ws.reduce((a, w) => a + w.tss, 0);
  const mixAll = {};
  for (const w of ws) mixAll[w.primary] = (mixAll[w.primary] || 0) + w.tss;
  const share = Object.fromEntries(Object.entries(mixAll).map(([k, v]) => [k, r2(v / Math.max(1, totalTss))]));
  const focusTss = (k) => ws.filter((w) => w.primary === k || w.secondary === k).length;
  return {
    ...p,
    workouts: ws.length,
    avgDurMin: Math.round(ws.reduce((a, w) => a + w.durMin, 0) / Math.max(1, ws.length)),
    avgIF: r2(ws.reduce((a, w) => a + w.IF, 0) / Math.max(1, ws.length)),
    tssShare: share,
    style: planStyle(ws),
    focusCounts: Object.fromEntries(CATEGORIES.map((k) => [k, focusTss(k)]).filter(([, v]) => v)),
    weeksDetail: p.kind === 'plan' ? weeks : undefined,
  };
});

/** Polarized vs sweet-spot/threshold vs pyramidal from time in zone across the plan. */
function planStyle(ws) {
  const t = { low: 0, mid: 0, high: 0 };
  for (const w of ws) {
    t.low += w.zonesMin.Z1 + w.zonesMin.Z2 + w.zonesMin.free;
    t.mid += w.zonesMin.Z3 + w.zonesMin.Z4;
    t.high += w.zonesMin.Z5 + w.zonesMin.Z6 + w.zonesMin.Z7;
  }
  const tot = t.low + t.mid + t.high || 1;
  const s = { low: r2(t.low / tot), mid: r2(t.mid / tot), high: r2(t.high / tot) };
  let label;
  if (s.low >= 0.75 && s.high >= s.mid) label = 'polarized';
  else if (s.mid >= 0.3 && s.mid > s.high * 2) label = 'threshold/sweet-spot';
  else if (s.low > s.mid && s.mid > s.high) label = 'pyramidal';
  else label = 'mixed';
  return { ...s, label };
}

// ---------------------------------------------------------------- motif library
const motifMap = new Map();
for (const w of catalog) {
  for (const mo of w.motifs) {
    const e = motifMap.get(mo.signature) || {
      signature: mo.signature, items: mo.items, count: 0, repeats: [], examples: [],
    };
    e.count++;
    e.repeats.push(mo.repeat);
    if (e.examples.length < 5) e.examples.push(w.id);
    motifMap.set(mo.signature, e);
  }
}
const patterns = [...motifMap.values()].map((e) => {
  // category of the hardest work item within the motif
  const work = e.items.filter(([, p0, p1]) => p0 != null && Math.max(p0, p1) >= 0.76);
  const hardest = work.sort((a, b) => Math.max(b[1], b[2]) - Math.max(a[1], a[2]))[0];
  const avgP = hardest ? (hardest[1] + hardest[2]) / 2 : 0;
  const restBetween = e.items.filter(([, p0, p1]) => p0 != null && Math.max(p0, p1) < 0.76).reduce((a, [d]) => a + d, 0);
  const cat = hardest ? effortCategory({ avg: avgP, dur: hardest[0], restBefore: restBetween, restAfter: restBetween }) : 'endurance';
  const reps = e.repeats.sort((a, b) => a - b);
  return {
    signature: e.signature, category: cat, count: e.count,
    repeatMin: reps[0], repeatMax: reps[reps.length - 1], repeatMedian: reps[Math.floor(reps.length / 2)],
    items: e.items, examples: e.examples,
  };
}).sort((a, b) => b.count - a.count);

// ---------------------------------------------------------------- summary
const durBucket = (d) => (d < 30 ? '<30' : d < 45 ? '30-44' : d < 60 ? '45-59' : d < 75 ? '60-74' : d < 90 ? '75-89' : d < 120 ? '90-119' : d < 180 ? '120-179' : '180+');
const count = (fn) => catalog.reduce((acc, w) => { const k = fn(w); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
const matrix = {};
for (const w of catalog) {
  matrix[w.primary] ||= {};
  matrix[w.primary][durBucket(w.durMin)] = (matrix[w.primary][durBucket(w.durMin)] || 0) + 1;
}
const flagCounts = {};
for (const w of catalog) for (const f of w.flags) flagCounts[f] = (flagCounts[f] || 0) + 1;

const summary = {
  generated: new Date().toISOString(),
  workouts: catalog.length,
  plans: plans.filter((p) => p.kind === 'plan').length,
  collections: plans.filter((p) => p.kind === 'collection').length,
  byPrimary: count((w) => w.primary),
  byLevel: count((w) => w.level),
  byDuration: count((w) => durBucket(w.durMin)),
  primaryByDuration: matrix,
  flags: flagCounts,
  patterns: patterns.length,
};

// strip per-workout motifs from catalog output (they live in patterns.json)
const catalogOut = catalog.map(({ motifs: _m, blocks: _b, ...rest }) => rest);
// engine library: everything with a usable structure, plus FTP tests
const library = catalog
  .filter((w) => w.primary === 'test' ? /ftp-tests$/.test(w.plan) : !w.flags.includes('unstructured'))
  .map((w) => ({
    id: w.id, plan: w.plan, planTag: planMeta[w.plan].tag, week: w.week, title: w.title,
    description: w.description, durMin: w.durMin, tss: w.tss, IF: w.IF, level: w.level,
    primary: w.primary, secondary: w.secondary, flags: w.flags, workMin: w.workMin, blocks: w.blocks,
  }));
fs.writeFileSync(path.join(outDir, 'library.json'), JSON.stringify(library));
fs.writeFileSync(path.join(outDir, 'catalog.json'), JSON.stringify(catalogOut));
fs.writeFileSync(path.join(outDir, 'plans.json'), JSON.stringify(plans, null, 1));
fs.writeFileSync(path.join(outDir, 'patterns.json'), JSON.stringify(patterns, null, 1));
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
