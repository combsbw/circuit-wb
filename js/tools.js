// Calculators: sliders + typed values. Filter & divider calculators run the real solver on a template
// circuit and can insert it into the design.
import { fmt, parseEng, nearestE, E12, E24 } from './units.js';
import { newDesign, makeComp, addWire, uid, snap, nextRef, compBBox } from './doc.js';
import { Circuit } from './sim.js';
import { bode } from './analysis.js';
import { drawPlot } from './plot.js';
import { icon } from './icons.js';

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
    id: 'opamp', name: 'Op-amp gain', inputs: [
      { k: 'mode', label: 'Configuration', options: ['Non-inverting', 'Inverting'], def: 'Non-inverting' },
      { k: 'Rf', label: 'Rf (feedback)', unit: 'Ω', range: R_RANGE, log: true, def: 10e3 },
      { k: 'Rg', label: 'Rin / Rg', unit: 'Ω', range: R_RANGE, log: true, def: 1e3 },
      { k: 'gbw', label: 'Op-amp GBW', unit: 'Hz', range: [1e4, 1e9], log: true, def: 3e6 },
    ],
    compute: (v) => { const g = v.mode === 'Inverting' ? -v.Rf / v.Rg : 1 + v.Rf / v.Rg; const nG = 1 + v.Rf / v.Rg; return { main: ['Gain', `${g.toFixed(3)} V/V`], rows: [['Gain (dB)', (20 * Math.log10(Math.abs(g))).toFixed(2) + ' dB'], ['Closed-loop BW ≈ GBW/noise gain', fmt(v.gbw / nG, 'Hz')], ['Input impedance', v.mode === 'Inverting' ? fmt(v.Rg, 'Ω') : 'very high']] }; },
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
    let h = `<div class="t2" style="color:var(--muted);font-size:13px">${esc(r.main[0])}</div><div class="big">${esc(r.main[1])}</div><dl class="kv">${(r.rows || []).map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl>`;
    if (r.plot) h += `<canvas class="plot" id="calcPlot" style="margin-top:10px"></canvas><div class="hint" id="calcSim"></div>`;
    if (r.insert) h += `<div class="actions">${`<button class="btn pri" id="calcInsert">${icon('plus')}Insert into circuit</button>`}</div>`;
    if (r.note) h += `<div class="hint" style="font-size:12.5px">${esc(r.note)}</div>`;
    const res = body.querySelector('#calcRes');
    res.innerHTML = h;
    if (r.plot) {
      clearTimeout(update._t);
      update._t = setTimeout(() => {
        const b = r.plot();
        const cv = res.querySelector('#calcPlot');
        if (b && cv) {
          drawPlot(cv, { f: b.f, y1: b.db, y2: b.ph, y1Label: 'dB', markers: [b.summary.fc, b.summary.f0].filter(Boolean) });
          res.querySelector('#calcSim').innerHTML = `<b>Simulated:</b> ${esc(b.summary.type)} — ${esc(b.summary.text)}`;
        }
      }, 60);
    }
    const ins = res.querySelector('#calcInsert');
    if (ins) ins.onclick = () => { insertTemplate(app, r.insert(), r.measure || (r.plot ? 'bode' : 'V')); };
  };
  const bind = (body) => {
    body.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { state.tab = b.dataset.tab; body.innerHTML = render(); bind(body); });
    const calc = CALCS.find((c) => c.id === state.tab);
    const v = vals(calc);
    body.querySelectorAll('select[data-k]').forEach((s) => s.onchange = () => { v[s.dataset.k] = s.value; body.innerHTML = render(); bind(body); });
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
  const dx = snap(cx - (x0 + x1) / 2, 20), dy = snap(cy - (y0 + y1) / 2, 20);
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
  app.toast('Inserted — probes placed. Open Measure to see the live result.', () => app.setMode('measure'));
}
