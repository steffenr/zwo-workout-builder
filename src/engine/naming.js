// naming.js — names, file names and descriptions for generated workouts and plans.
import { hash } from './rng.js';
import { CATEGORY_INFO } from './compose.js';

/** Series names per training type. A plan uses one per type and numbers the sessions (#1, #2, …). */
export const SERIES = {
  recovery: ['Easy Spin', 'Soft Pedal', 'Coffee Spin', 'Leg Flush', 'Recovery Roll', 'Lazy River', 'Spin Down', 'Gentle Glide'],
  endurance: ['Long Road', 'Base Miles', 'Aerobic Engine', 'Diesel Ride', 'Valley Miles', 'Endless Road', 'Fjord Cruise', 'Steady Miles', 'Long Haul', 'Backroads'],
  tempo: ['Tempo Train', 'Long Pull', 'Rolling Thunder', 'Steady Push', 'Drumbeat', 'Iron Rhythm', 'Even Keel', 'Metronome'],
  sweetspot: ['Golden Zone', 'Sweet Stack', 'Honey Pot', 'Sugar Mountain', 'Sweet Climb', 'Amber Hour', 'Butter Zone', 'Sweet Spot Builder'],
  threshold: ['Red Line', 'Edge Walker', 'Knife Edge', 'Threshold Ladder', 'Iron Hour', 'Limit Pusher', 'Hot Seat', 'Firewall'],
  vo2max: ['Lung Opener', 'Oxygen Debt', 'Big Engine', 'Air Hunger', 'Sky High', 'Heart Pounder', 'Thin Air', 'Redline Lungs'],
  anaerobic: ['Punch Card', 'Acid Test', 'Matchbox', 'Kicker', 'Red Mist', 'Short Fuse', 'Attack Mode', 'Gap Jumper'],
  sprint: ['Final Kick', 'Launch Pad', 'Lightning Legs', 'Jump Start', 'Gate Opener', 'Rocket Fuel', 'Finish Line', 'Snap'],
  test: ['FTP Check'],
};

export function seriesName(seed, category) {
  const list = SERIES[category] || ['Session'];
  return list[hash(`${seed}|${category}`) % list.length];
}

/** Short descriptive part, e.g. "5x4min VO2" or "Endurance 90min". */
export function descriptive(w) {
  if (w.category === 'endurance' || w.category === 'recovery') {
    return /\d+x/.test(w.label) ? `${w.label}, ${w.durMin}min` : `${w.label} ${w.durMin}min`;
  }
  return w.label;
}

/**
 * Display name.
 *  plan, composed:  "Lung Opener #3: VO2 5x4min"
 *  single:          "Lung Opener: VO2 5x4min"
 */
export function workoutName(w, { seed, seriesNo } = {}) {
  if (w.category === 'test') return w.label;
  const series = seriesName(seed, w.category);
  return seriesNo ? `${series} #${seriesNo}: ${descriptive(w)}` : `${series}: ${descriptive(w)}`;
}

export function sanitizeFile(s) {
  return String(s)
    .replace(/[:]/g, '')
    .replace(/[\\/?%*|"<>]/g, '-')
    .replace(/[()]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

const pad = (n) => String(n).padStart(2, '0');
export function fileName(name, week, day) {
  return week ? `Week${pad(week)}_Day${pad(day)}_${sanitizeFile(name)}.zwo` : `${sanitizeFile(name)}.zwo`;
}

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const pctRange = (a, b) => (Math.abs(a - b) < 0.015 ? `${Math.round(a * 100)}%` : `${Math.round(Math.min(a, b) * 100)}–${Math.round(Math.max(a, b) * 100)}%`);

/** Human description written into the .zwo file. */
export function describe(w, ctx = {}) {
  const info = CATEGORY_INFO[w.category];
  const lines = [];
  lines.push(w.label.toLowerCase().startsWith(info.label.toLowerCase()) ? `${w.label}.` : `${info.label}: ${w.label}.`);
  lines.push(info.purpose);
  if (w.structure) lines.push(`Main set: ${w.structure}.`);
  const m = w.metrics;
  lines.push(`${w.durMin} min · TSS ${Math.round(m.tss)} · IF ${m.IF.toFixed(2)}${ctx.ftp ? ` · NP ≈ ${Math.round(m.np * ctx.ftp)} W at FTP ${ctx.ftp} W` : ''}.`);
  if (ctx.planName) lines.push(`${ctx.planName}, week ${ctx.week} of ${ctx.weeks} (${ctx.phase}).`);
  lines.push('Created with Zwo Workout Builder.');
  return lines.join(' ');
}

export { pctRange };
