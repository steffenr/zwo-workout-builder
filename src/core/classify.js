// classify.js — turn computed metrics into training-type labels, difficulty and structure.
import { detectEfforts, r2 } from './zwo.js';

export const CATEGORIES = [
  'recovery', 'endurance', 'tempo', 'sweetspot', 'threshold', 'vo2max', 'anaerobic', 'sprint', 'test',
];

/** Relative physiological "cost" of one second in each effort category. */
const WEIGHT = { tempo: 0.6, sweetspot: 1, threshold: 1.4, vo2max: 2.2, anaerobic: 3.5, sprint: 6 };

/** Type hints in coach-given titles. Used only to break ties between types the metrics found. */
export const TITLE_HINTS = [
  ['vo2max', /\bvo2|v02|max aerobic/i],
  ['sweetspot', /sweet ?spot|\bsst\b/i],
  ['threshold', /(?<!sub[- ])threshold|\bftp interval|2x20|\bover.?under/i],
  ['tempo', /\btempo\b/i],
  ['sprint', /\bsprint/i],
  ['anaerobic', /anaerobic/i],
];
const RECOVERY_RE = /\b(recovery|recover|easy spin|flush|regeneration|mend)\b/i;
const TEST_RE = /\b(ftp[ -]?test|ramp[ -]?test|test\b|\btest\]|benchmark|assessment|verification|power profile test|\bcp\d+\b)/i;

/**
 * Category of one work block, judged by its average power, duration and the
 * recovery around it. Returns null for upper-Z2 work that is still "endurance".
 */
export function effortCategory(e) {
  const a = e.avg;
  const micro = e.dur <= 40 && e.restAfter > 0 && e.restAfter <= 60;
  if (a >= 1.5) return e.dur <= 30 ? 'sprint' : 'anaerobic';
  if (a >= 1.21) {
    if (e.dur > 180) return 'vo2max';
    // micro-intervals (30/30, 40/20, 15/15) are VO2 work, not anaerobic capacity
    if (micro) return 'vo2max';
    return 'anaerobic';
  }
  if (a >= 1.06) return e.dur > 600 ? 'threshold' : 'vo2max';
  if (a >= 0.955) return 'threshold';
  if (a >= 0.875) return 'sweetspot';
  if (a >= 0.8) return 'tempo';
  return null;
}

const segAvg = (s) => (s.p0 + s.p1) / 2;
const isRest = (s) => !s || s.free || segAvg(s) < 0.76;

/** Per-segment work blocks (warm-up/cool-down and free ride excluded). */
export function workBlocks(segs) {
  const out = [];
  segs.forEach((s, i) => {
    if (s.free || s.wc) return;
    const avg = segAvg(s);
    if (avg < 0.8) return;
    const prev = segs[i - 1];
    const next = segs[i + 1];
    const e = {
      dur: s.dur, avg,
      restBefore: isRest(prev) && prev ? prev.dur : 0,
      restAfter: isRest(next) && next ? next.dur : 0,
    };
    e.cat = effortCategory(e);
    if (e.cat) out.push(e);
  });
  return out;
}

/** Intensity level 1..5 from Intensity Factor. */
export function intensityLevel(IF) {
  if (IF < 0.62) return 1;
  if (IF < 0.72) return 2;
  if (IF < 0.8) return 3;
  if (IF < 0.88) return 4;
  return 5;
}

export function classify(parsed, m) {
  // warm-up / cool-down ramps are not training efforts
  const workPower = m.power.map((p, i) => (m.wc[i] ? Math.min(p, 0.75) : p));
  const efforts = detectEfforts(workPower);
  const blocks = workBlocks(m.segs);
  const structuredSec = Math.max(1, m.dur - m.freeSec);

  const workSec = {};
  const score = {};
  for (const e of blocks) {
    workSec[e.cat] = (workSec[e.cat] || 0) + e.dur;
    score[e.cat] = (score[e.cat] || 0) + e.dur * WEIGHT[e.cat];
  }
  const totalWork = Object.values(workSec).reduce((a, b) => a + b, 0);
  const workShare = totalWork / structuredSec;
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);

  const overUnder = efforts.some(
    (e) => e.dur >= 180 && e.avg >= 0.95 && e.avg < 1.1 && e.max >= 1.05 &&
      hasDip(m.power, e.start, e.dur),
  );

  let primary;
  let secondary = null;
  let labelSource = 'metrics';
  const flags = [];
  const text = `${parsed.name} ${parsed.description}`;

  if (TEST_RE.test(parsed.name)) {
    primary = 'test';
  } else if (!ranked.length || workShare < 0.06) {
    primary = RECOVERY_RE.test(parsed.name) || (m.IF < 0.58 && m.dur <= 75 * 60) ? 'recovery' : 'endurance';
  } else {
    primary = ranked[0][0];
    if (ranked[1] && ranked[1][1] >= ranked[0][1] * 0.35) secondary = ranked[1][0];
    // light tempo inside a long Z2 ride is still an endurance ride
    if (primary === 'tempo' && (workSec.tempo || 0) / structuredSec < 0.25 && m.IF < 0.75) {
      secondary = 'tempo';
      primary = 'endurance';
    }
    // a couple of short sprints inside an endurance ride
    if ((primary === 'sprint' || primary === 'anaerobic') && workShare < 0.05) {
      secondary = primary;
      primary = 'endurance';
    }
    // a low-IF session with little work is an endurance ride with some spice
    if ((m.IF < 0.65 || (m.IF < 0.7 && workShare < 0.15)) && !['recovery', 'endurance'].includes(primary)) {
      secondary = primary;
      primary = RECOVERY_RE.test(parsed.name) || m.IF < 0.58 ? 'recovery' : 'endurance';
    }
    // coach's intent from the title wins when the metrics confirm that work is present
    const hints = TITLE_HINTS.filter(([, re]) => re.test(parsed.name)).map(([k]) => k);
    if (hints.length === 1 && hints[0] !== primary && (score[hints[0]] || 0) >= ranked[0][1] * 0.25) {
      secondary = primary;
      primary = hints[0];
      labelSource = 'title';
    }
    const strong = ranked.filter(([, s]) => s >= ranked[0][1] * 0.25).length;
    if (strong >= 3) flags.push('mixed');
  }

  if (overUnder) flags.push('over-under');
  if (m.freeSec / Math.max(1, m.dur) > 0.4) flags.push('unstructured');
  if ((m.cadence.lowSec + m.cadence.highSec) / Math.max(1, m.dur) > 0.15) flags.push('cadence-drills');
  if (/\b(low[- ]cadence|torque|strength|big gear|force)\b/i.test(text)) flags.push('torque');
  if (/\b(climb|alpe|mountain|hill|kom)\b/i.test(text)) flags.push('climbing');
  if (/\b(sprint|crit|race|racing|attack|surge)\b/i.test(text)) flags.push('race-specific');
  if (/\b(tri|triathlon|ironman|brick|70\.3)\b/i.test(text)) flags.push('triathlon');
  if (/\b(tt|time[- ]trial)\b/i.test(text)) flags.push('time-trial');

  return {
    primary, secondary, flags, labelSource,
    level: intensityLevel(m.IF),
    workShare: r2(workShare),
    workSec, efforts,
    longestEffort: efforts.reduce((a, e) => Math.max(a, e.dur), 0),
  };
}

function hasDip(power, start, dur) {
  let above = false;
  let below = false;
  for (let i = start; i < start + dur; i++) {
    if (power[i] > 1.02) above = true;
    if (power[i] < 0.98) below = true;
  }
  return above && below;
}

// ---------------------------------------------------------------------------
// Structure compression: detect repeated sub-sequences to describe main sets.
// ---------------------------------------------------------------------------

const near = (a, b) => Math.abs(a - b) < 0.006;
const sameSeg = (a, b) =>
  Math.round(a.dur) === Math.round(b.dur) && near(a.p0, b.p0) && near(a.p1, b.p1) && a.free === b.free;

/** Merge adjacent identical flat segments that also share cadence. */
export function mergeSegments(segs) {
  const out = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && last.p0 === last.p1 && s.p0 === s.p1 && near(last.p0, s.p0) &&
        last.cad === s.cad && last.free === s.free) {
      last.dur += s.dur;
    } else out.push({ ...s });
  }
  return out;
}

/** Greedy repeat detection. Returns items: {seg} | {repeat, items:[seg…]} */
export function compress(segs, maxPeriod = 8) {
  const out = [];
  let i = 0;
  while (i < segs.length) {
    let best = null;
    for (let p = 1; p <= maxPeriod && i + 2 * p <= segs.length; p++) {
      let r = 1;
      while (i + (r + 1) * p <= segs.length) {
        let ok = true;
        for (let k = 0; k < p; k++) if (!sameSeg(segs[i + k], segs[i + r * p + k])) { ok = false; break; }
        if (!ok) break;
        r++;
      }
      if (r >= 2 && (!best || p * r > best.p * best.r)) best = { p, r };
    }
    if (best && !(best.p === 1 && segs[i].p0 < 0.76)) {
      out.push({ repeat: best.r, items: segs.slice(i, i + best.p) });
      i += best.p * best.r;
    } else {
      out.push({ seg: segs[i] });
      i++;
    }
  }
  return out;
}

const fmtDur = (s) => {
  s = Math.round(s);
  if (s < 60) return `${s}s`;
  if (s % 60 === 0) return `${s / 60}m`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}`;
};
const pct = (p) => `${Math.round(p * 100)}%`;
const fmtSeg = (s) =>
  s.free ? `${fmtDur(s.dur)} free ride`
    : near(s.p0, s.p1) ? `${fmtDur(s.dur)} @${pct(s.p0)}`
      : `${fmtDur(s.dur)} ${pct(s.p0)}→${pct(s.p1)}`;

const isWork = (s) => !s.free && Math.max(s.p0, s.p1) >= 0.76;

/** Human readable main-set description, e.g. "3×(10m @95% + 5m @55%)". */
export function describeStructure(items, maxParts = 6) {
  const parts = [];
  for (const it of items) {
    if (it.repeat) {
      if (!it.items.some(isWork)) continue;
      const inner = it.items.map(fmtSeg).join(' + ');
      parts.push(`${it.repeat}×(${inner})`);
    } else if (isWork(it.seg) && it.seg.dur >= 20) {
      parts.push(fmtSeg(it.seg));
    }
  }
  if (parts.length > maxParts) return `${parts.slice(0, maxParts).join(' · ')} · …`;
  return parts.join(' · ');
}

/** Normalised motif signatures for repeated work sets (used to build a pattern library). */
export function motifs(items) {
  const res = [];
  for (const it of items) {
    if (!it.repeat || !it.items.some(isWork)) continue;
    const norm = it.items.map((s) => ({
      dur: s.dur <= 60 ? Math.round(s.dur / 5) * 5 : Math.round(s.dur / 15) * 15,
      p0: Math.round(s.p0 * 20) / 20,
      p1: Math.round(s.p1 * 20) / 20,
      free: s.free,
    }));
    res.push({
      signature: norm.map(fmtSeg).join(' + '),
      repeat: it.repeat,
      items: norm.map((s) => [s.dur, s.p0, s.p1]),
      workDur: norm.filter(isWork).reduce((a, s) => a + s.dur, 0),
      setDur: norm.reduce((a, s) => a + s.dur, 0) * it.repeat,
    });
  }
  return res;
}

export { fmtDur, pct, r2 };
