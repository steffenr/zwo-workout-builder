// compose.js — build new workouts from standard interval formats, sized to a work dose.
import {
  warmup, cooldown, steady, intervals, ramp, blocksDuration, roundTo,
} from './blocks.js';
import { clamp, lerp } from './rng.js';

export const CATEGORY_INFO = {
  recovery: { label: 'Recovery', purpose: 'Very easy spinning to speed up recovery. Keep it light, the legs should feel better afterwards.' },
  endurance: { label: 'Endurance', purpose: 'Aerobic base work in zone 2: builds fat metabolism, capillaries and the ability to ride long.' },
  tempo: { label: 'Tempo', purpose: 'Sustained zone 3 riding: raises aerobic power and fatigue resistance at moderate cost.' },
  sweetspot: { label: 'Sweet Spot', purpose: 'Just below threshold (88–94% FTP): the most time-efficient way to raise FTP.' },
  threshold: { label: 'Threshold', purpose: 'Work at FTP: lifts the power you can hold for about an hour and teaches pacing on the limit.' },
  vo2max: { label: 'VO2max', purpose: 'Hard intervals at 106–125% FTP: raise maximal aerobic power and the ceiling for your FTP.' },
  anaerobic: { label: 'Anaerobic', purpose: 'Short, very hard efforts above 120% FTP: punch for short climbs, attacks and bridging gaps.' },
  sprint: { label: 'Sprint', purpose: 'Maximal neuromuscular efforts with full recovery: top-end power and acceleration.' },
  test: { label: 'FTP Test', purpose: 'Fitness test to set or update your FTP. Ride it fresh.' },
};

export const HARD = new Set(['threshold', 'vo2max', 'anaerobic', 'sprint']);

const m = (min) => Math.round(min * 60);
const fmt = (sec) => (sec >= 60 ? `${+(sec / 60).toFixed(1).replace(/\.0$/, '')}min` : `${sec}s`);

// ---------------------------------------------------------------- dose
/** Target minutes of work in a category for a workout of `durMin`, x in [0,1] = easy..hard end of the library range. */
export function workDose(rules, category, durMin, x) {
  const anchors = rules.workDoseMin?.[category];
  if (!anchors?.length) return 0;
  // library median → upper range: coach-made plans dose a bit higher than the average library workout
  const at = (a) => lerp(a.p50, a.p75 * 1.25, clamp(x, 0, 1)) * (x < 0 ? 1 + x * 0.3 : x > 1 ? 1 + (x - 1) * 0.3 : 1);
  if (durMin <= anchors[0].durMin) return at(anchors[0]) * (durMin / anchors[0].durMin) ** 0.7;
  for (let i = 1; i < anchors.length; i++) {
    if (durMin <= anchors[i].durMin) {
      const t = (durMin - anchors[i - 1].durMin) / (anchors[i].durMin - anchors[i - 1].durMin);
      return lerp(at(anchors[i - 1]), at(anchors[i]), t);
    }
  }
  return at(anchors[anchors.length - 1]);
}

// ---------------------------------------------------------------- formats
// Each generator returns candidates {format, label, blocks, workSec}.

function series(reps, work, restSec, restP) {
  const out = [];
  for (let r = 0; r < reps; r++) {
    out.push(...work.map((b) => ({ ...b })));
    if (r < reps - 1 && restSec > 0) out.push(steady(restSec, restP));
  }
  return out;
}

function tempoFormats(x, f) {
  const p = lerp(0.8, 0.86, x);
  const cad = f.torque ? 65 : null;
  const res = [];
  for (const w of [10, 12, 15, 20, 25, 30]) {
    for (let reps = 1; reps <= 4; reps++) {
      res.push({
        format: 'tempo-blocks', label: `Tempo ${reps}x${w}min${cad ? ' low cadence' : ''}`,
        blocks: series(reps, [steady(m(w), p, cad)], m(4), 0.6), workSec: reps * m(w),
      });
    }
  }
  if (f.race || f.climbing) {
    for (const w of [8, 10, 12]) {
      for (let reps = 2; reps <= 4; reps++) {
        const unit = [];
        for (let k = 0; k < w / 2; k++) unit.push(steady(105, p), steady(15, 1.2));
        res.push({ format: 'tempo-surges', label: `Tempo with surges ${reps}x${w}min`, blocks: series(reps, unit, m(4), 0.6), workSec: reps * m(w) });
      }
    }
  }
  return res;
}

function sweetspotFormats(x, f) {
  const p = lerp(0.88, 0.93, x);
  const cad = f.torque || f.climbing ? 65 : null;
  const res = [];
  for (const w of [8, 10, 12, 15, 20]) {
    for (let reps = 2; reps <= 5; reps++) {
      const rest = m(Math.max(3, Math.round(w / 3)));
      res.push({
        format: 'ss-blocks', label: `Sweet Spot ${reps}x${w}min${cad ? ' low cadence' : ''}`,
        blocks: series(reps, [steady(m(w), p, cad)], rest, 0.55), workSec: reps * m(w),
      });
    }
  }
  for (const k of [2, 3, 4]) {
    for (let reps = 2; reps <= 4; reps++) {
      const unit = [];
      for (let i = 0; i < k; i++) unit.push(steady(m(4), lerp(0.87, 0.9, x)), steady(m(1), lerp(0.96, 0.99, x)));
      res.push({ format: 'ss-over', label: `Sweet Spot Over-Unders ${reps}x${k * 5}min`, blocks: series(reps, unit, m(4), 0.55), workSec: reps * k * m(5) });
    }
  }
  if (f.race || f.climbing || x > 0.5) {
    for (const w of [9, 12, 15]) {
      for (let reps = 2; reps <= 4; reps++) {
        const unit = [];
        for (let i = 0; i < w / 3; i++) unit.push(steady(165, p), steady(15, 1.25));
        res.push({ format: 'ss-bursts', label: `Sweet Spot with bursts ${reps}x${w}min`, blocks: series(reps, unit, m(4), 0.55), workSec: reps * m(w) });
      }
    }
  }
  return res;
}

function thresholdFormats(x, f) {
  const p = lerp(0.95, 1.01, x);
  const res = [];
  for (const w of [5, 6, 8, 10, 12, 15, 20]) {
    for (let reps = 2; reps <= 6; reps++) {
      if (w >= 15 && reps > 3) continue;
      const rest = roundTo(m(clamp(w / 2, 2.5, 6)), 30);
      res.push({
        format: 'thr-blocks', label: `Threshold ${reps}x${w}min`,
        blocks: series(reps, [steady(m(w), p, f.climbing ? 70 : null)], rest, 0.55), workSec: reps * m(w),
      });
    }
  }
  for (const k of [2, 3, 4]) {
    for (let reps = 2; reps <= 5; reps++) {
      const unit = [];
      // unders at FTP, overs clearly above it: the surges create lactate that has to be
      // cleared while holding threshold (overs at 104-105 % gave almost no surge)
      for (let i = 0; i < k; i++) unit.push(steady(m(2), lerp(0.955, 0.97, x)), steady(m(1), lerp(1.08, 1.1, x)));
      res.push({ format: 'over-unders', label: `Over-Unders ${reps}x${k * 3}min`, blocks: series(reps, unit, m(4), 0.55), workSec: reps * k * m(3) });
    }
  }
  return res;
}

function vo2Formats(x) {
  const res = [];
  for (const w of [2, 3, 4, 5, 6]) {
    const p = lerp(1.06, 1.18, x) - 0.02 * (w - 3);
    for (let reps = 3; reps <= 8; reps++) {
      if (reps * w > 30) continue;
      const rest = m(clamp(w, 2, 4));
      res.push({ format: 'vo2-long', label: `VO2 ${reps}x${w}min`, blocks: series(reps, [steady(m(w), p)], rest, 0.5), workSec: reps * m(w) });
    }
  }
  const micro = [
    ['vo2-3030', '30/30s', 30, 30, lerp(1.15, 1.25, x), [8, 10, 12, 15]],
    ['vo2-4020', '40/20s', 40, 20, lerp(1.12, 1.2, x), [8, 10, 12]],
    ...(x >= 0.4 ? [['vo2-3015', '30/15s', 30, 15, lerp(1.15, 1.22, x), [10, 13]]] : []),
  ];
  for (const [id, name, on, off, p, repList] of micro) {
    for (const reps of repList) {
      for (let sets = 1; sets <= 3; sets++) {
        const set = [intervals(reps, on, p, off, 0.5)];
        res.push({ format: id, label: `${name} ${sets}x${reps}`, blocks: series(sets, set, m(id === 'vo2-3015' ? 3 : 5), 0.5), workSec: sets * reps * on });
      }
    }
  }
  return res;
}

function anaerobicFormats(x) {
  const res = [];
  for (let reps = 4; reps <= 10; reps++) {
    res.push({ format: 'ac-1min', label: `Anaerobic ${reps}x1min`, blocks: [intervals(reps, 60, lerp(1.25, 1.4, x), m(3), 0.5)], workSec: reps * 60 });
  }
  for (let reps = 6; reps <= 12; reps += 2) {
    res.push({ format: 'ac-30s', label: `Anaerobic ${reps}x30s`, blocks: [intervals(reps, 30, lerp(1.4, 1.6, x), 210, 0.5)], workSec: reps * 30 });
  }
  if (x >= 0.4) {
    for (let reps = 3; reps <= 6; reps++) {
      res.push({ format: 'ac-2min', label: `Anaerobic ${reps}x2min`, blocks: [intervals(reps, 120, lerp(1.2, 1.3, x), m(4), 0.5)], workSec: reps * 120 });
    }
  }
  return res;
}

function sprintFormats(x, f) {
  const res = [];
  for (const s of [10, 15, 20]) {
    for (let reps = 5; reps <= 12; reps++) {
      res.push({ format: 'sprints', label: `Sprints ${reps}x${s}s`, blocks: [intervals(reps, s, lerp(1.6, 2.0, x), s >= 20 ? 270 : 180, 0.55)], workSec: reps * s });
    }
  }
  if (f.torque || f.race) {
    for (let reps = 5; reps <= 10; reps++) {
      res.push({ format: 'standing-starts', label: `Standing starts ${reps}x15s`, blocks: [intervals(reps, 15, lerp(1.6, 1.9, x), 225, 0.55, 60, 90)], workSec: reps * 15 });
    }
  }
  return res;
}

const GENERATORS = {
  tempo: tempoFormats, sweetspot: sweetspotFormats, threshold: thresholdFormats,
  vo2max: vo2Formats, anaerobic: anaerobicFormats, sprint: sprintFormats,
};

// ---------------------------------------------------------------- aerobic fill
function aerobicFill(sec, x, f, rng) {
  if (sec < 60) return [];
  const base = lerp(0.62, 0.7, x);
  if (sec < 8 * 60) return [steady(sec, base)];
  const out = [];
  let left = sec;
  let i = 0;
  // alternate steady chunks; optional cadence drills inside
  while (left > 0) {
    const chunk = Math.min(left, roundTo(m(rng() < 0.5 ? 8 : 10), 60));
    if (f.cadence && i % 2 === 1 && chunk >= m(6)) {
      const reps = Math.floor(chunk / 120);
      out.push(intervals(reps, 60, base + 0.03, 60, base, 105, 85));
      const rest = chunk - reps * 120;
      if (rest > 0) out.push(steady(rest, base));
    } else {
      out.push(steady(chunk, i % 2 ? base + 0.04 : base));
    }
    left -= chunk;
    i++;
  }
  return out;
}

// ---------------------------------------------------------------- endurance & recovery
function enduranceMain(sec, x, f, rng) {
  const out = [];
  let label = 'Endurance';
  let left = sec;
  if (f.tempoInserts && sec >= m(50)) {
    const n = sec >= m(120) ? 3 : 2;
    const w = roundTo(Math.min(m(20), (sec * lerp(0.15, 0.3, x)) / n), 60);
    const gap = Math.floor((sec - n * w) / (n + 1));
    for (let k = 0; k < n; k++) {
      out.push(...aerobicFill(gap, x, f, rng), steady(w, lerp(0.8, 0.85, x)));
    }
    out.push(...aerobicFill(sec - n * w - n * gap, x, f, rng));
    return { blocks: out, label: `Endurance with tempo ${n}x${w / 60}min`, workSec: n * w };
  }
  if (f.sprintsInLong && sec >= m(40)) {
    const n = 6;
    const gap = Math.floor((sec - n * 10) / (n + 1));
    for (let k = 0; k < n; k++) out.push(...aerobicFill(gap, x, f, rng), steady(10, 1.6));
    out.push(...aerobicFill(sec - n * 10 - n * gap, x, f, rng));
    return { blocks: out, label: 'Endurance with sprints', workSec: 60 };
  }
  if (f.torque && sec >= m(40)) {
    const n = sec >= m(80) ? 5 : 3;
    const blocks = [];
    const gap = Math.floor((sec - n * m(5)) / (n + 1));
    for (let k = 0; k < n; k++) blocks.push(...aerobicFill(gap, x, f, rng), steady(m(5), 0.75, 60));
    blocks.push(...aerobicFill(sec - n * m(5) - n * gap, x, f, rng));
    return { blocks, label: `Endurance low cadence ${n}x5min`, workSec: 0 };
  }
  if (f.cadence) label = 'Endurance cadence drills';
  return { blocks: aerobicFill(left, x, { ...f, cadence: f.cadence }, rng), label, workSec: 0 };
}

function recoveryMain(sec) {
  const spins = sec >= m(20) ? 4 : 2;
  const easy = sec - spins * 120;
  const pre = Math.floor(easy / 2);
  return {
    blocks: [steady(pre, 0.52), intervals(spins, 30, 0.6, 90, 0.5, 105, 85), steady(easy - pre, 0.52)],
    label: 'Recovery spin', workSec: 0,
  };
}

// ---------------------------------------------------------------- warm-up / cool-down
function warmBlocks(category, durMin) {
  if (category === 'recovery') return [warmup(m(5), 0.4, 0.55)];
  if (HARD.has(category)) {
    const w = durMin >= 50 ? 10 : 7;
    return [warmup(m(w), 0.45, 0.75), intervals(3, 20, 1.1, 40, 0.55, 100), steady(m(2), 0.6)];
  }
  return [warmup(m(durMin >= 60 ? 12 : 8), 0.45, 0.7)];
}
function coolBlocks(category, durMin) {
  if (category === 'recovery') return [cooldown(m(5), 0.55, 0.4)];
  return [cooldown(m(durMin >= 50 ? 8 : 5), 0.65, 0.45)];
}

/**
 * Compose a workout.
 * req: { category, durMin, x (0..1), flags {}, rng, rules, dose?, avoidFormat? }
 * Returns { blocks, label, format, category, workSec, doseMin }.
 */
export function compose(req) {
  const { category, durMin, rng, rules } = req;
  const x = clamp(req.x ?? 0.5, 0, 1);
  const f = req.flags || {};
  const warm = warmBlocks(category, durMin);
  const cool = coolBlocks(category, durMin);
  const budget = m(durMin) - blocksDuration(warm) - blocksDuration(cool);

  if (category === 'recovery' || category === 'endurance') {
    const main = category === 'recovery' ? recoveryMain(budget) : enduranceMain(budget, x, f, rng);
    return { blocks: [...warm, ...main.blocks, ...cool], label: main.label, format: category, category, workSec: main.workSec, doseMin: 0 };
  }

  const dose = req.dose ?? workDose(rules, category, durMin, x);
  const doseSec = Math.max(60, dose * 60);
  const cands = GENERATORS[category](x, f)
    .map((c) => ({ ...c, dur: blocksDuration(c.blocks) }))
    .filter((c) => c.dur <= budget - 60);
  if (!cands.length) {
    // too short for any format: fall back to the smallest one, trimmed budget
    const all = GENERATORS[category](x, f).map((c) => ({ ...c, dur: blocksDuration(c.blocks) })).sort((a, b) => a.dur - b.dur);
    cands.push(all[0]);
  }
  for (const c of cands) {
    c.score = Math.abs(c.workSec - doseSec) / doseSec + rng() * 0.25 + (c.format === req.avoidFormat ? 0.35 : 0) +
      (req.preferFormat && c.format === req.preferFormat ? -0.3 : 0);
  }
  cands.sort((a, b) => a.score - b.score);
  const best = cands[0];
  const fill = Math.max(0, budget - best.dur);
  const pre = fill > m(10) ? roundTo(fill * 0.4, 60) : 0;
  const blocks = [
    ...warm,
    ...aerobicFill(pre, 0.4, f, rng),
    ...best.blocks,
    ...aerobicFill(fill - pre, 0.4, f, rng),
    ...cool,
  ];
  return { blocks, label: best.label, format: best.format, category, workSec: best.workSec, doseMin: dose };
}

export { fmt };
