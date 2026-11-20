// Engineering math for the Decoupling and Sensor-interface calculators (no DOM, testable in Node).
import { E12, E24 } from './units.js';

const TAU = 2 * Math.PI;
const KB = 1.380649e-23, TEMP = 300;
const log10 = Math.log10;

/** Smallest E-series value ≥ v (or nearest when up = false). */
export function eRound(v, series = E12, up = true) {
  if (!(v > 0)) return v;
  const dec = Math.floor(log10(v));
  let best = Infinity, near = v, ne = Infinity;
  for (const d of [dec - 1, dec, dec + 1]) for (const s of series) {
    const c = s * Math.pow(10, d);
    if (c >= v * 0.9999 && c < best) best = c;
    const e = Math.abs(Math.log(c / v)); if (e < ne) { ne = e; near = c; }
  }
  return up ? best : near;
}

// =====================================================================================================
// Decoupling / power-delivery network
// =====================================================================================================

/** Capacitor catalogue: C (F), typical ESR (Ω), body ESL (H), package/series, class. Values are typical, not guaranteed. */
const mk = (cls, name, C, esr, esl) => ({ cls, name, C, esr, esl });
export const CAPS = [
  mk('elec', '1000 µF aluminium electrolytic', 1000e-6, 0.08, 12e-9),
  mk('elec', '470 µF aluminium electrolytic', 470e-6, 0.12, 10e-9),
  mk('elec', '220 µF aluminium electrolytic', 220e-6, 0.2, 8e-9),
  mk('elec', '100 µF aluminium electrolytic', 100e-6, 0.4, 6e-9),
  mk('elec', '47 µF aluminium electrolytic', 47e-6, 0.8, 6e-9),
  mk('poly', '470 µF polymer', 470e-6, 0.008, 3e-9),
  mk('poly', '220 µF polymer', 220e-6, 0.012, 3e-9),
  mk('poly', '100 µF polymer', 100e-6, 0.02, 2.5e-9),
  mk('poly', '47 µF polymer', 47e-6, 0.03, 2e-9),
  mk('mlcc', '100 µF ceramic 1210', 100e-6, 0.003, 1.2e-9),
  mk('mlcc', '47 µF ceramic 1206', 47e-6, 0.003, 1.1e-9),
  mk('mlcc', '22 µF ceramic 0805', 22e-6, 0.003, 0.9e-9),
  mk('mlcc', '10 µF ceramic 0805', 10e-6, 0.004, 0.8e-9),
  mk('mlcc', '4.7 µF ceramic 0603', 4.7e-6, 0.005, 0.6e-9),
  mk('mlcc', '1 µF ceramic 0603', 1e-6, 0.007, 0.55e-9),
  mk('mlcc', '470 nF ceramic 0402', 470e-9, 0.009, 0.45e-9),
  mk('mlcc', '100 nF ceramic 0402', 100e-9, 0.014, 0.4e-9),
  mk('mlcc', '47 nF ceramic 0402', 47e-9, 0.02, 0.4e-9),
  mk('mlcc', '10 nF ceramic 0402', 10e-9, 0.035, 0.4e-9),
  mk('mlcc', '4.7 nF ceramic 0402', 4.7e-9, 0.05, 0.4e-9),
  mk('mlcc', '1 nF C0G 0402', 1e-9, 0.08, 0.4e-9),
  mk('mlcc', '100 pF C0G 0402', 100e-12, 0.15, 0.4e-9),
  mk('mlcc', '10 pF C0G 0402', 10e-12, 0.3, 0.4e-9),
];

/** Extra series inductance per capacitor from pads, vias and traces. */
export const MOUNTS = {
  'Via at the pad, plane below (≈0.3 nH)': 0.3e-9,
  'Short traces (≈1 nH)': 1e-9,
  'Long traces / hand-wired (≈4 nH)': 4e-9,
  'Breadboard / perfboard wiring (≈15 nH)': 15e-9,
};
export const DIELECTRICS = ['X5R / X7R', 'C0G / NP0 (no derating)'];
export const BULK_TECH = ['Ceramic only', 'Polymer / tantalum + ceramic', 'Aluminium electrolytic + ceramic'];

/** Typical-IC presets: supply, transient current, edge time, allowed ripple, supply pins, charge per event. */
export const IC_PRESETS = {
  'Custom': null,
  'Logic IC (74HC / CD4000, per package)': { Vdd: 5, dI: 0.02, tr: 3e-9, dV: 0.1, pins: 1, Q: 0, fReg: 50e3 },
  'Op-amp (per package)': { Vdd: 5, dI: 0.02, tr: 200e-9, dV: 0.01, pins: 1, Q: 0, fReg: 50e3 },
  'ESP32-S3 (Wi-Fi TX bursts)': { Vdd: 3.3, dI: 0.4, tr: 5e-9, dV: 0.1, pins: 3, Q: 0, fReg: 50e3 },
  'Arduino Nano / ATmega328': { Vdd: 5, dI: 0.03, tr: 5e-9, dV: 0.1, pins: 2, Q: 0, fReg: 50e3 },
  'MOSFET gate driver (TC4420 / IR2110)': { Vdd: 12, dI: 6, tr: 25e-9, dV: 0.3, pins: 1, Q: 120e-9, fReg: 20e3 },
  'Precision ADC supply (ADS1256 / ADS1115)': { Vdd: 5, dI: 0.015, tr: 20e-9, dV: 0.005, pins: 2, Q: 0, fReg: 50e3 },
  'Si5351 clock generator': { Vdd: 3.3, dI: 0.03, tr: 1e-9, dV: 0.03, pins: 1, Q: 0, fReg: 50e3 },
};

const cz = (c, f, Lm, derate) => {           // complex impedance of one capacitor [re, im]
  const w = TAU * f, C = c.C * derate;
  return [c.esr, w * (c.esl + Lm) - 1 / (w * C)];
};
const cinv = ([a, b]) => { const d = a * a + b * b; return [a / d, -b / d]; };

/** Ceramic DC-bias capacitance loss (a typical X5R/X7R shape; C0G loses nothing). */
export function derateOf(c, vdd, vrated, dielectric) {
  if (c.cls !== 'mlcc' || dielectric === DIELECTRICS[1] || /C0G/.test(c.name)) return 1;
  const k = c.C >= 1e-6 ? 3 : c.C >= 100e-9 ? 1 : 0.3;
  return 1 / (1 + k * Math.pow(Math.min(vdd / vrated, 1.2), 2));
}
const srf = (c, Lm, d) => 1 / (TAU * Math.sqrt((c.esl + Lm) * c.C * d));

/** Design a capacitor bank that holds the rail impedance below ΔV/ΔI from the regulator's bandwidth up to the edge's knee frequency. */
export function designDecoupling(v) {
  const Zt = v.dV / v.dI;
  const fKnee = 0.35 / v.tr;
  const fReg = v.fReg;
  const Lm = MOUNTS[v.mount] ?? 1e-9;
  const derateFor = (c) => derateOf(c, v.Vdd, v.Vr, v.diel);
  const Lvrm = Zt / (TAU * fReg), Rvrm = 0.2 * Zt;       // the regulator: holds Zt up to fReg, inductive above
  const Qneed = Math.max(v.dI * v.tr, v.Q || 0);
  const Cloc = Qneed / v.dV;                              // charge the local caps must hold up during the edge
  const Cbulk = v.dI / (TAU * fReg * v.dV);                // reservoir until the regulator loop responds
  const bulkOK = (c) => c.cls === 'mlcc' || (v.bulk === 'Polymer / tantalum + ceramic' && c.cls === 'poly') || (v.bulk === 'Aluminium electrolytic + ceramic' && c.cls === 'elec');
  const catalog = CAPS.filter(bulkOK);
  const fLo = fReg / 10, fHi = Math.max(fKnee, fReg * 2);
  const nB = 360, band = [];
  for (let i = 0; i < nB; i++) band.push(fLo * Math.pow(fHi / fLo, i / (nB - 1)));
  const zOf = (chosen, f) => {
    let y = cinv([Rvrm, TAU * f * Lvrm]);
    for (const { cap, n } of chosen) { const z = cinv(cz(cap, f, Lm, derateFor(cap))); y = [y[0] + n * z[0], y[1] + n * z[1]]; }
    const z = cinv(y); return Math.hypot(z[0], z[1]);
  };
  const peakOf = (chosen) => { let p = 0, fp = band[0]; for (const f of band) { const z = zOf(chosen, f); if (z > p) { p = z; fp = f; } } return { p, fp }; };
  const add = (chosen, cap) => { const e = chosen.find((x) => x.cap === cap); if (e) e.n++; else chosen.push({ cap, n: 1 }); };
  const clone = (ch) => ch.map((x) => ({ cap: x.cap, n: x.n }));
  const total = (ch) => ch.reduce((s, x) => s + x.n, 0);
  const pins = Math.max(1, v.pins | 0), capPin = CAPS.find((c) => c.C === 100e-9);
  let chosen = [{ cap: capPin, n: pins }];           // one 100 nF at every supply pin, whatever the maths says
  // 1) the reservoir: the fewest large capacitors that provide the bulk capacitance
  let best = null;
  for (const c of catalog) {
    if (c.C < 4.7e-6) continue;
    const eff = c.C * derateFor(c), n = Math.max(1, Math.ceil(Cbulk / eff));
    if (n > 6) continue;
    const score = n * 10 + log10(c.C) + (c.cls === 'mlcc' ? 0 : 3);
    if (!best || score < best.score) best = { c, n, score };
  }
  if (best && Cbulk > 2e-6) chosen.push({ cap: best.c, n: best.n });
  // 2) greedy: add parts until the worst in-band impedance is under the target (cheapest part that gets there, else the biggest improvement)
  const MAXP = 16, margin = 0.9;
  let pk = peakOf(chosen);
  while (pk.p > Zt * margin && total(chosen) < MAXP) {
    let bestC = null, cheap = null;
    for (const c of catalog) for (const u of [1, 2, 4]) {
      const t = clone(chosen); for (let i = 0; i < u; i++) add(t, c);
      const q = peakOf(t);
      if (q.p <= Zt * margin) { const cost = u * c.C; if (!cheap || cost < cheap.cost) cheap = { c, u, q, cost }; }
      if (!bestC || q.p < bestC.q.p - 1e-12 || (Math.abs(q.p - bestC.q.p) < 1e-12 && u < bestC.u)) bestC = { c, u, q };
    }
    const pick = cheap || bestC;
    if (!pick || pick.q.p >= pk.p * 0.9999) break;
    for (let i = 0; i < pick.u; i++) add(chosen, pick.c);
    pk = pick.q;
  }
  // 3) prune parts that are not needed
  for (let again = true; again;) {
    again = false;
    for (const e of [...chosen]) {
      if (e.cap === capPin && e.n <= pins) continue;
      const t = clone(chosen); const te = t.find((x) => x.cap === e.cap); te.n--;
      const t2 = t.filter((x) => x.n > 0);
      if (peakOf(t2).p <= Math.max(Zt * margin, pk.p)) { chosen = t2; again = true; break; }
    }
    pk = peakOf(chosen);
  }
  chosen.sort((a, b) => b.cap.C - a.cap.C);
  pk = peakOf(chosen);
  const ok = pk.p <= Zt;
  // the sweep for the plot
  const fa = Math.max(100, fReg / 100), fb = Math.min(3e9, Math.max(fKnee * 10, 1e8)), np = 400;
  const f = [], z = [];
  for (let i = 0; i < np; i++) { const ff = fa * Math.pow(fb / fa, i / (np - 1)); f.push(ff); z.push(zOf(chosen, ff)); }
  const parts = chosen.map(({ cap, n }) => {
    const d = derateFor(cap), L = cap.esl + Lm;
    return { name: cap.name, n, C: cap.C, Ceff: cap.C * d, esr: cap.esr, L, srf: srf(cap, Lm, d), cls: cap.cls };
  });
  const totalC = parts.reduce((s, p) => s + p.n * p.Ceff, 0), nTot = total(chosen);
  // highest frequency the mounting inductance can serve with this many parts (Z ≈ ωL / N)
  const fMax = (Zt * Math.max(1, nTot)) / (TAU * Lm);
  return { Zt, fKnee, fReg, Lm, Lvrm, Cloc, Cbulk, Qneed, parts, nTot, totalC, peak: pk.p, fPeak: pk.fp, ok, f, z, fMax, margin: Zt / pk.p, Zvrm: (ff) => Math.hypot(Rvrm, TAU * ff * Lvrm) };
}

// =====================================================================================================
// Sensor → ADC interface
// =====================================================================================================

/** Source presets. type 'V': Thévenin source Rs (+ coil Ls, cable Cs). type 'I': current source (photodiode) with Cj. */
export const SOURCES = {
  'Generic voltage source': { res: 100e-6, type: 'V', Rs: 10e3, Cs: 100e-12, Ls: 0, span: 0.1, fsig: 100, note: '' },
  'pH / ion-selective electrode': { res: 0.3e-3, type: 'V', Rs: 100e6, Cs: 150e-12, Ls: 0, span: 0.828, fsig: 1, note: 'Needs an electrometer-grade buffer (Ib ≲ 1 pA), a guard ring around the input node, clean flux-free board and short shielded cable — surface leakage of a few pA already looks like tens of µV.' },
  'Thermocouple (K-type)': { res: 1e-6, type: 'V', Rs: 100, Cs: 1e-9, Ls: 0, span: 0.05, fsig: 5, note: 'Tiny signal (≈41 µV/°C): amplify before the ADC, add a cold-junction sensor, and keep the input filter symmetric (differential) so it rejects mains pickup.' },
  'Pickup coil / inductive sensor': { res: 1e-3, type: 'V', Rs: 6e3, Cs: 100e-12, Ls: 2.5, span: 0.5, fsig: 5e3, note: 'The source impedance is DCR + jωL, so it rises with frequency; the coil with the cable capacitance resonates — damp it with a resistor across the coil if it rings.' },
  'Bridge / thermistor / strain gauge': { res: 2e-6, type: 'V', Rs: 5e3, Cs: 10e-12, Ls: 0, span: 0.02, fsig: 10, note: 'Small differential span: use an instrumentation amplifier or a ΔΣ ADC with PGA, drive the bridge from the ADC reference (ratiometric) and keep the filter resistors matched.' },
  'Electret / MEMS microphone': { res: 100e-6, type: 'V', Rs: 2.2e3, Cs: 20e-12, Ls: 0, span: 0.1, fsig: 8e3, note: 'AC-couple with a capacitor ≥ 1/(2π·Rin·f_low) and bias the buffer to mid-supply.' },
  'Photodiode (current source)': { res: 5e-9, type: 'I', Rs: 100e6, Cs: 70e-12, Ls: 0, span: 5e-6, fsig: 10e3, note: 'Reverse-bias and use a transimpedance stage; the feedback capacitor is chosen from the diode capacitance and op-amp GBW.' },
};

/** ADC presets: resolution, range, effective bits, sampling capacitance, switch resistance, input leakage, input impedance (0 = none), acquisition fraction. */
export const ADCS = {
  'ESP32-S3 SAR ADC (12-bit)': { bits: 12, vfs: 3.1, enob: 9.5, csamp: 5e-12, rsw: 1e3, ib: 20e-9, zin: 0, tacq: 0.25, fs: 20e3 },
  'ADS1115 (16-bit ΔΣ)': { bits: 16, vfs: 4.096, enob: 15, csamp: 0, rsw: 0, ib: 1e-9, zin: 6e6, tacq: 1, fs: 128 },
  'ADS1220 (24-bit ΔΣ, PGA on)': { bits: 24, vfs: 2.048, enob: 19.5, csamp: 0, rsw: 0, ib: 100e-12, zin: 1e9, tacq: 1, fs: 20 },
  'ADS1256 (24-bit ΔΣ, buffer on)': { bits: 24, vfs: 5, enob: 21, csamp: 0, rsw: 0, ib: 1e-9, zin: 1e9, tacq: 1, fs: 30 },
  'MCP3008 (10-bit SAR)': { bits: 10, vfs: 5, enob: 9.5, csamp: 20e-12, rsw: 1e3, ib: 100e-9, zin: 0, tacq: 0.3, fs: 20e3 },
  'Generic 16-bit SAR': { bits: 16, vfs: 5, enob: 15, csamp: 30e-12, rsw: 200, ib: 5e-9, zin: 0, tacq: 0.3, fs: 100e3 },
  'Generic ΔΣ (PGA, 24-bit)': { bits: 24, vfs: 2.5, enob: 20, csamp: 0, rsw: 0, ib: 0.5e-9, zin: 1e9, tacq: 1, fs: 100 },
};

/** Typical op-amp data for buffers and TIAs: input bias (A), noise voltage (V/√Hz) and current (A/√Hz), GBW, supply range, input-stage rails. Typical datasheet figures. */
export const OPAMPS = {
  'TL072': { ib: 65e-12, en: 18e-9, in: 0.01e-12, gbw: 3e6, vmin: 7, vmax: 36, cin: 5e-12 },
  'OPA2134': { ib: 5e-12, en: 8e-9, in: 3e-15, gbw: 8e6, vmin: 5, vmax: 36, cin: 4e-12 },
  'MCP6002': { ib: 1e-12, en: 28e-9, in: 0.6e-15, gbw: 1e6, vmin: 1.8, vmax: 6, cin: 6e-12 },
  'MCP6001': { ib: 1e-12, en: 28e-9, in: 0.6e-15, gbw: 1e6, vmin: 1.8, vmax: 6, cin: 6e-12 },
  'TLV9002': { ib: 0.5e-12, en: 27e-9, in: 0.5e-15, gbw: 1e6, vmin: 1.8, vmax: 5.5, cin: 5e-12 },
  'TLV2372': { ib: 1e-12, en: 17e-9, in: 0.6e-15, gbw: 3e6, vmin: 2.7, vmax: 16, cin: 5e-12 },
  'OPA2340': { ib: 0.2e-12, en: 25e-9, in: 3e-15, gbw: 5.5e6, vmin: 2.7, vmax: 5.5, cin: 6e-12 },
  'AD8606': { ib: 1e-12, en: 8e-9, in: 0.01e-12, gbw: 10e6, vmin: 2.7, vmax: 5.5, cin: 6e-12 },
  'LMV358': { ib: 15e-9, en: 39e-9, in: 0.1e-12, gbw: 1e6, vmin: 2.7, vmax: 5.5, cin: 5e-12 },
  'LM358': { ib: 20e-9, en: 40e-9, in: 0.1e-12, gbw: 0.7e6, vmin: 3, vmax: 32, cin: 5e-12 },
  'NE5532': { ib: 200e-9, en: 5e-9, in: 0.7e-12, gbw: 10e6, vmin: 6, vmax: 40, cin: 8e-12 },
};

const NICE_GAIN = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
const rms = (...a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0));

/**
 * Design the passives between a (high-impedance) sensor and an ADC input.
 * Inputs (SI): source (type, Rs, Cs, Ls, span), fsig (signal bandwidth), res (target resolution, V — or A for a current source),
 * ADC (bits, vfs, enob, csamp, rsw, ib, zin, tacq, fs), fc (0 = auto), Vsup (op-amp supply), gain (0 = auto).
 */
export function designSensor(v) {
  const N = v.bits, LSB = v.vfs / Math.pow(2, N);
  const fs = v.fs, tAcq = v.tacq / fs, ln2 = Math.LN2;
  const kT4 = 4 * KB * TEMP, K = 6.6;                              // peak-to-peak ≈ 6.6 σ (99.9 %)
  const isI = v.type === 'I';
  const fsig = v.fsig, Rs = v.Rs, Cs = v.Cs || 0, Ls = v.Ls || 0;
  const out = { warns: [], LSB, isI };
  const fc = v.fc > 0 ? v.fc : Math.min(2 * fsig, fs / 2);
  const sar = v.csamp > 0;
  // ---- gain so the sensor span fills the ADC
  let G = 1;
  if (!isI) { if (v.gain > 0) G = v.gain; else for (const g of NICE_GAIN) if (g * v.span <= 0.9 * v.vfs) G = g; }
  out.G = G; out.lsbIn = LSB / G;
  out.bitsNeeded = isI ? null : Math.log2(Math.max(v.span / v.res, 1));
  // ---- the source and its cable
  const zTop = rms(Rs, TAU * fsig * Ls);                           // source impedance at the top of the band
  out.fSrc = Cs > 0 && Rs > 0 && !Ls ? 1 / (TAU * Rs * Cs) : Infinity;
  out.zTop = zTop;
  // ---- the converter
  const lsbFrac = 1 / Math.pow(2, v.enob);                           // compare errors with the converter's real (noise-limited) resolution
  out.Cbucket = sar ? Math.pow(2, N) * v.csamp : 0;
  out.rinEq = sar ? 1 / (fs * v.csamp) : v.zin;                    // a switched-capacitor input looks like 1 / (fs·C)
  // ---- first filter (R ahead of C): single pole, or the coil's own second-order resonance
  let Rser = 0, C1 = 0, fcAct = fc, Rdamp = 0;
  if (Ls > 0) {
    const f0 = Math.max(fc, 2.5 * fsig);
    const Ctot = 1 / (Math.pow(TAU * f0, 2) * Ls);
    C1 = Math.max(0, Ctot - Cs);
    const Ct = C1 + Cs, Z0 = Math.sqrt(Ls / Ct);
    const Qraw = Z0 / Rs;
    if (Qraw > 0.8) Rdamp = 0.707 * Z0;               // parallel damping resistor across the coil / cable
    fcAct = 1 / (TAU * Math.sqrt(Ls * Ct));
    out.Q = Qraw > 0.8 ? 0.707 : Qraw; out.Qraw = Qraw; out.f0 = fcAct; out.Ctot = Ct; out.Z0 = Z0;
  } else {
    const Rfloor = Math.max(Rs, 100);
    // pick the filter capacitor: the smallest C whose series-resistor noise stays well under the target
    const allowE = Math.pow(0.3 * v.res / K, 2) / (kT4 * (Math.PI / 2) * fc);
    let pick = null;
    for (const Cp of [1e-9, 10e-9, 100e-9, 1e-6, 10e-6]) {
      const R = 1 / (TAU * fc * (Cp + Cs));
      if (Rs >= R) { pick = { Cp, R: Rs, ser: 0 }; break; }
      const ser = Math.max(R, Rfloor) - Rs;
      pick = { Cp, R: Math.max(R, Rfloor), ser };
      if (ser <= allowE || isI) break;
    }
    Rser = pick.ser;
    const Rsum = Rs + Rser;
    C1 = Math.max(0, 1 / (TAU * Rsum * fc) - Cs);
    fcAct = 1 / (TAU * Rsum * (eRound(C1 || 1e-12, E12, false) + Cs));
    if (C1 > 0) C1 = eRound(C1, E12, false);
    if (!C1) fcAct = Math.min(fc, out.fSrc);
  }
  const Rsum = Rs + Rser;
  out.Rser = Rser; out.R1 = Rsum; out.C1 = C1; out.fcAct = fcAct; out.Rdamp = Rdamp;
  // ---- charge bucket and isolation resistor behind a buffer (SAR converters)
  let Cf = 0, Riso = 0;
  if (sar) {
    Cf = Math.max(1e-9, eRound(out.Cbucket, E12, true));
    const Rmax = tAcq / ((N + 1) * ln2 * Cf);
    Riso = Rmax >= 100 ? 47 : Rmax >= 22 ? eRound(Rmax * 0.8, E24, false) : 10;
    out.RisoBad = Rmax < 10;
  }
  out.Cf = Cf; out.Riso = Riso;
  // ---- buffer requirements and candidates
  const gbwSettle = sar ? 3 * ((N + 1) * ln2) / (TAU * tAcq) : 0;
  let GBWmin = Math.max(gbwSettle, 10 * G * fsig);
  const noiseFloorI = (o) => (isI ? o.ib : o.ib * Rs);
  out.cands = [];
  // ---- direct connection (no buffer)
  const dir = { fail: [] };
  if (!isI) {
    dir.gainErr = (out.rinEq > 0 ? Rsum / (out.rinEq + Rsum) : 0);
    dir.offset = v.ib * Rs;
    if (dir.gainErr > 2 * lsbFrac) dir.fail.push(`the converter's input (≈ ${fmtR(out.rinEq)}) loads the source: ${(dir.gainErr * 1e6).toFixed(dir.gainErr < 1e-3 ? 1 : 0)} ppm gain error (effective LSB = ${(lsbFrac * 1e6).toFixed(1)} ppm)`);
    if (dir.offset > v.res / 2) dir.fail.push(`its input current × the source resistance = ${engV(dir.offset)} offset (target ${engV(v.res)})`);
    if (sar) {
      const Cd = Math.max(C1 + Cs, out.Cbucket);
      dir.fpole = 1 / (TAU * Rsum * Cd);
      if (dir.fpole < fsig) dir.fail.push(`a charge-reservoir capacitor of ${engF(out.Cbucket)} (2^N × C_sample) behind ${fmtR(Rsum)} puts the pole at ${engHz(dir.fpole)}, below the signal band`);
    }
  }
  dir.ok = !isI && dir.fail.length === 0;
  out.direct = dir;
  for (const [name, o] of Object.entries(OPAMPS)) {
    if (v.Vsup < o.vmin || v.Vsup > o.vmax) continue;
    if (o.gbw < GBWmin) continue;
    if (noiseFloorI(o) > v.res / 2) continue;
    out.cands.push({ name, ...o, eIb: noiseFloorI(o), eNoise: rms(o.en, o.in * Rsum) });
  }
  out.cands.sort((a, b) => a.eNoise - b.eNoise);
  out.GBWmin = GBWmin;
  const needAmp = !dir.ok || (sar && G > 1);
  const amp = needAmp ? out.cands[0] || null : null;
  out.amp = amp; out.arch = needAmp ? 'buffered' : 'direct';
  if (!sar && G > 1) out.pga = [128, 64, 32, 16, 8, 4, 2, 1].find((g) => g <= G);
  // ---- noise referred to the sensor (rms V)
  const vAdc = (v.vfs / Math.pow(2, v.enob)) / Math.sqrt(12);
  const en = amp ? amp.en : 0, inn = amp ? amp.in : 0;
  const Bf = (Math.PI / 2) * Math.min(fcAct, fc * 1.5);
  const noise = (B, avg) => {
    const eRs = Math.sqrt(kT4 * Rs * B), eSer = Math.sqrt(kT4 * Rser * B);
    const eAmp = en * Math.sqrt(B), eIn = inn * Rsum * Math.sqrt(B);
    const eAdc = (vAdc / G) * (avg ? Math.sqrt(Math.min(1, B / (fs / 2))) : 1);
    return { eRs, eSer, eAmp, eIn, eAdc, total: rms(eRs, eSer, eAmp, eIn, eAdc) };
  };
  const Bd = (Math.PI / 2) * fsig;
  out.noiseAnalog = noise(Bf, false);
  out.noiseAvg = noise(Math.min(Bf, Bd), true);
  out.resAnalog = K * out.noiseAnalog.total;
  out.resAvg = K * out.noiseAvg.total;
  out.enobIn = !isI && out.resAnalog > 0 ? Math.log2(v.span / out.resAnalog) : null;
  out.enobAvg = !isI && out.resAvg > 0 ? Math.log2(v.span / out.resAvg) : null;
  out.osrMax = Math.max(1, fs / (2 * fsig));
  out.osrNeed = Math.max(1, Math.pow(out.resAnalog / v.res, 2));
  out.rsMaxNoise = Math.pow(v.res / K, 2) / (kT4 * Bf);
  // ---- filter response
  const fAlias = Math.max(fs - fsig, fs / 2);
  const mag = (f) => {
    if (Ls > 0) { const x = f / fcAct, q = out.Q || 0.707; return 1 / Math.sqrt(Math.pow(1 - x * x, 2) + Math.pow(x / q, 2)); }
    return 1 / Math.sqrt(1 + Math.pow(f / fcAct, 2));
  };
  out.droopDb = -20 * log10(mag(fsig));
  out.fAlias = fAlias;
  out.aliasDb = -20 * log10(mag(fAlias));
  out.aliasNeedDb = 6.02 * v.enob + 1.76;
  out.poleSlope = Ls > 0 ? 40 : 20;
  out.orderNeed = Math.max(1, Math.ceil(out.aliasNeedDb / (20 * log10(Math.max(fAlias / fcAct, 1.01)))));
  // ---- gain network and transimpedance stage
  if (G > 1 && !isI && out.arch === 'buffered') { const Rg = 1e3, Rf2 = eRound((G - 1) * Rg, E24, false); out.gainNet = { Rg, Rf: Rf2, G: 1 + Rf2 / Rg }; }
  if (isI) {
    const a = out.cands[0] || null; out.amp = a;
    const Imax = v.span, Cin = Cs + (a ? a.cin : 5e-12);
    const swing = Math.min(0.9 * v.vfs, 0.4 * v.Vsup);                  // single supply: the output rides on Vsup/2, so only about Vsup/2 of swing is left
    const Rf = eRound(swing / Imax, E24, false);
    const gbw = a ? a.gbw : 1e6;
    const CfT = Math.max(0.1e-12, eRound(Math.sqrt(Cin / (TAU * Rf * gbw)), E12, true));
    const bw = 1 / (TAU * Rf * CfT);
    const B = (Math.PI / 2) * Math.min(bw, fc * 1.5);
    const eRf = Math.sqrt(kT4 / Rf * B) * Rf, eIn = (a ? a.in : 0) * Rf * Math.sqrt(B), eEn = (a ? a.en : 0) * (1 + Cin / CfT) * Math.sqrt(B);
    const tot = rms(eRf, eIn, eEn, vAdc);
    out.tia = { Rf, Cf: CfT, Cin, bw, vout: Imax * Rf, iMin: (K * tot) / Rf, eRf, eIn, eEn, eAdc: vAdc, ibErr: a ? a.ib : 0, tot, GBWreq: TAU * Rf * Cin * fsig * fsig * 3 };
    out.GBWmin = Math.max(out.tia.GBWreq, 1e3);
    out.resI = out.tia.iMin; out.resAnalog = out.resI; out.resAvg = out.resI;
    out.osrNeed = Math.max(1, Math.pow(out.resI / v.res, 2));
  }
  if (!isI) {
    const a = out.noiseAnalog, names = { eRs: 'the source resistance (thermal noise)', eSer: 'the series resistor (thermal noise)', eAmp: 'op-amp voltage noise', eIn: 'op-amp current noise × resistance', eAdc: 'the ADC' };
    out.dominant = Object.keys(names).sort((x, y) => a[y] - a[x])[0]; out.dominantName = names[out.dominant];
  }
  out.meets = out.resAnalog <= v.res;
  out.meetsAvg = out.resAvg <= v.res;
  // ---- warnings
  if (!isI) {
    if (out.bitsNeeded > v.enob) out.warns.push(`the target needs ${out.bitsNeeded.toFixed(1)} bits across the sensor span but this converter gives ~${v.enob} effective bits${G > 1 ? ' even with gain ×' + G : ''} — add averaging, use a better ADC, or relax the target`);
    if (fcAct < fsig && !Ls) out.warns.push(`the filter corner ${engHz(fcAct)} is below the signal bandwidth ${engHz(fsig)} — the signal will be attenuated`);
    if (out.fSrc < fsig) out.warns.push(`the source/cable pole 1/(2π·Rs·Cs) = ${engHz(out.fSrc)} is already below the signal bandwidth — shorten the cable, or buffer right at the sensor`);
    if (Ls > 0 && out.Qraw > 0.8) out.warns.push(`the coil and its capacitance resonate at ${engHz(fcAct)} with Q = ${out.Qraw.toFixed(1)} — a parallel damping resistor of ${engR(Rdamp)} across the coil brings it to Q ≈ 0.7`);
  }
  if (!isI && !out.meets) out.warns.push(`target missed: the largest noise contributor is ${out.dominantName}${out.dominant === 'eAdc' ? ' — add gain ahead of it, average samples, or use a lower-noise converter' : out.dominant === 'eRs' ? ' — lower the bandwidth, cool the source, or accept a coarser target' : ''}`);
  if (out.RisoBad) out.warns.push('the sample period is too short to settle through any practical isolation resistor — the op-amp must drive the reservoir capacitor directly (check its stability with that load)');
  if (!isI && !dir.ok && !out.cands.length) out.warns.push('no op-amp in the list meets the supply, bandwidth and input-current needs — pick a lower-bias part or reduce the sample rate / resolution');
  if (sar && out.aliasDb < out.aliasNeedDb) out.warns.push(`this filter gives ${out.aliasDb.toFixed(0)} dB at ${engHz(fAlias)} (the alias frequency); ${out.aliasNeedDb.toFixed(0)} dB keeps aliases under the converter noise — ${out.orderNeed > 3 ? 'oversample and average instead of adding many poles' : 'add ' + (out.orderNeed - 1) + ' more pole(s), or oversample and average'}`);
  return out;
}

// ---- small formatters used in messages
const eng = (x, u, d = 3) => { const a = Math.abs(x); const P = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']]; const q = P.find((p) => a >= p[0] * 0.9995) || P[P.length - 1]; return +(x / q[0]).toPrecision(d) + ' ' + q[1] + u; };
const fmtR = (x) => eng(x, 'Ω');
const engR = fmtR;
const engV = (x) => eng(x, 'V');
const engF = (x) => eng(x, 'F');
const engHz = (x) => eng(x, 'Hz');

