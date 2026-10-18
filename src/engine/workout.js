// workout.js — one entry point that produces a finished workout (library-based or composed) with metrics.
import { computeMetrics } from '../core/zwo.js';
import { mergeSegments, compress, describeStructure } from '../core/classify.js';
import { compose } from './compose.js';
import { fromLibrary, rampTest } from './library.js';
import { blocksDuration, steady } from './blocks.js';

const r2 = (x) => Math.round(x * 100) / 100;

export function summarize(blocks) {
  const m = computeMetrics({ blocks });
  const segs = mergeSegments(m.segs);
  return {
    metrics: {
      tss: m.tss, IF: m.IF, np: m.np, durSec: m.dur,
      zoneSec: m.zoneSec, freeSec: m.freeSec, maxPower: m.maxPower,
    },
    profile: segs.map((s) => (s.free ? [Math.round(s.dur), null, null] : [Math.round(s.dur), r2(s.p0), r2(s.p1)])),
    // Segments with full detail (cadence, free) for click-to-inspect, indexed to match profile
    segs: segs.map((s) => ({
      dur: s.dur, p0: s.free ? null : r2(s.p0), p1: s.free ? null : r2(s.p1),
      cad: s.cad ?? null, free: !!s.free, max: !!s.maxEffort,
    })),
  };
}

/**
 * req: { category, durMin, x, flags, rng, source: 'mixed'|'library'|'composed',
 *        used:Set, targetLevel, maxLevel, avoidFormat }
 */
export function makeWorkout(ctx, req) {
  let made = null;
  if (req.category === 'test') made = rampTest(ctx.library);
  const libAllowed = req.category !== 'endurance' && req.category !== 'recovery';
  if (!made && libAllowed && req.source !== 'composed') {
    const tryLib = req.source === 'library' || req.rng() < 0.5;
    if (tryLib) {
      made = fromLibrary(ctx.library, {
        ...req, rules: ctx.rules, maxScore: req.source === 'library' ? 1.4 : 0.7,
      });
    }
  }
  if (!made) made = compose({ ...req, rules: ctx.rules });
  // a test is short: ride easy afterwards to fill the slot
  if (req.category === 'test') {
    const left = req.durMin * 60 - blocksDuration(made.blocks);
    if (left >= 300) made = { ...made, blocks: [...made.blocks, steady(left, 0.55)] };
  }
  const durMin = Math.round(blocksDuration(made.blocks) / 60);
  return {
    category: req.category,
    role: req.role,
    durMin,
    label: made.label,
    format: made.format,
    source: made.source || null,
    blocks: made.blocks,
    ...summarize(made.blocks),
    structure: describeStructure(compress(mergeSegments(computeMetrics({ blocks: made.blocks }).segs)), 4),
  };
}
