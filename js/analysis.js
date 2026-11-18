// Measurement & analysis on top of the solver: DMM, LCR, Thevenin, frequency response, design checks.
import { Circuit } from './sim.js';
import { PARTS, TYPES, icGeom, getPins, helpers } from './library.js';
import { fmt } from './units.js';

const { num } = helpers;
const TWO_PI = 2 * Math.PI;
const cabs = (r, i) => Math.hypot(r, i);

/** DC voltage between two nets (red − black). */
export function dcVoltage(ckt, red, black) {
  if (!ckt.op) return NaN;
  return ckt.V(red) - ckt.V(black ?? ckt.nl.gndNet);
}

/** Impedance between nets a and b with ±1 A injection. mode 'off' = unpowered (DMM-style), 'ac' = small-signal around operating point. */
export function impedance(ckt, a, b, freq, opts = {}) {
  if (a == null || b == null || a === b) return null;
  const sol = ckt.solveAC(freq, { mode: opts.mode || 'off', inj: [[a, 1], [b, -1]], srcShort: opts.srcShort });
  if (!sol) return null;
  const va = ckt.acV(sol, a), vb = ckt.acV(sol, b);
  return { re: va[0] - vb[0], im: va[1] - vb[1] };
}

/** Ohmmeter (power off, semiconductors open). */
export function resistance(ckt, a, b, opts = {}) {
  const z = impedance(ckt, a, b, 0, { mode: 'off', srcShort: opts.srcShort });
  if (!z) return { ohms: NaN };
  const r = z.re;
  return { ohms: r, open: r > 1e9 };
}

/** LCR meter at a test frequency. */
export function lcr(ckt, a, b, freq, opts = {}) {
  const z = impedance(ckt, a, b, freq, { mode: 'off', srcShort: opts.srcShort });
  if (!z) return null;
  const w = TWO_PI * freq;
  const mag = cabs(z.re, z.im), ph = (Math.atan2(z.im, z.re) * 180) / Math.PI;
  const out = { z: mag, phase: ph, rs: z.re, xs: z.im, freq, open: mag > 1e9 };
  if (z.im < 0) { out.cs = -1 / (w * z.im); out.d = Math.abs(z.re / z.im); }
  else if (z.im > 0) { out.ls = z.im / w; out.q = Math.abs(z.im / (z.re || 1e-12)); }
  return out;
}

/** Impedance sweep for LCR plots */
export function zSweep(ckt, a, b, fmin, fmax, pts = 160, opts = {}) {
  const f = logspace(fmin, fmax, pts), mag = [], phase = [];
  for (const fr of f) {
    const z = impedance(ckt, a, b, fr, { mode: 'off', srcShort: opts.srcShort });
    if (!z) { mag.push(NaN); phase.push(NaN); continue; }
    mag.push(cabs(z.re, z.im)); phase.push((Math.atan2(z.im, z.re) * 180) / Math.PI);
  }
  return { f, mag, phase };
}

/** Thevenin equivalent seen at a net (vs ground): Vth from the operating point, Rth from small-signal. */
export function thevenin(ckt, net) {
  const g = ckt.nl.gndNet;
  if (net == null || net === g) return { vth: 0, rth: 0 };
  const sol = ckt.solveAC(0, { mode: 'ac', inj: [[net, 1]] });
  const rth = sol ? ckt.acV(sol, net)[0] : NaN;
  return { vth: ckt.V(net), rth };
}

export function logspace(a, b, n) {
  const la = Math.log10(a), lb = Math.log10(b), out = [];
  for (let i = 0; i < n; i++) out.push(Math.pow(10, la + ((lb - la) * i) / (n - 1)));
  return out;
}

/** Find a source that can serve as stimulus for the input net. */
function findStimulus(ckt, inNet, refNet) {
  let best = null;
  for (const e of ckt.elems) {
    if (e.c.type !== 'vac' && e.c.type !== 'vdc') continue;
    const [p, m] = e.nets;
    if (p === inNet || m === inNet) {
      const score = (e.c.type === 'vac' ? 2 : 1) + ((p === inNet && m === refNet) || (m === inNet && p === refNet) ? 2 : 0);
      if (!best || score > best.score) best = { id: e.c.id, score, ref: e.c.ref };
    }
  }
  return best;
}

/**
 * Frequency response H(f) = V(out)−V(ref) / V(in)−V(ref), computed from the actual circuit
 * (operating point linearised, real loading, op-amp GBW).
 */
export function bode(ckt, inNet, outNet, refNet, fmin = 1, fmax = 1e7, pts = 241) {
  if (inNet == null || outNet == null) return null;
  refNet = refNet ?? ckt.nl.gndNet;
  const stim = findStimulus(ckt, inNet, refNet);
  const f = logspace(fmin, fmax, pts), db = [], ph = [];
  let zin = null;
  for (const fr of f) {
    const sol = stim
      ? ckt.solveAC(fr, { mode: 'ac', stim: stim.id })
      : ckt.solveAC(fr, { mode: 'ac', inj: [[inNet, 1], [refNet, -1]] });
    if (!sol) { db.push(NaN); ph.push(NaN); continue; }
    const vi = ckt.acV(sol, inNet), vo = ckt.acV(sol, outNet), vr = ckt.acV(sol, refNet);
    const ir = vi[0] - vr[0], ii = vi[1] - vr[1], or = vo[0] - vr[0], oi = vo[1] - vr[1];
    const d = ir * ir + ii * ii;
    if (d < 1e-30) { db.push(NaN); ph.push(NaN); continue; }
    const hr = (or * ir + oi * ii) / d, hi = (oi * ir - or * ii) / d;
    db.push(20 * Math.log10(Math.max(cabs(hr, hi), 1e-15)));
    ph.push((Math.atan2(hi, hr) * 180) / Math.PI);
  }
  unwrap(ph);
  const summary = classify(f, db, ph);
  // refine notch / peak frequency with a fine local sweep
  if (summary.type && /Notch|Band-stop|Band-pass/.test(summary.type)) {
    const at = (fr) => {
      const sol = stim ? ckt.solveAC(fr, { mode: 'ac', stim: stim.id }) : ckt.solveAC(fr, { mode: 'ac', inj: [[inNet, 1], [refNet, -1]] });
      if (!sol) return NaN;
      const vi = ckt.acV(sol, inNet), vo = ckt.acV(sol, outNet), vr = ckt.acV(sol, refNet);
      return 20 * Math.log10(Math.max(cabs(vo[0] - vr[0], vo[1] - vr[1]) / Math.max(cabs(vi[0] - vr[0], vi[1] - vr[1]), 1e-30), 1e-15));
    };
    const notch = /Notch|stop/.test(summary.type);
    const i0 = f.findIndex((x) => x >= (notch ? summary.f0 : summary.fmax));
    const fa = f[Math.max(0, i0 - 2)], fb = f[Math.min(f.length - 1, i0 + 2)];
    let bestF = notch ? summary.f0 : summary.fmax, bestV = notch ? Infinity : -Infinity;
    for (const fr of logspace(fa, fb, 81)) { const v = at(fr); if (notch ? v < bestV : v > bestV) { bestV = v; bestF = fr; } }
    if (notch) {
      summary.f0 = bestF; summary.min = bestV; summary.depth = Math.min(summary.lo, summary.hi) - bestV;
      if (summary.bw) summary.q = summary.f0 / summary.bw;
      summary.type = summary.depth > 20 ? 'Notch (band-stop)' : 'Band-stop';
      summary.text = `Null at ${fmt(summary.f0, 'Hz')}, depth ${summary.depth.toFixed(1)} dB` + (summary.bw ? `, −3 dB stop-band ${fmt(summary.fl, 'Hz')} – ${fmt(summary.fh, 'Hz')}, Q ≈ ${summary.q.toFixed(2)}` : '');
    } else { summary.fpeak = bestF; summary.max = bestV; }
  }
  summary.stim = stim ? `${stim.ref} used as stimulus` : 'test signal injected at input';
  return { f, db, ph, summary };
}

function unwrap(ph) {
  for (let i = 1; i < ph.length; i++) {
    if (!Number.isFinite(ph[i]) || !Number.isFinite(ph[i - 1])) continue;
    while (ph[i] - ph[i - 1] > 180) ph[i] -= 360;
    while (ph[i] - ph[i - 1] < -180) ph[i] += 360;
  }
}

function interpCross(f, db, i, level) {
  // crossing between i and i+1 (log-frequency interpolation)
  const a = db[i], b = db[i + 1];
  const t = (level - a) / (b - a || 1e-12);
  return Math.pow(10, Math.log10(f[i]) + t * (Math.log10(f[i + 1]) - Math.log10(f[i])));
}

/** Characterise a response: low/high/band-pass, notch, flat; cut-off, centre, Q, slope. */
export function classify(f, db, ph) {
  const n = f.length;
  const valid = db.map((v) => Number.isFinite(v));
  if (!valid.some(Boolean)) return { type: 'No response', text: 'No signal path between the probes.' };
  let max = -Infinity, imax = 0, min = Infinity, imin = 0;
  db.forEach((v, i) => { if (valid[i]) { if (v > max) { max = v; imax = i; } if (v < min) { min = v; imin = i; } } });
  const lo = db[0], hi = db[n - 1];
  const lvl = max - 3.0103;
  const crossings = [];
  for (let i = 0; i < n - 1; i++) {
    if (!valid[i] || !valid[i + 1]) continue;
    if ((db[i] - lvl) * (db[i + 1] - lvl) < 0) crossings.push({ f: interpCross(f, db, i, lvl), dir: db[i + 1] > db[i] ? 'up' : 'down' });
  }
  const slope = (i0, i1) => (db[i1] - db[i0]) / (Math.log10(f[i1]) - Math.log10(f[i0]));
  const idxAt = (fr) => { let i = f.findIndex((x) => x >= fr); return i < 0 ? n - 1 : i; };
  const slopeNear = (fa, fb) => { const a = idxAt(fa), b = idxAt(fb); return b - a >= 3 ? slope(a, b) : null; };
  const decPts = Math.max(2, Math.round((n - 1) / (Math.log10(f[n - 1]) - Math.log10(f[0]))));
  const r = { max, fmax: f[imax], min, fmin: f[imin], lo, hi, crossings };
  const loIn = lo >= lvl, hiIn = hi >= lvl;
  if (max - min < 1) {
    r.type = 'Flat (all-pass)';
    r.text = `Gain ${max.toFixed(2)} dB across the band.`;
  } else if (loIn && !hiIn) {
    r.type = 'Low-pass';
    const c = crossings.find((x) => x.dir === 'down');
    r.fc = c?.f;
    const s = (r.fc && slopeNear(r.fc * 3, r.fc * 30)) ?? slope(n - 1 - decPts, n - 1);
    r.slope = s; r.order = Math.max(1, Math.round(-s / 20));
    r.peak = max - lo;
    r.text = `Passband ${lo.toFixed(2)} dB, −3 dB at ${fmt(r.fc, 'Hz')}, roll-off ${s.toFixed(0)} dB/dec (≈ order ${r.order})` + (r.peak > 0.5 ? `, resonant peak +${r.peak.toFixed(1)} dB at ${fmt(r.fmax, 'Hz')}` : '');
  } else if (!loIn && hiIn) {
    r.type = 'High-pass';
    const ups = crossings.filter((x) => x.dir === 'up');
    r.fc = ups[ups.length - 1]?.f;
    const s = (r.fc && slopeNear(r.fc / 30, r.fc / 3)) ?? slope(0, decPts);
    r.slope = s; r.order = Math.max(1, Math.round(s / 20));
    r.peak = max - hi;
    r.text = `Passband ${hi.toFixed(2)} dB, −3 dB at ${fmt(r.fc, 'Hz')}, roll-off ${s.toFixed(0)} dB/dec (≈ order ${r.order})` + (r.peak > 0.5 ? `, resonant peak +${r.peak.toFixed(1)} dB at ${fmt(r.fmax, 'Hz')}` : '');
  } else if (!loIn && !hiIn) {
    r.type = 'Band-pass';
    const up = crossings.filter((x) => x.dir === 'up' && x.f < f[imax]).pop();
    const down = crossings.find((x) => x.dir === 'down' && x.f > f[imax]);
    r.f0 = f[imax]; r.fl = up?.f; r.fh = down?.f;
    if (r.fl && r.fh) { r.bw = r.fh - r.fl; r.q = Math.sqrt(r.fl * r.fh) / r.bw; r.f0 = Math.sqrt(r.fl * r.fh); }
    r.text = `Centre ${fmt(r.f0, 'Hz')}, peak ${max.toFixed(2)} dB` + (r.bw ? `, BW ${fmt(r.bw, 'Hz')} (${fmt(r.fl, 'Hz')} – ${fmt(r.fh, 'Hz')}), Q ≈ ${r.q.toFixed(2)}` : '');
  } else {
    const depth = Math.min(lo, hi) - min;
    r.type = depth > 20 ? 'Notch (band-stop)' : 'Band-stop';
    r.f0 = f[imin]; r.depth = depth;
    const down = crossings.filter((x) => x.dir === 'down' && x.f < r.f0).pop();
    const up = crossings.find((x) => x.dir === 'up' && x.f > r.f0);
    r.fl = down?.f; r.fh = up?.f;
    if (r.fl && r.fh) { r.bw = r.fh - r.fl; r.q = r.f0 / r.bw; }
    r.text = `Null at ${fmt(r.f0, 'Hz')}, depth ${depth.toFixed(1)} dB` + (r.bw ? `, −3 dB stop-band ${fmt(r.fl, 'Hz')} – ${fmt(r.fh, 'Hz')}, Q ≈ ${r.q.toFixed(2)}` : '');
  }
  if (r.fc) {
    const i = f.findIndex((x) => x >= r.fc);
    if (i > 0) r.phaseAtFc = ph[i];
  }
  return r;
}

// ---------- design checks ----------
export function designChecks(ckt) {
  const out = [];
  const W = (level, c, msg) => out.push({ level, comp: c.id, ref: c.ref, msg });
  const nl = ckt.nl;
  // unconnected / dangling
  for (const e of ckt.elems) {
    const c = e.c;
    const pins = getPins(c);
    if (c.type === 'ic') {
      const g = icGeom(c);
      const powerPins = g.pins.map((p, i) => [p, i]).filter(([p]) => p.fn === 'pwr' || p.fn === 'gnd');
      const isBoard = g.def.layout === 'header';
      if (!isBoard && powerPins.length && powerPins.some(([p, i]) => !nl.connected(c.id, i) && !g.bridges.some((b) => b.includes(i) && b.some((j) => nl.connected(c.id, j)))))
        W('warn', c, `${c.props.part}: power pin ${powerPins.filter(([p, i]) => !nl.connected(c.id, i)).map(([p]) => p.name + '(' + p.num + ')').join(', ')} not connected`);
      if (!isBoard) g.pins.forEach((p, i) => { if (p.fn === 'in' && !nl.connected(c.id, i)) W('warn', c, `${c.props.part}: input ${p.name} (pin ${p.num}) is floating`); });
    } else if (!TYPES[c.type].noRef) {
      const open = pins.map((p, i) => (!nl.connected(c.id, i) ? p.name : null)).filter(Boolean);
      if (open.length === pins.length) W('info', c, `${c.ref} is not connected`);
      else if (open.length) W('info', c, `${c.ref}: pin ${open.join(', ')} unconnected`);
    }
  }
  if (!ckt.op) {
    if (ckt.opInfo?.singular) out.push({ level: 'err', msg: 'Circuit could not be solved (singular) — check for loops of ideal sources.' });
    else if (ckt.elems.length) out.push({ level: 'err', msg: 'Simulation did not converge — check for conflicting sources or impossible feedback.' });
    return out;
  }
  for (const e of ckt.elems) {
    const c = e.c, I = ckt.pinI.get(c.id) || [], V = e.nets.map((n) => ckt.V(n));
    const p = c.props;
    switch (c.type) {
      case 'resistor': {
        const P = Math.abs(I[0] * (V[0] - V[1])), rating = num(p.power, 0.25);
        if (P > rating) W('err', c, `${c.ref} dissipates ${fmt(P, 'W')} — exceeds ${fmt(rating, 'W')} rating`);
        else if (P > 0.6 * rating) W('warn', c, `${c.ref} dissipates ${fmt(P, 'W')} (${Math.round((P / rating) * 100)}% of rating)`);
        break;
      }
      case 'led': {
        const i = I[0], imax = num(p.imax, 0.02);
        if (i > imax) W('err', c, `${c.ref} LED current ${fmt(i, 'A')} exceeds ${fmt(imax, 'A')}`);
        else if (V[0] - V[1] < -5) W('warn', c, `${c.ref} reverse biased ${fmt(V[0] - V[1], 'V')} (LEDs tolerate ~5 V)`);
        break;
      }
      case 'diode': case 'schottky': {
        const m = PARTS[p.part]; if (m && I[0] > m.imax) W('err', c, `${c.ref} forward current ${fmt(I[0], 'A')} exceeds ${fmt(m.imax, 'A')}`);
        break;
      }
      case 'cap_pol': {
        const v = V[0] - V[1];
        if (v < -0.5) W('err', c, `${c.ref} electrolytic is reverse biased (${fmt(v, 'V')})`);
        if (Math.abs(v) > num(p.vmax, 25)) W('err', c, `${c.ref} sees ${fmt(Math.abs(v), 'V')} > ${p.vmax} V rating`);
        else if (Math.abs(v) > 0.8 * num(p.vmax, 25)) W('warn', c, `${c.ref} at ${Math.round((Math.abs(v) / num(p.vmax, 25)) * 100)}% of voltage rating — derate`);
        break;
      }
      case 'capacitor': if (Math.abs(V[0] - V[1]) > num(p.vmax, 50)) W('err', c, `${c.ref} sees ${fmt(Math.abs(V[0] - V[1]), 'V')} > rating`); break;
      case 'fuse': if (!p.blown && Math.abs(I[0]) > num(p.rating, 1)) W('err', c, `${c.ref} current ${fmt(Math.abs(I[0]), 'A')} — fuse would blow`); break;
      case 'vdc': case 'rail': case 'vac': if (Math.abs(I[0]) > 20) W('err', c, `${c.ref || p.name}: ${fmt(Math.abs(I[0]), 'A')} — short circuit?`); break;
      case 'reg': {
        const m = PARTS[p.part] || PARTS['7805'];
        const vin = V[0] - V[2], vout = V[1] - V[2], iout = -I[1];
        if (vin > 0.5 && !m.adj && vin < m.vout + m.drop) W('warn', c, `${c.ref} ${p.part} in dropout: input ${fmt(vin, 'V')} needs ≥ ${fmt(m.vout + m.drop, 'V')}`);
        if (vin > m.vinMax) W('err', c, `${c.ref} input ${fmt(vin, 'V')} exceeds ${m.vinMax} V max`);
        const pd = (V[0] - V[1]) * Math.max(iout, 0);
        if (pd > 1.5) W('err', c, `${c.ref} dissipates ${fmt(pd, 'W')} — needs a heatsink`);
        else if (pd > 0.7) W('warn', c, `${c.ref} dissipates ${fmt(pd, 'W')} — gets hot`);
        if (iout > m.ilim * 0.95) W('err', c, `${c.ref} output current ${fmt(iout, 'A')} at limit`);
        if (vin < 0.1 && e.connected[0]) W('info', c, `${c.ref} has no input voltage`);
        break;
      }
      case 'nmos': case 'pmos': {
        const m = PARTS[p.part] || {};
        const pol = c.type === 'nmos' ? 1 : -1;
        const vgs = pol * (V[0] - V[2]), vds = pol * (V[1] - V[2]), id = Math.abs(I[1]);
        if (Math.abs(V[0] - V[2]) > 20) W('err', c, `${c.ref} |VGS| = ${fmt(Math.abs(V[0] - V[2]), 'V')} exceeds ±20 V`);
        const vth = Math.abs(num(p.vth, m.vth ?? 2));
        if (vgs > vth * 0.7 && m.vgsSpec && vgs < m.vgsSpec * 0.85 && id > 0.01)
          W('warn', c, `${c.ref} ${p.part} gate drive ${fmt(vgs, 'V')} — RDS(on) is specified at ${m.vgsSpec} V, not fully enhanced`);
        const pd = Math.abs(vds * id);
        if (pd > 2) W('err', c, `${c.ref} dissipates ${fmt(pd, 'W')} (VDS ${fmt(vds, 'V')} × ID ${fmt(id, 'A')})`);
        else if (pd > 0.5) W('warn', c, `${c.ref} dissipates ${fmt(pd, 'W')}`);
        if (!e.connected[0]) W('warn', c, `${c.ref} gate is floating — add a pull-down`);
        break;
      }
      case 'npn': case 'pnp': {
        const m = PARTS[p.part] || {};
        const ic = Math.abs(I[1]);
        if (m.icmax && ic > m.icmax) W('err', c, `${c.ref} IC ${fmt(ic, 'A')} exceeds ${fmt(m.icmax, 'A')}`);
        const pd = Math.abs((V[1] - V[2]) * I[1]);
        if (pd > 0.6) W('warn', c, `${c.ref} dissipates ${fmt(pd, 'W')}`);
        break;
      }
      case 'opamp': {
        const m = PARTS[p.part] || PARTS.TL072;
        const powered = e.connected[3] && e.connected[4];
        const vp = powered ? V[3] : num(p.vpos, 15), vn = powered ? V[4] : num(p.vneg, -15);
        if (vp - vn < 1) W('err', c, `${c.ref} op-amp is not powered (V+ − V− = ${fmt(vp - vn, 'V')})`);
        else if (V[2] > vp - m.hr[1] - 0.05 || V[2] < vn + m.hr[0] + 0.05) W('warn', c, `${c.ref} output saturated at ${fmt(V[2], 'V')}`);
        if (Math.abs(I[2]) > m.ilim) W('err', c, `${c.ref} output current ${fmt(Math.abs(I[2]), 'A')} exceeds ~${fmt(m.ilim, 'A')} limit`);
        break;
      }
      case 'ic': icChecks(ckt, e, V, I, W); break;
    }
  }
  return out;
}

function icChecks(ckt, e, V, I, W) {
  const c = e.c, g = icGeom(c);
  const byName = (n) => g.pins.findIndex((p) => p.name === n);
  const v = (n) => { const i = byName(n); return i < 0 ? 0 : V[i]; };
  for (const u of g.def.units || []) {
    if (u.k === 'drv') {
      const vdd = v(u.vdd) - v(u.gnd);
      if (vdd < 4.5 && vdd > -0.1) W('warn', c, `${c.ref} ${c.props.part}: VDD ${fmt(vdd, 'V')} below 4.5 V minimum — output disabled`);
      if (vdd > 18) W('err', c, `${c.ref} VDD ${fmt(vdd, 'V')} exceeds 18 V`);
    } else if (u.k === 'ir2110' || u.k === 'ir2104') {
      const vcc = v('VCC') - v('COM'), vbs = v('VB') - v('VS');
      const uv = u.k === 'ir2110' ? 8.6 : 8.9;
      if (vcc < uv) W('warn', c, `${c.ref} VCC ${fmt(vcc, 'V')} below UVLO (${uv} V) — outputs held low`);
      else if (vbs < uv) W('warn', c, `${c.ref} bootstrap VB−VS = ${fmt(vbs, 'V')} below UVLO — HO cannot turn on (check bootstrap diode/cap, low side must switch first)`);
      if (vcc > 20) W('err', c, `${c.ref} VCC ${fmt(vcc, 'V')} exceeds 20 V`);
    } else if (u.k === 'opamp') {
      const m = PARTS[u.model] || PARTS.TL072;
      const vs = v(u.vp) - v(u.vn);
      if (vs < 1) W('err', c, `${c.ref} ${g.title}: not powered`);
      else { const vo = v(u.out); if (vo > v(u.vp) - m.hr[1] - 0.05 || vo < v(u.vn) + m.hr[0] + 0.05) W('warn', c, `${c.ref} ${u.out} saturated at ${fmt(vo, 'V')}`); }
    } else if (u.k === 'mcu') {
      const v3 = v(u.v3) - v(u.gnd);
      const vreg = u.vreg || 3.3;
      if (v3 < vreg * 0.9) W('warn', c, `${c.ref} ${c.props.part}: ${u.v3} rail only ${fmt(v3, 'V')} — board not powered`);
      g.pins.forEach((p, i) => {
        if (p.fn !== 'io') return;
        const vi = V[i] - v(u.gnd);
        if (vi > vreg + 0.4) W('err', c, `${c.ref} ${p.name} at ${fmt(vi, 'V')} — exceeds ${vreg} V logic (not tolerant!)`);
        if (vi < -0.4) W('err', c, `${c.ref} ${p.name} at ${fmt(vi, 'V')} — below ground`);
        const ii = Math.abs(I[i]);
        if (ii > 0.04) W('err', c, `${c.ref} ${p.name} sourcing/sinking ${fmt(ii, 'A')} — exceeds 40 mA`);
        else if (ii > 0.02) W('warn', c, `${c.ref} ${p.name} current ${fmt(ii, 'A')} above 20 mA recommended`);
      });
    }
  }
}

export { Circuit };
