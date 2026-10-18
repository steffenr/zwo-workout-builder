// library.js — pick a coach-made workout from the library and fit it to a slot.
import {
  decodeBlocks, splitWorkout, blocksDuration, warmup, cooldown, steady,
} from './blocks.js';
import { workDose, CATEGORY_INFO, HARD } from './compose.js';
import { toSegments, toTimeline, detectEfforts } from '../core/zwo.js';

const m = (min) => Math.round(min * 60);
const prepared = new WeakMap();

function prep(entry) {
  let p = prepared.get(entry);
  if (!p) {
    const blocks = decodeBlocks(entry.blocks);
    const parts = splitWorkout(blocks);
    p = { ...parts, mainSec: blocksDuration(parts.main), warmSec: blocksDuration(parts.warm), coolSec: blocksDuration(parts.cool) };
    p.structureOk = structureFits(parts.main, entry.primary);
    prepared.set(entry, p);
  }
  return p;
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/**
 * Does the main set train what its type promises? The classifier labels by work minutes,
 * so e.g. 8x1min at FTP counts as "threshold" and 30/30s at 90 % as "sweet spot".
 * - sweet spot / threshold: most time at or above the band comes in efforts of >= 4 / 3 min
 * - anaerobic: recoveries at least 1.5x the effort (shorter rests turn it into lactate tolerance)
 * - sprint: near-maximal targets (>= 170 %) with >= 2 min recovery
 */
export function structureFits(main, category) {
  if (!['sweetspot', 'threshold', 'anaerobic', 'sprint'].includes(category)) return true;
  const { power } = toTimeline(toSegments(main));
  if (category === 'sweetspot' || category === 'threshold') {
    const [thr, minDur] = category === 'sweetspot' ? [0.86, 240] : [0.9, 180];
    const eff = detectEfforts(power, thr);
    const total = eff.reduce((a, e) => a + e.dur, 0);
    const long = eff.filter((e) => e.dur >= minDur).reduce((a, e) => a + e.dur, 0);
    return total > 0 && long >= 0.6 * total;
  }
  if (category === 'anaerobic') {
    const eff = detectEfforts(power, 1.2).filter((e) => e.dur >= 15);
    return eff.length > 0 && median(eff.map((e) => e.restAfter / e.dur)) >= 1.5;
  }
  const eff = detectEfforts(power, 1.5).filter((e) => e.dur <= 30);
  return eff.length > 0 && median(eff.map((e) => e.max)) >= 1.7 && median(eff.map((e) => e.restAfter)) >= 120;
}

const shortDur = (sec) => (sec >= 60 ? `${+(sec / 60).toFixed(1).replace(/\.0$/, '')}min` : `${Math.round(sec)}s`);

/** Own label for a main set, e.g. "Sweet Spot 3x10min" — built from the efforts, never from the library title. */
export function structureLabel(main, category) {
  const { power } = toTimeline(toSegments(main));
  const efforts = detectEfforts(power, 0.8).filter((e) => e.dur >= 10);
  const cat = CATEGORY_INFO[category].label;
  if (!efforts.length) return cat;
  const total = efforts.reduce((x, e) => x + e.dur, 0);
  if (efforts.length === 1) return `${cat} ${shortDur(total)}`;
  // the dominant repeated effort length (short surges and openers do not count)
  const groups = {};
  for (const e of efforts) {
    const k = e.dur >= 60 ? Math.round(e.dur / 30) * 30 : Math.round(e.dur / 5) * 5;
    (groups[k] ||= []).push(e);
  }
  const [k, g] = Object.entries(groups).sort((x, y) => y[1].length * +y[0] - x[1].length * +x[0])[0];
  if (g.length >= 2 && g.length * +k >= total * 0.6) return `${cat} ${g.length}x${shortDur(+k)}`;
  const work = shortDur(Math.max(60, Math.round(total / 60) * 60));
  return efforts.length <= 6 ? `${cat} ${efforts.length} efforts, ${work}` : `${cat} mixed, ${work} work`;
}

/** "3. Tuesday - VO2 Max - 4x3 Ramps #2" → "VO2 Max - 4x3 Ramps" */
export function cleanTitle(t) {
  return String(t || '')
    .replace(/^\s*#?\d+[.)]\s+/, '')
    .replace(/^\s*#?\d+\s+-\s+/, '')
    .replace(/^#\d+-DPC\s*/i, '')
    .replace(/^#\d+\s+/, '')
    .replace(/["“”]/g, '')
    .replace(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\s*[-:]\s*/i, '')
    .replace(/^(day|session|week)\s*\d+\s*[:-]\s*/i, '')
    .replace(/\s*#\d+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Titles that read as names, not codes like "WKG - W4W1". */
export function goodTitle(t) {
  return !!t && /[A-Za-z]{4,}/.test(t.replace(/\b(week|day|wkg)\b/gi, '')) && !/\bW\d+[WD]\d+\b/i.test(t);
}

const FLAG_MAP = { climbing: 'climbing', torque: 'torque', race: 'race-specific', cadence: 'cadence-drills', tt: 'time-trial', triathlon: 'triathlon' };

/**
 * Find the best library workout for a slot and adapt its length.
 * req: { category, durMin, x, flags, rng, rules, used:Set, targetLevel, maxLevel, maxScore }
 * Returns { blocks, label, source } or null when nothing fits well enough.
 */
export function fromLibrary(library, req) {
  const { category, durMin, rng, rules } = req;
  const target = m(durMin);
  const dose = Math.max(1, workDose(rules, category, durMin, req.x));
  const wanted = Object.entries(req.flags || {}).filter(([k, v]) => v && FLAG_MAP[k]).map(([k]) => FLAG_MAP[k]);
  let best = null;
  for (const w of library) {
    if (w.primary !== category || req.used?.has(w.id)) continue;
    if (w.level > (req.maxLevel ?? 5)) continue;
    const p = prep(w);
    if (!p.structureOk) continue;
    const hard = HARD.has(category);
    if (!p.main.length || p.mainSec + m(hard ? 15 : 9) > target || p.mainSec < target * 0.45) continue;
    const work = w.workMin[category] || 0;
    let score = Math.abs(work - dose) / dose + 0.35 * Math.abs(w.level - (req.targetLevel ?? 3)) + rng() * 0.3;
    for (const fl of wanted) if (w.flags.includes(fl)) score -= 0.2;
    if (!best || score < best.score) best = { w, p, score };
  }
  if (!best || best.score > (req.maxScore ?? 0.8)) return null;

  const { w, p } = best;
  // hard sessions need >= 8 min of warm-up before the first effort
  const hard = HARD.has(category);
  let warm = p.warmSec >= m(hard ? 8 : 4) && p.warmSec <= m(20) ? p.warm : [warmup(m(10), 0.45, hard ? 0.75 : 0.7)];
  let cool = p.coolSec >= m(3) && p.coolSec <= m(15) ? p.cool : [cooldown(m(6), 0.65, 0.45)];
  let rest = target - blocksDuration(warm) - p.mainSec - blocksDuration(cool);
  if (rest < 0) {
    warm = [warmup(m(hard ? 8 : 5), 0.45, hard ? 0.75 : 0.65)];
    cool = [cooldown(m(4), 0.6, 0.45)];
    rest = target - blocksDuration(warm) - p.mainSec - blocksDuration(cool);
  }
  const fillP = 0.62 + 0.02 * Math.min(3, req.targetLevel ?? 3);
  const blocks = [...warm];
  let pre = 0;
  if (rest >= m(20)) pre = Math.round((rest * 0.4) / 60) * 60;
  if (pre) blocks.push(steady(pre, fillP));
  blocks.push(...p.main);
  const post = rest - pre;
  if (post >= 180) blocks.push(steady(post, fillP));
  else if (post > 0) cool = cool.map((b, i) => (i === cool.length - 1 ? { ...b, dur: b.dur + post } : b));
  blocks.push(...cool);
  req.used?.add(w.id);
  return {
    blocks,
    label: structureLabel(p.main, category),
    format: `lib:${w.id}`,
    source: { id: w.id },
  };
}

/** The library's FTP ramp test, unchanged. */
export function rampTest(library) {
  const t = library.find((w) => w.primary === 'test' && (w.ramp || /^FTP Ramp Test$/i.test(w.title || ''))) ||
    library.find((w) => w.primary === 'test');
  if (!t) return null;
  return {
    blocks: decodeBlocks(t.blocks), label: 'FTP Ramp Test', format: 'test',
    source: { id: t.id },
  };
}
