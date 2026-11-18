// Engineering-notation parsing & formatting.
const PREFIX = { f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12 };

/** Parse "4.7k", "4k7", "100n", "10uF", "2.2 MΩ", "1meg", "1e-6" → number (NaN on failure). */
export function parseEng(input) {
  if (typeof input === 'number') return input;
  if (input == null) return NaN;
  let s = String(input).trim().replace(/,/g, '').replace(/\s+/g, '');
  if (!s) return NaN;
  s = s.replace(/(ohms?|Ω|Ohm|F|H|Hz|V|A|W|s)$/i, (m) => (/^meg$/i.test(m) ? m : ''));
  const meg = s.match(/^([+-]?\d*\.?\d+(?:e[+-]?\d+)?)meg$/i);
  if (meg) return parseFloat(meg[1]) * 1e6;
  // RKM style: 4k7, 2R2, 4n7
  const rkm = s.match(/^([+-]?\d+)([fpnuµμmkKMGTR])(\d+)$/);
  if (rkm) {
    const mult = rkm[2] === 'R' ? 1 : PREFIX[rkm[2]];
    return parseFloat(rkm[1] + '.' + rkm[3]) * mult;
  }
  const m = s.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([fpnuµμmkKMGTR]?)$/);
  if (!m) return NaN;
  const mult = m[2] === '' || m[2] === 'R' ? 1 : PREFIX[m[2]];
  return parseFloat(m[1]) * mult;
}

const SI = [
  [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f'],
];

/** Format number with SI prefix. digits = significant digits. */
export function fmt(v, unit = '', digits = 3) {
  if (v == null || Number.isNaN(v)) return '—';
  if (!Number.isFinite(v)) return (v > 0 ? '∞' : '-∞') + (unit ? ' ' + unit : '');
  if (v === 0) return '0' + (unit ? ' ' + unit : '');
  const a = Math.abs(v);
  let pick = SI[SI.length - 1];
  for (const p of SI) { if (a >= p[0] * 0.9995) { pick = p; break; } }
  let n = v / pick[0];
  let str = Number(n.toPrecision(digits)).toString();
  return str + (pick[1] || unit ? ' ' : '') + pick[1] + unit;
}

/** Compact value for schematic labels: 4.7k, 100n, 10µ */
export function short(v, unit = '') {
  if (v == null || Number.isNaN(v)) return '?';
  return fmt(v, unit, 3).replace(' ', '');
}

export const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
export const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];

/** Nearest E-series value. */
export function nearestE(v, series = E24) {
  if (!(v > 0)) return v;
  const dec = Math.floor(Math.log10(v));
  let best = v, bestErr = Infinity;
  for (const d of [dec - 1, dec, dec + 1]) {
    for (const s of series) {
      const c = s * Math.pow(10, d);
      const e = Math.abs(Math.log(c / v));
      if (e < bestErr) { bestErr = e; best = c; }
    }
  }
  return +best.toPrecision(3);
}

/** Step up/down through E-series. */
export function stepE(v, dir, series = E24) {
  if (!(v > 0)) return v;
  const list = [];
  const dec = Math.floor(Math.log10(v));
  for (let d = dec - 1; d <= dec + 1; d++) for (const s of series) list.push(+(s * Math.pow(10, d)).toPrecision(3));
  if (dir > 0) return list.find((x) => x > v * 1.0001) ?? v;
  return [...list].reverse().find((x) => x < v * 0.9999) ?? v;
}

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
