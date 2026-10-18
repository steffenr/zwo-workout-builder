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
const ZONE_OF = { recovery: 'z1', endurance: 'z2', tempo: 'z3', sweetspot: 'z4', threshold: 'z4', vo2max: 'z5', anaerobic: 'z6', sprint: 'z7', test: 'z1' };
const zoneVar = (p) => (p == null ? 'free' : p < 0.56 ? 'z1' : p < 0.76 ? 'z2' : p < 0.91 ? 'z3' : p < 1.06 ? 'z4' : p < 1.21 ? 'z5' : p < 1.51 ? 'z6' : 'z7');

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
let openCell = null;
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

function profileSVG(profile, h, cls, ftp, selSeg, selKey, onSelect) {
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
    const zVar = p0 == null ? 'free' : zoneVar((a + b) / 2);
    const fill = `var(--${zVar})`;
    const sel = selSeg && selSeg.workoutKey === selKey && selSeg.segIndex === i;
    const stroke = sel ? 'var(--accent)' : 'none';
    const strokeWidth = sel ? 2 : 0;
    if (onSelect) {
      shapes += `<path data-seg="${i}" data-key="${selKey}" d="M${x.toFixed(1)} ${h}L${x.toFixed(1)} ${y0.toFixed(1)}L${(x + w).toFixed(1)} ${y1.toFixed(1)}L${(x + w).toFixed(1)} ${h}Z" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" class="seg-click"/>`;
    } else {
      shapes += `<path d="M${x.toFixed(1)} ${h}L${x.toFixed(1)} ${y0.toFixed(1)}L${(x + w).toFixed(1)} ${y1.toFixed(1)}L${(x + w).toFixed(1)} ${h}Z" fill="${fill}"/>`;
    }
    x += w;
  });
  const ftpY = h - (1 / top) * h;
  const svg = `<svg class="${cls}" viewBox="0 0 1000 ${h}" preserveAspectRatio="none" role="img" aria-label="Power profile">` + (onSelect ? '' : `<line x1="0" x2="1000" y1="${ftpY}" y2="${ftpY}" stroke="var(--muted)" stroke-dasharray="6 6" vector-effect="non-scaling-stroke" opacity=".7"/>`) + `${shapes}</svg>`;
  if (!ftp) return svg;
  const ticks = [0.5, 1, 1.5, 2].filter((p) => p < top).map((p) => `<span class="tick num" style="bottom:${(p / top) * 100}%">${Math.round(p * ftp)} W</span>`).join('');
  return `<div class="axis">${ticks}</div>${svg}`;
}

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
  openCell = null;
  if (S.mode === 'plan') result = { kind: 'plan', plan: buildPlan(input, ctx), input };
  else result = { kind: 'single', options: buildSingle(input, ctx), input };
}

// ---------------------------------------------------------------- theme
const THEME_ICONS = {
  system: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2.5" y="3.5" width="15" height="10" rx="1.5"/><path d="M7 17h6M10 13.5V17"/></svg>',
  light: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10" cy="10" r="3.5"/><path d="M10 1.8v2M10 16.2v2M1.8 10h2M16.2 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M16.5 12.3A7 7 0 0 1 7.7 3.5a7 7 0 1 0 8.8 8.8z"/></svg>',
};
let theme = 'system';
try { theme = localStorage.getItem('zwo-builder-theme') || 'system'; } catch { /* ignore */ }
function applyTheme() {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  $('#theme').innerHTML = ['system', 'light', 'dark'].map((t) => `<button type="button" data-theme-set="${t}" aria-pressed="${theme === t}" title="${{ system: 'Match system', light: 'Light', dark: 'Dark' }[t]}" aria-label="${{ system: 'Match system theme', light: 'Light theme', dark: 'Dark theme' }[t]}">${THEME_ICONS[t]}</button>`).join('');
}

// ---------------------------------------------------------------- small visuals
const GOAL_NOTES = {
  fitness: 'Feel fitter, ride stronger overall',
  ftp: 'Push your one-hour power up',
  fondo: 'Long days, steady power, fuel well',
  climbing: 'Sustained power on long climbs',
  racing: 'Repeated surges, attacks, sprints',
  tt: 'Hold the limit alone, aero and steady',
  triathlon: 'Strong bike leg, fresh for the run',
  gravel: 'Long efforts plus punchy terrain',
  maintain: 'Keep what you have with less time',
};
/** Distribution of key-session types across the goal's phases, drawn as zone colours. */
function goalMix(key) {
  const g = GOALS[key];
  const count = {};
  for (const ph of Object.values(g.phases)) ph.forEach((c, i) => { count[c] = (count[c] || 0) + (3 - Math.min(i, 2)); });
  const order = ['tempo', 'sweetspot', 'threshold', 'vo2max', 'anaerobic', 'sprint'];
  return `<span class="zmix" aria-hidden="true">${order.filter((c) => count[c]).map((c) => `<i style="flex:${count[c]};background:var(--${ZONE_OF[c]})"></i>`).join('')}</span>`;
}
const STYLE_MIX = { pyramidal: [75, 20, 5], polarized: [80, 5, 15], sweetspot: [60, 35, 5] };
function styleMix(k) {
  const m = STYLE_MIX[k];
  if (!m) return '<span class="zmix" aria-hidden="true"><i style="flex:1;background:repeating-linear-gradient(90deg,var(--line) 0 6px,transparent 6px 10px)"></i></span>';
  return `<span class="zmix" aria-hidden="true"><i style="flex:${m[0]};background:var(--z2)"></i><i style="flex:${m[1]};background:var(--z4)"></i><i style="flex:${m[2]};background:var(--z6)"></i></span>`;
}
function artPlan() {
  const h = [40, 46, 52, 26, 50, 56, 62, 30];
  return `<svg class="art" viewBox="0 0 200 64" preserveAspectRatio="none" aria-hidden="true">${h.map((v, i) => `<rect x="${i * 25 + 2}" y="${64 - v}" width="20" height="${v}" rx="3" fill="var(--${i === 3 || i === 7 ? 'z3' : 'z2'})"/>`).join('')}</svg>`;
}
function artSingle() {
  return `<svg class="art" viewBox="0 0 200 64" preserveAspectRatio="none" aria-hidden="true"><path d="M0 64L0 48L30 34L30 64Z" fill="var(--z1)"/>${[0, 1, 2, 3, 4].map((i) => `<rect x="${36 + i * 28}" y="14" width="16" height="50" fill="var(--z5)"/><rect x="${52 + i * 28}" y="44" width="12" height="20" fill="var(--z1)"/>`).join('')}<path d="M176 64L176 40L200 52L200 64Z" fill="var(--z1)"/></svg>`;
}
const rangeStyle = (v, min, max) => `style="--p:${((v - min) / (max - min)) * 100}%"`;

// ---------------------------------------------------------------- steps
const STEPS_PLAN = ['Mode', 'Rider', 'Goal', 'Week', 'Style', 'Result'];
const STEPS_SINGLE = ['Mode', 'Rider', 'Workout', 'Style', 'Result'];
const steps = () => (S.mode === 'plan' ? STEPS_PLAN : STEPS_SINGLE);
const STEP_ZONE = ['z1', 'z2', 'z3', 'z4', 'z5', 'z6'];
const INTENS = ['Gentle', 'Easy-going', 'Balanced', 'Ambitious', 'Aggressive'];

function stepMode() {
  const card = (val, title, text, art) => `
    <button type="button" class="choice hero ${S.mode === val ? 'on' : ''}" data-set="mode" data-val="${val}" aria-pressed="${S.mode === val}">
      ${art}<strong>${title}</strong><span class="sub">${text}</span></button>`;
  return `<div class="q"><div class="eyebrow">Let's get started</div><h2>What should I build?</h2></div>
    <div class="grid2">
      ${card('plan', 'Training plan', 'Several weeks with build and recovery weeks, ending in a ZIP of all workouts in plan order.', artPlan())}
      ${card('single', 'Single workout', 'One session for today. Pick a type and length, then choose from three options.', artSingle())}
    </div>`;
}

function stepRider() {
  const ath = athleteModel({ ftp: +S.ftp, weight: +S.weight, hours: +S.hours, years: +S.years, intensity: +S.intensity });
  const yrs = ['New', 'Under 1 year', '1–3 years', '3+ years'];
  return `<div class="q"><div class="eyebrow">Rider profile</div><h2>About you</h2></div>
    <div class="fields">
      <label for="ftp"><span class="lab">FTP</span><span class="big-in"><input id="ftp" type="number" inputmode="numeric" min="80" max="600" step="1" value="${S.ftp}" data-num="ftp"><em>W</em></span></label>
      <label for="weight"><span class="lab">Weight</span><span class="big-in"><input id="weight" type="number" inputmode="decimal" min="35" max="160" step="0.5" value="${S.weight}" data-num="weight"><em>kg</em></span></label>
      <label for="hours" class="wide"><span class="lab">Riding per week, last 4–6 weeks</span>
        <span class="range-row"><input id="hours" type="range" min="0" max="16" step="0.5" value="${S.hours}" data-num="hours" ${rangeStyle(S.hours, 0, 16)}><output>${S.hours} h</output></span></label>
      <fieldset class="wide"><legend>Structured training experience</legend>
        <div class="seg">${yrs.map((y, i) => `<button type="button" class="${+S.years === i ? 'on' : ''}" data-set="years" data-val="${i}" aria-pressed="${+S.years === i}">${y}</button>`).join('')}</div>
      </fieldset>
    </div>
    <div class="readout">
      <div><b class="num">${ath.wkg.toFixed(2)}</b><span>W/kg</span></div>
      <div><b class="txt">${ath.levelLabel}</b><span>Status</span></div>
      <div><b class="num">${ath.startTss}</b><span>TSS / week now</span></div>
    </div>
    <p class="hint">TSS (Training Stress Score) measures load: one hour flat out at FTP is 100 TSS. Your current weekly load is where the plan starts.</p>`;
}

function goalCards() {
  return Object.entries(GOALS).map(([k, g]) => `<button type="button" class="choice ${S.goal === k ? 'on' : ''}" data-set="goal" data-val="${k}" aria-pressed="${S.goal === k}"><strong>${g.label}</strong><span class="sub">${GOAL_NOTES[k]}</span>${goalMix(k)}</button>`).join('');
}

function stepGoal() {
  if (S.mode === 'single') {
    const types = ['auto', 'recovery', 'endurance', 'tempo', 'sweetspot', 'threshold', 'vo2max', 'anaerobic', 'sprint'];
    return `<div class="q"><div class="eyebrow">Session</div><h2>Which workout?</h2></div>
      <fieldset><legend>Type</legend><div class="chips">${types.map((t) => `<button type="button" class="chip-btn ${S.category === t ? 'on' : ''}" data-set="category" data-val="${t}" aria-pressed="${S.category === t}" style="--c:var(--${t === 'auto' ? 'accent' : ZONE_OF[t]})">${t === 'auto' ? 'Pick for me' : CATEGORY_INFO[t].label}</button>`).join('')}</div>
      <p class="hint">${S.category !== 'auto' ? esc(CATEGORY_INFO[S.category].purpose) : 'Uses your goal and weak spots to suggest three different sessions.'}</p></fieldset>
      <label for="durMin"><span class="lab">Length</span><span class="range-row"><input id="durMin" type="range" min="30" max="180" step="5" value="${S.durMin}" data-num="durMin" ${rangeStyle(S.durMin, 30, 180)}><output>${fmtMin(+S.durMin)}</output></span></label>
      ${S.category === 'auto' ? `<fieldset><legend>Your goal</legend><div class="grid3">${goalCards()}</div></fieldset>` : ''}`;
  }
  const wk = weeksUntil(S.eventDate);
  return `<div class="q"><div class="eyebrow">Target</div><h2>Your goal</h2><p class="lede">The coloured bar shows which intensities the plan's key sessions focus on.</p></div>
    <div class="grid3">${goalCards()}</div>
    <fieldset><legend>Plan length</legend>
      <div class="seg"><button type="button" class="${S.lengthBy === 'weeks' ? 'on' : ''}" data-set="lengthBy" data-val="weeks" aria-pressed="${S.lengthBy === 'weeks'}">Number of weeks</button><button type="button" class="${S.lengthBy === 'event' ? 'on' : ''}" data-set="lengthBy" data-val="event" aria-pressed="${S.lengthBy === 'event'}">Until an event</button></div>
      ${S.lengthBy === 'weeks'
    ? `<label for="weeks"><span class="range-row"><input id="weeks" type="range" min="4" max="16" step="1" value="${S.weeks}" data-num="weeks" aria-label="Weeks" ${rangeStyle(S.weeks, 4, 16)}><output>${S.weeks} wk</output></span></label>`
    : `<label for="eventDate" style="max-width:260px"><span class="lab">Event date</span><input id="eventDate" type="date" value="${esc(S.eventDate)}" data-str="eventDate"></label>
         <p class="hint">${wk == null ? 'The plan starts next Monday and ends with a taper week.' : wk < 4 ? `Only ${wk} week(s) away: the plan uses the 4-week minimum.` : `${Math.min(24, wk)} weeks, starting ${nextMonday().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ending with a taper week.`}</p>`}
    </fieldset>
    <label class="switch"><input type="checkbox" data-bool="includeTest" ${S.includeTest ? 'checked' : ''}><span class="knob"></span>FTP ramp test in week 1${S.lengthBy === 'weeks' ? ' and at the end' : ''}</label>`;
}

function stepWeek() {
  const tiles = S.days.map((d, i) => `
    <div class="day ${d.on ? 'on' : ''} ${d.on && d.outdoor ? 'out' : ''}">
      <button type="button" class="dtog" data-day-toggle="${i}" aria-pressed="${d.on}" aria-label="${DAY_NAMES[i]}: ${d.on ? 'riding' : 'rest'}"><b>${DAY_NAMES[i]}</b><small>${d.on ? (d.outdoor ? 'outdoor' : 'indoor') : 'rest'}</small></button>
      ${d.on ? `<div class="stepper"><button type="button" data-day-step="${i}" data-delta="-15" aria-label="Shorter">−</button><output>${fmtMin(+d.minutes)}</output><button type="button" data-day-step="${i}" data-delta="15" aria-label="Longer">+</button></div>
      <button type="button" class="outbtn" data-day-out="${i}" aria-pressed="${!!d.outdoor}">Outdoor</button>` : ''}
    </div>`).join('');
  const on = S.days.filter((d) => d.on);
  const total = on.reduce((a, d) => a + +d.minutes, 0);
  const now = +S.hours * 60;
  const scale = Math.max(total, now, 60) * 1.1;
  return `<div class="q"><div class="eyebrow">Schedule</div><h2>Your training week</h2>
      <p class="lede">Tap a day to ride or rest, set the time with − and +. Outdoor rides count towards your load but get no file.</p></div>
    <div class="days">${tiles}</div>
    <div class="volume">
      <div class="vbar" aria-hidden="true"><i style="width:${(total / scale) * 100}%"></i><u style="left:${(now / scale) * 100}%"></u></div>
      <div class="vlegend"><span><b class="num">${on.length}</b> rides · <b class="num">${fmtMin(total)}</b> available</span><span>marker: your current <b class="num">${S.hours} h</b></span></div>
      ${total / 60 > +S.hours * 1.6 + 2 ? '<p class="hint warn">A big jump from your current hours. The plan starts at your current load and builds up.</p>' : ''}
    </div>`;
}

function stepStyle() {
  const styles = Object.entries(STYLES).map(([k, st]) => `<button type="button" class="choice ${S.style === k ? 'on' : ''}" data-set="style" data-val="${k}" aria-pressed="${S.style === k}"><strong>${st.label}</strong><span class="sub">${st.note || 'Picks the style that suits your goal and available time.'}</span>${styleMix(k)}</button>`).join('');
  return `<div class="q"><div class="eyebrow">Preferences</div><h2>How you like to train</h2></div>
    ${S.mode === 'plan' ? `<fieldset><legend>Training style · easy / moderate / hard</legend><div class="grid2">${styles}</div></fieldset>` : ''}
    <label for="intensity"><span class="lab">Intensity</span><span class="range-row"><input id="intensity" type="range" min="1" max="5" step="1" value="${S.intensity}" data-num="intensity" ${rangeStyle(S.intensity, 1, 5)}><output class="txt">${INTENS[S.intensity - 1]}</output></span></label>
    <fieldset><legend>Rider type</legend><div class="chips">${Object.entries(RIDER_TYPES).map(([k, r]) => `<button type="button" class="chip-btn ${S.riderType === k ? 'on' : ''}" data-set="riderType" data-val="${k}" aria-pressed="${S.riderType === k}">${r.label}</button>`).join('')}</div></fieldset>
    <fieldset><legend>Weak spots to work on</legend><div class="chips">${Object.entries(WEAKNESSES).map(([k, wk]) => `<button type="button" class="chip-btn ${S.weaknesses.includes(k) ? 'on' : ''}" data-toggle="weaknesses" data-val="${k}" aria-pressed="${S.weaknesses.includes(k)}" style="--c:var(--${ZONE_OF[wk.category]})">${wk.label}</button>`).join('')}</div></fieldset>
    <label class="switch"><input type="checkbox" data-bool="cadence" ${S.cadence ? 'checked' : ''}><span class="knob"></span>Cadence drills in easy rides</label>
`;
}

/** Head-unit style summary of the answers so far. */
function unitHTML() {
  const ath = athleteModel({ ftp: +S.ftp, weight: +S.weight, hours: +S.hours, years: +S.years, intensity: +S.intensity });
  const on = S.days.filter((d) => d.on);
  const weeks = S.lengthBy === 'event' ? (weeksUntil(S.eventDate) ? Math.max(4, Math.min(24, weeksUntil(S.eventDate))) : '–') : S.weeks;
  const tiles = S.mode === 'plan'
    ? [[S.ftp, 'FTP W'], [ath.wkg.toFixed(2), 'W/kg'], [GOALS[S.goal].label, 'Goal', 'txt wide'], [weeks, 'Weeks'], [fmtMin(on.reduce((a, d) => a + +d.minutes, 0)), 'Per week'], [INTENS[S.intensity - 1], 'Intensity', 'txt wide']]
    : [[S.ftp, 'FTP W'], [ath.wkg.toFixed(2), 'W/kg'], [S.category === 'auto' ? 'Pick for me' : CATEGORY_INFO[S.category].label, 'Type', 'txt wide'], [fmtMin(+S.durMin), 'Length'], [INTENS[S.intensity - 1], 'Intensity', 'txt']];
  return `<div class="eyebrow">Your ride</div>
    <div class="tiles">${tiles.map(([v, l, c = '']) => `<div class="tile ${c.includes('wide') ? 'wide' : ''}"><b class="${c.includes('txt') ? 'txt' : ''}">${esc(v)}</b><span>${l}</span></div>`).join('')}</div>
    ${S.mode === 'plan' ? `<div class="weekstrip" aria-hidden="true">${S.days.map((d, i) => `<div class="${d.on ? (d.outdoor ? 'out' : 'on') : ''}">${DAY_NAMES[i][0]}</div>`).join('')}</div>` : ''}
    <p>${ath.levelLabel} · ${esc(RIDER_TYPES[S.riderType]?.label || '')}${S.weaknesses.length ? ` · works on ${S.weaknesses.map((w) => WEAKNESSES[w].label.toLowerCase()).join(', ')}` : ''}</p>`;
}

// ---------------------------------------------------------------- results
function chipFor(cat) { return `<span class="chip" style="--c:var(--${ZONE_OF[cat]})">${CATEGORY_INFO[cat].label}</span>`; }

const ZONE_TIP = { z1: 'Recovery', z2: 'Endurance', z3: 'Tempo', z4: 'Sweetspot/Threshold', z5: 'VO2max', z6: 'Anaerobic', z7: 'Neuromuscular', free: 'Free ride' };
const ZONE_LABELS = { z1: 'Z1', z2: 'Z2', z3: 'Z3', z4: 'Z4', z5: 'Z5', z6: 'Z6', z7: 'Z7', free: 'Free' };

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
function fmtDur(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m} min${s > 0 ? ` ${s}s` : ''}`;
  return `${s} s`;
}

function detailHTML(w, ftp, actions, workoutKey) {
  const zones = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6', 'Z7'];
  const m = (v, l) => `<span class="m"><b>${v}</b><span>${l}</span></span>`;
  // Use w.segs for full segment detail including cadence
  const segs = w.segs || w.profile.map(([dur, p0, p1]) => ({ dur, p0, p1, cad: null, free: p0 == null }));
  // Build segment detail for hover or click selection
  let segDetail = '';
  // Default: show first segment if none selected
  const segIdx = (selSeg && selSeg.workoutKey === workoutKey ? selSeg.segIndex : null);
  const targetIdx = segIdx != null ? segIdx : 0;
  if (segs[targetIdx]) {
    const seg = segs[targetIdx];
    const avg = seg.p0 != null ? (seg.p0 + seg.p1) / 2 : 0.55;
    const watts = Math.round(avg * ftp);
    const zoneAvg = zoneVar(avg);
    const cadLabel = seg.cad != null ? `${seg.cad} RPM` : 'Variable';
    segDetail = `<div class="seg-detail" style="--c:var(--${zoneAvg})">
      <div class="seg-detail-head">
        <span class="chip" style="--c:var(--${zoneAvg})">${ZONE_TIP[zoneAvg]}</span>
        <strong class="num">${seg.max ? 'MAX' : `${watts} W`}</strong>
      </div>
      <div class="seg-detail-grid">
        <div class="seg-dg"><b class="num">${seg.max ? 'All-out (ERG off)' : seg.p0 == null || seg.p1 == null ? '--' : seg.p0 !== seg.p1 ? `${Math.round(seg.p0 * 100)}% → ${Math.round(seg.p1 * 100)}%` : `${Math.round(avg * 100)}%`}</b><span>Power</span></div>
        <div class="seg-dg"><b class="num">${fmtDur(seg.dur)}</b><span>Duration</span></div>
        <div class="seg-dg"><b class="num">${cadLabel}</b><span>Cadence</span></div>
      </div>
    </div>`;
  }
  return `<div class="detail">
    <div class="detail-head">
      <div><h3>${esc(w.name)}</h3><div class="metrics">${chipFor(w.category)}${m(fmtMin(w.durMin), 'Time')}${m(Math.round(w.metrics.tss), 'TSS')}${m(w.metrics.IF.toFixed(2), 'IF')}${m(`${Math.round(w.metrics.np * ftp)} W`, 'NP')}</div></div>
      <div class="actions">${actions}</div>
    </div>
    <div class="big-wrap">${profileSVG(w.profile, 180, 'big', ftp, selSeg, workoutKey, true)}</div>
    ${segDetail}
    <div class="zonebar" aria-label="Time in zone">${zones.map((z, i) => `<div style="flex:${w.metrics.zoneSec[i]};background:var(--z${i + 1})" title="${z}: ${Math.round(w.metrics.zoneSec[i] / 60)} min"></div>`).join('')}${w.metrics.freeSec ? `<div style="flex:${w.metrics.freeSec};background:var(--free)}</div>` : ''}</div>
    <p class="desc">${esc(w.description)}</p>
    <p class="file">${esc(w.file)}</p>
  </div>`;
}

const DL_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11"/></svg>';
const dlLabel = () => `${DL_ICON}${zwoBlocked ? 'Download (.zip)' : 'Download .zwo'}`;
const PHASE_CLASS = (w) => (w.kind === 'recovery' ? 'ph-rec' : w.kind === 'taper' ? 'ph-taper' : `ph-${w.phase}`);

function resultPlan() {
  const { plan, input } = result;
  const maxT = Math.max(...plan.weeks.map((w) => Math.max(w.tss, w.targetTss)));
  const bars = plan.weeks.map((w) => `
    <div class="wbar ${w.kind}" title="Week ${w.week}: ${w.tss} TSS (target ${w.targetTss}), ${w.hours} h, ${phaseLabel(w)}">
      <div class="target" style="bottom:${(w.targetTss / maxT) * 100}%"></div>
      <div class="fill" style="height:${(w.tss / maxT) * 100}%"></div>
      <span class="val" style="bottom:${(Math.max(w.tss, w.targetTss) / maxT) * 100}%">${w.tss}</span>
    </div>`).join('');
  const phases = plan.weeks.map((w) => `<div class="${PHASE_CLASS(w)}">${w.week}</div>`).join('');
  const weeksHtml = plan.weeks.map((wk, wi) => {
    const cells = [];
    for (let d = 1; d <= 7; d++) {
      const si = wk.sessions.findIndex((s) => s.day === d);
      const s = wk.sessions[si];
      if (!s) { cells.push(`<div class="cell rest"><span class="dname">${DAY_NAMES[d - 1]}</span><span class="restlbl">Rest</span></div>`); continue; }
      if (s.outdoor) {
        cells.push(`<div class="cell outdoor"><span class="dname">${DAY_NAMES[d - 1]}</span><strong>Outdoor ride</strong><small class="num">${fmtMin(s.minutes)} · ≈${s.estTss} TSS</small></div>`);
        continue;
      }
      const w = s.workout;
      const isOpen = openCell && openCell[0] === wi && openCell[1] === si;
      cells.push(`<button type="button" class="cell ${isOpen ? 'open' : ''}" data-cell="${wi},${si}" style="--c:var(--${ZONE_OF[w.category]})" aria-expanded="${isOpen}">
        <span class="dname">${DAY_NAMES[d - 1]}</span><strong>${esc(w.name)}</strong>
        ${profileSVG(w.profile, 34, 'mini')}
        <small class="num">${fmtMin(w.durMin)} · ${Math.round(w.metrics.tss)} TSS</small></button>`);
    }
    let detail = '';
    if (openCell && openCell[0] === wi) {
      const w = wk.sessions[openCell[1]].workout;
      detail = detailHTML(w, input.ftp, `<button type="button" class="btn ghost" data-act="reroll">Swap for another</button><button type="button" class="btn" data-act="dl-one">${dlLabel()}</button><button type="button" class="btn ghost" data-act="dl-ictx">Download .ictx</button>`, `plan:${wi},${openCell[1]}`);
    }
    return `<section class="week ${wk.kind}">
      <header><h3>Week ${wk.week}</h3><span class="pill ${PHASE_CLASS(wk)}">${phaseLabel(wk)}</span>${wk.cappedByTime && wk.kind === 'load' ? '<span class="capped" title="Your available time limits the load this week">time-limited</span>' : ''}<span class="num wk-stats">${wk.hours} h · ${wk.tss} TSS</span></header>
      <div class="cal">${cells.join('')}</div>${detail}</section>`;
  }).join('');
  const a = plan.athlete;
  const avg = Math.round(plan.totals.tss / plan.weeks.length);
  return `<div class="dash">
    <div class="res-head">
      <div><div class="eyebrow">Your training plan</div><h2>${esc(plan.name)}</h2>
      <p class="meta">${esc(plan.goal)} · ${esc(STYLES[plan.style]?.label || plan.style)} · ${a.levelLabel}, ${a.wkg.toFixed(2)} W/kg</p></div>
      <div class="actions"><button type="button" class="btn ghost" data-act="edit">Change answers</button><button type="button" class="btn ghost" data-act="shuffle">Shuffle workouts</button><button type="button" class="btn primary" data-act="dl-plan">${DL_ICON}Download plan (.zip)</button></div>
    </div>
    <div class="stats">
      <div><b>${plan.weeks.length}</b><span>Weeks</span></div>
      <div><b>${plan.totals.workouts}</b><span>Workouts</span></div>
      <div><b>${plan.totals.hours}</b><span>Hours</span></div>
      <div><b>${plan.totals.tss.toLocaleString()}</b><span>Total TSS</span></div>
      <div><b>${avg}</b><span>TSS / week</span></div>
    </div>
    <div class="panel" aria-label="Weekly load">
      <div class="lc-head"><span class="eyebrow">Weekly load (TSS)</span><span class="legend"><i class="lg load"></i>build <i class="lg recovery"></i>recovery <i class="lg taper"></i>taper <i class="lg tgt"></i>target</span></div>
      <div class="wbars">${bars}</div>
      <div class="phases">${phases}</div>
      <div class="legend" style="margin-top:8px"><i class="lg" style="background:var(--z2)"></i>base <i class="lg" style="background:var(--z4)"></i>build <i class="lg" style="background:var(--z6)"></i>peak</div>
    </div>
    <p class="hint">Select a session for its details. The ZIP holds one folder with every workout in .zwo and .ictx (icTrainer) named Week/Day in plan order, plus an overview. Copy the .zwo files into Zwift's Workouts folder, or import the .ictx files into icTrainer.</p>
    ${weeksHtml}</div>`;
}

function resultSingle() {
  const { options, input } = result;
  return `<div class="dash">
    <div class="res-head">
      <div><div class="eyebrow">Single workout</div><h2>${options.length} options for ${fmtMin(input.durMin)}</h2></div>
      <div class="actions"><button type="button" class="btn ghost" data-act="edit">Change answers</button><button type="button" class="btn ghost" data-act="shuffle">More options</button><button type="button" class="btn primary" data-act="dl-all">${DL_ICON}Download all (.zip)</button></div>
    </div>
    <div class="options">${options.map((w, i) => `<article class="opt"><div class="optno">Option ${i + 1}</div>${detailHTML(w, input.ftp, `<button type="button" class="btn" data-act="dl-opt" data-i="${i}">${dlLabel()}</button><button type="button" class="btn ghost" data-act="dl-ictx-opt" data-i="${i}">Download .ictx</button>`, `single:${i}`)}</article>`).join('')}</div></div>`;
}

// ---------------------------------------------------------------- render
function render() {
  const names = steps();
  const isResult = names[step] === 'Result';
  $('#rail').innerHTML = names.map((n, i) => `<li class="${i === step ? 'cur' : i < step ? 'done' : ''}"><button type="button" data-goto="${i}" ${i > step && !result ? 'disabled' : ''} aria-current="${i === step ? 'step' : 'false'}" style="--zc:var(--${STEP_ZONE[i]})"><span class="bar"></span><span class="lbl">${i + 1} · ${n}</span></button></li>`).join('');
  $('#railcap').innerHTML = `Step <b>${step + 1}</b> of ${names.length} · <b>${names[step]}</b>`;
  let body;
  const n = names[step];
  if (n === 'Mode') body = stepMode();
  else if (n === 'Rider') body = stepRider();
  else if (n === 'Goal' || n === 'Workout') body = stepGoal();
  else if (n === 'Week') body = stepWeek();
  else if (n === 'Style') body = stepStyle();
  else body = result?.kind === 'plan' ? resultPlan() : resultSingle();
  $('#stage').innerHTML = body;
  $('#stage').classList.toggle('result', isResult);
  $('#work').classList.toggle('full', isResult);
  $('#unit').hidden = isResult;
  if (!isResult) $('#unit').innerHTML = unitHTML();
  $('#nav').hidden = isResult;
  $('#back').disabled = step === 0;
  const nextIsResult = names[step + 1] === 'Result';
  $('#next').textContent = nextIsResult ? (S.mode === 'plan' ? 'Build my plan' : 'Build workouts') : 'Next';
  const invalid = validate();
  $('#next').disabled = !!invalid;
  $('#why').textContent = invalid || '';
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

// ---------------------------------------------------------------- events
document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.themeSet) {
    theme = t.dataset.themeSet;
    try { localStorage.setItem('zwo-builder-theme', theme); } catch { /* ignore */ }
    applyTheme(); return;
  }
  if (t.dataset.dayToggle != null) {
    const d = S.days[+t.dataset.dayToggle]; d.on = !d.on; saveState(); render(); return;
  }
  if (t.dataset.dayStep != null) {
    const d = S.days[+t.dataset.dayStep];
    d.minutes = Math.max(30, Math.min(300, +d.minutes + +t.dataset.delta)); saveState(); render(); return;
  }
  if (t.dataset.dayOut != null) {
    const d = S.days[+t.dataset.dayOut]; d.outdoor = !d.outdoor; saveState(); render(); return;
  }
  if (t.dataset.set) {
    const v = t.dataset.val;
    S[t.dataset.set] = /^\d+$/.test(v) && t.dataset.set === 'years' ? +v : v;
    if (t.dataset.set === 'mode') { result = null; }
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
  if (t.dataset.cell) {
    const [wi, si] = t.dataset.cell.split(',').map(Number);
    openCell = openCell && openCell[0] === wi && openCell[1] === si ? null : [wi, si];
    render();
    if (openCell) $('.detail')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return;
  }
  switch (t.dataset.act) {
    case 'edit': step = steps().length - 2; render(); window.scrollTo({ top: 0 }); break;
    case 'shuffle': seedSalt++; generate(); render(); toast(S.mode === 'plan' ? 'New workouts, same structure.' : 'Three new options.'); break;
    case 'dl-plan': downloadPlan(result.plan); break;
    case 'dl-all': downloadOptions(result.options); break;
    case 'dl-opt': downloadWorkout(result.options[+t.dataset.i]); break;
    case 'dl-one': downloadWorkout(result.plan.weeks[openCell[0]].sessions[openCell[1]].workout); break;
    case 'dl-ictx': downloadIctx(result.plan.weeks[openCell[0]].sessions[openCell[1]].workout, result.plan.slug); break;
    case 'dl-ictx-opt': downloadIctx(result.options[+t.dataset.i], ''); break;
    case 'reroll': {
      rerolls++;
      const w = rerollSession(result.plan, openCell[0], openCell[1], ctx, result.input, rerolls);
      render();
      if (w) toast(`Swapped for ${w.name}`);
      break;
    }
    default: break;
  }
});

// Hover/click handler for segment selection (SVG paths)
document.addEventListener('mousemove', (e) => {
  const t = e.target.closest('.seg-click');
  if (!t || !t.dataset.seg || !t.dataset.key) return;
  const key = t.dataset.key;
  if (selSeg && selSeg.workoutKey === key && selSeg.segIndex === +t.dataset.seg) return;
  selSeg = { workoutKey: key, segIndex: +t.dataset.seg };
  // Only re-render the detail area, not the whole page
  const detail = document.querySelector('.detail');
  if (detail) {
    // Find the parent workout context to rebuild just the detail
    const workoutKey = key;
    // We need to re-render to update the detail panel
    // Since we have the workout data in the result, let's just update selSeg and re-render
    selSeg = { workoutKey: key, segIndex: +t.dataset.seg };
    render();
  }
});

// Click handler to toggle selection on segments (for persistent selection)
document.addEventListener('click', (e) => {
  const t = e.target.closest('.seg-click');
  if (!t || !t.dataset.seg || !t.dataset.key) return;
  const key = t.dataset.key;
  if (selSeg && selSeg.workoutKey === key && selSeg.segIndex === +t.dataset.seg) {
    // Already selected - keep it selected
  } else {
    selSeg = { workoutKey: key, segIndex: +t.dataset.seg };
  }
  render();
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.num) {
    S[t.dataset.num] = t.type === 'range' ? +t.value : t.value;
    if (t.type === 'range') t.style.setProperty('--p', `${((t.value - t.min) / (t.max - t.min)) * 100}%`);
    const out = t.parentElement.querySelector('output');
    if (out) {
      const k = t.dataset.num;
      out.textContent = k === 'hours' ? `${t.value} h` : k === 'durMin' ? fmtMin(+t.value) : k === 'weeks' ? `${t.value} wk` : k === 'intensity' ? INTENS[t.value - 1] : t.value;
    }
    saveState();
    $('#unit').innerHTML = unitHTML();
    if (t.type !== 'range') { const inv = validate(); $('#next').disabled = !!inv; $('#why').textContent = inv; }
  }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.num) { S[t.dataset.num] = +t.value; saveState(); render(); }
  else if (t.dataset.str) { S[t.dataset.str] = t.value; saveState(); render(); }
  else if (t.dataset.bool) { S[t.dataset.bool] = t.checked; saveState(); render(); }
  else if (t.dataset.day != null) {
    const d = S.days[+t.dataset.day];
    const f = t.dataset.field;
    d[f] = t.type === 'checkbox' ? t.checked : +t.value;
    saveState(); render();
  }
});

// Logo: back to the start (mode selection). Answers and the last result are kept.
$('#home').addEventListener('click', (e) => {
  e.preventDefault();
  step = 0;
  openCell = null;
  selSeg = null;
  render();
  window.scrollTo({ top: 0 });
});

$('#back').addEventListener('click', () => { if (step > 0) { step--; render(); window.scrollTo({ top: 0 }); } });
$('#next').addEventListener('click', () => {
  if (validate()) return;
  const names = steps();
  if (names[step + 1] === 'Result') {
    $('#next').textContent = 'Building…';
    setTimeout(() => { seedSalt = 0; dataReady.then(() => { generate(); step++; render(); window.scrollTo({ top: 0 }); }); }, 20);
    return;
  }
  step++; render(); window.scrollTo({ top: 0 });
});

applyTheme();
dataReady.then(() => {
  render();
});
