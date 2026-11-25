// Battery chemistries: open-circuit voltage curves, ratings and pack maths (no DOM; used by the
// battery component, design checks, the power budget and the battery tools).
import { parseEng } from './units.js';

const num = (x, d) => { const v = parseEng(x); return Number.isFinite(v) ? v : d; };

/** Per-cell figures. curve = [state of charge %, resting voltage]. maxC / chargeC are typical continuous limits (× capacity). */
export const CHEMS = {
  'Li-ion / LiPo': { short: 'Li-ion', nom: 3.7, full: 4.2, cut: 3.0, chargeV: 4.2, maxC: 1, chargeC: 1, selfPerMonth: 0.02, peukert: 1.03,
    curve: [[0, 3.0], [5, 3.3], [10, 3.45], [20, 3.6], [30, 3.68], [40, 3.73], [50, 3.78], [60, 3.83], [70, 3.9], [80, 3.98], [90, 4.07], [100, 4.2]],
    r: (ah) => 0.06 + 0.04 / ah, note: 'Charge with CC/CV to 4.2 V; never below ≈ 3.0 V; needs a protection circuit.' },
  'LiFePO4': { short: 'LiFePO4', nom: 3.2, full: 3.4, cut: 2.5, chargeV: 3.65, maxC: 2, chargeC: 1, selfPerMonth: 0.03, peukert: 1.03,
    curve: [[0, 2.5], [5, 2.9], [10, 3.05], [20, 3.2], [30, 3.24], [50, 3.27], [70, 3.3], [90, 3.33], [100, 3.4]],
    r: (ah) => 0.03 + 0.03 / ah, note: 'Very flat curve (hard to gauge by voltage); charge to 3.6 V, not 4.2 V.' },
  'NiMH': { short: 'NiMH', nom: 1.2, full: 1.4, cut: 1.0, chargeV: 1.45, maxC: 1, chargeC: 0.5, selfPerMonth: 0.15, peukert: 1.05,
    curve: [[0, 1.0], [5, 1.1], [10, 1.15], [20, 1.2], [50, 1.24], [80, 1.28], [95, 1.33], [100, 1.4]],
    r: (ah) => 0.02 + 0.03 / ah, note: 'Needs a ΔV / temperature-terminated charger; low-self-discharge types lose ≈ 1.5 %/month.' },
  'Alkaline': { short: 'Alkaline', nom: 1.5, full: 1.58, cut: 0.9, chargeV: null, maxC: 0.3, chargeC: 0, selfPerMonth: 0.002, peukert: 1.3, primary: true,
    curve: [[0, 0.9], [10, 1.05], [20, 1.15], [40, 1.25], [60, 1.32], [80, 1.42], [100, 1.58]],
    r: (ah) => 0.12 + 0.05 / ah, note: 'Primary cell — never charge. Capacity falls steeply at high current.' },
  'Lithium coin (CR2032)': { short: 'CR2032', nom: 3.0, full: 3.2, cut: 2.0, chargeV: null, maxC: 0.013, chargeC: 0, selfPerMonth: 0.001, peukert: 1.15, primary: true,
    curve: [[0, 2.0], [5, 2.5], [10, 2.75], [20, 2.85], [50, 2.95], [90, 3.0], [100, 3.2]],
    r: () => 15, note: 'Primary cell — never charge. ≈ 3 mA continuous; radio bursts need a large capacitor across it.' },
  'Lead-acid (SLA)': { short: 'SLA', nom: 2.0, full: 2.12, cut: 1.75, chargeV: 2.4, maxC: 1, chargeC: 0.25, selfPerMonth: 0.03, peukert: 1.2,
    curve: [[0, 1.93], [20, 1.98], [40, 2.02], [60, 2.06], [80, 2.09], [100, 2.12]],
    r: (ah) => 0.004 + 0.02 / ah, note: 'Rated at the 20-hour rate (0.05C); much less capacity at high current. Float charge 2.25–2.3 V per cell.' },
};
export const CHEM_NAMES = Object.keys(CHEMS);

/** Resting voltage per cell at a state of charge (%). */
export function ocv(chem, soc) {
  const c = (CHEMS[chem] || CHEMS['Li-ion / LiPo']).curve;
  const s = Math.max(0, Math.min(100, soc));
  for (let i = 1; i < c.length; i++) if (s <= c[i][0]) { const [s0, v0] = c[i - 1], [s1, v1] = c[i]; return v0 + ((v1 - v0) * (s - s0)) / (s1 - s0); }
  return c[c.length - 1][1];
}

/** Everything about a pack from the battery component's properties. */
export function batteryInfo(p) {
  const chemName = CHEMS[p.chem] ? p.chem : 'Li-ion / LiPo';
  const chem = CHEMS[chemName];
  const S = Math.max(1, Math.round(num(p.series, 1))), P = Math.max(1, Math.round(num(p.parallel, 1)));
  const capCell = Math.max(1e-3, num(p.cap, 100));                                   // mAh
  const soc = Math.max(0, Math.min(100, num(p.soc, 80)));
  const rCell = p.rint !== '' && p.rint != null && Number.isFinite(parseEng(p.rint)) ? parseEng(p.rint) : chem.r(capCell / 1000);
  const capPack = capCell * P;
  const maxI = chemName === 'Lithium coin (CR2032)' ? 0.003 * P : chem.maxC * capPack / 1000;
  return {
    chemName, chem, S, P, capCell, capPack, soc,
    Vcell: ocv(chemName, soc), V: ocv(chemName, soc) * S, Vnom: chem.nom * S, Vfull: chem.full * S, Vcut: chem.cut * S, Vcharge: chem.chargeV ? chem.chargeV * S : null,
    rCell, rPack: (rCell * S) / P, energyWh: (capPack / 1000) * chem.nom * S, maxI, chargeI: chem.chargeC * capPack / 1000,
  };
}

/** Runtime (h) for a constant current from a state of charge, with a Peukert-style correction around the 0.2C rate. */
export function runtimeHours(info, amps, fromSoc = 100) {
  if (!(amps > 0)) return Infinity;
  const capAh = info.capPack / 1000, ref = 0.2 * capAh;
  const eff = capAh * Math.pow(Math.max(ref, 1e-9) / Math.max(amps, 1e-9), info.chem.peukert - 1);
  return Math.min(eff, capAh * 1.05) * (fromSoc / 100) / amps;
}
