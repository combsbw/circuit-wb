// Calculators: sliders + typed values. Filter & divider calculators run the real solver on a template
// circuit and can insert it into the design.
import { fmt, parseEng, nearestE, E12, E24 } from './units.js';
import { newDesign, makeComp, addWire, uid, snap, nextRef, compBBox, designBBox } from './doc.js';
import { Circuit } from './sim.js';
import { bode, classify, logspace } from './analysis.js';
import { PARTS } from './library.js';
import { drawPlot } from './plot.js';
import { icon } from './icons.js';
import { designDecoupling, designSensor, IC_PRESETS, MOUNTS, BULK_TECH, DIELECTRICS, SOURCES, ADCS, OPAMPS } from './design.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TAU = 2 * Math.PI;

// ---------- template builders ----------
function T() { return newDesign('template'); }
function put(d, type, x, y, props = {}, rot = 0, part) {
  const c = makeComp(d, type, part, x, y);
  c.rot = rot;
  Object.assign(c.props, props);
  d.comps.push(c);
  return c;
}
const W = (d, a, pa, b, pb) => addWire(d, { c: a.id, p: pa }, { c: b.id, p: pb });

const ELEM = { R: 'resistor', L: 'inductor', C: 'capacitor' };
/** Ladder filter: series block from IN to OUT, shunt block from OUT to GND. Blocks: arrays of 'R','L','C' or {par:['L','C']} */
function ladder(series, shunt, v) {
  const d = T();
  const src = put(d, 'vac', 0, 60, { amp: '1', freq: '1k' });
  const g0 = put(d, 'ground', 0, 110);
  W(d, src, 1, g0, 0);
  let x = 80, prev = null, inNode = null;
  const val = (k) => ({ R: fmt(v.R).replace(/\s/g, ''), L: fmt(v.L).replace(/\s/g, '').replace('µ', 'u'), C: fmt(v.C).replace(/\s/g, '').replace('µ', 'u') }[k]);
  for (const el of series) {
    let a, b;
    if (el.par) {
      const e1 = put(d, ELEM[el.par[0]], x + 30, -20, { value: val(el.par[0]) });
      const e2 = put(d, ELEM[el.par[1]], x + 30, 20, { value: val(el.par[1]) });
      W(d, e1, 0, e2, 0); W(d, e1, 1, e2, 1);
      a = [e1, 0]; b = [e1, 1];
      x += 100;
    } else {
      const e = put(d, ELEM[el], x, 0, { value: val(el) });
      a = [e, 0]; b = [e, 1];
      x += 80;
    }
    if (prev) W(d, prev[0], prev[1], a[0], a[1]); else inNode = a;
    prev = b;
  }
  W(d, src, 0, inNode[0], inNode[1]);
  const out = prev;
  const xs = x;
  let y = 30, sprev = out;
  for (const el of shunt) {
    const e = put(d, ELEM[el], xs, y, { value: val(el) }, 1);
    W(d, sprev[0], sprev[1], e, 0);
    sprev = [e, 1];
    y += 80;
  }
  const g1 = put(d, 'ground', xs, y);
  W(d, sprev[0], sprev[1], g1, 0);
  const lbl = put(d, 'netlabel', xs + 40, 0, { name: 'OUT' });
  W(d, out[0], out[1], lbl, 0);
  return { d, inRef: { c: inNode[0].id, p: inNode[1] }, outRef: { c: out[0].id, p: out[1] } };
}
function twinT(v) {
  const d = T();
  const R = fmt(v.R).replace(/\s/g, ''), R2 = fmt(v.R / 2).replace(/\s/g, ''), C = fmt(v.C).replace(/\s/g, '').replace('µ', 'u'), C2 = fmt(2 * v.C).replace(/\s/g, '').replace('µ', 'u');
  const src = put(d, 'vac', -40, 90, { amp: '1', freq: '1k' });
  const g0 = put(d, 'ground', -40, 150); W(d, src, 1, g0, 0);
  const r1 = put(d, 'resistor', 60, 0, { value: R }), r2 = put(d, 'resistor', 150, 0, { value: R });
  const c3 = put(d, 'capacitor', 105, 40, { value: C2 }, 1);
  const c1 = put(d, 'capacitor', 60, 140, { value: C }), c2 = put(d, 'capacitor', 150, 140, { value: C });
  const r3 = put(d, 'resistor', 105, 180, { value: R2 }, 1);
  const g1 = put(d, 'ground', 105, 80), g2 = put(d, 'ground', 105, 220);
  W(d, r1, 1, r2, 0); W(d, c3, 0, r1, 1); W(d, c3, 1, g1, 0);
  W(d, c1, 1, c2, 0); W(d, r3, 0, c1, 1); W(d, r3, 1, g2, 0);
  W(d, r1, 0, c1, 0); W(d, r2, 1, c2, 1); W(d, src, 0, r1, 0);
  const lbl = put(d, 'netlabel', 220, 0, { name: 'OUT' }); W(d, r2, 1, lbl, 0);
  return { d, inRef: { c: r1.id, p: 0 }, outRef: { c: r2.id, p: 1 } };
}
function divider(v) {
  const d = T();
  const src = put(d, 'vdc', 0, 60, { volts: String(+v.Vin.toPrecision(4)) });
  const g0 = put(d, 'ground', 0, 130); W(d, src, 1, g0, 0);
  const r1 = put(d, 'resistor', 80, 30, { value: fmt(v.R1).replace(/\s/g, '') }, 1);
  const r2 = put(d, 'resistor', 80, 110, { value: fmt(v.R2).replace(/\s/g, '') }, 1);
  const g1 = put(d, 'ground', 80, 160);
  W(d, src, 0, r1, 0); W(d, r1, 1, r2, 0); W(d, r2, 1, g1, 0);
  const lbl = put(d, 'netlabel', 130, 80, { name: 'VOUT' }); W(d, r1, 1, lbl, 0);
  if (v.RL > 0) { const rl = put(d, 'resistor', 180, 110, { value: fmt(v.RL).replace(/\s/g, '') }, 1); const g2 = put(d, 'ground', 180, 160); W(d, r1, 1, rl, 0); W(d, rl, 1, g2, 0); }
  return { d, inRef: { c: r1.id, p: 0 }, outRef: { c: r1.id, p: 1 } };
}

export const TEMPLATES = { ladder: (...a) => ladder(...a), twinT: (v) => twinT(v), divider: (v) => divider(v) };
const TOPOS = {
  'RC low-pass': { build: (v) => ladder(['R'], ['C'], v), uses: 'RC', theory: (v) => [['f−3dB', fmt(1 / (TAU * v.R * v.C), 'Hz')], ['τ = RC', fmt(v.R * v.C, 's')]] },
  'RC high-pass': { build: (v) => ladder(['C'], ['R'], v), uses: 'RC', theory: (v) => [['f−3dB', fmt(1 / (TAU * v.R * v.C), 'Hz')], ['τ = RC', fmt(v.R * v.C, 's')]] },
  'RL low-pass': { build: (v) => ladder(['L'], ['R'], v), uses: 'RL', theory: (v) => [['f−3dB', fmt(v.R / (TAU * v.L), 'Hz')], ['τ = L/R', fmt(v.L / v.R, 's')]] },
  'RL high-pass': { build: (v) => ladder(['R'], ['L'], v), uses: 'RL', theory: (v) => [['f−3dB', fmt(v.R / (TAU * v.L), 'Hz')]] },
  'LC low-pass (R load)': { build: null, uses: 'RLC', theory: (v) => lcTheory(v) },
  'Series RLC band-pass': { build: (v) => ladder(['L', 'C'], ['R'], v), uses: 'RLC', theory: (v) => { const f0 = 1 / (TAU * Math.sqrt(v.L * v.C)), q = Math.sqrt(v.L / v.C) / v.R; return [['f₀', fmt(f0, 'Hz')], ['Q', q.toFixed(3)], ['BW', fmt(f0 / q, 'Hz')]]; } },
  'LC notch / trap (shunt)': { build: (v) => ladder(['R'], ['L', 'C'], v), uses: 'RLC', theory: (v) => { const f0 = 1 / (TAU * Math.sqrt(v.L * v.C)), q = (TAU * f0 * v.L) / v.R; return [['f₀ (null)', fmt(f0, 'Hz')], ['Q ≈ XL/R', q.toFixed(3)], ['BW ≈ R/(2πL)', fmt(v.R / (TAU * v.L), 'Hz')]]; } },
  'Parallel-tank band-stop': { build: (v) => ladder([{ par: ['L', 'C'] }], ['R'], v), uses: 'RLC', theory: (v) => { const f0 = 1 / (TAU * Math.sqrt(v.L * v.C)); return [['f₀ (null)', fmt(f0, 'Hz')], ['Z₀ = √(L/C)', fmt(Math.sqrt(v.L / v.C), 'Ω')]]; } },
  'Twin-T notch': { build: (v) => twinT(v), uses: 'RC', theory: (v) => [['f₀ = 1/(2πRC)', fmt(1 / (TAU * v.R * v.C), 'Hz')], ['Parts', `R, R, R/2 = ${fmt(v.R / 2, 'Ω')}; C, C, 2C = ${fmt(2 * v.C, 'F')}`], ['Q (passive)', '0.25']] },
};
function lcTheory(v) { const f0 = 1 / (TAU * Math.sqrt(v.L * v.C)); return [['f₀', fmt(f0, 'Hz')], ['Z₀ = √(L/C)', fmt(Math.sqrt(v.L / v.C), 'Ω')], ['Q = R/Z₀', (v.R / Math.sqrt(v.L / v.C)).toFixed(3)]]; }
// fix: LC low-pass should load with R in parallel with C
TOPOS['LC low-pass (R load)'].build = (v) => {
  const t = ladder(['L'], ['C'], v);
  const out = t.d.comps.find((c) => c.id === t.outRef.c);
  const cap = t.d.comps.find((c) => c.type === 'capacitor');
  const rl = put(t.d, 'resistor', cap.x + 60, cap.y, { value: fmt(v.R).replace(/\s/g, '') }, 1);
  const g = put(t.d, 'ground', cap.x + 60, cap.y + 50);
  addWire(t.d, { c: cap.id, p: 0 }, { c: rl.id, p: 0 }); addWire(t.d, { c: rl.id, p: 1 }, { c: g.id, p: 0 });
  void out;
  return t;
};


// ---------- op-amp designer ----------
const OPCFG = ['Buffer (voltage follower)', 'Non-inverting amplifier', 'Inverting amplifier', 'Summing amplifier (inverting)', 'Difference amplifier', 'Integrator / inverting low-pass', 'Transimpedance (photodiode)', 'Sallen-Key low-pass (unity)'];
const INV_CFG = new Set(['Inverting amplifier', 'Summing amplifier (inverting)', 'Difference amplifier', 'Integrator / inverting low-pass', 'Transimpedance (photodiode)']);
const ev = (x) => fmt(x).replace(/\s/g, '').replace('µ', 'u');
const pe = (c, p) => ({ c: c.id, p });
function jn(d, x, y) { const j = { id: uid('j'), x, y }; d.juncs.push(j); return { j: j.id }; }

function opampDesign(v) {
  const d = T();
  const single = v.supply === 'Single supply';
  const vref = single ? v.Vs / 2 : 0;
  const cfg = v.cfg, inv = INV_CFG.has(cfg);
  const u = put(d, 'opamp', 260, 10, { plusTop: !inv }, 0, v.model);
  const rp = put(d, 'rail', 260, -30, { volts: String(v.Vs), name: '+V' }); W(d, rp, 0, u, 3);
  if (single) { const g = put(d, 'ground', 260, 60); W(d, u, 4, g, 0); put(d, 'rail', -60, -130, { volts: String(+vref.toFixed(4)), name: 'VREF' }); }
  else { const rn = put(d, 'rail', 260, 60, { volts: String(-v.Vs), name: '-V' }, 2); W(d, rn, 0, u, 4); }
  const ref = (x, y) => { if (single) { const l = put(d, 'netlabel', x, y, { name: 'VREF' }); l.flip = true; return pe(l, 0); } return pe(put(d, 'ground', x, y), 0); };
  let src = null;
  if (cfg !== 'Transimpedance (photodiode)') {
    src = put(d, 'vac', 0, 60, { amp: '1', freq: '1k', offset: String(+(vref + v.Vin).toFixed(4)) });
    const g0 = put(d, 'ground', 0, 110); W(d, src, 1, g0, 0);
  }
  let inRef = src ? pe(src, 0) : null;
  const outRef = pe(u, 2);
  if (cfg === 'Buffer (voltage follower)' || cfg === 'Non-inverting amplifier') {
    W(d, src, 0, u, 0);
    const j1 = jn(d, 200, 100);
    addWire(d, pe(u, 1), j1);
    if (cfg === 'Buffer (voltage follower)') addWire(d, j1, pe(u, 2));
    else {
      const rf = put(d, 'resistor', 250, 100, { value: ev(v.Rf) }); addWire(d, j1, pe(rf, 0)); W(d, rf, 1, u, 2);
      const rg = put(d, 'resistor', 200, 150, { value: ev(v.Rg) }, 1); addWire(d, j1, pe(rg, 0)); addWire(d, pe(rg, 1), ref(200, 200));
    }
  } else if (cfg === 'Sallen-Key low-pass (unity)') {
    const C = v.Cf > 0 ? v.Cf : 10e-9;
    const r1 = put(d, 'resistor', 60, 0, { value: ev(v.Rin) }), r2 = put(d, 'resistor', 150, 0, { value: ev(v.Rin) });
    W(d, src, 0, r1, 0); W(d, r1, 1, r2, 0); W(d, r2, 1, u, 0);
    const c2 = put(d, 'capacitor', 190, 40, { value: ev(C) }, 1); W(d, c2, 0, r2, 1); addWire(d, pe(c2, 1), ref(190, 90));
    const c1 = put(d, 'capacitor', 200, -80, { value: ev(2 * C) }); W(d, c1, 0, r1, 1); W(d, c1, 1, u, 2);
    const j1 = jn(d, 210, 80), j2 = jn(d, 320, 80);
    addWire(d, pe(u, 1), j1); addWire(d, j1, j2); addWire(d, j2, pe(u, 2));
  } else {
    // inverting family: − on top (220,0), + below (220,20)
    let fb;
    if (cfg === 'Transimpedance (photodiode)') {
      const pd = put(d, 'photodiode', 150, 0, { lux: String(v.lux) }, 0, 'BPW34');
      W(d, pd, 1, u, 1); addWire(d, pe(pd, 0), ref(100, 0));
      fb = pe(pd, 1); inRef = pe(u, 1);
    } else {
      const rin = put(d, 'resistor', 150, 0, { value: ev(v.Rin) });
      W(d, src, 0, rin, 0); W(d, rin, 1, u, 1); fb = pe(rin, 1);
      if (cfg === 'Summing amplifier (inverting)') {
        const r2 = put(d, 'resistor', 150, -50, { value: ev(v.R2) });
        const v2 = put(d, 'vdc', 80, -50, { volts: String(v.V2) }, 1);
        W(d, v2, 0, r2, 0); W(d, r2, 1, rin, 1);
        const g2 = put(d, 'ground', 50, -30); W(d, v2, 1, g2, 0);
      }
    }
    const rf = put(d, 'resistor', 260, -80, { value: ev(v.Rf) });
    addWire(d, pe(rf, 0), fb); W(d, rf, 1, u, 2);
    if (v.Cf > 0 && cfg !== 'Summing amplifier (inverting)' && cfg !== 'Difference amplifier') {
      const cf = put(d, 'capacitor', 260, -120, { value: ev(v.Cf) }); W(d, cf, 0, rf, 0); W(d, cf, 1, rf, 1);
    }
    if (cfg === 'Difference amplifier') {
      const r3 = put(d, 'resistor', 150, 20, { value: ev(v.Rin) }); W(d, r3, 1, u, 0);
      const r4 = put(d, 'resistor', 190, 50, { value: ev(v.Rf) }, 1); W(d, r4, 0, r3, 1); addWire(d, pe(r4, 1), ref(190, 100));
      const v2 = put(d, 'vdc', 80, 20, { volts: String(v.V2) }, 1); W(d, v2, 0, r3, 0);
      const g2 = put(d, 'ground', 50, 40); W(d, v2, 1, g2, 0);
    } else if (single) { addWire(d, pe(u, 0), ref(200, 20)); }
    else { const g = put(d, 'ground', 200, 40); addWire(d, pe(u, 0), pe(g, 0)); }
  }
  return { d, inRef, outRef, tia: cfg === 'Transimpedance (photodiode)' };
}

function opampCompute(v) {
  const m = PARTS[v.model] || PARTS.TL072;
  const single = v.supply === 'Single supply';
  const vref = single ? v.Vs / 2 : 0, vpos = v.Vs, vneg = single ? 0 : -v.Vs;
  const lo = vneg + m.hr[0], hi = vpos - m.hr[1];
  const cfg = v.cfg;
  const par = (a, b) => (a * b) / (a + b);
  let gain = 1, ng = 1, vout, zin = 'very high (op-amp input)', extra = [];
  const iph = (v.lux / 1000) * 70e-6;
  switch (cfg) {
    case 'Buffer (voltage follower)': vout = vref + v.Vin; break;
    case 'Non-inverting amplifier': gain = 1 + v.Rf / v.Rg; ng = gain; vout = vref + gain * v.Vin; break;
    case 'Inverting amplifier': gain = -v.Rf / v.Rin; ng = 1 + v.Rf / v.Rin; vout = vref + gain * v.Vin; zin = fmt(v.Rin, 'Ω');
      if (v.Cf > 0) extra.push(['−3 dB (Rf·Cf)', fmt(1 / (TAU * v.Rf * v.Cf), 'Hz')]); break;
    case 'Summing amplifier (inverting)': gain = -v.Rf / v.Rin; ng = 1 + v.Rf / par(v.Rin, v.R2); vout = vref - v.Rf * (v.Vin / v.Rin + (v.V2 - vref) / v.R2); zin = `${fmt(v.Rin, 'Ω')} / ${fmt(v.R2, 'Ω')}`;
      extra.push(['Formula', 'Vout = Vref − Rf·(V1/Rin + (V2−Vref)/R2)']); break;
    case 'Difference amplifier': gain = v.Rf / v.Rin; ng = 1 + v.Rf / v.Rin; vout = vref + gain * (v.V2 - (vref + v.Vin)); zin = `${fmt(v.Rin, 'Ω')} (V1), ${fmt(v.Rin + v.Rf, 'Ω')} (V2)`;
      extra.push(['Formula', 'Vout = Vref + (Rf/R1)·(V2 − V1), R3 = R1, R4 = Rf']); break;
    case 'Integrator / inverting low-pass': gain = -v.Rf / v.Rin; ng = 1 + v.Rf / v.Rin; vout = vref + gain * v.Vin; zin = fmt(v.Rin, 'Ω');
      if (v.Cf > 0) { extra.push(['Corner 1/(2π·Rf·Cf)', fmt(1 / (TAU * v.Rf * v.Cf), 'Hz')]); extra.push(['Unity-gain freq 1/(2π·Rin·Cf)', fmt(1 / (TAU * v.Rin * v.Cf), 'Hz')]); }
      else extra.push(['Tip', 'set Cf to make it an integrator / low-pass']); break;
    case 'Transimpedance (photodiode)': gain = v.Rf; ng = 1; vout = vref + iph * v.Rf; zin = '≈ 0 (virtual ground)';
      extra.push(['Photocurrent (BPW34)', fmt(iph, 'A')]);
      if (v.Cf > 0) extra.push(['Bandwidth 1/(2π·Rf·Cf)', fmt(1 / (TAU * v.Rf * v.Cf), 'Hz')]);
      else extra.push(['Tip', 'add Cf (≈ 1–10 pF) for stability']); break;
    case 'Sallen-Key low-pass (unity)': { const C = v.Cf > 0 ? v.Cf : 10e-9; vout = vref + v.Vin; extra.push(['f₀ (Butterworth, C1 = 2·C2)', fmt(1 / (TAU * v.Rin * C * Math.SQRT2), 'Hz')], ['Parts', `R1 = R2 = ${fmt(v.Rin, 'Ω')}, C2 = ${fmt(C, 'F')}, C1 = ${fmt(2 * C, 'F')}`]); break; }
  }
  const clipped = vout > hi || vout < lo;
  const gtxt = cfg === 'Transimpedance (photodiode)' ? `${fmt(gain, 'V/A')} (${fmt(gain, 'Ω')})` : `${gain.toFixed(3)} V/V (${(20 * Math.log10(Math.abs(gain) || 1e-12)).toFixed(2)} dB)`;
  const rows = [
    ['Ideal Vout (DC)', `${fmt(vout, 'V', 4)}${clipped ? ' ⚠ beyond output swing — will clip' : ''}`],
    ['Output swing', `${fmt(lo, 'V', 3)} … ${fmt(hi, 'V', 3)} (${m.hr[1] < 0.1 ? 'rail-to-rail' : 'not rail-to-rail'})`],
    ['Closed-loop BW ≈ GBW / noise gain', fmt(m.gbw / ng, 'Hz')],
    ['Input impedance', zin],
    ...extra,
    ['Supply', single ? `0 / ${fmt(vpos, 'V')}, VREF = ${fmt(vref, 'V')} (bias: 2 equal resistors + 10 µF, or buffered)` : `±${fmt(v.Vs, 'V')}`],
  ];
  const specSupply = (m.specs || []).find(([k]) => k === 'Supply');
  if (specSupply) rows.push([`${v.model} supply range`, specSupply[1]]);
  const tot = single ? v.Vs : 2 * v.Vs;
  const maxV = { MCP6001: 6, MCP6002: 6, TLV9002: 5.5, OPA2340: 5.5, AD8606: 5.5, LMV358: 5.5, TLV2372: 16 }[v.model];
  if (maxV && tot > maxV) rows.unshift(['⚠ Supply', `${fmt(tot, 'V')} total exceeds ${v.model} maximum ${maxV} V`]);
  const minV = { TL072: 7, TL082: 7, NE5532: 6, LM741: 10, OPA2134: 5 }[v.model];
  if (minV && tot < minV) rows.unshift(['⚠ Supply', `${fmt(tot, 'V')} is below the ${v.model} minimum (~${minV} V) — choose a low-voltage part such as MCP6002, TLV9002, OPA2340 or LMV358`]);
  return {
    main: ['Gain', gtxt], rows,
    plot: () => simOpamp(opampDesign(v)),
    insert: () => opampDesign(v),
    note: 'Plot & DC result come from the full solver on this exact circuit (op-amp rails, headroom and GBW included).',
  };
}

function simOpamp(t) {
  try {
    const ckt = new Circuit(t.d);
    ckt.dcop();
    const n = ckt.nl;
    const inNet = n.pinNet(t.inRef.c, t.inRef.p), outNet = n.pinNet(t.outRef.c, t.outRef.p);
    const vo = ckt.V(outNet);
    const dc = Number.isFinite(vo) ? `DC Vout (simulated) = <b>${fmt(vo, 'V', 4)}</b>` : 'DC did not converge';
    let b;
    if (t.tia) {
      const f = logspace(1, 1e7, 161), db = [], ph = [];
      for (const fr of f) {
        const sol = ckt.solveAC(fr, { mode: 'ac', inj: [[inNet, 1]] });
        const [re, im] = sol ? ckt.acV(sol, outNet) : [NaN, NaN];
        db.push(20 * Math.log10(Math.hypot(re, im) || 1e-15)); ph.push((Math.atan2(im, re) * 180) / Math.PI);
      }
      const s = classify(f, db, ph);
      s.type = 'Transimpedance'; s.text = `${fmt(Math.pow(10, db[0] / 20), 'Ω')} at low frequency${s.fc ? `, −3 dB at ${fmt(s.fc, 'Hz')}` : ''}`;
      b = { f, db, ph, summary: s, y1Label: 'dBΩ' };
    } else b = bode(ckt, inNet, outNet, null, 1, 1e7, 161);
    if (b) b.extra = dc;
    return b;
  } catch (e) { console.warn(e); return null; }
}

// ---------- calculator definitions ----------
const R_RANGE = [1, 10e6], C_RANGE = [1e-12, 0.01], L_RANGE = [1e-9, 10], F_RANGE = [0.1, 100e6], V_RANGE = [0, 60];
const CALCS = [
  {
    id: 'filter', name: 'Filters', inputs: [
      { k: 'topo', label: 'Topology', options: Object.keys(TOPOS), def: 'RC low-pass' },
      { k: 'R', label: 'R', unit: 'Ω', range: R_RANGE, log: true, def: 1e3 },
      { k: 'L', label: 'L', unit: 'H', range: L_RANGE, log: true, def: 10e-3 },
      { k: 'C', label: 'C', unit: 'F', range: C_RANGE, log: true, def: 100e-9 },
    ],
    hide: (v) => { const u = TOPOS[v.topo].uses; return ['R', 'L', 'C'].filter((x) => !u.includes(x)); },
    compute: (v) => {
      const t = TOPOS[v.topo];
      const th = t.theory(v);
      return { main: th[0], rows: th.slice(1), plot: () => simTemplate(t.build(v)), insert: () => t.build(v), note: 'Plot = full solver on this exact circuit (same engine as Measure → Freq. response).' };
    },
  },
  {
    id: 'opamp', name: 'Op-amp designer', inputs: [
      { k: 'cfg', label: 'Circuit', options: OPCFG, def: 'Non-inverting amplifier' },
      { k: 'model', label: 'Op-amp', options: Object.keys(PARTS).filter((k) => PARTS[k].type === 'opamp'), def: 'MCP6002' },
      { k: 'supply', label: 'Supply', options: ['Single supply', 'Dual supply (±)'], def: 'Single supply' },
      { k: 'Vs', label: 'Supply voltage (+V, or ±V)', unit: 'V', range: [1, 36], def: 5 },
      { k: 'Vin', label: 'Input signal DC level (vs ref)', unit: 'V', range: [-5, 5], def: 0.1 },
      { k: 'Rin', label: 'Rin / R1', unit: 'Ω', range: R_RANGE, log: true, def: 10e3 },
      { k: 'Rf', label: 'Rf (feedback)', unit: 'Ω', range: R_RANGE, log: true, def: 100e3 },
      { k: 'Rg', label: 'Rg (to ref)', unit: 'Ω', range: R_RANGE, log: true, def: 10e3 },
      { k: 'R2', label: 'R2 (2nd input)', unit: 'Ω', range: R_RANGE, log: true, def: 10e3 },
      { k: 'V2', label: 'V2 (2nd input, absolute)', unit: 'V', range: [-15, 15], def: 2.6 },
      { k: 'Cf', label: 'Cf / C', unit: 'F', range: [1e-12, 1e-3], log: true, def: 0, allowZero: true },
      { k: 'lux', label: 'Light on photodiode', unit: 'lux', range: [0.1, 100000], log: true, def: 1000 },
    ],
    hide: (v) => {
      const show = {
        'Buffer (voltage follower)': ['Vin'],
        'Non-inverting amplifier': ['Vin', 'Rf', 'Rg'],
        'Inverting amplifier': ['Vin', 'Rin', 'Rf', 'Cf'],
        'Summing amplifier (inverting)': ['Vin', 'Rin', 'Rf', 'R2', 'V2'],
        'Difference amplifier': ['Vin', 'Rin', 'Rf', 'V2'],
        'Integrator / inverting low-pass': ['Vin', 'Rin', 'Rf', 'Cf'],
        'Transimpedance (photodiode)': ['Rf', 'Cf', 'lux'],
        'Sallen-Key low-pass (unity)': ['Vin', 'Rin', 'Cf'],
      }[v.cfg] || [];
      return ['Vin', 'Rin', 'Rf', 'Rg', 'R2', 'V2', 'Cf', 'lux'].filter((k) => !show.includes(k));
    },
    compute: (v) => opampCompute(v),
  },
  {
    id: 'divider', name: 'Voltage divider', inputs: [
      { k: 'Vin', label: 'Vin', unit: 'V', range: V_RANGE, def: 12 },
      { k: 'R1', label: 'R1 (top)', unit: 'Ω', range: R_RANGE, log: true, def: 10e3 },
      { k: 'R2', label: 'R2 (bottom)', unit: 'Ω', range: R_RANGE, log: true, def: 4.7e3 },
      { k: 'RL', label: 'Load (0 = none)', unit: 'Ω', range: [0, 10e6], log: true, def: 0, allowZero: true },
      { k: 'Vt', label: 'Target Vout (solve R2)', unit: 'V', range: V_RANGE, def: 3.3 },
    ],
    compute: (v) => {
      const r2e = v.RL > 0 ? (v.R2 * v.RL) / (v.R2 + v.RL) : v.R2;
      const vout = (v.Vin * r2e) / (v.R1 + r2e), i = v.Vin / (v.R1 + r2e);
      const r2t = v.Vt > 0 && v.Vt < v.Vin ? (v.Vt * v.R1) / (v.Vin - v.Vt) : NaN;
      const rth = (v.R1 * r2e) / (v.R1 + r2e);
      return { main: ['Vout', fmt(vout, 'V', 4)], rows: [['Ratio', (vout / v.Vin).toFixed(4)], ['Divider current', fmt(i, 'A')], ['P(R1) / P(R2)', `${fmt(i * i * v.R1, 'W')} / ${fmt((vout * vout) / v.R2, 'W')}`], ['Output impedance', fmt(rth, 'Ω')], ['R2 for target', Number.isFinite(r2t) ? `${fmt(r2t, 'Ω')} → E24 ${fmt(nearestE(r2t, E24), 'Ω')} (${fmt((v.Vin * nearestE(r2t, E24)) / (v.R1 + nearestE(r2t, E24)), 'V')})` : '—']], insert: () => divider(v), measure: 'node' };
    },
  },
  {
    id: 'led', name: 'LED resistor', inputs: [
      { k: 'Vs', label: 'Supply', unit: 'V', range: V_RANGE, def: 5 },
      { k: 'Vf', label: 'LED Vf', unit: 'V', range: [1, 4], def: 2.0 },
      { k: 'If', label: 'LED current', unit: 'A', range: [1e-4, 0.1], log: true, def: 0.01 },
      { k: 'n', label: 'LEDs in series', unit: '', range: [1, 10], def: 1, step: 1 },
    ],
    compute: (v) => { const r = (v.Vs - v.Vf * v.n) / v.If; const e = nearestE(r, E12); return { main: ['R', r > 0 ? fmt(r, 'Ω') : 'Supply too low'], rows: [['Nearest E12', `${fmt(e, 'Ω')} → ${fmt((v.Vs - v.Vf * v.n) / e, 'A')}`], ['Resistor power', fmt(v.If * v.If * r, 'W')], ['Suggested rating', v.If * v.If * r > 0.125 ? '½ W' : '¼ W']] }; },
  },
  {
    id: 'ohm', name: "Ohm's law", inputs: [
      { k: 'V', label: 'Voltage', unit: 'V', range: [0, 1000], log: false, def: 12 },
      { k: 'R', label: 'Resistance', unit: 'Ω', range: R_RANGE, log: true, def: 100 },
    ],
    compute: (v) => ({ main: ['I = V/R', fmt(v.V / v.R, 'A')], rows: [['P = V²/R', fmt((v.V * v.V) / v.R, 'W')], ['Conductance', fmt(1 / v.R, 'S')]] }),
  },
  {
    id: 'react', name: 'Reactance', inputs: [
      { k: 'f', label: 'Frequency', unit: 'Hz', range: F_RANGE, log: true, def: 1e3 },
      { k: 'C', label: 'C', unit: 'F', range: C_RANGE, log: true, def: 100e-9 },
      { k: 'L', label: 'L', unit: 'H', range: L_RANGE, log: true, def: 1e-3 },
    ],
    compute: (v) => ({ main: ['XC', fmt(1 / (TAU * v.f * v.C), 'Ω')], rows: [['XL', fmt(TAU * v.f * v.L, 'Ω')], ['LC resonance', fmt(1 / (TAU * Math.sqrt(v.L * v.C)), 'Hz')], ['Z₀ = √(L/C)', fmt(Math.sqrt(v.L / v.C), 'Ω')]] }),
  },
  {
    id: 'lm317', name: 'LM317', inputs: [
      { k: 'R1', label: 'R1 (OUT→ADJ)', unit: 'Ω', range: [50, 2000], log: true, def: 240 },
      { k: 'R2', label: 'R2 (ADJ→GND)', unit: 'Ω', range: [10, 100e3], log: true, def: 720 },
    ],
    compute: (v) => { const vo = 1.25 * (1 + v.R2 / v.R1) + 50e-6 * v.R2; return { main: ['Vout', fmt(vo, 'V', 4)], rows: [['Min. input', fmt(vo + 2.5, 'V')], ['Divider current', fmt(1.25 / v.R1, 'A')]] }; },
  },
  {
    id: '555', name: '555 astable', inputs: [
      { k: 'R1', label: 'R1', unit: 'Ω', range: [100, 10e6], log: true, def: 1e3 },
      { k: 'R2', label: 'R2', unit: 'Ω', range: [100, 10e6], log: true, def: 10e3 },
      { k: 'C', label: 'C', unit: 'F', range: [1e-10, 1e-3], log: true, def: 100e-9 },
    ],
    compute: (v) => { const th = 0.693 * (v.R1 + v.R2) * v.C, tl = 0.693 * v.R2 * v.C; return { main: ['Frequency', fmt(1 / (th + tl), 'Hz')], rows: [['Duty cycle', ((th / (th + tl)) * 100).toFixed(1) + ' %'], ['t high / t low', `${fmt(th, 's')} / ${fmt(tl, 's')}`]] }; },
  },
  {
    id: 'gate', name: 'MOSFET gate drive', inputs: [
      { k: 'Qg', label: 'Total gate charge Qg', unit: 'C', range: [1e-9, 500e-9], log: true, def: 63e-9 },
      { k: 'Vdrv', label: 'Drive voltage', unit: 'V', range: [3, 20], def: 12 },
      { k: 'Ipk', label: 'Driver peak current', unit: 'A', range: [0.01, 10], log: true, def: 1.5 },
      { k: 'Rg', label: 'Gate resistor', unit: 'Ω', range: [0, 100], def: 10 },
      { k: 'f', label: 'Switching frequency', unit: 'Hz', range: [10, 1e6], log: true, def: 20e3 },
    ],
    compute: (v) => { const ipk = Math.min(v.Ipk, v.Vdrv / Math.max(v.Rg, 0.1)); const t = v.Qg / ipk; const p = v.Qg * v.Vdrv * v.f; return { main: ['Switch time ≈ Qg / Ipk', fmt(t, 's')], rows: [['Effective peak current', fmt(ipk, 'A')], ['Gate drive power', fmt(p, 'W')], ['Avg driver current', fmt(v.Qg * v.f, 'A')], ['Max duty-limited f (t ≤ 2% of period)', fmt(0.02 / t, 'Hz')]] }; },
  },
];

// ---------- decoupling capacitors ----------
const DEF_IC = IC_PRESETS['ESP32-S3 (Wi-Fi TX bursts)'];
const decoupleCalc = {
  id: 'decap', name: 'Decoupling', inputs: [
    { k: 'preset', label: 'What are you decoupling?', options: Object.keys(IC_PRESETS), def: 'ESP32-S3 (Wi-Fi TX bursts)', onSelect: (v, val) => { const p = IC_PRESETS[val]; if (p) Object.assign(v, p); } },
    { k: 'Vdd', label: 'Rail voltage', unit: 'V', range: [0.8, 60], log: true, def: DEF_IC.Vdd },
    { k: 'dI', label: 'Load current step ΔI', unit: 'A', range: [1e-3, 100], log: true, def: DEF_IC.dI },
    { k: 'tr', label: 'Edge / rise time', unit: 's', range: [100e-12, 10e-6], log: true, def: DEF_IC.tr },
    { k: 'dV', label: 'Allowed rail ripple ΔV', unit: 'V', range: [1e-3, 5], log: true, def: DEF_IC.dV },
    { k: 'Q', label: 'Charge per switching event (0 = ignore)', unit: 'C', range: [1e-9, 1e-5], log: true, allowZero: true, def: 0 },
    { k: 'fReg', label: 'Regulator / source bandwidth', unit: 'Hz', range: [100, 2e6], log: true, def: DEF_IC.fReg },
    { k: 'pins', label: 'Supply pins to decouple', unit: '', range: [1, 16], step: 1, def: DEF_IC.pins },
    { k: 'bulk', label: 'Bulk capacitor type', options: BULK_TECH, def: BULK_TECH[1] },
    { k: 'diel', label: 'Ceramic dielectric', options: DIELECTRICS, def: DIELECTRICS[0] },
    { k: 'Vr', label: 'Ceramic voltage rating', unit: 'V', range: [4, 100], log: true, def: 10 },
    { k: 'mount', label: 'Mounting / wiring', options: Object.keys(MOUNTS), def: Object.keys(MOUNTS)[1] },
  ],
  compute: (v) => {
    const r = designDecoupling({ ...v, pins: Math.round(v.pins) });
    const rows = [
      ['__h', 'What the rail needs'],
      ['Target impedance  ΔV / ΔI', fmt(r.Zt, 'Ω')],
      ['Edge knee frequency  0.35 / tr', fmt(r.fKnee, 'Hz')],
      ['Regulator holds the rail up to', fmt(r.fReg, 'Hz')],
      ['Reservoir until the regulator reacts', fmt(r.Cbulk, 'F') + '  (ΔI / 2π·f·ΔV)'],
      ['Charge to hold during the edge', fmt(r.Cloc, 'F') + '  (max(ΔI·tr, Q) / ΔV)'],
      ['__h', 'Result'],
      ['Worst impedance in the band', `${fmt(r.peak, 'Ω')} at ${fmt(r.fPeak, 'Hz')} — ${r.ok ? '✓ under' : '✗ above'} the target${r.ok ? ` (${r.margin.toFixed(2)}× margin)` : ''}`],
      ['Parts / effective capacitance', `${r.nTot} / ${fmt(r.totalC, 'F')}`],
      ['Mounting inductance per part', fmt(r.Lm, 'H', 2) + ' (+ the part’s own ESL)'],
      ['Highest frequency this bank can serve', fmt(r.fMax, 'Hz') + '  (Z ≈ ω·L / N)'],
    ];
    const table = { head: ['Qty', 'Part', 'C (effective)', 'ESR', 'Resonance'], rows: r.parts.map((p) => [p.n + ' ×', p.name, fmt(p.Ceff, 'F') + (p.Ceff < p.C * 0.95 ? ` (of ${fmt(p.C, 'F')})` : ''), fmt(p.esr, 'Ω'), fmt(p.srf, 'Hz')]) };
    const warns = [];
    if (!r.ok) {
      if (r.fMax < r.fKnee) warns.push(`The mounting inductance (${fmt(r.Lm, 'H', 2)} per part) limits this bank to about ${fmt(r.fMax, 'Hz')} with ${r.nTot} parts, but the edge reaches ${fmt(r.fKnee, 'Hz')}. Shorten the leads / use a plane and via at the pad, slow the edge, or reduce ΔI.`);
      else warns.push('The target could not be met with a practical number of parts. Relax ΔV, slow the edge, or give the regulator more bandwidth.');
    }
    if (r.parts.some((p) => p.cls === 'mlcc' && p.Ceff < p.C * 0.7)) warns.push('Ceramic capacitance falls with DC bias (the listed effective values include it). A higher voltage rating or C0G keeps more of it.');
    if (v.mount.startsWith('Breadboard')) warns.push('Breadboards and perfboard wiring add ~15 nH per capacitor, so only the larger capacitors help; fast edges need a proper board.');
    warns.push('Put the smallest capacitor closest to the pin, then the larger ones further out; one 100 nF per supply pin is included regardless.');
    const lz = (x) => Math.log10(Math.max(x, 1e-9));
    return {
      main: ['Capacitor bank for this rail', r.parts.map((p) => `${p.n}× ${p.name.replace(/ (aluminium electrolytic|polymer|ceramic|C0G)/, ' $1')}`).join('  +  ') || '—'],
      rows, table, warns,
      freqPlot: { f: r.f, y1: r.z.map(lz), y2: [], y1Log: true, noPhase: true, y1Label: '|Z| of the rail', hlines: [{ y: lz(r.Zt), label: 'target ' + fmt(r.Zt, 'Ω') }], markers: [r.fReg, r.fKnee] },
      note: 'Model: regulator (R + L set by its bandwidth) in parallel with every capacitor as ESR + ESL + mounting L in series with its DC-bias-derated C. Values are typical catalogue figures.',
    };
  },
};

// ---------- sensor → ADC interface ----------
const DEF_SRC = SOURCES['pH / ion-selective electrode'], DEF_ADC = ADCS['ADS1115 (16-bit ΔΣ)'];
const KIND = ['Voltage source (Thévenin)', 'Current source (photodiode → transimpedance)'];
const adcSet = (v, a) => Object.assign(v, a);
const sensorCalc = {
  id: 'sensor', name: 'Sensor → ADC', inputs: [
    { k: 'src', label: 'Sensor / source', options: Object.keys(SOURCES), def: 'pH / ion-selective electrode', onSelect: (v, val) => {
      const s = SOURCES[val]; v.kind = s.type === 'I' ? KIND[1] : KIND[0]; v.Rs = s.Rs; v.Cs = s.Cs; v.Ls = s.Ls; v.fsig = s.fsig;
      if (s.type === 'I') { v.ispan = s.span; v.resI = s.res; } else { v.span = s.span; v.res = s.res; } } },
    { k: 'kind', label: 'Output type', options: KIND, def: KIND[0] },
    { k: 'Rs', label: 'Source resistance Rs (coil: DCR)', unit: 'Ω', range: [1, 10e9], log: true, def: DEF_SRC.Rs },
    { k: 'Cs', label: 'Source + cable capacitance', unit: 'F', range: [1e-12, 1e-6], log: true, def: DEF_SRC.Cs },
    { k: 'Ls', label: 'Source inductance (coil; 0 = none)', unit: 'H', range: [1e-6, 100], log: true, allowZero: true, def: 0 },
    { k: 'span', label: 'Signal span (peak-to-peak)', unit: 'V', range: [1e-6, 10], log: true, def: DEF_SRC.span },
    { k: 'ispan', label: 'Maximum photocurrent', unit: 'A', range: [1e-9, 1e-2], log: true, def: 5e-6 },
    { k: 'fsig', label: 'Signal bandwidth (highest frequency of interest)', unit: 'Hz', range: [0.01, 1e6], log: true, def: DEF_SRC.fsig },
    { k: 'res', label: 'Target resolution (smallest change to see)', unit: 'V', range: [1e-9, 1], log: true, def: DEF_SRC.res },
    { k: 'resI', label: 'Target resolution (current)', unit: 'A', range: [1e-12, 1e-3], log: true, def: 5e-9 },
    { k: 'adc', label: 'ADC', options: Object.keys(ADCS), def: 'ADS1115 (16-bit ΔΣ)', onSelect: (v, val) => adcSet(v, ADCS[val]) },
    { k: 'fs', label: 'Sample rate / output data rate', unit: 'Hz', range: [0.5, 5e6], log: true, def: DEF_ADC.fs },
    { k: 'fc', label: 'Filter corner (0 = automatic)', unit: 'Hz', range: [0.01, 1e6], log: true, allowZero: true, def: 0 },
    { k: 'gain', label: 'Gain before the ADC (0 = automatic)', unit: '', range: [1, 1000], log: true, allowZero: true, def: 0 },
    { k: 'Vsup', label: 'Buffer op-amp supply', unit: 'V', range: [1.8, 36], log: true, def: 3.3 },
    { k: 'adcd', label: 'ADC details', options: ['Hide', 'Show / edit'], def: 'Hide' },
    { k: 'bits', label: 'ADC resolution (bits)', unit: '', range: [8, 32], step: 1, def: DEF_ADC.bits },
    { k: 'vfs', label: 'ADC full-scale input', unit: 'V', range: [0.01, 12], log: true, def: DEF_ADC.vfs },
    { k: 'enob', label: 'Effective bits (noise-limited)', unit: '', range: [6, 26], step: 0.1, def: DEF_ADC.enob },
    { k: 'csamp', label: 'Sampling capacitor (0 = ΔΣ / buffered)', unit: 'F', range: [1e-12, 1e-9], log: true, allowZero: true, def: DEF_ADC.csamp },
    { k: 'rsw', label: 'Sampling switch resistance', unit: 'Ω', range: [1, 10e3], log: true, allowZero: true, def: DEF_ADC.rsw },
    { k: 'ib', label: 'ADC input current', unit: 'A', range: [1e-12, 1e-5], log: true, def: DEF_ADC.ib },
    { k: 'zin', label: 'ΔΣ input impedance', unit: 'Ω', range: [1e3, 1e10], log: true, allowZero: true, def: DEF_ADC.zin },
    { k: 'tacq', label: 'Acquisition share of the sample period', unit: '', range: [0.02, 1], def: DEF_ADC.tacq },
  ],
  hide: (v) => {
    const h = [];
    if (v.kind === KIND[1]) h.push('span', 'res'); else h.push('ispan', 'resI');
    if (v.adcd === 'Hide') h.push('bits', 'vfs', 'enob', 'csamp', 'rsw', 'ib', 'zin', 'tacq');
    return h;
  },
  compute: (v) => sensorCompute(v),
};
function sensorCompute(v) {
  const isI = v.kind === KIND[1];
  const dv = { ...v, type: isI ? 'I' : 'V', span: isI ? v.ispan : v.span, res: isI ? v.resI : v.res };
  const o = designSensor(dv);
  const U = isI ? 'A' : 'V';
  const nz = (x) => fmt(x, U);
  const rows = [];
  const E = (x) => fmt(x, 'Ω'), F = (x) => fmt(x, 'F');
  const srcNote = (SOURCES[v.src] || {}).note;
  // ---------- signal chain
  rows.push(['__h', 'Recommended signal chain']);
  if (isI) {
    const t = o.tia;
    rows.push(['Transimpedance stage', `Rf = ${E(t.Rf)}, Cf = ${F(t.Cf)} → ${fmt(t.vout, 'V')} at ${fmt(dv.span, 'A')}`]);
    rows.push(['Bandwidth  1 / (2π·Rf·Cf)', fmt(t.bw, 'Hz') + (t.bw < v.fsig ? ' ✗ below the signal band' : ' ✓')]);
    rows.push(['Op-amp needs', `GBW ≳ ${fmt(o.GBWmin, 'Hz')}, input bias ≪ ${fmt(dv.res, 'A')}${o.cands.length ? '' : ' — none in the list'}`]);
  } else {
    const dirLine = o.arch === 'direct';
    rows.push(['Architecture', dirLine ? 'Sensor → R → C → ADC (no buffer needed)' : `Sensor → R → C → buffer${o.G > 1 ? ' + gain' : ''} → ${o.Riso ? 'R → C (charge reservoir) → ' : ''}ADC`]);
    if (v.Ls > 0) {
      rows.push(['Coil + cable resonance', `${fmt(o.f0, 'Hz')}, Q ${o.Qraw.toFixed(1)}${o.Rdamp ? ' → damp with ' + E(o.Rdamp) + ' across the coil (Q ≈ 0.7)' : ''}`]);
      if (o.C1 > 0) rows.push(['Extra capacitor across the coil', F(o.C1)]);
    } else {
      rows.push(['Series resistor R1 (incl. Rs)', `${E(o.R1)}${o.Rser > 0 ? ' — add ' + E(o.Rser) : ' (the source alone)'}`]);
      rows.push(['Shunt capacitor C1', o.C1 > 0 ? F(o.C1) + ' (C0G / film)' : 'none needed — the cable capacitance already does it']);
    }
    rows.push(['Filter corner', `${fmt(o.fcAct, 'Hz')}  (${o.droopDb.toFixed(2)} dB at ${fmt(v.fsig, 'Hz')}; ${o.aliasDb.toFixed(0)} dB at ${fmt(o.fAlias, 'Hz')})`]);
    if (!dirLine) {
      rows.push(['Buffer op-amp', o.cands.length ? o.cands.slice(0, 3).map((c) => `${c.name} (Ib ${fmt(c.ib, 'A', 2)}, ${fmt(c.en * 1e9, '', 2).trim()} nV/√Hz)`).join(' · ') : 'none in the list fits'] );
      rows.push(['Needs GBW of at least', fmt(o.GBWmin, 'Hz')]);
      if (o.gainNet) rows.push([`Gain ×${o.gainNet.G.toFixed(2)}`, `Rg = ${E(o.gainNet.Rg)}, Rf = ${E(o.gainNet.Rf)} (non-inverting)`]);
      if (o.Cf) rows.push(['Charge reservoir', `${E(o.Riso)} in series, ${F(o.Cf)} to ground  (C ≥ 2^N × C_sample = ${F(o.Cbucket)})`]);
    } else if (o.pga) rows.push(['ADC gain setting', `PGA ×${o.pga} (signal ${fmt(v.span * o.pga, 'V')} of ${fmt(v.vfs, 'V')})`]);
    else if (o.G > 1) rows.push(['Gain', `×${o.G}`]);
    if (!dirLine) { rows.push(['Why not direct?', o.direct.fail.length ? o.direct.fail.join('; ') : 'a gain stage is needed']); }
  }
  // ---------- resolution
  rows.push(['__h', 'Resolution']);
  rows.push(['ADC step (LSB)', `${fmt(o.LSB, 'V')}${o.G > 1 && !isI ? ' → ' + fmt(o.lsbIn, 'V') + ' at the sensor (÷' + o.G + ')' : ''}`]);
  if (!isI) rows.push(['Bits the target needs / ADC delivers', `${o.bitsNeeded.toFixed(1)} / ${v.enob}`]);
  rows.push(['Achievable (6.6σ noise)', `${nz(o.resAnalog)}${!isI ? '  ≈ ' + o.enobIn.toFixed(1) + ' bits' : ''}  — ${o.meets ? '✓ meets' : '✗ misses'} ${nz(dv.res)}`]);
  if (!isI) {
    rows.push(['With averaging (×' + Math.floor(o.osrMax) + ' samples)', `${nz(o.resAvg)}  ≈ ${o.enobAvg.toFixed(1)} bits — ${o.meetsAvg ? '✓ meets' : '✗ misses'} the target`]);
    if (!o.meets) rows.push(['Samples to average needed', `${Math.ceil(o.osrNeed)} (rate ${fmt(v.fs / Math.ceil(o.osrNeed), 'Hz')} out${Math.ceil(o.osrNeed) > o.osrMax ? '; bandwidth would suffer' : ''})`]);
    rows.push(['Highest Rs for the target (thermal only)', E(o.rsMaxNoise)]);
    if (!o.direct.ok || o.arch === 'buffered') { /* offsets */ }
    rows.push(['Offset from input current × Rs', `${fmt((o.amp ? o.amp.ib : v.ib) * v.Rs, 'V')} (${o.amp ? o.amp.name : 'ADC'})`]);
  } else {
    const t = o.tia;
    rows.push(['Transimpedance noise', `Rf ${fmt(t.eRf, 'V')} · in ${fmt(t.eIn, 'V')} · en ${fmt(t.eEn, 'V')} · ADC ${fmt(t.eAdc, 'V')} (rms)`]);
    rows.push(['Op-amp bias × Rf', fmt(t.ibErr * t.Rf, 'V')]);
  }
  let table = null;
  if (!isI) {
    const a = o.noiseAnalog, b = o.noiseAvg;
    const line = (n, x, y) => [n, fmt(x, 'V', 3), fmt(y, 'V', 3)];
    table = { head: ['Noise at the sensor (rms)', 'single sample', 'averaged'], rows: [line('Source resistance', a.eRs, b.eRs), line('Series resistor', a.eSer, b.eSer), line('Op-amp voltage noise', a.eAmp, b.eAmp), line('Op-amp current noise × R', a.eIn, b.eIn), line('ADC noise ÷ gain', a.eAdc, b.eAdc), ['Total', fmt(a.total, 'V', 3), fmt(b.total, 'V', 3)]] };
  }
  const warns = o.warns.slice();
  if (srcNote) warns.push(srcNote);
  return {
    main: isI ? ['Smallest current you can resolve', fmt(o.resI, 'A')] : ['Achievable resolution (noise-limited)', fmt(o.resAnalog, 'V')],
    rows, table, warns,
    plot: () => (isI ? simOpamp(sensorTemplate(dv, o)) : simTemplate(sensorTemplate(dv, o))),
    insert: () => sensorTemplate(dv, o),
    note: 'Noise: Rs thermal √(4kTR·B), op-amp en and in·R, converter noise from its effective bits. Currents/offsets use typical datasheet values, which vary a lot — check the real parts.',
  };
}

/** Build the designed signal path as a schematic: source → Rs (+L) → filter → [buffer] → reservoir → OUT. */
function sensorTemplate(v, o) {
  if (v.type === 'I' && o.tia) {
    const pdv = { cfg: 'Transimpedance (photodiode)', model: o.amp ? o.amp.name : 'MCP6002', supply: 'Single supply', Vs: v.Vsup, Rf: o.tia.Rf, Cf: o.tia.Cf, lux: Math.max(1, (v.span / 70e-6) * 1000) };
    if (!PARTS[pdv.model]) pdv.model = 'MCP6002';
    return opampDesign(pdv);
  }
  const d = T();
  const buffered = o.arch !== 'direct';
  const src = put(d, 'vac', 0, 60, { amp: '1', freq: ev(Math.max(v.fsig / 2, 0.1)), offset: buffered ? String(+(v.Vsup / (2 * (o.gainNet ? o.gainNet.G : 1))).toFixed(4)) : '0' });
  const g0 = put(d, 'ground', 0, 110); W(d, src, 1, g0, 0);
  let x = 80, prev = pe(src, 0), last = null;
  const series = (type, value) => { const e = put(d, type, x, 0, { value: ev(value) }); addWire(d, prev, pe(e, 0)); prev = pe(e, 1); last = pe(e, 1); x += 90; return e; };
  let node = null, nodeX = 0, ns = 0;
  const startNode = () => { nodeX = x; node = jn(d, nodeX, 0); addWire(d, prev, node); prev = node; ns = 0; x += 60; };
  const shunt = (type, value) => {
    const e = put(d, type, nodeX + ns * 50, 50, { value: ev(value) }, 1);
    addWire(d, node, pe(e, 0));
    const g = put(d, 'ground', e.x, 100); addWire(d, pe(e, 1), pe(g, 0));
    last = pe(e, 0); ns++; x = nodeX + ns * 50 + 60;
    return e;
  };
  series('resistor', v.Rs);
  if (v.Ls > 0) series('inductor', v.Ls);
  if (v.Ls <= 0 && o.Rser > 0) series('resistor', o.Rser);
  const direct = o.arch === 'direct';
  const C1 = direct && o.Cbucket ? Math.max(o.C1, o.Cbucket) : o.C1;
  startNode();
  if (v.Cs > 0) shunt('capacitor', v.Cs);
  if (v.Ls > 0 && o.Rdamp > 0) shunt('resistor', o.Rdamp);
  if (C1 > 0) shunt('capacitor', C1);
  if (!direct) {
    const model = o.amp && PARTS[o.amp.name] ? o.amp.name : 'MCP6002';
    const u = put(d, 'opamp', x + 150, 10, { plusTop: true }, 0, model);
    addWire(d, prev, pe(u, 0));
    const rp = put(d, 'rail', x + 150, -30, { volts: String(v.Vsup), name: '+V' }); W(d, rp, 0, u, 3);
    const gg = put(d, 'ground', x + 150, 60); W(d, u, 4, gg, 0);
    const j1 = jn(d, x + 100, 100); addWire(d, pe(u, 1), j1);
    if (o.gainNet) {
      const rf = put(d, 'resistor', x + 150, 100, { value: ev(o.gainNet.Rf) }); addWire(d, j1, pe(rf, 0)); W(d, rf, 1, u, 2);
      const rg = put(d, 'resistor', x + 100, 150, { value: ev(o.gainNet.Rg) }, 1); addWire(d, j1, pe(rg, 0));
      const g2 = put(d, 'ground', x + 100, 200); addWire(d, pe(rg, 1), pe(g2, 0));
    } else addWire(d, j1, pe(u, 2));
    prev = pe(u, 2); x += 320; last = pe(u, 2);
    if (o.Cf) {
      const ri = put(d, 'resistor', x, 0, { value: ev(o.Riso) }); addWire(d, prev, pe(ri, 0)); prev = pe(ri, 1); x += 70;
      const cf = put(d, 'capacitor', x, 50, { value: ev(o.Cf) }, 1); addWire(d, prev, pe(cf, 0));
      const g3 = put(d, 'ground', x, 100); addWire(d, pe(cf, 1), pe(g3, 0)); last = pe(cf, 0); x += 60;
    }
  }
  const lbl = put(d, 'netlabel', x + 20, 0, { name: 'OUT' });
  addWire(d, prev, pe(lbl, 0));
  return { d, inRef: pe(src, 0), outRef: last };
}

CALCS.push(decoupleCalc, sensorCalc);

function simTemplate(t) {
  try {
    const ckt = new Circuit(t.d);
    ckt.dcop();
    const n = ckt.nl;
    return bode(ckt, n.pinNet(t.inRef.c, t.inRef.p), n.pinNet(t.outRef.c, t.outRef.p), null, 1, 1e7, 161);
  } catch (e) { console.warn(e); return null; }
}

// ---------- UI ----------
const state = { tab: 'filter', vals: {} };
function vals(calc) {
  const v = state.vals[calc.id] || (state.vals[calc.id] = {});
  for (const i of calc.inputs) if (v[i.k] == null) v[i.k] = i.def;
  return v;
}
const toSlider = (i, x) => {
  const [a, b] = i.range;
  if (i.log) { const la = Math.log10(Math.max(a, 1e-15)), lb = Math.log10(b); return x <= 0 ? 0 : ((Math.log10(x) - la) / (lb - la)) * 1000; }
  return ((x - a) / (b - a)) * 1000;
};
const fromSlider = (i, s) => {
  const [a, b] = i.range;
  if (i.allowZero && s <= 0) return 0;
  if (i.log) { const la = Math.log10(Math.max(a, 1e-15)), lb = Math.log10(b); return +Math.pow(10, la + (s / 1000) * (lb - la)).toPrecision(3); }
  const x = a + (s / 1000) * (b - a);
  return i.step ? Math.round(x / i.step) * i.step : +x.toPrecision(3);
};
const show = (i, x) => (i.unit === '' ? String(x) : fmt(x, i.unit, 4).replace(' ', ' '));

export function openTools(app) {
  const render = () => {
    const calc = CALCS.find((c) => c.id === state.tab);
    const v = vals(calc);
    const hidden = calc.hide ? calc.hide(v) : [];
    let h = `<div class="tabs">${CALCS.map((c) => `<button data-tab="${c.id}" class="${c.id === state.tab ? 'on' : ''}">${esc(c.name)}</button>`).join('')}</div><div class="calc">`;
    for (const i of calc.inputs) {
      if (hidden.includes(i.k)) continue;
      if (i.options) { h += `<div class="ctl"><div class="top"><label>${esc(i.label)}</label><select class="inp" style="width:auto;flex:1" data-k="${i.k}">${i.options.map((o) => `<option ${o === v[i.k] ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div></div>`; continue; }
      h += `<div class="ctl"><div class="top"><label>${esc(i.label)}</label><input class="inp" data-k="${i.k}" value="${esc(show(i, v[i.k]))}" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false"></div><input type="range" min="0" max="1000" step="1" value="${toSlider(i, v[i.k])}" data-s="${i.k}"></div>`;
    }
    h += `<div class="res" id="calcRes"></div></div>`;
    return h;
  };
  const update = (body) => {
    const calc = CALCS.find((c) => c.id === state.tab);
    const v = vals(calc);
    const r = calc.compute(v);
    const big = String(r.main[1]).length > 26;
    let h = `<div class="t2" style="color:var(--muted);font-size:13px">${esc(r.main[0])}</div><div class="big${big ? ' long' : ''}">${esc(r.main[1])}</div><dl class="kv">${(r.rows || []).map(([a, b]) => (a === '__h' ? `<dt class="sec">${esc(b)}</dt>` : `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`)).join('')}</dl>`;
    if (r.table) h += `<div class="rtw"><table class="rt"><thead><tr>${r.table.head.map((x) => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${r.table.rows.map((row) => `<tr>${row.map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    if (r.freqPlot) h += `<canvas class="plot" id="calcFreq" style="margin-top:10px"></canvas>`;
    if (r.warns && r.warns.length) h += `<ul class="cw">${r.warns.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    if (r.plot) h += `<canvas class="plot" id="calcPlot" style="margin-top:10px"></canvas><div class="hint" id="calcSim"></div>`;
    if (r.insert) h += `<div class="actions">${`<button class="btn pri" id="calcInsert">${icon('plus')}Insert into circuit</button>`}</div>`;
    if (r.note) h += `<div class="hint" style="font-size:12.5px">${esc(r.note)}</div>`;
    const res = body.querySelector('#calcRes');
    res.innerHTML = h;
    if (r.freqPlot) { const cv = res.querySelector('#calcFreq'); if (cv) requestAnimationFrame(() => drawPlot(cv, r.freqPlot)); }
    if (r.plot) {
      clearTimeout(update._t);
      update._t = setTimeout(() => {
        const b = r.plot();
        const cv = res.querySelector('#calcPlot');
        if (b && cv) {
          drawPlot(cv, { f: b.f, y1: b.db, y2: b.ph, y1Label: b.y1Label || 'dB', markers: [b.summary.fc, b.summary.f0].filter(Boolean) });
          res.querySelector('#calcSim').innerHTML = `<b>Simulated:</b> ${esc(b.summary.type)} — ${esc(b.summary.text)}${b.extra ? '<br>' + b.extra : ''}`;
        }
      }, 60);
    }
    const ins = res.querySelector('#calcInsert');
    if (ins) ins.onclick = () => { insertTemplate(app, r.insert(), r.measure || (r.plot ? 'bode' : 'V')); };
  };
  const bind = (body) => {
    const on = body.querySelector('.tabs button.on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
    body.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { state.tab = b.dataset.tab; body.innerHTML = render(); bind(body); });
    const calc = CALCS.find((c) => c.id === state.tab);
    const v = vals(calc);
    body.querySelectorAll('select[data-k]').forEach((s) => s.onchange = () => { v[s.dataset.k] = s.value; const i = calc.inputs.find((x) => x.k === s.dataset.k); if (i && i.onSelect) i.onSelect(v, s.value); body.innerHTML = render(); bind(body); });
    body.querySelectorAll('input[data-s]').forEach((s) => s.oninput = () => {
      const i = calc.inputs.find((x) => x.k === s.dataset.s);
      v[i.k] = fromSlider(i, +s.value);
      const t = body.querySelector(`input[data-k="${i.k}"]`); if (t) t.value = show(i, v[i.k]);
      update(body);
    });
    body.querySelectorAll('input.inp[data-k]').forEach((t) => {
      const commit = () => {
        const i = calc.inputs.find((x) => x.k === t.dataset.k);
        const x = parseEng(t.value);
        if (!Number.isFinite(x) || (x <= 0 && !i.allowZero && i.log)) { t.classList.add('bad'); return; }
        t.classList.remove('bad');
        v[i.k] = x;
        const s = body.querySelector(`input[data-s="${i.k}"]`); if (s) s.value = toSlider(i, x);
        update(body);
      };
      t.onchange = commit;
      t.oninput = () => {
        const i = calc.inputs.find((x) => x.k === t.dataset.k);
        const x = parseEng(t.value);
        if (!Number.isFinite(x) || (x <= 0 && !i.allowZero && i.log)) return;
        t.classList.remove('bad');
        v[i.k] = x;
        const sl = body.querySelector(`input[data-s="${i.k}"]`); if (sl) sl.value = toSlider(i, x);
        update(body);
      };
      t.onkeydown = (e) => { if (e.key === 'Enter') { commit(); t.blur(); } };
    });
    update(body);
  };
  app.openModal('Calculators', render(), bind);
}

/** Merge a template design into the current document near the view centre. */
function insertTemplate(app, t, fn) {
  const d = app.doc;
  app.checkpoint();
  const [cx, cy] = app.editor.viewCenterWorld();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of t.d.comps) { const b = compBBox(c); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  let dx = snap(cx - (x0 + x1) / 2, 20), dy = snap(cy - (y0 + y1) / 2, 20);
  // keep clear of the existing circuit: drop the template to its right if it would overlap
  const ex = designBBox(d);
  if (ex && x0 + dx < ex.x + ex.w + 60 && x1 + dx > ex.x - 60 && y0 + dy < ex.y + ex.h + 60 && y1 + dy > ex.y - 60) {
    dx = snap(ex.x + ex.w + 100 - x0, 20); dy = snap(ex.y - y0, 20);
  }
  const idMap = new Map();
  for (const c of t.d.comps) {
    const n = { ...c, id: uid('c'), x: c.x + dx, y: c.y + dy, props: { ...c.props } };
    n.ref = nextRef(d, c.type);
    idMap.set(c.id, n.id);
    d.comps.push(n);
  }
  const jMap = new Map();
  for (const j of t.d.juncs) { const n = { id: uid('j'), x: j.x + dx, y: j.y + dy }; jMap.set(j.id, n.id); d.juncs.push(n); }
  const mapEnd = (e) => (e.j != null ? { j: jMap.get(e.j) } : { c: idMap.get(e.c), p: e.p });
  for (const w of t.d.wires) d.wires.push({ id: uid('w'), a: mapEnd(w.a), b: mapEnd(w.b), bend: w.bend });
  app.probes.red = { kind: 'pin', c: idMap.get(t.inRef.c), p: t.inRef.p };
  app.probes.black = fn === 'bode' ? { kind: 'pin', c: idMap.get(t.outRef.c), p: t.outRef.p } : null;
  if (fn === 'node') { app.probes.red = { kind: 'pin', c: idMap.get(t.outRef.c), p: t.outRef.p }; app.probes.black = { kind: 'pin', c: idMap.get(t.inRef.c), p: t.inRef.p }; }
  app.meterFn = fn;
  app.closeModal();
  app.changed('insert');
  app.select({ comps: [...idMap.values()] });
  app.editor.centerOn((x0 + x1) / 2 + dx, (y0 + y1) / 2 + dy);
  app.toast('Inserted — probes placed. Open Measure to see the live result.', () => app.setMode('measure'));
}
