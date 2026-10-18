// export.js — .zwo XML writer and a dependency-free ZIP (store) writer.

const xmlEsc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n2 = (x) => (Math.round(x * 1000) / 1000).toFixed(2).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '.0');
const pw = (x) => (Math.round(x * 100) / 100).toFixed(2);
const cadAttr = (c, name = 'Cadence') => (c != null ? ` ${name}="${Math.round(c)}"` : '');

function blockXml(b) {
  switch (b.kind) {
    case 'warmup':
      return `<Warmup Duration="${Math.round(b.dur)}" PowerLow="${pw(b.p0)}" PowerHigh="${pw(b.p1)}" pace="0"${cadAttr(b.cad)}/>`;
    case 'cooldown':
      return `<Cooldown Duration="${Math.round(b.dur)}" PowerLow="${pw(b.p0)}" PowerHigh="${pw(b.p1)}" pace="0"${cadAttr(b.cad)}/>`;
    case 'ramp':
      return `<Ramp Duration="${Math.round(b.dur)}" PowerLow="${pw(b.p0)}" PowerHigh="${pw(b.p1)}" pace="0"${cadAttr(b.cad)}/>`;
    case 'steady':
      return `<SteadyState Duration="${Math.round(b.dur)}" Power="${pw(b.p)}" pace="0"${cadAttr(b.cad)}/>`;
    case 'intervals':
      return `<IntervalsT Repeat="${b.repeat}" OnDuration="${Math.round(b.onDur)}" OffDuration="${Math.round(b.offDur)}" OnPower="${pw(b.onP)}" OffPower="${pw(b.offP)}" pace="0"${cadAttr(b.cad)}${cadAttr(b.cadRest, 'CadenceResting')}/>`;
    case 'free':
      return b.maxEffort ? `<MaxEffort Duration="${Math.round(b.dur)}"/>` : `<FreeRide Duration="${Math.round(b.dur)}" FlatRoad="1"/>`;
    default:
      return '';
  }
}

/** Serialize a workout to Zwift .zwo XML. */
export function toZwo({ name, description, tags = [], blocks, author = 'Zwo Workout Builder' }) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<workout_file>',
    `    <author>${xmlEsc(author)}</author>`,
    `    <name>${xmlEsc(name)}</name>`,
    `    <description>${xmlEsc(description)}</description>`,
    '    <sportType>bike</sportType>',
    '    <tags>',
    ...tags.map((t) => `        <tag name="${xmlEsc(String(t).toUpperCase())}"/>`),
    '    </tags>',
    '    <workout>',
    ...blocks.map((b) => `        ${blockXml(b)}`),
    '    </workout>',
    '</workout_file>',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- ZIP (no compression)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Build a ZIP archive. files: [{ name, data: string | Uint8Array }]
 * Returns a Uint8Array.
 */
export function makeZip(files, date = new Date()) {
  const enc = new TextEncoder();
  const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // UTF-8 names
    lh.setUint16(8, 0, true);
    lh.setUint16(10, dosTime, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);
    locals.push(new Uint8Array(lh.buffer), nameBytes, data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint32(42, offset, true);
    centrals.push(new Uint8Array(ch.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}
