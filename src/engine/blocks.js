// blocks.js — block constructors, compact encoding and helpers shared by the engine.
// Block shape is the same as parseZwo() produces, so computeMetrics() works on both.

// Zwift power targets carry two decimals; rounding here keeps metrics identical after export.
const r3 = (x) => Math.round(x * 100) / 100;

export const warmup = (dur, p0, p1, cad = null) => ({ kind: 'warmup', dur, p0: r3(p0), p1: r3(p1), cad });
export const cooldown = (dur, p0, p1, cad = null) => ({ kind: 'cooldown', dur, p0: r3(p0), p1: r3(p1), cad });
export const ramp = (dur, p0, p1, cad = null) => ({ kind: 'ramp', dur, p0: r3(p0), p1: r3(p1), cad });
export const steady = (dur, p, cad = null) => ({ kind: 'steady', dur, p: r3(p), cad });
export const intervals = (repeat, onDur, onP, offDur, offP, cad = null, cadRest = null) => ({
  kind: 'intervals', repeat, onDur, offDur, onP: r3(onP), offP: r3(offP), cad, cadRest,
});
export const free = (dur) => ({ kind: 'free', dur, maxEffort: false });

/** Total duration in seconds. */
export function blocksDuration(blocks) {
  return blocks.reduce((a, b) => a + (b.kind === 'intervals' ? b.repeat * (b.onDur + b.offDur) : b.dur), 0);
}

// Compact encoding for embedding the library in the app:
// w/c/r: [code, dur, p0, p1, cad]   s: ['s', dur, p, cad]   i: ['i', rep, on, off, onP, offP, cad, cadRest]   f: ['f', dur]
export function encodeBlocks(blocks) {
  return blocks.map((b) => {
    switch (b.kind) {
      case 'warmup': return ['w', b.dur, b.p0, b.p1, b.cad];
      case 'cooldown': return ['c', b.dur, b.p0, b.p1, b.cad];
      case 'ramp': return ['r', b.dur, b.p0, b.p1, b.cad];
      case 'steady': return ['s', b.dur, b.p, b.cad];
      case 'intervals': return ['i', b.repeat, b.onDur, b.offDur, b.onP, b.offP, b.cad, b.cadRest];
      default: return ['f', b.dur];
    }
  }).map((a) => { while (a.length && a[a.length - 1] == null) a.pop(); return a; });
}

export function decodeBlocks(arr) {
  return arr.map((a) => {
    switch (a[0]) {
      case 'w': return warmup(a[1], a[2], a[3], a[4] ?? null);
      case 'c': return cooldown(a[1], a[2], a[3], a[4] ?? null);
      case 'r': return ramp(a[1], a[2], a[3], a[4] ?? null);
      case 's': return steady(a[1], a[2], a[3] ?? null);
      case 'i': return intervals(a[1], a[2], a[4], a[3], a[5], a[6] ?? null, a[7] ?? null);
      default: return free(a[1]);
    }
  });
}

/** Split into lead warm-up blocks, main part and trailing cool-down blocks. */
export function splitWorkout(blocks) {
  let i = 0;
  while (i < blocks.length && blocks[i].kind === 'warmup') i++;
  let j = blocks.length;
  while (j > i && blocks[j - 1].kind === 'cooldown') j--;
  return { warm: blocks.slice(0, i), main: blocks.slice(i, j), cool: blocks.slice(j) };
}

/** Multiply every power target (except free ride). */
export function scalePower(blocks, f) {
  return blocks.map((b) => {
    switch (b.kind) {
      case 'steady': return { ...b, p: r3(b.p * f) };
      case 'intervals': return { ...b, onP: r3(b.onP * f), offP: r3(b.offP * f) };
      case 'free': return b;
      default: return { ...b, p0: r3(b.p0 * f), p1: r3(b.p1 * f) };
    }
  });
}

/** Repeat a list of [dur, power, cad?] steps as compactly as possible. */
export function repeatSet(reps, steps) {
  if (steps.length === 2) {
    const [[d1, p1, c1 = null], [d2, p2, c2 = null]] = steps;
    return [intervals(reps, d1, p1, d2, p2, c1, c2)];
  }
  const out = [];
  for (let r = 0; r < reps; r++) for (const [d, p, c = null] of steps) out.push(steady(d, p, c));
  return out;
}

/** Round seconds to a nice value. */
export const roundTo = (s, step) => Math.max(step, Math.round(s / step) * step);
