// ictx.js — workout blocks -> icTrainer .ictx (ratio exercise).
// Mapping logic ported from whats-on-zwift/src/core/ictx.ts, kept dependency-free.

const LEVEL_XS = 55;
const LEVEL_S = 80;
const LEVEL_L = 106;
const COOLDOWN_RATIO = 55; // legs below this % FTP count as recovery
const FREERIDE_RATIO = 80; // icTrainer's default ratio for power-less free segments
const MAX_EFFORT = { sprint: 200, long: 150 }; // % FTP, mirrors MAX_EFFORT_ASSUMED_POWER in zwo.js

const level = (r) => (r < LEVEL_XS ? 'XS' : r < LEVEL_S ? 'S' : r < LEVEL_L ? 'L' : 'XL');
const ratio = (power) => Math.round(power * 100);
const midRatio = (leg) => (leg.ratioEnd === undefined ? leg.ratio : Math.round((leg.ratio + leg.ratioEnd) / 2));
const legEquals = (a, b) => a.duration === b.duration && a.ratio === b.ratio
  && (a.ratioEnd ?? null) === (b.ratioEnd ?? null) && a.rpm === b.rpm && a.comment === b.comment
  && (a.resistance ?? null) === (b.resistance ?? null);
const legsEqual = (xs, ys) => xs.length === ys.length && xs.every((x, i) => legEquals(x, ys[i]));

// Greedy leftmost pattern collapse: shortest prefix that repeats >= 2x, then count all repeats.
function splitRuns(legs) {
  const result = [];
  let i = 0;
  const n = legs.length;
  while (i < n) {
    let patternLen = -1;
    for (let size = 1; size <= Math.floor((n - i) / 2); size++) {
      if (legsEqual(legs.slice(i, i + size), legs.slice(i + size, i + 2 * size))) { patternLen = size; break; }
    }
    if (patternLen === -1) { result.push([legs.slice(i), 1]); break; }
    const pattern = legs.slice(i, i + patternLen);
    let loops = 1;
    while (i + (loops + 1) * patternLen <= n && legsEqual(pattern, legs.slice(i + loops * patternLen, i + (loops + 1) * patternLen))) loops++;
    result.push([pattern, loops]);
    i += loops * patternLen;
  }
  return result;
}

// Leading warmup blocks -> "WarmUp"; trailing sub-55 % steadies -> "CoolDown"
// (only when real work exists); repeated leg patterns collapse into loops.
function buildSequences(units) {
  const n = units.length;
  let warmupEnd = 0;
  while (warmupEnd < n && units[warmupEnd].kind === 'warmup') warmupEnd++;
  const hasWork = units.some((u) => u.legs.some((leg) => midRatio(leg) >= COOLDOWN_RATIO));
  let cooldownStart = n;
  if (hasWork) {
    while (cooldownStart > warmupEnd + 1 && units[cooldownStart - 1].kind === 'steady'
      && units[cooldownStart - 1].legs.every((leg) => midRatio(leg) < COOLDOWN_RATIO)) cooldownStart--;
  }
  const sequences = [];
  if (warmupEnd > 0) for (const [pattern, loops] of splitRuns(units.slice(0, warmupEnd).flatMap((u) => u.legs)))
    sequences.push({ name: 'WarmUp', loops, legs: [...pattern] });
  // Middle: merge consecutive intervals with identical legs; freeride gets its own
  // sequence; steady/warmup chains collapse into repetition patterns.
  const middle = units.slice(warmupEnd, cooldownStart);
  let steadyChains = 0;
  let i = 0;
  while (i < middle.length) {
    const unit = middle[i];
    if (unit.kind === 'intervals') {
      let j = i; let total = 0;
      while (j < middle.length && middle[j].kind === 'intervals' && legsEqual(middle[j].legs, unit.legs)) {
        total += middle[j].repeat; j++;
      }
      sequences.push({ name: 'Intervals', loops: total, legs: [...unit.legs] });
      i = j;
    } else if (unit.kind === 'freeride' || unit.kind === 'max') {
      sequences.push({ name: unit.kind === 'freeride' ? 'Freeride' : 'Max Effort', loops: 1, legs: [...unit.legs] });
      i++;
    } else {
      let j = i; const legs = [];
      while (j < middle.length && (middle[j].kind === 'steady' || middle[j].kind === 'warmup')) {
        legs.push(...middle[j].legs); j++;
      }
      steadyChains++;
      for (const [pattern, loops] of splitRuns(legs))
        sequences.push({ name: '\x00STEADY', loops, legs: [...pattern] });
      i = j;
    }
  }
  if (cooldownStart < n) for (const [pattern, loops] of splitRuns(units.slice(cooldownStart).flatMap((u) => u.legs)))
    sequences.push({ name: 'CoolDown', loops, legs: [...pattern] });
  for (const seq of sequences) if (seq.name.startsWith('\x00STEADY'))
    seq.name = steadyChains === 1 ? 'Main Set' : 'Steady Effort';
  return sequences;
}

const EXERCISE_TYPE = { RECOVERY: 'RECOM', ENDURANCE: 'ENDURANCE', TEMPO: 'SPEED', THRESHOLD: 'POWER', VO2MAX: 'HIIT' };
const ZONE_TEMPO = 76;
const ZONE_THRESHOLD = 91;
const ZONE_VO2MAX = 106;

// Time-in-zone over the main set (WarmUp/CoolDown/Freeride ignored, loops expanded,
// ramps count at peak). Tuned against the WhatsOnZwift golden corpus.
function determineExerciseType(sequences) {
  const zone = [0, 0, 0, 0, 0]; // [recovery, endurance, tempo, threshold, vo2max]
  for (const seq of sequences) {
    if (seq.name === 'WarmUp' || seq.name === 'CoolDown' || seq.name === 'Freeride') continue;
    const loops = Math.max(seq.loops, 1);
    for (const leg of seq.legs) {
      const r = Math.max(leg.ratio, leg.ratioEnd ?? leg.ratio);
      const idx = r < COOLDOWN_RATIO ? 0 : r < ZONE_TEMPO ? 1 : r < ZONE_THRESHOLD ? 2 : r < ZONE_VO2MAX ? 3 : 4;
      zone[idx] += leg.duration * loops;
    }
  }
  const total = zone.reduce((a, b) => a + b, 0);
  if (total === 0) return EXERCISE_TYPE.ENDURANCE;
  const [z1, , z3, z4, z5] = zone.map((t) => (t * 100) / total);
  if (z3 + z4 + z5 < 5 && z1 >= 50) return EXERCISE_TYPE.RECOVERY;
  if (z5 >= 8) return EXERCISE_TYPE.VO2MAX;
  if (z4 + z5 >= 20) return EXERCISE_TYPE.THRESHOLD;
  if (z3 + z4 + z5 >= 50) return EXERCISE_TYPE.TEMPO;
  return EXERCISE_TYPE.ENDURANCE;
}

/** Convert our block list (power as fractions of FTP) into icTrainer units. */
function blocksToUnits(blocks) {
  const units = [];
  for (const b of blocks) {
    switch (b.kind) {
      case 'steady':
        units.push({ kind: 'steady', legs: [{ duration: Math.round(b.dur), ratio: ratio(b.p), rpm: b.cad || 0, comment: '' }] });
        break;
      case 'warmup':
      case 'ramp': {
        const start = ratio(b.p0); const end = ratio(b.p1);
        const leg = { duration: Math.round(b.dur), ratio: start, rpm: b.cad || 0, comment: '' };
        if (end !== start) leg.ratioEnd = end;
        // Ramps behave like warmups: leading -> "WarmUp", mid-workout merges into the steady chain.
        units.push({ kind: 'warmup', legs: [leg] });
        break;
      }
      case 'intervals':
        units.push({
          kind: 'intervals', repeat: b.repeat,
          legs: [
            { duration: Math.round(b.onDur), ratio: ratio(b.onP), rpm: b.cad || 0, comment: 'Work' },
            { duration: Math.round(b.offDur), ratio: ratio(b.offP), rpm: b.cadRest || 0, comment: 'Recovery' },
          ],
        });
        break;
      case 'cooldown': {
        const start = ratio(b.p0); const end = ratio(b.p1);
        const leg = { duration: Math.round(b.dur), ratio: start, rpm: b.cad || 0, comment: '' };
        if (end !== start) leg.ratioEnd = end;
        // Treated as steady so the trailing-cooldown trimmer can claim it.
        units.push({ kind: 'steady', legs: [leg] });
        break;
      }
      case 'free': {
        if (b.maxEffort) {
          // No ERG target: icTrainer needs a number, so ride it at an all-out ratio
          // (sprint-length ~200 % FTP, longer ~150 %) — mirrors MAX_EFFORT_ASSUMED_POWER.
          units.push({ kind: 'max', legs: [{ duration: Math.round(b.dur), ratio: b.dur <= 30 ? MAX_EFFORT.sprint : MAX_EFFORT.long, rpm: 0, comment: 'Max Effort' }] });
        } else {
          units.push({ kind: 'freeride', legs: [{ duration: Math.round(b.dur), ratio: FREERIDE_RATIO, rpm: 0, resistance: 1, comment: '' }] });
        }
        break;
      }
      default: break;
    }
  }
  return units;
}

const workoutStruct = (sequences) => {
  const parts = [];
  for (const seq of sequences) for (let k = 0; k < seq.loops; k++) for (const leg of seq.legs)
    parts.push(leg.ratioEnd !== undefined && leg.ratioEnd !== leg.ratio
      ? `${leg.duration}-${leg.ratio}-${leg.ratioEnd}`
      : `${leg.duration}-${leg.ratio}`);
  return `ratio;${parts.join(';')}`;
};

// ---------------------------------------------------------------- thumbnail
// Deterministic transparent PNG profile (indexed colour, raw deflate blocks),
// ported from whats-on-zwift — icTrainer shows it in its workout list.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const raw of bytes) {
    crc ^= raw & 0xff;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function adler32(bytes) {
  let a = 1; let b = 0;
  for (const byte of bytes) { a = (a + (byte & 0xff)) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}
const be32 = (v) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
function pngChunk(type, data) {
  const content = [...Array.from(type, (c) => c.charCodeAt(0)), ...data];
  const checksum = crc32(content);
  return [data.length >>> 24 & 0xff, data.length >>> 16 & 0xff, data.length >>> 8 & 0xff, data.length & 0xff, ...content, ...be32(checksum)];
}
function base64(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] & 0xff; const b = (bytes[i + 1] ?? 0) & 0xff; const c = (bytes[i + 2] ?? 0) & 0xff;
    const v = (a << 16) | (b << 8) | c;
    out += alphabet[(v >>> 18) & 63] + alphabet[(v >>> 12) & 63] + (i + 1 < bytes.length ? alphabet[(v >>> 6) & 63] : '=') + (i + 2 < bytes.length ? alphabet[v & 63] : '=');
  }
  return out;
}
const THUMBNAIL_PALETTE = [[0, 0, 0], [133, 32, 211], [156, 35, 194], [201, 42, 160], [235, 112, 87], [254, 215, 2]];
function paletteIndex(ratioValue, maxDisplay) {
  const position = Math.max(0, Math.min(1, ratioValue / Math.max(maxDisplay, 1)));
  if (position < 0.25) return 1; if (position < 0.45) return 2; if (position < 0.65) return 3; if (position < 0.85) return 4; return 5;
}
function renderThumbnail(sequences) {
  const width = 340; const height = 64;
  const maxRatio = Math.max(100, ...sequences.flatMap((s) => s.legs.map((l) => Math.max(l.ratio, l.ratioEnd ?? l.ratio))));
  const timeline = [];
  for (const seq of sequences) for (let k = 0; k < seq.loops; k++) timeline.push(...seq.legs);
  const totalDuration = timeline.reduce((a, l) => a + l.duration, 0);
  const segments = []; let cursor = 0;
  for (const leg of timeline) { segments.push({ start: cursor, end: cursor + leg.duration, leg }); cursor += leg.duration; }
  const ratioAt = (seg, time) => {
    const span = seg.end - seg.start;
    const progress = span > 0 ? (time - seg.start) / span : 0;
    return seg.leg.ratio + (seg.leg.ratioEnd === undefined ? 0 : (seg.leg.ratioEnd - seg.leg.ratio) * progress);
  };
  const rows = [];
  for (let y = 0; y < height; y++) {
    rows.push(0);
    for (let x = 0; x < width; x++) {
      const t0 = totalDuration > 0 ? (x / width) * totalDuration : 0;
      const t1 = totalDuration > 0 ? ((x + 1) / width) * totalDuration : 0;
      let ratioValue = 0;
      for (const seg of segments) {
        if (seg.end < t0 || seg.start > t1 || seg.end === seg.start) continue;
        ratioValue = Math.max(ratioValue, ratioAt(seg, Math.max(t0, seg.start)), ratioAt(seg, Math.min(t1, seg.end)));
      }
      const top = Math.max(0, height - 1 - Math.round((ratioValue / maxRatio) * (height - 4)));
      rows.push(y >= top && ratioValue > 0 ? paletteIndex(ratioValue, maxRatio) : 0);
    }
  }
  const compressed = [0x78, 0x01];
  for (let offset = 0; offset < rows.length; offset += 65535) {
    const length = Math.min(65535, rows.length - offset);
    const finalBlock = offset + length === rows.length ? 1 : 0;
    compressed.push(finalBlock, length & 0xff, (length >>> 8) & 0xff, (~length) & 0xff, ((~length) >>> 8) & 0xff, ...rows.slice(offset, offset + length));
  }
  const checksum = adler32(rows);
  compressed.push(...be32(checksum));
  const palette = THUMBNAIL_PALETTE.flatMap(([r, g, b]) => [r, g, b]);
  const transparency = THUMBNAIL_PALETTE.map((_, i) => (i === 0 ? 0 : 235));
  const png = [137, 80, 78, 71, 13, 10, 26, 10, ...pngChunk('IHDR', [...be32(width), ...be32(height), 8, 3, 0, 0, 0]), ...pngChunk('PLTE', palette), ...pngChunk('tRNS', transparency), ...pngChunk('IDAT', compressed), ...pngChunk('IEND', [])];
  return base64(png);
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// The reference collapses internal whitespace of text fields; mirror it.
const norm = (s) => String(s ?? '').split(/\s+/).join(' ').trim();
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const todayStamp = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 00:00`;
};

const legXml = (leg) => {
  const lines = [
    '        <level>' + level(midRatio(leg)) + '</level>',
    `        <levelRatio>${leg.ratio}</levelRatio>`,
  ];
  if (leg.ratioEnd !== undefined && leg.ratioEnd !== leg.ratio) lines.push(`        <levelRatioEnd>${leg.ratioEnd}</levelRatioEnd>`);
  if (leg.resistance !== undefined) lines.push(`        <levelResistance>${leg.resistance}</levelResistance>`);
  lines.push(`        <duration>${mmss(leg.duration)}</duration>`);
  lines.push(`        <rpm>${leg.rpm}</rpm>`);
  lines.push('        <bpm>0</bpm>');
  lines.push('        <bpmDefault>false</bpmDefault>');
  if (leg.comment) lines.push(`        <comment>${esc(leg.comment)}</comment>`);
  return ['      <leg>', ...lines, '      </leg>'].join('\n');
};

/**
 * Serialize a workout to icTrainer .ictx XML text (BOM prefixed, trailing newline).
 * name/description/blocks like the .zwo writer; displayOrder = position within the plan (1-based);
 * lastUpdate/author overridable (lastUpdate defaults to today, author to the app name).
 */
export function toIctx({ name, plan, displayOrder = 1, description = '', blocks, author = 'Zwo Workout Builder', lastUpdate = todayStamp(), bom = true }) {
  const sequences = buildSequences(blocksToUnits(blocks));
  const maxRatio = Math.max(...sequences.flatMap((s) => s.legs.map((l) => Math.max(l.ratio, l.ratioEnd ?? l.ratio))), 0);
  const maxDisplay = Math.max(100, Math.ceil(maxRatio / 10) * 10);
  const thumbnail = renderThumbnail(sequences);
  const lines = [
    '<?xml version="1.0" ?>',
    '<icTrainer>',
    '  <icTrainerExercise>',
    `    <name>${esc(norm(name))}</name>`,
    `    <plan>${esc(norm(plan))}</plan>`,
    '    <code></code>',
    '    <version>9</version>',
    `    <displayOrder>${displayOrder}</displayOrder>`,
    '    <sportType>Road</sportType>',
    '    <exerciseLevel>INTERMEDIATE</exerciseLevel>',
    `    <exerciseType>${esc(determineExerciseType(sequences))}</exerciseType>`,
    `    <workoutStruct>${esc(workoutStruct(sequences))}</workoutStruct>`,
    '    <comment></comment>',
    `    <description>${esc(norm(description))}</description>`,
    '    <playlist></playlist>',
    `    <lastUpdate>${esc(lastUpdate)}</lastUpdate>`,
    '    <startImage></startImage>',
    `    <maxLevelRatioDisplay>${maxDisplay}</maxLevelRatioDisplay>`,
    '    <ratioExercise>true</ratioExercise>',
    `    <author>${esc(norm(author))}</author>`,
    `    <image>${thumbnail}</image>`,
    '    <containsVideo>false</containsVideo>',
    '    <containsAudio>false</containsAudio>',
    ...sequences.flatMap((seq) => [
      '    <sequence>',
      `      <name>${esc(seq.name)}</name>`,
      `      <loops>${seq.loops}</loops>`,
      ...seq.legs.map(legXml),
      '    </sequence>',
    ]),
    '  </icTrainerExercise>',
    '</icTrainer>',
  ];
  const text = lines.join('\n') + '\n';
  return bom ? '\uFEFF' + text : text;
}
