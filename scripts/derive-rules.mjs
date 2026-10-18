#!/usr/bin/env node
// derive-rules.mjs — learn plan-building rules from the indexed multi-week plans.
// Usage: node scripts/derive-rules.mjs <dataDir>
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || 'data';
const plans = JSON.parse(fs.readFileSync(path.join(dir, 'plans.json'), 'utf8')).filter((p) => p.kind === 'plan');
const catalog = JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8'));
const byId = Object.fromEntries(catalog.map((w) => [w.id, w]));

const q = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  return +(s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo)).toFixed(2);
};
const stats = (arr) => ({ n: arr.length, p25: q(arr, 0.25), median: q(arr, 0.5), p75: q(arr, 0.75) });

const buildRatios = [];
const recoveryRatios = [];
const blockLengths = [];
const tssPerHour = [];
const hardShare = [];
const longRideShare = [];
const hardPerWeek = {};
const backToBackHard = { yes: 0, no: 0 };
const typeOrder = {}; // which type follows which within a week

for (const p of plans) {
  const weeks = p.weeksDetail.filter((w) => w.week > 0); // week 0 = intro/test week
  let sinceRecovery = 0;
  weeks.forEach((w, i) => {
    if (w.hours > 0) tssPerHour.push(w.tss / w.hours);
    if (w.workouts > 0) hardShare.push(w.hardSessions / w.workouts);
    if (w.hours > 0) longRideShare.push(w.longestMin / 60 / w.hours);
    (hardPerWeek[w.workouts] ||= []).push(w.hardSessions);
    if (i > 0) {
      const prev = weeks[i - 1];
      if (w.recoveryWeek) {
        const ref = weeks.slice(Math.max(0, i - 3), i);
        recoveryRatios.push(w.tss / (ref.reduce((a, x) => a + x.tss, 0) / ref.length));
      } else if (!prev.recoveryWeek && prev.tss > 0) {
        buildRatios.push(w.tss / prev.tss);
      }
    }
    sinceRecovery++;
    if (w.recoveryWeek) {
      blockLengths.push(sinceRecovery - 1);
      sinceRecovery = 0;
    }
    // sequencing inside a week (file order)
    const list = w.ids.map((id) => byId[id]);
    for (let k = 1; k < list.length; k++) {
      const a = list[k - 1].primary;
      const b = list[k].primary;
      const hard = (t) => ['threshold', 'vo2max', 'anaerobic', 'sprint'].includes(t);
      if (hard(a)) backToBackHard[hard(b) ? 'yes' : 'no']++;
      typeOrder[a] ||= {};
      typeOrder[a][b] = (typeOrder[a][b] || 0) + 1;
    }
  });
}

// Work dose: minutes of work in a type, for workouts of that primary type, by duration.
const DOSE_ANCHORS = [[30, 0, 45], [60, 45, 75], [90, 75, 120], [150, 120, 999]];
const dose = {};
for (const k of ['tempo', 'sweetspot', 'threshold', 'vo2max', 'anaerobic', 'sprint']) {
  dose[k] = DOSE_ANCHORS.map(([at, lo, hi]) => {
    const l = catalog.filter((w) => w.primary === k && w.durMin >= lo && w.durMin < hi).map((w) => w.workMin[k] || 0);
    return { durMin: at, n: l.length, p25: q(l, 0.25), p50: q(l, 0.5), p75: q(l, 0.75) };
  }).filter((d) => d.n >= 3);
}

const rules = {
  workDoseMin: dose,
  derivedFrom: `${plans.length} multi-week plans`,
  weeklyLoadIncrease: stats(buildRatios),
  recoveryWeekLoad: stats(recoveryRatios),
  weeksBetweenRecovery: stats(blockLengths),
  tssPerHour: stats(tssPerHour),
  hardSessionShare: stats(hardShare),
  longestRideShareOfWeek: stats(longRideShare),
  hardSessionsBySessionsPerWeek: Object.fromEntries(
    Object.entries(hardPerWeek).map(([k, v]) => [k, stats(v)]),
  ),
  hardSessionFollowedBy: {
    anotherHard: backToBackHard.yes,
    easyOrModerate: backToBackHard.no,
  },
  typeTransitions: typeOrder,
};
fs.writeFileSync(path.join(dir, 'rules.json'), JSON.stringify(rules, null, 1));
console.log(JSON.stringify({ ...rules, typeTransitions: '(see rules.json)' }, null, 1));
