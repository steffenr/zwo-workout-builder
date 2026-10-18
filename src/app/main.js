// main.js — wizard UI for the Zwo Workout Builder.
import {
  buildPlan, buildSingle, planFiles, rerollSession, GOALS, STYLES, RIDER_TYPES, WEAKNESSES, DAY_NAMES, athleteModel, phaseLabel,
} from '../engine/plan.js';
import { CATEGORY_INFO } from '../engine/compose.js';
import { toZwo, makeZip } from '../engine/export.js';
import { toIctx } from '../engine/ictx.js';
import { slug } from '../engine/naming.js';

// Engine data is embedded as base64-encoded gzip JSON in the page
// (compressed at build time to keep the offline file small).
// Falls back to plain JSON for uncompressed builds.
async function loadData() {
  const el = document.getElementById('engine-data');
  const raw = el ? el.textContent.trim() : '';
  if (!raw) return null;
  try {
    return JSON.parse(raw); // uncompressed
  } catch { /* base64 gzip below */ }
  const bin = atob(raw);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const decompressed = new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(decompressed).text());
}
const ctx = { library: [], rules: {} };
const dataReady = loadData()
  .then((d) => { ctx.library = d?.library || []; ctx.rules = d?.rules || {}; })
  .catch((e) => console.error('Failed to load engine data:', e));
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Five zones as in zwoTrainer: upper bounds of Z1..Z4 in % FTP; everything above Z4 is Z5.
const ZONE_BOUNDS = [55, 75, 90, 105];
const ZONES = [
  { id: 'z1', short: 'Z1', name: 'Recovery' },
  { id: 'z2', short: 'Z2', name: 'Base endurance' },
  { id: 'z3', short: 'Z3', name: 'Tempo' },
  { id: 'z4', short: 'Z4', name: 'Threshold' },
  { id: 'z5', short: 'Z5', name: 'VO2max' },
];
const ZONE_OF = { recovery: 'z1', endurance: 'z2', tempo: 'z3', sweetspot: 'z4', threshold: 'z4', vo2max: 'z5', anaerobic: 'z5', sprint: 'z5', test: 'z4' };
const zoneVar = (p) => {
  if (p == null) return 'free';
  const pct = p * 100;
  for (let i = 0; i < ZONE_BOUNDS.length; i++) if (pct <= ZONE_BOUNDS[i] + 1e-9) return ZONES[i].id;
  return 'z5';
};

// ---------------------------------------------------------------- state
const DEFAULTS = {
  mode: 'plan', ftp: 250, weight: 75, hours: 5, years: 1,
  goal: 'ftp', lengthBy: 'weeks', weeks: 8, eventDate: '', includeTest: true,
  category: 'auto', durMin: 60,
  days: [
    { day: 1, on: false, minutes: 60, outdoor: false },
    { day: 2, on: true, minutes: 60, outdoor: false },
    { day: 3, on: false, minutes: 60, outdoor: false },
    { day: 4, on: true, minutes: 60, outdoor: false },
    { day: 5, on: false, minutes: 60, outdoor: false },
    { day: 6, on: true, minutes: 90, outdoor: false },
    { day: 7, on: true, minutes: 120, outdoor: false },
  ],
  style: 'auto', intensity: 3, riderType: 'allrounder', weaknesses: [], cadence: false, source: 'mixed',
};
let S = loadState();
let step = 0;
let result = null; // { kind: 'plan'|'single', plan?, options? }
let seedSalt = 0;
let rerolls = 0;
let selSeg = null; // { workoutKey: 'plan:wi,si' | 'single:i', segIndex, seg } currently selected segment

function loadState() {
  try {
    const raw = localStorage.getItem('zwo-builder-answers');
    if (raw) return { ...structuredClone(DEFAULTS), ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return structuredClone(DEFAULTS);
}
function saveState() {
  try { localStorage.setItem('zwo-builder-answers', JSON.stringify(S)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- downloads
let downloads = null;
if (window.claude?.use) {
  window.claude.use('downloads').then((d) => { downloads = d; render(); }).catch(() => {});
}
const inArtifact = () => !!window.claude?.use;

let zwoBlocked = false; // set when the hosting view refuses .zwo files

async function saveFile(filename, data, { rethrow = false } = {}) {
  try {
    if (downloads) {
      await downloads.save({ filename, data });
      toast(`Saved ${filename}`);
      return;
    }
    if (inArtifact()) { toast('Downloads are not available in this view.'); return; }
    const blob = new Blob([data], { type: filename.endsWith('.zip') ? 'application/zip' : 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  } catch (e) {
    if (e?.code === 'declined') return;
    if (rethrow) throw e;
    toast(e?.message || 'The file could not be saved.');
  }
}

/** Single workout as one .zwo file. Only if the hosting view refuses .zwo does it fall back to a .zip. */
async function downloadWorkout(w) {
  const xml = toZwo({ name: w.fullName, description: w.description, tags: w.tags, blocks: w.blocks });
  const zipIt = () => saveFile(w.file.replace(/\.zwo$/, '.zip'), makeZip([{ name: w.file, data: xml }]));
  if (zwoBlocked) { zipIt(); return; }
  try {
    await saveFile(w.file, xml, { rethrow: true });
  } catch (e) {
    if (e?.code === 'rejected_extension' || e?.code === 'extension_not_enabled') {
      zwoBlocked = true;
      render();
      toast('This view only allows .zip downloads, so the .zwo comes inside a .zip. The offline app saves .zwo directly.');
      setTimeout(zipIt, 400);
    } else toast(e?.message || 'The file could not be saved.');
  }
}
function downloadPlan(plan) {
  saveFile(`${plan.slug}.zip`, makeZip(planFiles(plan)));
}
let ictxBlocked = false; // set when the hosting view refuses .ictx files
async function downloadIctx(w, planName, displayOrder = 1) {
  const fname = w.file.replace(/\.zwo$/, '.ictx');
  const data = toIctx({ name: w.fullName, plan: planName || '', displayOrder, description: w.description, blocks: w.blocks });
  const zipIt = () => saveFile(fname.replace(/\.ictx$/, '.zip'), makeZip([{ name: fname, data }]));
  if (ictxBlocked) { zipIt(); return; }
  try {
    await saveFile(fname, data, { rethrow: true });
  } catch (e) {
    if (e?.code === 'rejected_extension' || e?.code === 'extension_not_enabled') {
      ictxBlocked = true;
      render();
      toast('This view only allows .zip downloads, so the .ictx comes inside a .zip. The offline app saves .ictx directly.');
      setTimeout(zipIt, 400);
    } else toast(e?.message || 'The file could not be saved.');
  }
}
function downloadOptions(opts) {
  const files = [];
  for (const w of opts) {
    files.push({ name: w.file, data: toZwo({ name: w.fullName, description: w.description, tags: w.tags, blocks: w.blocks }) });
    files.push({ name: w.file.replace(/\.zwo$/, '.ictx'), data: toIctx({ name: w.fullName, plan: '', displayOrder: 1, description: w.description, blocks: w.blocks }) });
  }
  saveFile('zwo-workouts.zip', makeZip(files));
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

// ---------------------------------------------------------------- helpers
function nextMonday(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const add = (8 - x.getDay()) % 7 || 7;
  x.setDate(x.getDate() + (x.getDay() === 1 ? 0 : add));
  return x;
}
function weeksUntil(dateStr) {
  if (!dateStr) return null;
  const ev = new Date(`${dateStr}T12:00:00`);
  const start = nextMonday();
  return Math.ceil((ev - start) / (7 * 864e5));
}
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m}min`);

/**
 * Power profile as SVG (bars stretch; all text is HTML). With `key`, segments are selectable
 * (data-seg) and the selected one is outlined in the accent colour.
 */
function profileSVG(profile, { h = 28, cls = 'mini', ftp = null, key = null } = {}) {
  const total = profile.reduce((a, s) => a + s[0], 0) || 1;
  const top = Math.max(1.3, Math.min(2.2, Math.max(...profile.map((s) => Math.max(s[1] ?? 0, s[2] ?? 0))) + 0.1));
  let x = 0;
  let shapes = '';
  profile.forEach(([d, p0, p1], i) => {
    const w = (d / total) * 1000;
    const a = p0 ?? 0.55;
    const b = p1 ?? 0.55;
    const y0 = h - (Math.min(a, top) / top) * h;
    const y1 = h - (Math.min(b, top) / top) * h;
    const fill = `var(--${p0 == null ? 'free' : zoneVar((a + b) / 2)})`;
    const path = `M${x.toFixed(1)} ${h}L${x.toFixed(1)} ${y0.toFixed(1)}L${(x + w).toFixed(1)} ${y1.toFixed(1)}L${(x + w).toFixed(1)} ${h}Z`;
    if (key) {
      const sel = selSeg && selSeg.workoutKey === key && selSeg.segIndex === i;
      shapes += `<path data-seg="${i}" data-key="${key}" d="${path}" fill="${fill}" class="seg-click"${sel ? ' stroke="var(--accent)" stroke-width="2.5" vector-effect="non-scaling-stroke"' : ''}/>`;
    } else shapes += `<path d="${path}" fill="${fill}"/>`;
    x += w;
  });
  const ftpY = h - (1 / top) * h;
  const ftpLine = ftp ? `<line x1="0" x2="1000" y1="${ftpY}" y2="${ftpY}" stroke="var(--ftp)" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" opacity=".45"/>` : '';
  const svg = `<svg class="${cls}" viewBox="0 0 1000 ${h}" preserveAspectRatio="none" role="img" aria-label="Power profile">${shapes}${ftpLine}</svg>`;
  if (!ftp) return svg;
  const ticks = [0.5, 1, 1.5, 2].filter((p) => p < top).map((p) => `<span class="tick" style="bottom:${(p / top) * 100}%">${Math.round(p * ftp)} W</span>`).join('');
  return `<div class="axis">${ticks}</div>${svg}`;
}

/** Seconds per zone (Z1..Z5) and free ride, from a compact profile. */
function zoneSeconds(profile) {
  const z = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, free: 0 };
  for (const [d, p0, p1] of profile) {
    if (p0 == null) { z.free += d; continue; }
    const n = p0 === p1 ? 1 : 12;
    for (let k = 0; k < n; k++) z[zoneVar(p0 + ((p1 - p0) * (k + 0.5)) / n)] += d / n;
  }
  return z;
}
/** Dominant zone tag for a workout type. */
const zoneTag = (cat) => {
  const z = ZONE_OF[cat] || 'z2';
  return `<span class="ztag" style="--zc:var(--${z})" title="${ZONES.find((x) => x.id === z).name}">${z.toUpperCase()}</span>`;
};

function inputForEngine() {
  const days = S.days.filter((d) => d.on).map((d) => ({ day: d.day, minutes: +d.minutes, outdoor: !!d.outdoor }));
  const weeks = S.lengthBy === 'event' ? Math.max(4, Math.min(24, weeksUntil(S.eventDate) || 8)) : +S.weeks;
  return {
    ftp: +S.ftp, weight: +S.weight, hours: +S.hours, years: +S.years, intensity: +S.intensity,
    goal: S.goal, weeks, eventDate: S.lengthBy === 'event' ? S.eventDate : null,
    days, style: S.style, riderType: S.riderType, weaknesses: S.weaknesses, cadence: S.cadence,
    source: 'mixed', includeTest: S.includeTest, category: S.category, durMin: +S.durMin,
  };
}

function generate() {
  const input = inputForEngine();
  if (seedSalt) input.seed = 1000 + seedSalt;
  modalState = null;
  selSeg = null;
  if (S.mode === 'plan') result = { kind: 'plan', plan: buildPlan(input, ctx), input };
  else result = { kind: 'single', options: buildSingle(input, ctx), input };
}


// ---------------------------------------------------------------- formatting
const fmtTime = (sec) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};
const fmtShort = (min) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}` : `${min}m`);
const fmtDur = (min) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m` : `${Math.round(min)} min`);

// ---------------------------------------------------------------- theme (lives in Settings)
const THEME_LABEL = { system: 'Match system', light: 'Light', dark: 'Dark' };
let theme = 'system';
try { theme = localStorage.getItem('zwo-builder-theme') || 'system'; } catch { /* ignore */ }
function applyTheme() {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

function openSettings(anchor) {
  const pop = $('#popover');
  if (!pop.hidden) { closePopover(); return; }
  pop.innerHTML = `<div class="pop-title">Appearance</div>
    <div class="pop-row"><span class="seg-ctl" id="theme-ctl">${['system', 'light', 'dark'].map((t) => `<button type="button" data-theme-set="${t}" class="${theme === t ? 'on' : ''}" aria-pressed="${theme === t}">${THEME_LABEL[t]}</button>`).join('')}</span></div>
    <hr><p>Your answers and the theme are stored in this browser only.</p>`;
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${r.bottom + 8}px`;
  pop.style.left = `${Math.max(16, r.right - pop.offsetWidth)}px`;
  anchor.setAttribute('aria-expanded', 'true');
}
function closePopover() {
  $('#popover').hidden = true;
  $('#btn-settings').setAttribute('aria-expanded', 'false');
}

// ---------------------------------------------------------------- small visuals
const GOAL_NOTES = {
  fitness: 'Feel fitter and ride stronger overall.',
  ftp: 'Push your one-hour power up.',
  fondo: 'Long days, steady power, good pacing.',
  climbing: 'Sustained power on long climbs.',
  racing: 'Repeated surges, attacks and sprints.',
  tt: 'Hold the limit alone, steady and aero.',
  triathlon: 'A strong bike leg, fresh for the run.',
  gravel: 'Long efforts plus punchy terrain.',
  maintain: 'Keep what you have with less time.',
};
/** Distribution of key-session types across the goal's phases, drawn in zone colours. */
function goalMix(key) {
  const g = GOALS[key];
  const count = {};
  for (const ph of Object.values(g.phases)) {
    ph.forEach((c, i) => { const z = ZONE_OF[c]; count[z] = (count[z] || 0) + (3 - Math.min(i, 2)); });
  }
  return `<span class="zmix" aria-hidden="true">${['z3', 'z4', 'z5'].filter((z) => count[z]).map((z) => `<i style="flex:${count[z]};background:var(--${z})"></i>`).join('')}</span>`;
}
const STYLE_MIX = { pyramidal: [75, 20, 5], polarized: [80, 5, 15], sweetspot: [60, 35, 5] };
function styleMix(k) {
  const m = STYLE_MIX[k];
  if (!m) return '<span class="zmix" aria-hidden="true"><i style="flex:1;background:var(--surface-3)"></i></span>';
  return `<span class="zmix" aria-hidden="true"><i style="flex:${m[0]};background:var(--z2)"></i><i style="flex:${m[1]};background:var(--z4)"></i><i style="flex:${m[2]};background:var(--z5)"></i></span>`;
}
function artPlan() {
  const h = [36, 42, 48, 24, 46, 52, 58, 28];
  return `<svg class="art" viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true">${h.map((v, i) => `<rect x="${i * 25 + 2}" y="${60 - v}" width="20" height="${v}" rx="3" fill="var(--${i === 3 || i === 7 ? 'z3' : 'z2'})"/>`).join('')}</svg>`;
}
function artSingle() {
  return `<svg class="art" viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true"><path d="M0 60L0 46L30 32L30 60Z" fill="var(--z1)"/>${[0, 1, 2, 3, 4].map((i) => `<rect x="${36 + i * 28}" y="14" width="16" height="46" fill="var(--z5)"/><rect x="${52 + i * 28}" y="42" width="12" height="18" fill="var(--z2)"/>`).join('')}<path d="M176 60L176 38L200 50L200 60Z" fill="var(--z1)"/></svg>`;
}

// ---------------------------------------------------------------- steps
const STEPS_PLAN = ['Mode', 'Rider', 'Goal', 'Week', 'Style', 'Result'];
const STEPS_SINGLE = ['Mode', 'Rider', 'Workout', 'Style', 'Result'];
const steps = () => (S.mode === 'plan' ? STEPS_PLAN : STEPS_SINGLE);
const INTENS = ['Gentle', 'Easy-going', 'Balanced', 'Ambitious', 'Aggressive'];

function stepActions() {
  const names = steps();
  const nextIsResult = names[step + 1] === 'Result';
  const label = nextIsResult ? (S.mode === 'plan' ? 'Build plan' : 'Build workouts') : 'Next';
  const invalid = validate();
  return `<div class="step-actions">
    <span class="why" role="status">${esc(invalid)}</span>
    ${step > 0 ? '<button type="button" class="btn ghost" data-act="back">Back</button>' : ''}
    <button type="button" class="btn primary" data-act="next" ${invalid ? 'disabled' : ''}>${label}</button>
  </div>`;
}

function stepMode() {
  const card = (val, title, text, art) => `
    <button type="button" class="choice ${S.mode === val ? 'on' : ''}" data-set="mode" data-val="${val}" aria-pressed="${S.mode === val}">
      ${art}<h3>${title}</h3><span class="sub">${text}</span></button>`;
  return `<div class="q"><div class="eyebrow">New</div><h1>What should we build?</h1></div>
    <div class="grid2">
      ${card('plan', 'Training plan', 'Several weeks with build and recovery weeks. Downloads as one ZIP in plan order.', artPlan())}
      ${card('single', 'Single workout', 'One session for today. Pick a type and length, then choose from three options.', artSingle())}
    </div>`;
}

function stepRider() {
  const ath = athleteModel({ ftp: +S.ftp, weight: +S.weight, hours: +S.hours, years: +S.years, intensity: +S.intensity });
  const yrs = ['New', 'Under 1 year', '1–3 years', 'Over 3 years'];
  return `<div class="q"><div class="eyebrow">Rider</div><h1>About you</h1></div>
    <div class="form">
      <label class="frow" for="ftp"><span>FTP<small>Functional threshold power</small></span><span class="unit-in"><input id="ftp" type="number" inputmode="numeric" min="80" max="600" step="1" value="${S.ftp}" data-num="ftp"> W</span></label>
      <label class="frow" for="weight"><span>Weight</span><span class="unit-in"><input id="weight" type="number" inputmode="decimal" min="35" max="160" step="0.5" value="${S.weight}" data-num="weight"> kg</span></label>
      <label class="frow" for="hours"><span>Riding per week<small>Average of the last 4–6 weeks</small></span>
        <span class="range"><input id="hours" type="range" min="0" max="16" step="0.5" value="${S.hours}" data-num="hours"><output>${S.hours} h</output></span></label>
      <div class="frow"><span>Structured training</span>
        <span class="seg-ctl" role="group" aria-label="Structured training experience">${yrs.map((y, i) => `<button type="button" class="${+S.years === i ? 'on' : ''}" data-set="years" data-val="${i}" aria-pressed="${+S.years === i}">${y}</button>`).join('')}</span></div>
    </div>
    <div class="stats" style="--cols:3;background:var(--surface-2);border-radius:12px;padding:14px 16px">
      <div><span class="k">W/kg</span><b>${ath.wkg.toFixed(2)}</b></div>
      <div><span class="k">Status</span><b class="txt">${ath.levelLabel}</b></div>
      <div><span class="k">TSS / week now</span><b>${ath.startTss}</b></div>
    </div>
    <p class="hint">TSS (Training Stress Score) measures load: one hour flat out at FTP is 100 TSS. Your current weekly load is where the plan starts.</p>`;
}

function goalCards() {
  return Object.entries(GOALS).map(([k, g]) => `<button type="button" class="choice ${S.goal === k ? 'on' : ''}" data-set="goal" data-val="${k}" aria-pressed="${S.goal === k}"><h3>${g.label}</h3><span class="sub">${GOAL_NOTES[k]}</span>${goalMix(k)}</button>`).join('');
}

function stepGoal() {
  if (S.mode === 'single') {
    const types = ['auto', 'recovery', 'endurance', 'tempo', 'sweetspot', 'threshold', 'vo2max', 'anaerobic', 'sprint'];
    return `<div class="q"><div class="eyebrow">Workout</div><h1>Which workout?</h1></div>
      <fieldset><legend class="k">Type</legend><div class="chips">${types.map((t) => `<button type="button" class="zchip ${S.category === t ? 'on' : ''}" data-set="category" data-val="${t}" aria-pressed="${S.category === t}" style="--zc:var(--${t === 'auto' ? 'accent' : ZONE_OF[t]})"><i></i>${t === 'auto' ? 'Pick for me' : CATEGORY_INFO[t].label}</button>`).join('')}</div>
      <p class="hint">${S.category !== 'auto' ? esc(CATEGORY_INFO[S.category].purpose) : 'Uses your goal and weak spots to suggest three different sessions.'}</p></fieldset>
      <div class="form"><label class="frow" for="durMin"><span>Length</span><span class="range"><input id="durMin" type="range" min="30" max="180" step="5" value="${S.durMin}" data-num="durMin"><output>${fmtDur(+S.durMin)}</output></span></label></div>
      ${S.category === 'auto' ? `<fieldset><legend class="k">Your goal</legend><div class="grid3">${goalCards()}</div></fieldset>` : ''}`;
  }
  const wk = weeksUntil(S.eventDate);
  return `<div class="q"><div class="eyebrow">Goal</div><h1>What are you training for?</h1><p>The coloured bar shows which intensities the plan's key sessions focus on.</p></div>
    <div class="grid3">${goalCards()}</div>
    <div class="form">
      <div class="frow"><span>Plan length</span>
        <span class="seg-ctl"><button type="button" class="${S.lengthBy === 'weeks' ? 'on' : ''}" data-set="lengthBy" data-val="weeks" aria-pressed="${S.lengthBy === 'weeks'}">Number of weeks</button><button type="button" class="${S.lengthBy === 'event' ? 'on' : ''}" data-set="lengthBy" data-val="event" aria-pressed="${S.lengthBy === 'event'}">Until an event</button></span></div>
      ${S.lengthBy === 'weeks'
    ? `<label class="frow" for="weeks"><span>Weeks</span><span class="range"><input id="weeks" type="range" min="4" max="16" step="1" value="${S.weeks}" data-num="weeks"><output>${S.weeks} weeks</output></span></label>`
    : `<label class="frow" for="eventDate"><span>Event date<small>${wk == null ? 'The plan starts next Monday and ends with a taper week.' : wk < 4 ? `Only ${wk} week(s) away: the plan uses the 4-week minimum.` : `${Math.min(24, wk)} weeks from ${nextMonday().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ending with a taper week.`}</small></span><input id="eventDate" type="date" value="${esc(S.eventDate)}" data-str="eventDate"></label>`}
      <div class="frow"><label class="check"><input type="checkbox" data-bool="includeTest" ${S.includeTest ? 'checked' : ''}> FTP ramp test in week 1${S.lengthBy === 'weeks' ? ' and at the end' : ''}</label></div>
    </div>`;
}

function stepWeek() {
  const tiles = S.days.map((d, i) => `
    <div class="day ${d.on ? 'on' : ''}">
      <button type="button" class="dtog" data-day-toggle="${i}" aria-pressed="${d.on}" aria-label="${DAY_NAMES[i]}: ${d.on ? 'riding, tap for rest' : 'rest, tap to ride'}"><b>${DAY_NAMES[i]}</b><small>${d.on ? (d.outdoor ? 'Outdoor' : 'Indoor') : 'Rest'}</small></button>
      ${d.on ? `<div class="stepper"><button type="button" class="btn round" data-day-step="${i}" data-delta="-15" aria-label="${DAY_NAMES[i]} shorter">−</button><output title="${fmtDur(+d.minutes)}">${fmtShort(+d.minutes)}</output><button type="button" class="btn round" data-day-step="${i}" data-delta="15" aria-label="${DAY_NAMES[i]} longer">+</button></div>
      <button type="button" class="outtog" data-day-out="${i}" aria-pressed="${!!d.outdoor}" title="Outdoor rides count towards your load but get no file">Outdoor</button>` : ''}
    </div>`).join('');
  const on = S.days.filter((d) => d.on);
  const total = on.reduce((a, d) => a + +d.minutes, 0);
  const now = +S.hours * 60;
  const scale = Math.max(total, now, 60) * 1.1;
  return `<div class="q"><div class="eyebrow">Week</div><h1>Your training week</h1>
      <p>Tap a day to ride or rest and set the time with − and +. Outdoor rides count towards your load but get no file.</p></div>
    <div class="days">${tiles}</div>
    <div class="load">
      <div class="pbar" aria-hidden="true"><i style="width:${(total / scale) * 100}%"></i><u style="left:${(now / scale) * 100}%"></u></div>
      <div class="legend"><span><b class="num" style="color:var(--text)">${on.length}</b>&nbsp;rides · <b class="num" style="color:var(--text)">${fmtDur(total)}</b>&nbsp;available</span><span><i class="tgt"></i>Your current ${S.hours} h</span></div>
      ${total / 60 > +S.hours * 1.6 + 2 ? '<p class="hint warn-text">A big jump from your current hours. The plan starts at your current load and builds up.</p>' : ''}
    </div>`;
}

function stepStyle() {
  const styles = Object.entries(STYLES).map(([k, st]) => `<button type="button" class="choice ${S.style === k ? 'on' : ''}" data-set="style" data-val="${k}" aria-pressed="${S.style === k}"><h3>${st.label}</h3><span class="sub">${st.note || 'Picks the style that suits your goal and available time.'}</span>${styleMix(k)}</button>`).join('');
  return `<div class="q"><div class="eyebrow">Style</div><h1>How you like to train</h1></div>
    ${S.mode === 'plan' ? `<fieldset><legend class="k">Training style · easy / moderate / hard</legend><div class="grid2">${styles}</div></fieldset>` : ''}
    <div class="form">
      <label class="frow" for="intensity"><span>Intensity</span><span class="range"><input id="intensity" type="range" min="1" max="5" step="1" value="${S.intensity}" data-num="intensity"><output>${INTENS[S.intensity - 1]}</output></span></label>
      <div class="frow"><label class="check"><input type="checkbox" data-bool="cadence" ${S.cadence ? 'checked' : ''}> Cadence drills in easy rides</label></div>
    </div>
    <fieldset><legend class="k">Rider type</legend><div class="chips">${Object.entries(RIDER_TYPES).map(([k, r]) => `<button type="button" class="zchip ${S.riderType === k ? 'on' : ''}" data-set="riderType" data-val="${k}" aria-pressed="${S.riderType === k}"><i></i>${r.label}</button>`).join('')}</div></fieldset>
    <fieldset><legend class="k">Weak spots to work on</legend><div class="chips">${Object.entries(WEAKNESSES).map(([k, wk]) => `<button type="button" class="zchip ${S.weaknesses.includes(k) ? 'on' : ''}" data-toggle="weaknesses" data-val="${k}" aria-pressed="${S.weaknesses.includes(k)}" style="--zc:var(--${ZONE_OF[wk.category]})"><i></i>${wk.label}</button>`).join('')}</div></fieldset>`;
}

/** Summary of the answers so far. */
function sideHTML() {
  const ath = athleteModel({ ftp: +S.ftp, weight: +S.weight, hours: +S.hours, years: +S.years, intensity: +S.intensity });
  const on = S.days.filter((d) => d.on);
  const weeks = S.lengthBy === 'event' ? (weeksUntil(S.eventDate) ? Math.max(4, Math.min(24, weeksUntil(S.eventDate))) : '–') : S.weeks;
  const tiles = S.mode === 'plan'
    ? [['FTP', `${S.ftp} W`], ['W/kg', ath.wkg.toFixed(2)], ['Weeks', weeks], ['Per week', fmtDur(on.reduce((a, d) => a + +d.minutes, 0))], ['Goal', GOALS[S.goal].label, 'txt'], ['Intensity', INTENS[S.intensity - 1], 'txt']]
    : [['FTP', `${S.ftp} W`], ['W/kg', ath.wkg.toFixed(2)], ['Length', fmtDur(+S.durMin)], ['Intensity', INTENS[S.intensity - 1], 'txt'], ['Type', S.category === 'auto' ? 'Pick for me' : CATEGORY_INFO[S.category].label, 'txt']];
  return `<div class="eyebrow">Your answers</div>
    <div class="stats">${tiles.map(([l, v, c = '']) => `<div><span class="k">${l}</span><b class="${c}">${esc(v)}</b></div>`).join('')}</div>
    ${S.mode === 'plan' ? `<div class="weekstrip" aria-label="Riding days">${S.days.map((d, i) => `<span class="${d.on ? (d.outdoor ? 'out' : 'on') : ''}" title="${DAY_NAMES[i]}: ${d.on ? (d.outdoor ? 'outdoor' : 'indoor') : 'rest'}">${DAY_NAMES[i].slice(0, 2)}</span>`).join('')}</div>` : ''}
    <p class="meta">${ath.levelLabel} · ${esc(RIDER_TYPES[S.riderType]?.label || '')}${S.weaknesses.length ? ` · works on ${S.weaknesses.map((w) => WEAKNESSES[w].label.toLowerCase()).join(', ')}` : ''}</p>`;
}

// ---------------------------------------------------------------- results
const DL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>';
const zwoLabel = () => (zwoBlocked ? 'Download (.zip)' : 'Download .zwo');
const ictxLabel = () => (ictxBlocked ? '.ictx (.zip)' : 'Download .ictx');
const PHASE_SHORT = (w) => (w.kind === 'recovery' ? 'Recovery' : w.kind === 'taper' ? 'Taper' : { base: 'Base', build: 'Build', peak: 'Peak' }[w.phase] || w.phase);
const ROLE_LABEL = { key: 'key session', long: 'long ride', easy: 'easy ride', recovery: 'recovery ride', test: 'FTP test' };

let modalState = null; // { kind: 'plan', wi, si } | { kind: 'single', i }

function resultPlan() {
  const { plan } = result;
  const maxT = Math.max(...plan.weeks.map((w) => Math.max(w.tss, w.targetTss)));
  const bars = plan.weeks.map((w) => `
    <div class="lbar ${w.kind}" title="Week ${w.week}: ${w.tss} TSS (target ${w.targetTss}), ${w.hours} h, ${phaseLabel(w)}">
      <div class="tgt" style="bottom:${(w.targetTss / maxT) * 100}%"></div>
      <div class="fill" style="height:${(w.tss / maxT) * 100}%"></div>
      <span class="val" style="bottom:${(Math.max(w.tss, w.targetTss) / maxT) * 100}%">${w.tss}</span>
    </div>`).join('');
  const weekLabels = plan.weeks.map((w) => `<span><b>${w.week}</b>${PHASE_SHORT(w)}</span>`).join('');
  const weeksHtml = plan.weeks.map((wk, wi) => {
    const rows = wk.sessions.map((s, si) => {
      const day = `<span class="wd">${DAY_NAMES[s.day - 1]}</span>`;
      if (s.outdoor) {
        return `<div class="wrow outdoor">${day}<div class="wt"><span>Outdoor ride</span><small>No file · counts towards your load</small></div><div class="wprof"></div><div class="wdur">${fmtDur(s.minutes)}</div><div class="wtss">≈ ${s.estTss}<small> TSS</small></div></div>`;
      }
      const w = s.workout;
      const open = modalState?.kind === 'plan' && modalState.wi === wi && modalState.si === si;
      return `<div class="wrow ${open ? 'open' : ''}" role="button" tabindex="0" data-open="plan:${wi},${si}" aria-label="${esc(w.name)}, ${DAY_NAMES[s.day - 1]}">
        ${day}
        <div class="wt"><span>${esc(w.name)}</span><small>${CATEGORY_INFO[w.category].label} · ${ROLE_LABEL[s.role] || s.role}</small></div>
        <div class="wprof">${profileSVG(w.profile)}</div>
        <div class="wdur">${fmtDur(w.durMin)}</div>
        <div class="wtss">${zoneTag(w.category)}<span>${Math.round(w.metrics.tss)}<small> TSS</small></span></div>
      </div>`;
    }).join('');
    return `<div class="wk-head"><h3>Week ${wk.week} <span class="badge muted">${phaseLabel(wk)}</span>${wk.cappedByTime && wk.kind === 'load' ? '<span class="badge warn" title="Your available time limits the load this week">Time-limited</span>' : ''}</h3>
      <span class="meta">${wk.hours} h · ${wk.tss} TSS</span></div>
      <div class="wlist">${rows}</div>`;
  }).join('');
  const a = plan.athlete;
  return `<div class="plan-head">
      <div><div class="eyebrow">Training plan</div><h1>${esc(plan.name)}</h1>
      <p class="meta">${esc(plan.goal)} · ${esc(STYLES[plan.style]?.label || plan.style)} · ${a.levelLabel}, ${a.wkg.toFixed(2)} W/kg</p></div>
      <div class="actions"><button type="button" class="btn ghost" data-act="edit">Change answers</button><button type="button" class="btn" data-act="shuffle">Shuffle workouts</button><button type="button" class="btn primary" data-act="dl-plan">${DL_ICON}Download plan (.zip)</button></div>
    </div>
    <div class="card section stats plan" style="--cols:5">
      <div><span class="k">Weeks</span><b>${plan.weeks.length}</b></div>
      <div><span class="k">Workouts</span><b>${plan.totals.workouts}</b></div>
      <div><span class="k">Hours</span><b>${plan.totals.hours}</b></div>
      <div><span class="k">Total TSS</span><b>${plan.totals.tss.toLocaleString()}</b></div>
      <div><span class="k">TSS / week</span><b>${Math.round(plan.totals.tss / plan.weeks.length)}</b></div>
    </div>
    <div class="card load" style="margin-top:12px" aria-label="Weekly load">
      <div class="wk-head" style="margin:0"><span class="eyebrow">Weekly load (TSS)</span>
        <span class="legend"><span><i style="background:var(--accent)"></i>Build</span><span><i style="background:color-mix(in srgb, var(--accent) 35%, var(--surface))"></i>Recovery</span><span><i style="background:var(--line-strong)"></i>Taper</span><span><i class="tgt"></i>Target</span></span></div>
      <div class="lbars">${bars}</div>
      <div class="lweeks">${weekLabels}</div>
    </div>
    <p class="hint" style="margin-top:14px">Select a workout for its details. The ZIP holds one folder with every workout as .zwo and .ictx (icTrainer), named Week/Day in plan order, plus an overview.</p>
    ${weeksHtml}`;
}

function resultSingle() {
  const { options, input } = result;
  return `<div class="plan-head">
      <div><div class="eyebrow">Single workout</div><h1>${options.length} options for ${fmtDur(input.durMin)}</h1>
      <p class="meta">Select an option for its details.</p></div>
      <div class="actions"><button type="button" class="btn ghost" data-act="edit">Change answers</button><button type="button" class="btn" data-act="shuffle">More options</button><button type="button" class="btn primary" data-act="dl-all">${DL_ICON}Download all (.zip)</button></div>
    </div>
    <div class="opts section">${options.map((w, i) => `
      <article class="card opt" role="button" tabindex="0" data-open="single:${i}" aria-label="Option ${i + 1}: ${esc(w.name)}">
        <div class="eyebrow">Option ${i + 1} ${zoneTag(w.category)}</div>
        <h3>${esc(w.name)}</h3>
        ${profileSVG(w.profile, { h: 64 })}
        <p class="meta">${fmtDur(w.durMin)} · ${Math.round(w.metrics.tss)} TSS · IF ${w.metrics.IF.toFixed(2)} · ${CATEGORY_INFO[w.category].label}</p>
        <div class="actions"><button type="button" class="btn sm" data-act="dl-opt" data-i="${i}">${DL_ICON}${zwoLabel()}</button><button type="button" class="btn ghost sm" data-act="dl-ictx-opt" data-i="${i}">${ictxLabel()}</button></div>
      </article>`).join('')}</div>`;
}

// ---------------------------------------------------------------- workout dialog
function modalWorkout() {
  if (!modalState || !result) return null;
  if (modalState.kind === 'plan') {
    const wk = result.plan.weeks[modalState.wi];
    const s = wk?.sessions[modalState.si];
    return s && { w: s.workout, key: `plan:${modalState.wi},${modalState.si}`, eyebrow: `Week ${wk.week} · ${DAY_NAMES[s.day - 1]} · ${ROLE_LABEL[s.role] || s.role}` };
  }
  const w = result.options[modalState.i];
  return w && { w, key: `single:${modalState.i}`, eyebrow: `Option ${modalState.i + 1}` };
}

function segInfo(w, key) {
  const segs = w.segs || w.profile.map(([dur, p0, p1]) => ({ dur, p0, p1, cad: null, free: p0 == null }));
  const idx = selSeg && selSeg.workoutKey === key ? selSeg.segIndex : null;
  const seg = idx != null ? segs[idx] : null;
  if (!seg) return '<span class="muted">Hover or tap a segment for its target.</span>';
  const ftp = result.input.ftp;
  const cad = seg.cad != null ? ` · ${seg.cad} rpm` : '';
  if (seg.max) return `<b>All-out</b> · ${fmtTime(seg.dur)} · ERG off${cad}`;
  if (seg.free || seg.p0 == null) return `<b>Free ride</b> · ${fmtTime(seg.dur)}${cad}`;
  const z = zoneVar((seg.p0 + seg.p1) / 2);
  const ink = `style="color:var(--${z}-ink)"`;
  if (Math.abs(seg.p0 - seg.p1) > 0.005) {
    return `<b>Ramp</b> · ${fmtTime(seg.dur)} · <b ${ink}>${Math.round(seg.p0 * ftp)} → ${Math.round(seg.p1 * ftp)} W</b> (${Math.round(seg.p0 * 100)} → ${Math.round(seg.p1 * 100)} %)${cad}`;
  }
  return `<b>Steady</b> · ${fmtTime(seg.dur)} · <b ${ink}>${Math.round(seg.p0 * ftp)} W</b> (${Math.round(seg.p0 * 100)} %) · ${ZONES.find((x) => x.id === z).name}${cad}`;
}

function renderModal() {
  const m = modalWorkout();
  const dlg = $('#modal');
  if (!m) { if (dlg.open) dlg.close(); return; }
  const { w, key, eyebrow } = m;
  const ftp = result.input.ftp;
  const zs = zoneSeconds(w.profile);
  const total = Object.values(zs).reduce((a, b) => a + b, 0) || 1;
  const parts = [...ZONES.map((z) => [z.id, z.short, z.name]), ['free', '', 'Free ride']].filter(([id]) => zs[id] > 0);
  const isPlan = modalState.kind === 'plan';
  $('#modal-body').innerHTML = `
    <div class="pv-head">
      <div><div class="eyebrow">${esc(eyebrow)} ${zoneTag(w.category)}</div><h2>${esc(w.name)}</h2></div>
      <button type="button" class="icon-btn" data-act="close" title="Close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    </div>
    <div class="stats" style="--cols:4">
      <div><span class="k">Duration</span><b>${fmtDur(w.durMin)}</b></div>
      <div><span class="k">TSS</span><b>${Math.round(w.metrics.tss)}</b></div>
      <div><span class="k">IF</span><b>${w.metrics.IF.toFixed(2)}</b></div>
      <div><span class="k">NP</span><b>${Math.round(w.metrics.np * ftp)} W</b></div>
    </div>
    <div class="pv-diagram">${profileSVG(w.profile, { h: 200, cls: 'big', ftp, key })}</div>
    <div class="seg-info" id="seg-info">${segInfo(w, key)}</div>
    <div>
      <div class="zones-bar" aria-label="Time in zone">${parts.map(([id]) => `<i style="flex:${zs[id] / total};background:var(--${id})"></i>`).join('')}</div>
      <div class="zones-legend" style="margin-top:8px">${parts.map(([id, short, name]) => `<span><i style="background:var(--${id})"></i>${short ? `${short} ` : ''}${name} <b>${Math.round(zs[id] / 60)} min</b></span>`).join('')}</div>
    </div>
    <p class="pv-desc">${esc(w.description)}</p>
    <p class="small muted">File: <code>${esc(w.file)}</code></p>
    <div class="modal-actions">
      ${isPlan ? '<button type="button" class="btn ghost left" data-act="reroll">Swap for another</button>' : ''}
      <button type="button" class="btn" data-act="${isPlan ? 'dl-ictx' : 'dl-ictx-opt'}" data-i="${modalState.i ?? ''}">${ictxLabel()}</button>
      <button type="button" class="btn primary" data-act="${isPlan ? 'dl-one' : 'dl-opt'}" data-i="${modalState.i ?? ''}">${DL_ICON}${zwoLabel()}</button>
    </div>`;
  if (!dlg.open) dlg.showModal();
}

function openModal(spec) {
  const [kind, rest] = spec.split(':');
  if (kind === 'plan') { const [wi, si] = rest.split(',').map(Number); modalState = { kind, wi, si }; } else modalState = { kind, i: +rest };
  selSeg = null;
  renderModal();
  renderResult();
}
function closeModal() {
  modalState = null;
  selSeg = null;
  if ($('#modal').open) $('#modal').close();
  renderResult();
}

// ---------------------------------------------------------------- render
function renderResult() {
  if (steps()[step] !== 'Result' || !result) return;
  $('#result').innerHTML = result.kind === 'plan' ? resultPlan() : resultSingle();
}

function render() {
  const names = steps();
  const isResult = names[step] === 'Result';
  $('#steps').innerHTML = names.map((n, i) => {
    const cls = i === step ? 'on' : i < step || (result && i <= names.length - 1) ? 'done' : '';
    return `<button type="button" class="${cls}" data-goto="${i}" ${i > step && !result ? 'disabled' : ''} aria-current="${i === step ? 'step' : 'false'}"><span class="n">${i < step ? '✓' : i + 1}</span><span class="lbl">${n}</span></button>`;
  }).join('');
  $('#wizard').hidden = isResult;
  $('#result').hidden = !isResult;
  if (isResult) { renderResult(); return; }
  const n = names[step];
  let body;
  if (n === 'Mode') body = stepMode();
  else if (n === 'Rider') body = stepRider();
  else if (n === 'Goal' || n === 'Workout') body = stepGoal();
  else if (n === 'Week') body = stepWeek();
  else body = stepStyle();
  $('#stage').innerHTML = body + stepActions();
  $('#side').innerHTML = sideHTML();
}

/** Refresh only the summary and the Next button (while typing or dragging). */
function refreshLight() {
  $('#side').innerHTML = sideHTML();
  const invalid = validate();
  const next = $('[data-act="next"]');
  if (next) next.disabled = !!invalid;
  const why = $('.step-actions .why');
  if (why) why.textContent = invalid;
}

function validate() {
  const n = steps()[step];
  if (n === 'Rider') {
    if (!(+S.ftp >= 80 && +S.ftp <= 600)) return 'Enter an FTP between 80 and 600 W.';
    if (!(+S.weight >= 35 && +S.weight <= 160)) return 'Enter a weight between 35 and 160 kg.';
  }
  if (n === 'Goal' && S.mode === 'plan' && S.lengthBy === 'event' && !S.eventDate) return 'Pick your event date, or choose a number of weeks.';
  if (n === 'Goal' && S.mode === 'plan' && S.lengthBy === 'event' && weeksUntil(S.eventDate) < 1) return 'The event date must be in the future.';
  if (n === 'Week') {
    const on = S.days.filter((d) => d.on);
    if (!on.length) return 'Pick at least one day.';
    if (!on.some((d) => !d.outdoor)) return 'At least one ride must be indoors to create workouts.';
  }
  return '';
}

function goNext() {
  if (validate()) return;
  const names = steps();
  if (names[step + 1] === 'Result') {
    const btn = $('[data-act="next"]');
    if (btn) { btn.textContent = 'Building…'; btn.disabled = true; }
    setTimeout(() => { seedSalt = 0; dataReady.then(() => { generate(); step++; render(); window.scrollTo({ top: 0 }); }); }, 20);
    return;
  }
  step++; render(); window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------- events
document.addEventListener('click', (e) => {
  const pop = $('#popover');
  if (!pop.hidden && !e.target.closest('#popover') && !e.target.closest('#btn-settings')) closePopover();
  const opener = e.target.closest('[data-open]');
  if (opener && !e.target.closest('button')) { openModal(opener.dataset.open); return; }
  const t = e.target.closest('button');
  if (!t) return;
  if (t.id === 'btn-settings') { openSettings(t); return; }
  if (t.dataset.themeSet) {
    theme = t.dataset.themeSet;
    try { localStorage.setItem('zwo-builder-theme', theme); } catch { /* ignore */ }
    applyTheme();
    $('#theme-ctl').querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b.dataset.themeSet === theme); b.setAttribute('aria-pressed', b.dataset.themeSet === theme); });
    return;
  }
  if (t.dataset.dayToggle != null) { const d = S.days[+t.dataset.dayToggle]; d.on = !d.on; saveState(); render(); return; }
  if (t.dataset.dayStep != null) {
    const d = S.days[+t.dataset.dayStep];
    d.minutes = Math.max(30, Math.min(300, +d.minutes + +t.dataset.delta)); saveState(); render(); return;
  }
  if (t.dataset.dayOut != null) { const d = S.days[+t.dataset.dayOut]; d.outdoor = !d.outdoor; saveState(); render(); return; }
  if (t.dataset.set) {
    const v = t.dataset.val;
    S[t.dataset.set] = t.dataset.set === 'years' ? +v : v;
    if (t.dataset.set === 'mode') result = null;
    saveState(); render(); return;
  }
  if (t.dataset.toggle) {
    const arr = S[t.dataset.toggle];
    const i = arr.indexOf(t.dataset.val);
    if (i >= 0) arr.splice(i, 1); else arr.push(t.dataset.val);
    saveState(); render(); return;
  }
  if (t.dataset.goto) {
    const i = +t.dataset.goto;
    if (steps()[i] === 'Result' && !result) return;
    step = i; render(); window.scrollTo({ top: 0 }); return;
  }
  const cur = () => result.plan.weeks[modalState.wi].sessions[modalState.si].workout;
  switch (t.dataset.act) {
    case 'next': goNext(); break;
    case 'back': if (step > 0) { step--; render(); window.scrollTo({ top: 0 }); } break;
    case 'close': closeModal(); break;
    case 'edit': step = steps().length - 2; render(); window.scrollTo({ top: 0 }); break;
    case 'shuffle': seedSalt++; generate(); render(); toast(S.mode === 'plan' ? 'New workouts, same structure.' : 'Three new options.'); break;
    case 'dl-plan': downloadPlan(result.plan); break;
    case 'dl-all': downloadOptions(result.options); break;
    case 'dl-opt': downloadWorkout(result.options[+t.dataset.i]); break;
    case 'dl-ictx-opt': downloadIctx(result.options[+t.dataset.i], ''); break;
    case 'dl-one': downloadWorkout(cur()); break;
    case 'dl-ictx': downloadIctx(cur(), result.plan.slug); break;
    case 'reroll': {
      rerolls++;
      const w = rerollSession(result.plan, modalState.wi, modalState.si, ctx, result.input, rerolls);
      selSeg = null;
      renderModal();
      renderResult();
      if (w) toast(`Swapped for ${w.name}`);
      break;
    }
    default: break;
  }
});

// rows and option cards open with Enter / Space
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-open]')) { e.preventDefault(); openModal(e.target.dataset.open); }
  if (e.key === 'Escape' && !$('#popover').hidden) closePopover();
});
$('#modal').addEventListener('close', () => { if (modalState) { modalState = null; selSeg = null; renderResult(); } });
$('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) closeModal(); });

// segment hover / tap in the dialog: update the outline and the info line only
function pickSegment(t) {
  const seg = +t.dataset.seg;
  if (selSeg && selSeg.workoutKey === t.dataset.key && selSeg.segIndex === seg) return;
  selSeg = { workoutKey: t.dataset.key, segIndex: seg };
  const svg = t.closest('svg');
  svg.querySelectorAll('.seg-click').forEach((p) => {
    const on = +p.dataset.seg === seg;
    if (on) { p.setAttribute('stroke', 'var(--accent)'); p.setAttribute('stroke-width', '2.5'); p.setAttribute('vector-effect', 'non-scaling-stroke'); } else p.removeAttribute('stroke');
  });
  const m = modalWorkout();
  if (m) $('#seg-info').innerHTML = segInfo(m.w, m.key);
}
document.addEventListener('mousemove', (e) => { const t = e.target.closest?.('.seg-click'); if (t) pickSegment(t); });
document.addEventListener('click', (e) => { const t = e.target.closest?.('.seg-click'); if (t) pickSegment(t); });

document.addEventListener('input', (e) => {
  const t = e.target;
  if (!t.dataset.num) return;
  S[t.dataset.num] = t.type === 'range' ? +t.value : t.value;
  const out = t.parentElement.querySelector('output');
  if (out) {
    const k = t.dataset.num;
    out.textContent = k === 'hours' ? `${t.value} h` : k === 'durMin' ? fmtDur(+t.value) : k === 'weeks' ? `${t.value} weeks` : k === 'intensity' ? INTENS[t.value - 1] : t.value;
  }
  saveState();
  refreshLight();
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.num) { S[t.dataset.num] = +t.value; saveState(); render(); }
  else if (t.dataset.str) { S[t.dataset.str] = t.value; saveState(); render(); }
  else if (t.dataset.bool) { S[t.dataset.bool] = t.checked; saveState(); render(); }
});

// Logo: back to the start (mode selection). Answers and the last result are kept.
$('#home').addEventListener('click', (e) => {
  e.preventDefault();
  step = 0;
  closeModal();
  render();
  window.scrollTo({ top: 0 });
});

applyTheme();
dataReady.then(() => { render(); });
