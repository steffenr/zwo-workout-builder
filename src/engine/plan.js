// plan.js — athlete model, periodization and weekly session planning.
import { makeRng, clamp, hash } from './rng.js';
import { makeWorkout } from './workout.js';
import { HARD, CATEGORY_INFO } from './compose.js';
import {
  workoutName, describe, fileName, slug,
} from './naming.js';
import { toZwo } from './export.js';

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ---------------------------------------------------------------- wizard vocabularies
export const GOALS = {
  fitness: {
    label: 'General fitness', tag: 'Fitness',
    phases: { base: ['sweetspot', 'tempo'], build: ['sweetspot', 'vo2max', 'threshold'], peak: ['vo2max', 'threshold', 'sweetspot'] },
  },
  ftp: {
    label: 'Raise FTP', tag: 'FTP Builder',
    phases: { base: ['sweetspot', 'tempo'], build: ['threshold', 'sweetspot', 'vo2max'], peak: ['threshold', 'vo2max'] },
  },
  fondo: {
    label: 'Gran fondo / long rides', tag: 'Gran Fondo', longRide: true,
    phases: { base: ['tempo', 'sweetspot'], build: ['sweetspot', 'threshold'], peak: ['threshold', 'sweetspot', 'vo2max'] },
  },
  climbing: {
    label: 'Climbing', tag: 'Climbing',
    phases: { base: ['sweetspot', 'tempo'], build: ['threshold', 'sweetspot', 'vo2max'], peak: ['vo2max', 'threshold'] },
  },
  racing: {
    label: 'Road racing / crits', tag: 'Race Ready',
    phases: { base: ['sweetspot', 'tempo'], build: ['vo2max', 'threshold', 'anaerobic'], peak: ['anaerobic', 'vo2max', 'sprint'] },
  },
  tt: {
    label: 'Time trial', tag: 'Time Trial',
    phases: { base: ['sweetspot', 'tempo'], build: ['threshold', 'sweetspot'], peak: ['threshold', 'vo2max'] },
  },
  triathlon: {
    label: 'Triathlon (bike leg)', tag: 'Triathlon Bike', longRide: true,
    phases: { base: ['tempo', 'sweetspot'], build: ['sweetspot', 'threshold'], peak: ['threshold', 'tempo'] },
  },
  gravel: {
    label: 'Gravel / MTB', tag: 'Gravel & MTB', longRide: true,
    phases: { base: ['sweetspot', 'tempo'], build: ['vo2max', 'threshold', 'anaerobic'], peak: ['anaerobic', 'vo2max', 'threshold'] },
  },
  maintain: {
    label: 'Maintain fitness', tag: 'Maintenance', noPeriodization: true,
    phases: { base: ['sweetspot', 'vo2max', 'threshold'], build: ['sweetspot', 'vo2max', 'threshold'], peak: ['sweetspot', 'vo2max', 'threshold'] },
  },
};

export const STYLES = {
  auto: { label: 'Let the goal decide' },
  pyramidal: { label: 'Pyramidal', note: 'Mostly easy, a good share of tempo/sweet spot, a little very hard. Classic and robust.' },
  polarized: { label: 'Polarized', note: 'Easy rides plus a few really hard sessions, almost nothing in between. Needs enough hours.' },
  sweetspot: { label: 'Sweet spot', note: 'Time-efficient: many sessions just under threshold. Good with little time.' },
};

export const RIDER_TYPES = {
  allrounder: { label: 'All-rounder' },
  climber: { label: 'Climber', flags: { climbing: true } },
  sprinter: { label: 'Sprinter / puncheur', flags: { race: true } },
  rouleur: { label: 'Rouleur / time-triallist', flags: { tt: true } },
  diesel: { label: 'Diesel / endurance', flags: {} },
};

export const WEAKNESSES = {
  sprint: { label: 'Sprint', category: 'sprint' },
  punch: { label: 'Short climbs / attacks', category: 'anaerobic' },
  vo2: { label: '3–8 min efforts', category: 'vo2max' },
  threshold: { label: 'Holding threshold', category: 'threshold' },
  endurance: { label: 'Long-ride endurance', category: 'endurance' },
};

// ---------------------------------------------------------------- athlete
export function athleteModel(p) {
  const wkg = p.ftp && p.weight ? p.ftp / p.weight : 2.8;
  const sW = wkg < 2 ? 1 : wkg < 2.6 ? 2 : wkg < 3.2 ? 3 : wkg < 3.9 ? 4 : 5;
  const h = p.hours ?? 4;
  const sH = h < 3 ? 1 : h < 5 ? 2 : h < 8 ? 3 : h < 11 ? 4 : 5;
  const sY = [1, 2, 3, 4.5][p.years ?? 1];
  const level = clamp(Math.round(0.4 * sW + 0.35 * sH + 0.25 * sY), 1, 5);
  const labels = ['', 'Beginner', 'Developing', 'Intermediate', 'Advanced', 'Very advanced'];
  return {
    wkg: Math.round(wkg * 100) / 100,
    level,
    levelLabel: labels[level],
    // unstructured riding is roughly 50 TSS per hour; structured training a bit more
    startTss: Math.max(100, Math.round(h * 52)),
    intensity: p.intensity ?? 3,
  };
}

/** Where in the library's easy→hard range a session sits (0..1). */
export function sessionX(ath, prog) {
  return clamp(0.35 + 0.12 * (ath.level - 3) + 0.1 * (ath.intensity - 3) + 0.5 * prog, 0, 1);
}

const BASE_LEVEL = { recovery: 1, endurance: 2, tempo: 3, sweetspot: 3, threshold: 4, vo2max: 4, anaerobic: 4, sprint: 3, test: 3 };
export function levelTargets(ath, category) {
  const targetLevel = clamp(Math.round(BASE_LEVEL[category] + 0.5 * (ath.level - 3) + 0.3 * (ath.intensity - 3)), 1, 5);
  const maxLevel = clamp(ath.level + 1 + (ath.intensity >= 4 ? 1 : 0), 2, 5);
  return { targetLevel, maxLevel };
}

// ---------------------------------------------------------------- key-session lists
function resolveStyle(input) {
  if (input.style && input.style !== 'auto') return input.style;
  if (input.goal === 'racing' || input.goal === 'gravel') return (input.hours ?? 4) >= 8 ? 'polarized' : 'pyramidal';
  const avail = (input.days || []).reduce((a, d) => a + d.minutes, 0) / 60;
  return avail < 5 ? 'sweetspot' : 'pyramidal';
}

export function keyList(input, phase, style) {
  const goal = GOALS[input.goal] || GOALS.fitness;
  let L = [...goal.phases[phase]];
  if (style === 'polarized') {
    L = L.map((c) => (c === 'tempo' || c === 'sweetspot' ? (phase === 'base' ? 'threshold' : 'vo2max') : c));
    if (!L.includes('vo2max')) L.push('vo2max');
  } else if (style === 'sweetspot') {
    if (phase !== 'peak') L = L.map((c) => (c === 'vo2max' || c === 'anaerobic' || c === 'sprint' ? 'threshold' : c === 'tempo' ? 'sweetspot' : c));
    if (!L.includes('sweetspot')) L.unshift('sweetspot');
  }
  // goals decided on 3–8 min efforts keep VO2max work from the build phase on, whatever the style
  if (phase !== 'base' && ['climbing', 'racing', 'gravel'].includes(input.goal) && !L.includes('vo2max')) L.push('vo2max');
  if (phase !== 'base') {
    for (const w of input.weaknesses || []) {
      const c = WEAKNESSES[w]?.category;
      if (c && c !== 'endurance' && !L.includes(c)) L.push(c);
    }
  }
  return [...new Set(L)];
}

function keyCount(nIndoor, nTotal, ath, style, kind, buildUp = 0) {
  if (kind === 'recovery') return Math.min(1, nIndoor);
  if (kind === 'taper') return Math.min(2, nIndoor);
  const table = [0, 1, 1, 2, 2, 2, 3, 3];
  let k = table[Math.min(7, nTotal)];
  if (ath.intensity >= 4 && ath.level >= 3) k += 1;
  if (ath.intensity <= 2 || ath.level <= 1) k -= 1;
  // with only two rides a week, both can be quality sessions
  if (nTotal <= 2 && ath.intensity >= 3 && ath.level >= 2) k = nTotal;
  if (style === 'polarized') k = Math.min(k, 2);
  // riders who currently train far below their available time: one key session in the
  // first block, at most two afterwards, until volume has caught up
  if (buildUp) k = Math.min(k, buildUp);
  k = Math.min(k, 3);
  return clamp(k, 1, Math.max(1, nIndoor - (nIndoor >= 3 ? 1 : 0)));
}

// ---------------------------------------------------------------- week skeleton
function phaseOf(w, N, goal) {
  if (goal.noPeriodization) return 'build';
  const f = N <= 1 ? 1 : (w - 1) / (N - 1);
  return f < 0.4 ? 'base' : f < 0.8 ? 'build' : 'peak';
}

export function weekTypes(N, hasEvent) {
  const out = [];
  for (let w = 1; w <= N; w++) {
    if (hasEvent && w === N) out.push('taper');
    else if (w % 4 === 0 && !(hasEvent && w === N - 1 && N > 4)) out.push('recovery');
    else out.push('load');
  }
  return out;
}

// Day numbers 1..7 (Mon..Sun) wrap around: Sunday's long ride is followed by Monday.
const nextDay = (d) => (d % 7) + 1;
const adjacent = (a, b) => nextDay(a) === b || nextDay(b) === a;

function chooseKeyDays(indoor, K, longDay, level = 3) {
  const cands = indoor.filter((s) => s.day !== longDay);
  // A key session on legs tired from the long ride loses quality and stacks fatigue;
  // only very experienced riders get it as a deliberate weekend block.
  const afterLongPenalty = level >= 4 ? 3 : 6;
  let best = null;
  const combos = (arr, k, start = 0, acc = []) => {
    if (acc.length === k) { score(acc); return; }
    for (let i = start; i < arr.length; i++) combos(arr, k, i + 1, [...acc, arr[i]]);
  };
  const score = (sel) => {
    const days = sel.map((s) => s.day).sort((a, b) => a - b);
    let sc = sel.reduce((a, s) => a + Math.min(s.minutes, 90) / 10, 0);
    for (let i = 0; i < days.length; i++) for (let j = i + 1; j < days.length; j++) if (adjacent(days[i], days[j])) sc -= 4;
    if (longDay) {
      for (const d of days) {
        if (d === nextDay(longDay)) sc -= afterLongPenalty;
        else if (nextDay(d) === longDay) sc -= 1;
      }
    }
    for (const s of sel) if (s.minutes < 45) sc -= 3;
    if (!best || sc > best.sc) best = { sc, sel };
  };
  combos(cands, Math.min(K, cands.length));
  return best ? best.sel.map((s) => s.day) : [];
}

const round5 = (x) => Math.max(5, Math.round(x / 5) * 5);

// ---------------------------------------------------------------- plan
/**
 * input: { ftp, weight, hours, years, intensity, goal, weeks, eventDate?, startDate?,
 *          days:[{day:1..7, minutes, outdoor}], style, riderType, weaknesses[], cadence,
 *          source, includeTest, seed }
 * ctx: { library, rules }
 */
export function buildPlan(input, ctx) {
  const goal = GOALS[input.goal] || GOALS.fitness;
  const ath = athleteModel(input);
  const style = resolveStyle(input);
  const seed = input.seed ?? hash(JSON.stringify({ ...input, seed: undefined }));
  const rng = makeRng(seed);
  const hasEvent = !!input.eventDate;
  const N = clamp(input.weeks || 8, 2, 24);
  const types = weekTypes(N, hasEvent);
  const days = [...(input.days || [])].filter((d) => d.minutes > 0).sort((a, b) => a.day - b.day);
  const used = new Set();
  const lastFormat = {};
  const catCount = {};
  const rider = RIDER_TYPES[input.riderType] || RIDER_TYPES.allrounder;
  const baseFlags = {
    ...rider.flags,
    climbing: input.goal === 'climbing' || rider.flags?.climbing,
    race: input.goal === 'racing' || input.goal === 'gravel' || rider.flags?.race,
    tt: input.goal === 'tt' || input.goal === 'triathlon' || rider.flags?.tt,
    triathlon: input.goal === 'triathlon',
    cadence: !!input.cadence,
  };
  const weakEndurance = (input.weaknesses || []).includes('endurance');

  // load targets. Riders whose current load is well below what their schedule offers
  // ("under-trained" for the plan) ramp a little faster (max 10 %/week) from their real load
  // instead of jumping to the schedule's capacity.
  const capacityTss = days.reduce((a, d) => a + (d.minutes / 60) * 50, 0);
  const underTrained = ath.startTss < 0.6 * capacityTss;
  const ramp = Math.min(0.1, 0.03 + 0.01 * ath.intensity + (underTrained ? 0.03 : 0));
  const loadWeeks = types.filter((t) => t === 'load').length;
  let lastLoad = ath.startTss;
  const loadHistory = [];
  let loadIdx = 0;
  const weeks = [];

  for (let w = 1; w <= N; w++) {
    const kind = types[w - 1];
    const phase = kind === 'taper' ? 'taper' : phaseOf(w, N, goal);
    let target;
    if (kind === 'load') {
      target = loadIdx === 0 ? lastLoad : lastLoad * (1 + ramp);
      lastLoad = target;
      loadHistory.push(target);
      loadIdx++;
    } else if (kind === 'recovery') {
      const recent = loadHistory.slice(-3);
      target = 0.55 * (recent.reduce((a, b) => a + b, 0) / Math.max(1, recent.length) || lastLoad);
    } else {
      target = 0.5 * lastLoad;
    }
    const prog = kind === 'load' ? (loadWeeks > 1 ? (loadIdx - 1) / (loadWeeks - 1) : 0.5) : kind === 'recovery' ? 0.05 : 0.15;
    const keyPhase = phase === 'taper' ? 'peak' : phase;
    const L = keyList(input, keyPhase, style);

    // roles
    const indoor = days.filter((d) => !d.outdoor);
    const outdoor = days.filter((d) => d.outdoor);
    const lastLoad4 = loadHistory.at(-1) ?? ath.startTss;
    const buildUp = underTrained && lastLoad4 < 0.6 * capacityTss ? (w <= 4 ? 1 : 2) : 0;
    const K = keyCount(indoor.length, days.length, ath, style, kind, buildUp);
    const longest = [...days].sort((a, b) => b.minutes - a.minutes || b.day - a.day)[0];
    const hasLong = longest && (days.length >= 3 || goal.longRide) && !(indoor.length <= K && !longest.outdoor);
    const longDay = hasLong ? longest.day : null;
    const keyDays = chooseKeyDays(indoor, K, longDay, ath.level);
    const testWeek = input.includeTest && (w === 1 || (!hasEvent && w === N && N >= 6));

    let sessions = days.map((d) => {
      if (d.outdoor) {
        // outdoor rides are not generated; their load is estimated (and expected easier in lighter weeks)
        const easyFactor = kind === 'load' ? 1 : 0.75;
        return { day: d.day, minutes: d.minutes, role: d.day === longDay ? 'long' : 'outdoor', outdoor: true, category: 'endurance', estTss: Math.round((d.minutes / 60) * 55 * easyFactor) };
      }
      let role;
      if (keyDays.includes(d.day)) role = 'key';
      else if (d.day === longDay) role = 'long';
      else {
        const afterKey = keyDays.includes(d.day - 1);
        role = afterKey && (ath.level <= 3 || ath.intensity <= 2 || kind !== 'load') ? 'recovery' : 'easy';
      }
      return { day: d.day, minutes: d.minutes, role };
    });

    // categories for key sessions: the first slot keeps the phase's main focus (L[0]); further
    // slots take the category of the list used least so far, so every category - including
    // weak spots - comes round regularly. With one key slot a week, the focus counts double.
    let ki = 0;
    const keySlots = sessions.filter((s) => !s.outdoor && s.role === 'key').length;
    const thisWeek = new Set();
    const phaseUse = (catCount[keyPhase] ||= {}); // usage is counted per phase
    const pickLeastUsed = (list, weightFirst) => list
      .filter((c) => !thisWeek.has(c) || list.every((x) => thisWeek.has(x)))
      .map((c, i) => ({ c, i, n: (phaseUse[c] || 0) / (weightFirst && c === L[0] ? 2 : 1) }))
      .sort((a, b) => a.n - b.n || a.i - b.i)[0].c;
    for (const s of sessions) {
      if (s.outdoor) continue;
      if (s.role === 'key') {
        let cat;
        if (kind === 'taper') cat = ki === 0 ? L[0] : 'vo2max';
        else if (kind === 'recovery' || L.length === 1) cat = L[0];
        else if (keySlots === 1) cat = pickLeastUsed(L, true);
        else cat = ki === 0 ? L[0] : pickLeastUsed(L.slice(1), false);
        if (kind === 'load') phaseUse[cat] = (phaseUse[cat] || 0) + 1;
        thisWeek.add(cat);
        s.category = cat;
        ki++;
      } else if (s.role === 'recovery') s.category = 'recovery';
      else s.category = 'endurance';
    }
    if (testWeek) {
      const t = sessions.find((s) => !s.outdoor && s.role !== 'long' && s.minutes >= 30);
      if (t) { t.category = 'test'; t.role = 'test'; }
    }

    // durations
    for (const s of sessions) {
      if (s.outdoor) continue;
      let dur = s.minutes;
      if (s.role === 'recovery') dur = Math.min(dur, 45);
      if (s.role === 'easy') dur = Math.min(dur, 60 + 15 * ath.level + (weakEndurance ? 30 : 0));
      if (kind === 'recovery') dur = Math.max(30, dur * 0.75);
      if (kind === 'taper') dur = Math.max(30, Math.min(dur, s.role === 'key' ? 60 : 50));
      s.dur = round5(dur);
    }

    // generate, then trim durations until the week fits its load target
    const gen = (s) => {
      if (s.outdoor) return;
      const r = makeRng(`${seed}|w${w}|d${s.day}`);
      const flags = { ...baseFlags };
      if (s.role === 'long' && phase !== 'base') {
        if (['fondo', 'triathlon', 'tt', 'gravel'].includes(input.goal) || weakEndurance) flags.tempoInserts = true;
        if (input.goal === 'racing') flags.sprintsInLong = true;
      }
      if (s.category === 'endurance' && phase === 'base' && input.goal === 'climbing') flags.torque = true;
      const sx = sessionX(ath, s.category === 'endurance' ? prog * 0.6 : prog);
      const lv = levelTargets(ath, s.category);
      s.req = {
        category: s.category, durMin: s.dur, x: kind === 'taper' ? 0.15 : sx, flags,
        source: input.source || 'mixed', ...lv, avoidFormat: lastFormat[s.category], role: s.role,
      };
      s.workout = makeWorkout(ctx, { ...s.req, rng: r, used });
    };
    sessions.forEach(gen);
    const total = () => sessions.reduce((a, s) => a + (s.outdoor ? s.estTss : s.workout.metrics.tss), 0);
    // what the available time allows: structured indoor riding ≈ 65 TSS/h at most
    const maxPossible = sessions.reduce((a, s) => a + (s.outdoor ? s.estTss : (s.dur / 60) * 65), 0);
    const cappedByTime = target > maxPossible;
    target = Math.min(target, maxPossible);
    const light = kind !== 'load';
    const floors = light ? { easy: 30, recovery: 30, long: 40, key: 30, test: 0 } : { easy: 40, recovery: 30, long: 60, key: 45, test: 0 };
    const order = ['easy', 'long', 'key'];
    const trim = () => {
      for (let it = 0; it < 14 && total() > target * 1.05; it++) {
        let changed = false;
        for (const role of order) {
          const list = sessions.filter((s) => !s.outdoor && s.role === role && s.dur > floors[role]);
          if (!list.length) continue;
          for (const s of list) {
            s.dur = Math.max(floors[role], round5(s.dur * 0.9));
            if (s.workout?.source) used.delete(s.workout.source.id);
            gen(s);
          }
          changed = true;
          break;
        }
        if (!changed) break;
      }
    };
    trim();
    // Still over target although every session is at its minimum length: give back whole
    // days (easy and recovery rides become rest days), so the plan never starts far above
    // the rider's current load.
    for (let it = 0; it < 7 && total() > target * 1.15; it++) {
      const cands = sessions.filter((s) => !s.outdoor && (s.role === 'easy' || s.role === 'recovery'));
      if (!cands.length) break;
      const t = total();
      const drop = cands.reduce((best, s) => (Math.abs(t - s.workout.metrics.tss - target) < Math.abs(t - best.workout.metrics.tss - target) ? s : best));
      sessions = sessions.filter((s) => s !== drop);
      trim();
    }
    for (const s of sessions) if (s.workout) lastFormat[s.category] = s.workout.format;

    weeks.push({
      week: w, kind, phase, targetTss: Math.round(target), cappedByTime, prog,
      sessions,
      tss: Math.round(total()),
      hours: Math.round(sessions.reduce((a, s) => a + (s.outdoor ? s.minutes : s.workout.durMin), 0) / 6) / 10,
    });
  }

  // names, series numbers, files
  const planName = `${goal.tag} ${N}wk`;
  const seriesCount = {};
  for (const wk of weeks) {
    for (const s of wk.sessions) {
      if (s.outdoor) continue;
      const wo = s.workout;
      let seriesNo = null;
      if (!['test', 'endurance', 'recovery'].includes(wo.category)) seriesNo = seriesCount[wo.category] = (seriesCount[wo.category] || 0) + 1;
      wo.seriesNo = seriesNo;
      finishPlanWorkout(wo, { seed, planName, wk, day: s.day, weeks: N, ftp: input.ftp });
    }
  }

  return {
    name: planName,
    slug: slug(planName),
    goal: goal.label,
    style,
    athlete: ath,
    seed,
    weeks,
    totals: {
      tss: weeks.reduce((a, w) => a + w.tss, 0),
      hours: Math.round(weeks.reduce((a, w) => a + w.hours, 0)),
      workouts: weeks.reduce((a, w) => a + w.sessions.filter((s) => !s.outdoor).length, 0),
    },
  };
}

function finishPlanWorkout(wo, { seed, planName, wk, day, weeks, ftp }) {
  wo.name = workoutName(wo, { seed, seriesNo: wo.seriesNo });
  wo.fullName = `${planName} - Week ${wk.week} Day ${day} - ${wo.name}`;
  wo.description = describe(wo, { ftp, planName, week: wk.week, weeks, phase: phaseLabel(wk) });
  wo.file = fileName(wo.name, wk.week, day);
  wo.tags = [planName, CATEGORY_INFO[wo.category].label];
}

/** Replace one session with a fresh variant (same type, length and dose). Mutates the plan. */
export function rerollSession(plan, weekIdx, sessIdx, ctx, input, salt) {
  const wk = plan.weeks[weekIdx];
  const s = wk.sessions[sessIdx];
  if (!s || s.outdoor || !s.req) return null;
  const used = new Set(plan.weeks.flatMap((w) => w.sessions).map((x) => x.workout?.source?.id).filter(Boolean));
  const prev = s.workout;
  const sources = ['composed', 'library', s.req.source];
  const wo = makeWorkout(ctx, {
    ...s.req, source: sources[salt % 3], avoidFormat: prev.format, used, rng: makeRng(`${plan.seed}|reroll|${weekIdx}|${sessIdx}|${salt}`),
  });
  wo.seriesNo = ['test', 'endurance', 'recovery'].includes(wo.category) ? null : prev.seriesNo || 1;
  finishPlanWorkout(wo, { seed: plan.seed, planName: plan.name, wk, day: s.day, weeks: plan.weeks.length, ftp: input.ftp });
  s.workout = wo;
  wk.tss = Math.round(wk.sessions.reduce((a, x) => a + (x.outdoor ? x.estTss : x.workout.metrics.tss), 0));
  wk.hours = Math.round(wk.sessions.reduce((a, x) => a + (x.outdoor ? x.minutes : x.workout.durMin), 0) / 6) / 10;
  plan.totals.tss = plan.weeks.reduce((a, w) => a + w.tss, 0);
  return wo;
}

export function phaseLabel(wk) {
  if (wk.kind === 'recovery') return 'recovery week';
  if (wk.kind === 'taper') return 'taper week';
  return { base: 'base phase', build: 'build phase', peak: 'peak phase' }[wk.phase] || wk.phase;
}

/** Files for a plan download: one .zwo per indoor session plus an overview. */
export function planFiles(plan) {
  const files = [];
  for (const wk of plan.weeks) {
    for (const s of wk.sessions) {
      if (s.outdoor) continue;
      const w = s.workout;
      files.push({
        name: `${plan.slug}/${w.file}`,
        data: toZwo({ name: w.fullName, description: w.description, tags: w.tags, blocks: w.blocks }),
      });
    }
  }
  files.push({ name: `${plan.slug}/plan-overview.md`, data: planOverview(plan) });
  return files;
}

export function planOverview(plan) {
  const lines = [
    `# ${plan.name}`,
    '',
    `Goal: ${plan.goal} · style: ${plan.style} · athlete level: ${plan.athlete.levelLabel} (${plan.athlete.wkg} W/kg)`,
    `${plan.weeks.length} weeks · ${plan.totals.workouts} workouts · ${plan.totals.hours} h · ${plan.totals.tss} TSS`,
    '',
  ];
  for (const wk of plan.weeks) {
    lines.push(`## Week ${wk.week} — ${phaseLabel(wk)} · ${wk.hours} h · TSS ${wk.tss}`, '');
    for (const s of wk.sessions) {
      if (s.outdoor) lines.push(`- ${DAY_NAMES[s.day - 1]}: outdoor ride, ${s.minutes} min (not included)`);
      else lines.push(`- ${DAY_NAMES[s.day - 1]}: ${s.workout.name} — ${s.workout.durMin} min, TSS ${Math.round(s.workout.metrics.tss)}, IF ${s.workout.metrics.IF.toFixed(2)}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- single workouts
/**
 * input: { ftp, weight, hours, years, intensity, goal, category ('auto' or a type), durMin,
 *          riderType, weaknesses, cadence, source, seed }
 * Returns 3 options.
 */
export function buildSingle(input, ctx) {
  const ath = athleteModel(input);
  const seed = input.seed ?? hash(JSON.stringify({ ...input, seed: undefined }));
  const rider = RIDER_TYPES[input.riderType] || RIDER_TYPES.allrounder;
  const flags = {
    ...rider.flags,
    climbing: input.goal === 'climbing' || rider.flags?.climbing,
    race: input.goal === 'racing' || rider.flags?.race,
    tt: input.goal === 'tt' || rider.flags?.tt,
    cadence: !!input.cadence,
  };
  let cats;
  if (!input.category || input.category === 'auto') {
    const L = keyList(input, 'build', resolveStyle(input));
    cats = [L[0], L[1] || L[0], L[2] || L[0]];
  } else cats = [input.category, input.category, input.category];
  const used = new Set();
  const out = [];
  const sources = input.source === 'composed' ? ['composed', 'composed', 'composed']
    : input.source === 'library' ? ['library', 'library', 'library'] : ['library', 'composed', 'composed'];
  let lastFormat;
  for (let i = 0; i < 3; i++) {
    const r = makeRng(`${seed}|opt${i}`);
    const lv = levelTargets(ath, cats[i]);
    const variant = cats[i] === 'endurance' ? [{}, { cadence: true }, { tempoInserts: true }][i] : {};
    const wo = makeWorkout(ctx, {
      category: cats[i], durMin: input.durMin, x: sessionX(ath, 0.5), flags: { ...flags, ...variant }, rng: r,
      source: sources[i], used, ...lv, avoidFormat: lastFormat, role: 'single',
    });
    lastFormat = wo.format;
    wo.name = workoutName(wo, { seed: seed + i });
    wo.fullName = wo.name;
    wo.description = describe(wo, { ftp: input.ftp });
    wo.file = fileName(wo.name);
    wo.tags = ['Zwo Workout Builder', CATEGORY_INFO[wo.category].label];
    out.push(wo);
  }
  // drop exact duplicates
  return out.filter((w, i) => out.findIndex((o) => o.name === w.name) === i);
}

export { HARD };
