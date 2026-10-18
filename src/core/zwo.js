// zwo.js — parse Zwift .zwo workouts and compute training metrics.
// Pure ES module, no dependencies: runs in Node (indexer) and in the browser (app).

/** Coggan power zones as fraction of FTP (upper bounds, exclusive). */
export const ZONES = [
  { id: 'Z1', name: 'Active recovery', max: 0.56 },
  { id: 'Z2', name: 'Endurance', max: 0.76 },
  { id: 'Z3', name: 'Tempo', max: 0.91 },
  { id: 'Z4', name: 'Threshold', max: 1.06 },
  { id: 'Z5', name: 'VO2max', max: 1.21 },
  { id: 'Z6', name: 'Anaerobic', max: 1.51 },
  { id: 'Z7', name: 'Neuromuscular', max: Infinity },
];

/** Power assumed for FreeRide blocks (no target given) when estimating load. */
export const FREERIDE_ASSUMED_POWER = 0.6;

/** Power assumed for MaxEffort blocks (all-out, no target) when estimating load. */
export const MAX_EFFORT_ASSUMED_POWER = { sprint: 2.0, long: 1.5 };

const num = (v, d = 0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

function attrs(str) {
  const out = {};
  for (const m of str.matchAll(/([A-Za-z_][\w-]*)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

function decode(s) {
  return (s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
}

const tagText = (xml, tag) => {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? decode(m[1]) : '';
};

/**
 * Parse a .zwo XML string.
 * Returns { name, author, description, sportType, tags, blocks }.
 * Block kinds: warmup | cooldown | ramp | steady | intervals | free
 */
export function parseZwo(xml) {
  const workoutXml = (xml.match(/<workout>([\s\S]*?)<\/workout>/) || [, ''])[1];
  const tags = [...xml.matchAll(/<tag\s+name="([^"]*)"/g)].map((m) => decode(m[1]));
  const blocks = [];
  for (const m of workoutXml.matchAll(/<(\w+)([^>]*?)\/?>/g)) {
    const el = m[1];
    const a = attrs(m[2]);
    const cad = a.Cadence ? num(a.Cadence) : null;
    switch (el) {
      case 'Warmup':
      case 'Cooldown':
      case 'Ramp':
        blocks.push({
          kind: el.toLowerCase(), dur: num(a.Duration),
          p0: num(a.PowerLow), p1: num(a.PowerHigh), cad,
        });
        break;
      case 'SteadyState':
        blocks.push({ kind: 'steady', dur: num(a.Duration), p: num(a.Power), cad });
        break;
      case 'IntervalsT':
        blocks.push({
          kind: 'intervals', repeat: Math.max(1, Math.round(num(a.Repeat, 1))),
          onDur: num(a.OnDuration), offDur: num(a.OffDuration),
          onP: num(a.OnPower), offP: num(a.OffPower),
          cad: a.Cadence ? num(a.Cadence) : null,
          cadRest: a.CadenceResting ? num(a.CadenceResting) : null,
        });
        break;
      case 'FreeRide':
      case 'MaxEffort':
        blocks.push({ kind: 'free', dur: num(a.Duration), maxEffort: el === 'MaxEffort' });
        break;
      default:
        break; // textevent etc.
    }
  }
  return {
    name: tagText(xml, 'name'),
    author: tagText(xml, 'author'),
    description: tagText(xml, 'description'),
    sportType: tagText(xml, 'sportType') || 'bike',
    tags,
    blocks,
  };
}

/** Flatten blocks into simple segments {dur, p0, p1, cad, free}. Intervals are expanded. */
export function toSegments(blocks) {
  const segs = [];
  for (const b of blocks) {
    if (b.kind === 'intervals') {
      for (let i = 0; i < b.repeat; i++) {
        segs.push({ dur: b.onDur, p0: b.onP, p1: b.onP, cad: b.cad, free: false });
        segs.push({ dur: b.offDur, p0: b.offP, p1: b.offP, cad: b.cadRest ?? null, free: false });
      }
    } else if (b.kind === 'steady') {
      segs.push({ dur: b.dur, p0: b.p, p1: b.p, cad: b.cad, free: false });
    } else if (b.kind === 'free' && b.maxEffort) {
      // all-out effort without a target: counted as work at an assumed power (sprint-length
      // efforts ~200 % FTP, longer ones ~150 %) so load and classification see it
      const p = b.dur <= 30 ? MAX_EFFORT_ASSUMED_POWER.sprint : MAX_EFFORT_ASSUMED_POWER.long;
      segs.push({ dur: b.dur, p0: p, p1: p, cad: null, free: false, maxEffort: true });
    } else if (b.kind === 'free') {
      segs.push({ dur: b.dur, p0: FREERIDE_ASSUMED_POWER, p1: FREERIDE_ASSUMED_POWER, cad: null, free: true });
    } else {
      segs.push({ dur: b.dur, p0: b.p0, p1: b.p1, cad: b.cad, free: false, wc: b.kind !== 'ramp' });
    }
  }
  return segs.filter((s) => s.dur > 0);
}

/** 1-second power samples (fraction of FTP), plus parallel cadence & freeride flags. */
export function toTimeline(segs) {
  const power = [];
  const cad = [];
  const free = [];
  const wc = [];
  for (const s of segs) {
    const n = Math.round(s.dur);
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0;
      power.push(s.p0 + (s.p1 - s.p0) * t);
      cad.push(s.cad);
      free.push(s.free);
      wc.push(!!s.wc);
    }
  }
  return { power, cad, free, wc };
}

/** Normalized power (fraction of FTP) using a 30 s rolling average. */
export function normalizedPower(power) {
  if (!power.length) return 0;
  let sum = 0;
  let acc = 0;
  const w = 30;
  let total = 0;
  for (let i = 0; i < power.length; i++) {
    sum += power[i];
    if (i >= w) sum -= power[i - w];
    const avg = sum / Math.min(i + 1, w);
    acc += avg ** 4;
    total++;
  }
  return (acc / total) ** 0.25;
}

export function zoneIndex(p) {
  for (let i = 0; i < ZONES.length; i++) if (p < ZONES[i].max) return i;
  return ZONES.length - 1;
}

/**
 * Detect "efforts": contiguous runs at or above `threshold` (default: Z3 floor 0.76).
 * Returns [{start, dur, avg, max, restBefore, restAfter}]
 */
export function detectEfforts(power, threshold = 0.76) {
  const efforts = [];
  let i = 0;
  while (i < power.length) {
    if (power[i] >= threshold) {
      let j = i;
      let sum = 0;
      let max = 0;
      while (j < power.length && power[j] >= threshold) {
        sum += power[j];
        max = Math.max(max, power[j]);
        j++;
      }
      efforts.push({ start: i, dur: j - i, avg: sum / (j - i), max });
      i = j;
    } else i++;
  }
  for (let k = 0; k < efforts.length; k++) {
    const prevEnd = k > 0 ? efforts[k - 1].start + efforts[k - 1].dur : 0;
    efforts[k].restBefore = efforts[k].start - prevEnd;
    const nextStart = k < efforts.length - 1 ? efforts[k + 1].start : power.length;
    efforts[k].restAfter = nextStart - (efforts[k].start + efforts[k].dur);
  }
  return efforts;
}

/** Core metrics for a parsed workout. Power values are fractions of FTP. */
export function computeMetrics(parsed) {
  const segs = toSegments(parsed.blocks);
  const { power, cad, free, wc } = toTimeline(segs);
  const dur = power.length;
  const np = normalizedPower(power);
  const avg = dur ? power.reduce((a, b) => a + b, 0) / dur : 0;
  const IF = np;
  const tss = (dur / 3600) * IF * IF * 100;

  const zoneSec = new Array(ZONES.length).fill(0);
  let cadTargetSec = 0;
  let cadLowSec = 0;
  let cadHighSec = 0;
  let freeSec = 0;
  for (let i = 0; i < dur; i++) {
    if (free[i]) freeSec++;
    else zoneSec[zoneIndex(power[i])]++;
    if (cad[i] != null) {
      cadTargetSec++;
      if (cad[i] <= 70) cadLowSec++;
      if (cad[i] >= 105) cadHighSec++;
    }
  }
  const maxPower = dur ? Math.max(...segs.map((s) => Math.max(s.p0, s.p1))) : 0;
  return {
    segs, power, wc, dur, np, avg, IF, tss,
    zoneSec, freeSec, maxPower,
    cadence: { targetSec: cadTargetSec, lowSec: cadLowSec, highSec: cadHighSec },
  };
}

/** Round helpers */
export const r2 = (x) => Math.round(x * 100) / 100;
export const r1 = (x) => Math.round(x * 10) / 10;
