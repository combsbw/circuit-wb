// Component library: symbols, pin geometry, editable properties, part spec bank & simulation models.
import { parseEng, short, fmt } from './units.js';
import { batteryInfo, CHEM_NAMES } from './battery.js';

export const GRID = 10;
const VT = 0.025852;

// ---------- math helpers for device models ----------
const sig = (x) => (x > 40 ? 1 : x < -40 ? 0 : 1 / (1 + Math.exp(-x)));
const spos = (x, e = 1e-7) => (x + Math.sqrt(x * x + e * e)) / 2;
const smin = (a, b, e = 0.05) => (a + b - Math.sqrt((a - b) * (a - b) + e * e)) / 2;
function limexp(x, xmax) { return x > xmax ? Math.exp(xmax) * (1 + x - xmax) : Math.exp(x); }
function diodeI(v, Is, n, bv = 0) {
  const nvt = n * VT;
  const xmax = Math.log(50 / Is);
  let i = Is * (limexp(v / nvt, xmax) - 1);
  if (bv > 0) i -= 5e-3 * limexp((-v - bv) / 0.03, 9.2); // reverse breakdown: 5 mA at VZ
  return i + v * 1e-12;
}
// Output stage: sourced current toward target with resistance & current limit
const drive = (vo, vt, rout, ilim) => ilim * Math.tanh((vt - vo) / (rout * ilim));
// Split a bidirectional output current s (+ = sourcing) into the part drawn from the positive rail.
// Sourcing needs the rail above the output, which keeps floating rails from running away.
const fromRail = (s, vrail, vo) => spos(s, 1e-4) * sig((vrail - vo + 0.3) / 0.05);

const num = (v, d) => { const x = parseEng(v); return Number.isFinite(x) ? x : d; };

// ---------- SVG helpers ----------
const P = (d, cls = 's') => `<path class="${cls}" d="${d}"/>`;
const T = (x, y, s, cls = 'tn', a = 'middle') => [x, y, s, cls, a];

// ---------- Part data (spec bank) ----------
export const PARTS = {
  // Diodes
  '1N4148': { type: 'diode', desc: 'Small-signal fast switching diode', pkg: 'DO-35', Is: 2.52e-9, n: 1.75, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VRRM', '100 V'], ['IF(AV)', '200 mA'], ['IFSM', '1 A (1 s) / 4 A (1 µs)'], ['VF', '0.72 V typ @ 5 mA, 1.0 V max @ 10 mA'], ['trr', '4 ns'], ['CT', '4 pF']], imax: 0.2 },
  '1N4007': { type: 'diode', desc: 'General-purpose 1 A rectifier', pkg: 'DO-41', Is: 7e-9, n: 1.8, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VRRM', '1000 V'], ['IF(AV)', '1 A'], ['IFSM', '30 A'], ['VF', '1.1 V max @ 1 A'], ['trr', '~2 µs (slow)']], imax: 1 },
  'UF4007': { type: 'diode', desc: 'Ultra-fast 1 A rectifier — good bootstrap / flyback diode', pkg: 'DO-41', Is: 3e-8, n: 2.0, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VRRM', '1000 V'], ['IF(AV)', '1 A'], ['VF', '1.7 V max @ 1 A'], ['trr', '75 ns']], imax: 1 },
  '1N5819': { type: 'schottky', desc: 'Schottky barrier rectifier, low VF', pkg: 'DO-41', Is: 3e-6, n: 1.3, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VRRM', '40 V'], ['IF(AV)', '1 A'], ['VF', '0.60 V max @ 1 A'], ['IR', '1 mA @ 40 V']], imax: 1 },
  '1N5822': { type: 'schottky', desc: 'Schottky barrier rectifier 3 A', pkg: 'DO-201AD', Is: 1e-5, n: 1.3, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VRRM', '40 V'], ['IF(AV)', '3 A'], ['VF', '0.525 V max @ 3 A']], imax: 3 },
  'SS34': { type: 'schottky', desc: 'SMD Schottky 3 A', pkg: 'SMA / DO-214AC', Is: 1e-5, n: 1.3, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VRRM', '40 V'], ['IF(AV)', '3 A'], ['VF', '0.5 V @ 3 A']], imax: 3 },
  '1N4001': { type: 'diode', desc: 'General-purpose 1 A rectifier, 50 V', pkg: 'DO-41', Is: 7e-9, n: 1.8, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VRRM', '50 V'], ['IF(AV)', '1 A'], ['IFSM', '30 A'], ['VF', '1.1 V max @ 1 A']], imax: 1 },
  '1N5408': { type: 'diode', desc: 'General-purpose 3 A rectifier, 1000 V', pkg: 'DO-201AD', Is: 2e-8, n: 1.8, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VRRM', '1000 V'], ['IF(AV)', '3 A'], ['IFSM', '200 A'], ['VF', '1.2 V max @ 3 A']], imax: 3 },
  'FR107': { type: 'diode', desc: 'Fast-recovery 1 A rectifier, 1000 V', pkg: 'DO-41', Is: 2e-8, n: 1.9, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VRRM', '1000 V'], ['IF(AV)', '1 A'], ['VF', '1.3 V max @ 1 A'], ['trr', '500 ns']], imax: 1 },
  '1N914': { type: 'diode', desc: 'Small-signal fast switching diode (1N4148 equivalent)', pkg: 'DO-35', Is: 2.52e-9, n: 1.75, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VRRM', '100 V'], ['IF(AV)', '200 mA'], ['VF', '1.0 V max @ 10 mA'], ['trr', '4 ns']], imax: 0.2 },
  'BAT54': { type: 'schottky', desc: 'Small-signal Schottky switching diode', pkg: 'SOT-23', Is: 2e-7, n: 1.05, pinout: [['1', 'A'], ['2', 'NC'], ['3', 'K']], specs: [['VRRM', '30 V'], ['IF', '200 mA'], ['VF', '0.32 V @ 1 mA, 0.8 V max @ 100 mA'], ['trr', '5 ns']], imax: 0.2 },
  '1N4740A': { type: 'zener', desc: 'Zener 10 V, 1 W', pkg: 'DO-41', vz: 10, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VZ', '10 V @ 25 mA'], ['PD', '1 W'], ['IZM', '91 mA']] },
  '1N4750A': { type: 'zener', desc: 'Zener 27 V, 1 W', pkg: 'DO-41', vz: 27, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VZ', '27 V @ 9.5 mA'], ['PD', '1 W'], ['IZM', '34 mA']] },
  'BZX55C3V3': { type: 'zener', desc: 'Zener 3.3 V, 500 mW', pkg: 'DO-35', vz: 3.3, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VZ', '3.3 V @ 5 mA'], ['PD', '500 mW']] },
  // TVS diodes (vbr = breakdown at IT; bidirectional CA parts have no polarity)
  'SMAJ5.0A': { type: 'tvs', desc: 'TVS 400 W, 5 V stand-off, unidirectional', pkg: 'SMA / DO-214AC', vbr: 6.4, vc: 9.2, ipp: 43.5, bi: false, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VWM (stand-off)', '5.0 V'], ['VBR', '6.40–7.07 V @ 10 mA'], ['VC', '9.2 V @ 43.5 A'], ['PPP', '400 W (10/1000 µs)']] },
  'SMBJ5.0A': { type: 'tvs', desc: 'TVS 600 W, 5 V stand-off, unidirectional', pkg: 'SMB / DO-214AA', vbr: 6.4, vc: 9.2, ipp: 65.2, bi: false, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VWM (stand-off)', '5.0 V'], ['VBR', '6.40–7.07 V @ 10 mA'], ['VC', '9.2 V @ 65.2 A'], ['PPP', '600 W (10/1000 µs)']] },
  'SMBJ12A': { type: 'tvs', desc: 'TVS 600 W, 12 V stand-off, unidirectional', pkg: 'SMB / DO-214AA', vbr: 13.3, vc: 19.9, ipp: 30.2, bi: false, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VWM (stand-off)', '12 V'], ['VBR', '13.3–14.7 V @ 1 mA'], ['VC', '19.9 V @ 30.2 A'], ['PPP', '600 W']] },
  'SMBJ15A': { type: 'tvs', desc: 'TVS 600 W, 15 V stand-off, unidirectional', pkg: 'SMB / DO-214AA', vbr: 16.7, vc: 24.4, ipp: 24.6, bi: false, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VWM (stand-off)', '15 V'], ['VBR', '16.7–18.5 V @ 1 mA'], ['VC', '24.4 V @ 24.6 A'], ['PPP', '600 W']] },
  'SMBJ24A': { type: 'tvs', desc: 'TVS 600 W, 24 V stand-off, unidirectional', pkg: 'SMB / DO-214AA', vbr: 26.7, vc: 38.9, ipp: 15.4, bi: false, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VWM (stand-off)', '24 V'], ['VBR', '26.7–29.5 V @ 1 mA'], ['VC', '38.9 V @ 15.4 A'], ['PPP', '600 W']] },
  'SMBJ12CA': { type: 'tvs', desc: 'TVS 600 W, 12 V stand-off, bidirectional', pkg: 'SMB / DO-214AA', vbr: 13.3, vc: 19.9, ipp: 30.2, bi: true, pinout: [['1', 'either'], ['2', 'either (no polarity)']], specs: [['VWM (stand-off)', '±12 V'], ['VBR', '±13.3–14.7 V @ 1 mA'], ['VC', '19.9 V @ 30.2 A'], ['PPP', '600 W']] },
  'SMBJ33A': { type: 'tvs', desc: 'TVS 600 W, 33 V stand-off, unidirectional', pkg: 'SMB / DO-214AA', vbr: 36.7, vc: 53.3, ipp: 11.3, bi: false, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VWM (stand-off)', '33 V'], ['VBR', '36.7–40.6 V @ 1 mA'], ['VC', '53.3 V @ 11.3 A'], ['PPP', '600 W']] },
  'P6KE6.8A': { type: 'tvs', desc: 'TVS 600 W axial, 6.8 V breakdown, unidirectional', pkg: 'DO-15', vbr: 6.8, vc: 10.5, ipp: 57, bi: false, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VWM (stand-off)', '5.8 V'], ['VBR', '6.45–7.14 V @ 10 mA'], ['VC', '10.5 V @ 57 A'], ['PPP', '600 W']] },
  'P6KE15A': { type: 'tvs', desc: 'TVS 600 W axial, 15 V breakdown, unidirectional', pkg: 'DO-15', vbr: 15, vc: 21.2, ipp: 28, bi: false, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VWM (stand-off)', '12.8 V'], ['VBR', '14.3–15.8 V @ 1 mA'], ['VC', '21.2 V @ 28 A'], ['PPP', '600 W']] },
  'P6KE33A': { type: 'tvs', desc: 'TVS 600 W axial, 33 V breakdown, unidirectional', pkg: 'DO-15', vbr: 33, vc: 45.7, ipp: 13.2, bi: false, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VWM (stand-off)', '28.2 V'], ['VBR', '31.4–34.7 V @ 1 mA'], ['VC', '45.7 V @ 13.2 A'], ['PPP', '600 W']] },
  '1.5KE18A': { type: 'tvs', desc: 'TVS 1500 W axial, 18 V breakdown, unidirectional', pkg: 'DO-201AD', vbr: 18, vc: 25.2, ipp: 59.5, bi: false, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VWM (stand-off)', '15.3 V'], ['VBR', '17.1–18.9 V @ 1 mA'], ['VC', '25.2 V @ 59.5 A'], ['PPP', '1500 W']] },
  '1N4728A': { type: 'zener', desc: 'Zener 3.3 V, 1 W', pkg: 'DO-41', vz: 3.3, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VZ', '3.3 V @ 76 mA'], ['PD', '1 W'], ['IZM', '276 mA']] },
  '1N4733A': { type: 'zener', desc: 'Zener 5.1 V, 1 W', pkg: 'DO-41', vz: 5.1, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VZ', '5.1 V @ 49 mA'], ['PD', '1 W'], ['IZM', '178 mA']] },
  '1N4742A': { type: 'zener', desc: 'Zener 12 V, 1 W', pkg: 'DO-41', vz: 12, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VZ', '12 V @ 21 mA'], ['PD', '1 W'], ['IZM', '76 mA']] },
  '1N4744A': { type: 'zener', desc: 'Zener 15 V, 1 W — gate clamp', pkg: 'DO-41', vz: 15, pinout: [['A', 'Anode'], ['K', 'Cathode (band)']], specs: [['VZ', '15 V @ 17 mA'], ['PD', '1 W'], ['IZM', '61 mA']] },
  // BJTs  (pinout listed flat face toward you, legs down, left→right)
  '2N2222A': { type: 'npn', desc: 'General-purpose NPN switch/amp', pkg: 'TO-92 (PN2222A) / TO-18', beta: 150, Is: 1e-14, pinout: [['1', 'E'], ['2', 'B'], ['3', 'C']], specs: [['VCEO', '40 V'], ['IC max', '600 mA'], ['hFE', '100–300 @ 150 mA'], ['VCE(sat)', '0.3 V @ 150 mA'], ['fT', '300 MHz'], ['PD', '625 mW']], icmax: 0.6 },
  '2N3904': { type: 'npn', desc: 'Small-signal NPN', pkg: 'TO-92', beta: 150, Is: 6.7e-15, pinout: [['1', 'E'], ['2', 'B'], ['3', 'C']], specs: [['VCEO', '40 V'], ['IC max', '200 mA'], ['hFE', '100–300 @ 10 mA'], ['fT', '300 MHz'], ['PD', '625 mW']], icmax: 0.2 },
  'BC547': { type: 'npn', desc: 'Small-signal NPN (EU)', pkg: 'TO-92', beta: 300, Is: 1.8e-14, pinout: [['1', 'C'], ['2', 'B'], ['3', 'E']], specs: [['VCEO', '45 V'], ['IC max', '100 mA'], ['hFE', '110–800 (B: 200–450)'], ['PD', '500 mW']], icmax: 0.1 },
  'TIP31C': { type: 'npn', desc: 'Medium-power NPN', pkg: 'TO-220', beta: 50, Is: 1e-12, pinout: [['1', 'B'], ['2', 'C (tab)'], ['3', 'E']], specs: [['VCEO', '100 V'], ['IC max', '3 A'], ['hFE', '25–50'], ['PD', '40 W (case)']], icmax: 3 },
  'TIP120': { type: 'npn', desc: 'NPN Darlington power transistor', pkg: 'TO-220', beta: 1000, Is: 1e-12, nf: 2, pinout: [['1', 'B'], ['2', 'C (tab)'], ['3', 'E']], specs: [['VCEO', '60 V'], ['IC max', '5 A'], ['hFE', '1000 min'], ['VBE(on)', '2.5 V max'], ['VCE(sat)', '2 V @ 3 A'], ['PD', '65 W (case)']], icmax: 5 },
  '2N3906': { type: 'pnp', desc: 'Small-signal PNP', pkg: 'TO-92', beta: 150, Is: 1.4e-14, pinout: [['1', 'E'], ['2', 'B'], ['3', 'C']], specs: [['VCEO', '-40 V'], ['IC max', '-200 mA'], ['hFE', '100–300'], ['PD', '625 mW']], icmax: 0.2 },
  'BC557': { type: 'pnp', desc: 'Small-signal PNP (EU)', pkg: 'TO-92', beta: 250, Is: 1e-14, pinout: [['1', 'C'], ['2', 'B'], ['3', 'E']], specs: [['VCEO', '-45 V'], ['IC max', '-100 mA'], ['hFE', '125–800'], ['PD', '500 mW']], icmax: 0.1 },
  'TIP42C': { type: 'pnp', desc: 'Medium-power PNP', pkg: 'TO-220', beta: 40, Is: 1e-12, pinout: [['1', 'B'], ['2', 'C (tab)'], ['3', 'E']], specs: [['VCEO', '-100 V'], ['IC max', '-6 A'], ['hFE', '15–75'], ['PD', '65 W (case)']], icmax: 6 },
  // MOSFETs  (TO-220 front view, legs down: G D S)
  'IRF540N': { type: 'nmos', desc: 'N-ch power MOSFET 100 V', pkg: 'TO-220', vth: 3.0, rds: 0.044, vgsSpec: 10, pinout: [['1', 'G'], ['2', 'D (tab)'], ['3', 'S']], specs: [['VDSS', '100 V'], ['ID', '33 A'], ['RDS(on)', '44 mΩ @ VGS 10 V'], ['VGS(th)', '2–4 V'], ['Qg', '71 nC'], ['Ciss', '1960 pF'], ['VGS max', '±20 V']], logic: false, idmax: 33 },
  'IRFZ44N': { type: 'nmos', desc: 'N-ch power MOSFET 55 V', pkg: 'TO-220', vth: 3.0, rds: 0.0175, vgsSpec: 10, pinout: [['1', 'G'], ['2', 'D (tab)'], ['3', 'S']], specs: [['VDSS', '55 V'], ['ID', '49 A'], ['RDS(on)', '17.5 mΩ @ VGS 10 V'], ['VGS(th)', '2–4 V'], ['Qg', '63 nC'], ['Ciss', '1470 pF'], ['VGS max', '±20 V']], logic: false, idmax: 49 },
  'IRLZ44N': { type: 'nmos', desc: 'Logic-level N-ch MOSFET 55 V', pkg: 'TO-220', vth: 1.5, rds: 0.022, vgsSpec: 5, pinout: [['1', 'G'], ['2', 'D (tab)'], ['3', 'S']], specs: [['VDSS', '55 V'], ['ID', '47 A'], ['RDS(on)', '22 mΩ @ 5 V, 35 mΩ @ 4 V'], ['VGS(th)', '1–2 V'], ['Qg', '48 nC'], ['VGS max', '±16 V']], logic: true, idmax: 47 },
  'IRF3205': { type: 'nmos', desc: 'N-ch power MOSFET 55 V, 110 A', pkg: 'TO-220', vth: 3.0, rds: 0.008, vgsSpec: 10, pinout: [['1', 'G'], ['2', 'D (tab)'], ['3', 'S']], specs: [['VDSS', '55 V'], ['ID', '110 A'], ['RDS(on)', '8 mΩ @ 10 V'], ['VGS(th)', '2–4 V'], ['Qg', '146 nC'], ['Ciss', '3250 pF']], logic: false, idmax: 110 },
  'IRLB8721': { type: 'nmos', desc: 'Logic-friendly N-ch MOSFET 30 V', pkg: 'TO-220', vth: 1.8, rds: 0.0087, vgsSpec: 10, pinout: [['1', 'G'], ['2', 'D (tab)'], ['3', 'S']], specs: [['VDSS', '30 V'], ['ID', '62 A'], ['RDS(on)', '8.7 mΩ @ 10 V, 16 mΩ @ 4.5 V'], ['VGS(th)', '1.35–2.35 V'], ['Qg', '7.6 nC']], logic: true, idmax: 62 },
  'IRFB4410': { type: 'nmos', desc: 'N-ch power MOSFET 100 V, 96 A (HEXFET)', pkg: 'TO-220', vth: 3.0, rds: 0.008, vgsSpec: 10, pinout: [['1', 'G'], ['2', 'D (tab)'], ['3', 'S']], specs: [['VDSS', '100 V'], ['ID', '96 A (package-limited 75 A)'], ['RDS(on)', '8 mΩ typ, 10 mΩ max @ 10 V'], ['VGS(th)', '2–4 V'], ['Qg', '120 nC'], ['Ciss', '5150 pF'], ['VGS max', '±20 V']], logic: false, idmax: 96 },
  'IRFP260N': { type: 'nmos', desc: 'N-ch power MOSFET 200 V', pkg: 'TO-247', vth: 3.0, rds: 0.04, vgsSpec: 10, pinout: [['1', 'G'], ['2', 'D (tab)'], ['3', 'S']], specs: [['VDSS', '200 V'], ['ID', '50 A'], ['RDS(on)', '40 mΩ @ 10 V'], ['VGS(th)', '2–4 V'], ['Qg', '234 nC'], ['Ciss', '4057 pF']], logic: false, idmax: 50 },
  '2N7000': { type: 'nmos', desc: 'Small-signal N-ch MOSFET', pkg: 'TO-92', vth: 2.1, rds: 1.8, vgsSpec: 10, pinout: [['1', 'S'], ['2', 'G'], ['3', 'D']], specs: [['VDSS', '60 V'], ['ID', '200 mA'], ['RDS(on)', '1.8 Ω typ, 5 Ω max @ 10 V'], ['VGS(th)', '0.8–3 V']], logic: false, idmax: 0.2 },
  'BSS138': { type: 'nmos', desc: 'SMD small N-ch (level shifters)', pkg: 'SOT-23', vth: 1.3, rds: 1.4, vgsSpec: 10, pinout: [['1', 'G'], ['2', 'S'], ['3', 'D']], specs: [['VDSS', '50 V'], ['ID', '220 mA'], ['RDS(on)', '3.5 Ω max @ 10 V'], ['VGS(th)', '0.8–1.5 V']], logic: true, idmax: 0.22 },
  'AO3400': { type: 'nmos', desc: 'SMD logic-level N-ch 30 V', pkg: 'SOT-23', vth: 1.05, rds: 0.028, vgsSpec: 4.5, pinout: [['1', 'G'], ['2', 'S'], ['3', 'D']], specs: [['VDSS', '30 V'], ['ID', '5.7 A'], ['RDS(on)', '28 mΩ @ 4.5 V, 48 mΩ @ 2.5 V'], ['VGS(th)', '0.65–1.45 V']], logic: true, idmax: 5.7 },
  'IRF9540N': { type: 'pmos', desc: 'P-ch power MOSFET -100 V', pkg: 'TO-220', vth: 3.0, rds: 0.117, vgsSpec: 10, pinout: [['1', 'G'], ['2', 'D (tab)'], ['3', 'S']], specs: [['VDSS', '-100 V'], ['ID', '-23 A'], ['RDS(on)', '117 mΩ @ VGS -10 V'], ['VGS(th)', '-2 to -4 V'], ['Qg', '97 nC']], idmax: 23 },
  'IRF4905': { type: 'pmos', desc: 'P-ch power MOSFET -55 V', pkg: 'TO-220', vth: 3.0, rds: 0.02, vgsSpec: 10, pinout: [['1', 'G'], ['2', 'D (tab)'], ['3', 'S']], specs: [['VDSS', '-55 V'], ['ID', '-74 A'], ['RDS(on)', '20 mΩ @ -10 V'], ['VGS(th)', '-2 to -4 V'], ['Qg', '180 nC']], idmax: 74 },
  'AO3401': { type: 'pmos', desc: 'SMD P-ch 30 V (high-side switch)', pkg: 'SOT-23', vth: 0.9, rds: 0.05, vgsSpec: 4.5, pinout: [['1', 'G'], ['2', 'S'], ['3', 'D']], specs: [['VDSS', '-30 V'], ['ID', '-4 A'], ['RDS(on)', '50 mΩ @ -4.5 V'], ['VGS(th)', '-0.5 to -1.3 V']], idmax: 4 },
  // Op-amps (symbol)
  'Ideal': { type: 'opamp', desc: 'Ideal op-amp (rail-to-rail, very high GBW)', gbw: 1e9, hr: [0, 0], iq: 0, ilim: 1, specs: [['Gain', '100 dB'], ['GBW', '1 GHz'], ['Output', 'rail-to-rail']] },
  'TL072': { type: 'opamp', desc: 'Low-noise JFET-input op-amp (single unit of TL072)', gbw: 3e6, hr: [1.5, 1.5], iq: 1.4e-3, ilim: 0.04, specs: [['Supply', '±3.5 … ±18 V (7–36 V)'], ['GBW', '3 MHz'], ['Slew rate', '13 V/µs'], ['Vos', '3 mV typ'], ['Output swing', '±13.5 V @ ±15 V'], ['Input CM', 'NOT to V− (phase reversal)'], ['Iq', '1.4 mA / amp']] },
  'LM358': { type: 'opamp', desc: 'Single-supply op-amp (single unit of LM358)', gbw: 0.7e6, hr: [0.02, 1.5], iq: 0.35e-3, ilim: 0.04, specs: [['Supply', '3–32 V (±1.5 … ±16 V)'], ['GBW', '0.7 MHz'], ['Slew rate', '0.3 V/µs'], ['Input CM', 'includes V− (ground)'], ['Output', 'to ~V−, V+ − 1.5 V'], ['Iq', '0.7 mA total']] },
  'NE5532': { type: 'opamp', desc: 'Low-noise audio op-amp', gbw: 10e6, hr: [2, 2], iq: 4e-3, ilim: 0.038, specs: [['Supply', '±3 … ±20 V'], ['GBW', '10 MHz'], ['Slew rate', '9 V/µs'], ['Noise', '5 nV/√Hz'], ['Iq', '8 mA total']] },
  'MCP6002': { type: 'opamp', desc: 'Low-power rail-to-rail I/O op-amp', gbw: 1e6, hr: [0.025, 0.025], iq: 0.1e-3, ilim: 0.023, specs: [['Supply', '1.8–6.0 V'], ['GBW', '1 MHz'], ['Slew rate', '0.6 V/µs'], ['I/O', 'rail-to-rail'], ['Iq', '100 µA / amp']] },
  'LM741': { type: 'opamp', desc: 'Classic general-purpose op-amp', gbw: 1e6, hr: [2, 2], iq: 1.7e-3, ilim: 0.025, specs: [['Supply', '±5 … ±18 V'], ['GBW', '1 MHz'], ['Slew rate', '0.5 V/µs'], ['Iq', '1.7 mA']] },
  // Regulators: pin order in our symbol = [IN, OUT, GND/ADJ]; pkgPins = physical numbering
  '7805': { type: 'reg', desc: 'Positive linear regulator 5 V, 1.5 A', pkg: 'TO-220', vout: 5, drop: 2.0, iq: 5e-3, ilim: 1.5, vinMax: 35, nums: ['1', '3', '2'], pinout: [['1', 'IN'], ['2', 'GND (tab)'], ['3', 'OUT']], specs: [['Vout', '5 V ±4%'], ['Vin', '7–35 V'], ['Dropout', '2 V typ'], ['Iout', '1.5 A (with heatsink)'], ['Iq', '5 mA'], ['Caps', '0.33 µF in, 0.1 µF out'], ['θJA', '65 °C/W (no heatsink)']] },
  '7809': { type: 'reg', desc: 'Positive linear regulator 9 V', pkg: 'TO-220', vout: 9, drop: 2.0, iq: 5e-3, ilim: 1.5, vinMax: 35, nums: ['1', '3', '2'], pinout: [['1', 'IN'], ['2', 'GND (tab)'], ['3', 'OUT']], specs: [['Vout', '9 V'], ['Vin', '11–35 V'], ['Dropout', '2 V'], ['Iout', '1.5 A']] },
  '7812': { type: 'reg', desc: 'Positive linear regulator 12 V', pkg: 'TO-220', vout: 12, drop: 2.0, iq: 5e-3, ilim: 1.5, vinMax: 35, nums: ['1', '3', '2'], pinout: [['1', 'IN'], ['2', 'GND (tab)'], ['3', 'OUT']], specs: [['Vout', '12 V ±4%'], ['Vin', '14.5–35 V'], ['Dropout', '2 V'], ['Iout', '1.5 A'], ['Iq', '5 mA'], ['Caps', '0.33 µF in, 0.1 µF out']] },
  '7815': { type: 'reg', desc: 'Positive linear regulator 15 V', pkg: 'TO-220', vout: 15, drop: 2.0, iq: 5e-3, ilim: 1.5, vinMax: 35, nums: ['1', '3', '2'], pinout: [['1', 'IN'], ['2', 'GND (tab)'], ['3', 'OUT']], specs: [['Vout', '15 V'], ['Vin', '17.5–35 V'], ['Dropout', '2 V'], ['Iout', '1.5 A']] },
  'LM317': { type: 'reg', adj: true, desc: 'Adjustable positive regulator 1.25–37 V', pkg: 'TO-220', vout: 1.25, drop: 2.0, iq: 0, ilim: 1.5, vinMax: 40, nums: ['3', '2', '1'], pinout: [['1', 'ADJ'], ['2', 'OUT (tab)'], ['3', 'IN']], specs: [['Vref', '1.25 V (OUT−ADJ)'], ['Vout', '1.25 × (1 + R2/R1) + IADJ·R2'], ['IADJ', '50 µA'], ['Dropout', '~2 V'], ['Iout', '1.5 A'], ['Min load', '~3.5–10 mA'], ['Vin−Vout', '≤ 40 V'], ['Typical', 'R1 = 240 Ω (OUT→ADJ)']] },
  'AMS1117-3.3': { type: 'reg', desc: 'LDO 3.3 V, 1 A', pkg: 'SOT-223', vout: 3.3, drop: 1.1, iq: 5e-3, ilim: 1.0, vinMax: 15, nums: ['3', '2', '1'], pinout: [['1', 'GND/ADJ'], ['2', 'OUT (tab)'], ['3', 'IN']], specs: [['Vout', '3.3 V ±1%'], ['Vin', '4.5–15 V'], ['Dropout', '1.1 V typ @ 800 mA'], ['Iout', '1 A'], ['Iq', '5 mA'], ['Caps', '≥10 µF tantalum out (ESR!)']] },
  'AMS1117-5.0': { type: 'reg', desc: 'LDO 5.0 V, 1 A', pkg: 'SOT-223', vout: 5.0, drop: 1.1, iq: 5e-3, ilim: 1.0, vinMax: 15, nums: ['3', '2', '1'], pinout: [['1', 'GND/ADJ'], ['2', 'OUT (tab)'], ['3', 'IN']], specs: [['Vout', '5.0 V'], ['Vin', '6.5–15 V'], ['Dropout', '1.1 V'], ['Iout', '1 A']] },
  'LM2940-5': { type: 'reg', desc: 'Low-dropout 5 V, 1 A', pkg: 'TO-220', vout: 5, drop: 0.5, iq: 10e-3, ilim: 1.0, vinMax: 26, nums: ['1', '3', '2'], pinout: [['1', 'IN'], ['2', 'GND (tab)'], ['3', 'OUT']], specs: [['Vout', '5 V'], ['Dropout', '0.5 V @ 1 A'], ['Iout', '1 A'], ['Cout', '≥22 µF required']] },
  'AP2112K-3.3': { type: 'reg', desc: 'LDO 3.3 V, 600 mA, 250 mV dropout, enable pin', pkg: 'SOT-23-5', vout: 3.3, drop: 0.25, iq: 55e-6, ilim: 0.6, vinMax: 6, en: true, nums: ['1', '5', '2', '3'], pinout: [['1', 'VIN'], ['2', 'GND'], ['3', 'EN'], ['4', 'NC'], ['5', 'VOUT']], specs: [['Vout', '3.3 V ±1.5%'], ['Vin', '2.5–6 V'], ['Dropout', '250 mV @ 600 mA'], ['Iout', '600 mA'], ['Iq', '55 µA'], ['EN', 'high = on (tie to VIN if unused)'], ['Caps', '1 µF in, 1 µF out (ceramic OK)']] },
  'ME6211C33': { type: 'reg', desc: 'LDO 3.3 V, 500 mA, enable pin, low quiescent', pkg: 'SOT-23-5', vout: 3.3, drop: 0.1, iq: 40e-6, ilim: 0.5, vinMax: 6.5, en: true, nums: ['1', '5', '2', '3'], pinout: [['1', 'VIN'], ['2', 'VSS'], ['3', 'CE'], ['4', 'NC'], ['5', 'VOUT']], specs: [['Vout', '3.3 V ±2%'], ['Vin', '2–6 V'], ['Dropout', '100 mV @ 100 mA'], ['Iout', '500 mA'], ['Iq', '40 µA'], ['Caps', '1 µF in, 1 µF out']] },
  'MCP1700-3302': { type: 'reg', desc: 'Micro-power LDO 3.3 V, 250 mA', pkg: 'TO-92', vout: 3.3, drop: 0.178, iq: 1.6e-6, ilim: 0.25, vinMax: 6, nums: ['2', '3', '1'], pinout: [['1', 'GND'], ['2', 'IN'], ['3', 'OUT']], specs: [['Vout', '3.3 V'], ['Vin', '≤ 6 V'], ['Dropout', '178 mV @ 250 mA'], ['Iq', '1.6 µA'], ['Caps', '1 µF in/out']] },
};

// Bidirectional (CA) TVS variants: same VBR / VC as the A part, clamps both polarities, no polarity marking.
for (const base of ['SMAJ5.0A', 'SMBJ5.0A', 'SMBJ15A', 'SMBJ24A', 'SMBJ33A', 'P6KE6.8A', 'P6KE15A', 'P6KE33A', '1.5KE18A']) {
  const a = PARTS[base];
  const name = base.replace(/A$/, 'CA');
  if (PARTS[name]) continue;
  PARTS[name] = {
    ...a, bi: true,
    desc: a.desc.replace('unidirectional', 'bidirectional'),
    pinout: [['1', 'either'], ['2', 'either (no polarity)']],
    specs: [...a.specs.map(([k, v]) => [k, /^V(WM|BR)/.test(k) ? '±' + v : v]), ['Polarity', 'bidirectional — clamps + and − transients (AC lines, RS-485, CAN, audio)']],
  };
}

// ---------- IC / module definitions (block symbols with physical pinouts) ----------
// fn: pwr, gnd, in, out, io, nc, ctl
export const ICS = {
  'TC4420': { cat: 'Gate drivers', desc: '6 A high-speed single MOSFET driver, non-inverting', pkg: 'DIP-8 / SOIC-8', layout: 'dip',
    pins: [['VDD', 'pwr'], ['IN', 'in'], ['NC', 'nc'], ['GND', 'gnd'], ['GND', 'gnd'], ['OUT', 'out'], ['OUT', 'out'], ['VDD', 'pwr']],
    units: [{ k: 'drv', in: 'IN', out: 'OUT', vdd: 'VDD', gnd: 'GND', inv: false, rout: 2.5, ilim: 6, th: 1.6, uvlo: 4.0 }],
    specs: [['VDD', '4.5–18 V'], ['Peak out', '6 A'], ['Rout', '2.5 Ω typ'], ['tR / tF', '25 ns @ 2500 pF'], ['Delay', '55 ns'], ['Input', 'VIH 2.4 V, VIL 0.8 V (3.3 V logic OK)'], ['Iq', '~0.5 mA']],
    notes: 'Pins 1&8 and 4&5, 6&7 are internally common — connect both. Bypass VDD with 1 µF + 0.1 µF close to pins.' },
  'TC4429': { cat: 'Gate drivers', desc: '6 A high-speed single MOSFET driver, INVERTING', pkg: 'DIP-8 / SOIC-8', layout: 'dip',
    pins: [['VDD', 'pwr'], ['IN', 'in'], ['NC', 'nc'], ['GND', 'gnd'], ['GND', 'gnd'], ['OUT', 'out'], ['OUT', 'out'], ['VDD', 'pwr']],
    units: [{ k: 'drv', in: 'IN', out: 'OUT', vdd: 'VDD', gnd: 'GND', inv: true, rout: 2.5, ilim: 6, th: 1.6, uvlo: 4.0 }],
    specs: [['VDD', '4.5–18 V'], ['Peak out', '6 A'], ['Logic', 'OUT = NOT IN'], ['Input', 'VIH 2.4 V, VIL 0.8 V']], notes: 'Same pinout as TC4420 but inverting.' },
  'TC4427': { cat: 'Gate drivers', desc: '1.5 A dual MOSFET driver, non-inverting', pkg: 'DIP-8 / SOIC-8', layout: 'dip',
    pins: [['NC', 'nc'], ['INA', 'in'], ['GND', 'gnd'], ['INB', 'in'], ['OUTB', 'out'], ['VDD', 'pwr'], ['OUTA', 'out'], ['NC', 'nc']],
    units: [{ k: 'drv', in: 'INA', out: 'OUTA', vdd: 'VDD', gnd: 'GND', inv: false, rout: 7, ilim: 1.5, th: 1.6, uvlo: 4.0 }, { k: 'drv', in: 'INB', out: 'OUTB', vdd: 'VDD', gnd: 'GND', inv: false, rout: 7, ilim: 1.5, th: 1.6, uvlo: 4.0 }],
    specs: [['VDD', '4.5–18 V'], ['Peak out', '1.5 A'], ['Rout', '7 Ω'], ['tR / tF', '19 ns @ 1000 pF'], ['Input', 'TTL/CMOS']] },
  'TC4426': { cat: 'Gate drivers', desc: '1.5 A dual MOSFET driver, inverting', pkg: 'DIP-8 / SOIC-8', layout: 'dip',
    pins: [['NC', 'nc'], ['INA', 'in'], ['GND', 'gnd'], ['INB', 'in'], ['OUTB', 'out'], ['VDD', 'pwr'], ['OUTA', 'out'], ['NC', 'nc']],
    units: [{ k: 'drv', in: 'INA', out: 'OUTA', vdd: 'VDD', gnd: 'GND', inv: true, rout: 7, ilim: 1.5, th: 1.6, uvlo: 4.0 }, { k: 'drv', in: 'INB', out: 'OUTB', vdd: 'VDD', gnd: 'GND', inv: true, rout: 7, ilim: 1.5, th: 1.6, uvlo: 4.0 }],
    specs: [['VDD', '4.5–18 V'], ['Peak out', '1.5 A'], ['Logic', 'OUTx = NOT INx']] },
  'IR2110': { cat: 'Gate drivers', desc: 'High & low side driver, 500 V, 2 A', pkg: 'DIP-14', layout: 'dip',
    pins: [['LO', 'out'], ['COM', 'gnd'], ['VCC', 'pwr'], ['NC', 'nc'], ['VS', 'io'], ['VB', 'pwr'], ['HO', 'out'], ['NC', 'nc'], ['VDD', 'pwr'], ['HIN', 'in'], ['SD', 'in'], ['LIN', 'in'], ['VSS', 'gnd'], ['NC', 'nc']],
    units: [{ k: 'ir2110' }],
    specs: [['VOFFSET', '500 V (IR2113: 600 V)'], ['VCC / VBS', '10–20 V'], ['VDD logic', '3.3–20 V'], ['Io+ / Io−', '2 A / 2 A'], ['ton / toff', '120 / 94 ns'], ['UVLO', 'VCC & VBS ≈ 8.6 V on / 8.2 V off'], ['SD', 'HIGH = shutdown (both outputs low)']],
    notes: 'Bootstrap: diode VCC→VB (UF4007) + cap VB–VS (≥ 0.47 µF). HO is referenced to VS (switch node). No dead-time — add it in firmware.' },
  'IR2104': { cat: 'Gate drivers', desc: 'Half-bridge driver, single input + shutdown, 600 V', pkg: 'DIP-8 / SOIC-8', layout: 'dip',
    pins: [['VCC', 'pwr'], ['IN', 'in'], ['SD̅', 'in'], ['COM', 'gnd'], ['LO', 'out'], ['VS', 'io'], ['HO', 'out'], ['VB', 'pwr']],
    units: [{ k: 'ir2104' }],
    specs: [['VOFFSET', '600 V'], ['VCC', '10–20 V'], ['Io+ / Io−', '130 / 270 mA'], ['Dead time', '520 ns internal'], ['Logic', 'IN high → HO on; IN low → LO on'], ['SD̅', 'LOW = shutdown'], ['UVLO', '8.9 V / 8.2 V']],
    notes: 'Bootstrap diode VCC→VB + cap VB–VS. Logic thresholds 2.5/0.8 V (3.3 V OK).' },
  'TL072-IC': { cat: 'Op-amps', name: 'TL072', desc: 'Dual JFET-input op-amp', pkg: 'DIP-8', layout: 'dip',
    pins: [['OUT1', 'out'], ['IN1−', 'in'], ['IN1+', 'in'], ['V−', 'pwr'], ['IN2+', 'in'], ['IN2−', 'in'], ['OUT2', 'out'], ['V+', 'pwr']],
    units: [{ k: 'opamp', model: 'TL072', inp: 'IN1+', inn: 'IN1−', out: 'OUT1', vp: 'V+', vn: 'V−' }, { k: 'opamp', model: 'TL072', inp: 'IN2+', inn: 'IN2−', out: 'OUT2', vp: 'V+', vn: 'V−' }],
    specs: PARTS.TL072.specs },
  'LM358-IC': { cat: 'Op-amps', name: 'LM358', desc: 'Dual single-supply op-amp', pkg: 'DIP-8', layout: 'dip',
    pins: [['OUT1', 'out'], ['IN1−', 'in'], ['IN1+', 'in'], ['GND', 'gnd'], ['IN2+', 'in'], ['IN2−', 'in'], ['OUT2', 'out'], ['V+', 'pwr']],
    units: [{ k: 'opamp', model: 'LM358', inp: 'IN1+', inn: 'IN1−', out: 'OUT1', vp: 'V+', vn: 'GND' }, { k: 'opamp', model: 'LM358', inp: 'IN2+', inn: 'IN2−', out: 'OUT2', vp: 'V+', vn: 'GND' }],
    specs: PARTS.LM358.specs },
  'NE5532-IC': { cat: 'Op-amps', name: 'NE5532', desc: 'Dual low-noise op-amp', pkg: 'DIP-8', layout: 'dip',
    pins: [['OUT1', 'out'], ['IN1−', 'in'], ['IN1+', 'in'], ['V−', 'pwr'], ['IN2+', 'in'], ['IN2−', 'in'], ['OUT2', 'out'], ['V+', 'pwr']],
    units: [{ k: 'opamp', model: 'NE5532', inp: 'IN1+', inn: 'IN1−', out: 'OUT1', vp: 'V+', vn: 'V−' }, { k: 'opamp', model: 'NE5532', inp: 'IN2+', inn: 'IN2−', out: 'OUT2', vp: 'V+', vn: 'V−' }],
    specs: PARTS.NE5532.specs },
  'MCP6002-IC': { cat: 'Op-amps', name: 'MCP6002', desc: 'Dual rail-to-rail low-power op-amp', pkg: 'DIP-8 / SOIC-8', layout: 'dip',
    pins: [['OUTA', 'out'], ['INA−', 'in'], ['INA+', 'in'], ['VSS', 'gnd'], ['INB+', 'in'], ['INB−', 'in'], ['OUTB', 'out'], ['VDD', 'pwr']],
    units: [{ k: 'opamp', model: 'MCP6002', inp: 'INA+', inn: 'INA−', out: 'OUTA', vp: 'VDD', vn: 'VSS' }, { k: 'opamp', model: 'MCP6002', inp: 'INB+', inn: 'INB−', out: 'OUTB', vp: 'VDD', vn: 'VSS' }],
    specs: PARTS.MCP6002.specs },
  'TL074-IC': { cat: 'Op-amps', name: 'TL074', desc: 'Quad JFET-input op-amp (LM324 same pinout)', pkg: 'DIP-14', layout: 'dip',
    pins: [['OUT1', 'out'], ['IN1−', 'in'], ['IN1+', 'in'], ['V+', 'pwr'], ['IN2+', 'in'], ['IN2−', 'in'], ['OUT2', 'out'], ['OUT3', 'out'], ['IN3−', 'in'], ['IN3+', 'in'], ['V−', 'pwr'], ['IN4+', 'in'], ['IN4−', 'in'], ['OUT4', 'out']],
    units: [1, 2, 3, 4].map((i) => ({ k: 'opamp', model: 'TL072', inp: `IN${i}+`, inn: `IN${i}−`, out: `OUT${i}`, vp: 'V+', vn: 'V−' })),
    specs: [['Supply', '±3.5 … ±18 V'], ['GBW', '3 MHz'], ['Slew rate', '13 V/µs'], ['Note', 'V+ is pin 4, V− pin 11']] },
  'LM393-IC': { cat: 'Comparators', name: 'LM393', desc: 'Dual open-collector comparator', pkg: 'DIP-8', layout: 'dip',
    pins: [['OUT1', 'out'], ['IN1−', 'in'], ['IN1+', 'in'], ['GND', 'gnd'], ['IN2+', 'in'], ['IN2−', 'in'], ['OUT2', 'out'], ['VCC', 'pwr']],
    units: [{ k: 'cmp', inp: 'IN1+', inn: 'IN1−', out: 'OUT1', vp: 'VCC', vn: 'GND' }, { k: 'cmp', inp: 'IN2+', inn: 'IN2−', out: 'OUT2', vp: 'VCC', vn: 'GND' }],
    specs: [['Supply', '2–36 V'], ['Output', 'open collector — needs pull-up'], ['Sink', '16 mA typ'], ['Response', '1.3 µs'], ['Input CM', '0 to VCC−1.5 V']] },
  'NE555': { cat: 'ICs', desc: 'Timer (astable / monostable) — pinout reference, no DC model', pkg: 'DIP-8', layout: 'dip',
    pins: [['GND', 'gnd'], ['TRIG', 'in'], ['OUT', 'out'], ['RESET', 'in'], ['CTRL', 'io'], ['THRES', 'in'], ['DISCH', 'io'], ['VCC', 'pwr']],
    units: [],
    specs: [['Supply', '4.5–16 V'], ['Output', '200 mA source/sink'], ['Astable f', '1.44 / ((R1 + 2·R2)·C)'], ['Duty', '(R1+R2)/(R1+2R2)'], ['Monostable t', '1.1·R·C']], notes: 'Tie RESET (4) to VCC if unused; 10 nF from CTRL (5) to GND.' },
  'PC817': { cat: 'ICs', desc: 'Optocoupler, phototransistor output', pkg: 'DIP-4', layout: 'dip',
    pins: [['A', 'in'], ['K', 'in'], ['E', 'io'], ['C', 'io']],
    units: [{ k: 'opto', a: 'A', kk: 'K', e: 'E', c: 'C', ctr: 1.0 }],
    specs: [['CTR', '50–600 % (rank A–D)'], ['IF max', '50 mA'], ['VF', '1.2 V @ 20 mA'], ['VCEO', '35 V'], ['Isolation', '5 kVrms']] },
  // ---------- MCU boards (header layout: left/right lists top→bottom, USB at top) ----------
  'ESP32-S3 SuperMini': { cat: 'MCU boards', desc: 'ESP32-S3 SuperMini (ESP32-S3FH4R2) — 3.3 V logic', pkg: '2 × 9 header, USB-C top', layout: 'header',
    left: ['IO43/TX', 'IO44/RX', 'IO1', 'IO2', 'IO3', 'IO4', 'IO5', 'IO6', 'IO7'],
    right: ['5V', 'GND', '3V3', 'IO13', 'IO12', 'IO11', 'IO10', 'IO9', 'IO8'],
    units: [{ k: 'mcu', vlogic: 3.3, v5: '5V', v3: '3V3', gnd: 'GND', drop: 0.25, ilim: 0.5, load: 0.05 }],
    specs: [['MCU', 'ESP32-S3, dual-core LX7 240 MHz'], ['Memory', '4 MB flash, 2 MB PSRAM'], ['Radio', 'Wi-Fi 2.4 GHz + BLE 5'], ['Logic', '3.3 V — NOT 5 V tolerant'], ['GPIO current', '≤ 20 mA rec. (40 mA max)'], ['5V pin', 'USB 5 V in/out → onboard LDO → 3V3 (~500 mA)'], ['ADC', 'ADC1: IO1–IO10; ADC2: IO11–IO20 (not with Wi-Fi)'], ['Strapping', 'IO0 (BOOT btn), IO3, IO45, IO46'], ['USB', 'native USB on IO19/IO20'], ['LED', 'RGB WS2812 on IO48']],
    notes: 'Pin order shown with USB-C at the top, components facing you. Header layouts vary between vendors — verify against your board silkscreen.' },
  'ESP32-S3-DevKitC-1': { cat: 'MCU boards', desc: 'Espressif ESP32-S3-DevKitC-1 (WROOM-1) — 3.3 V logic', pkg: '2 × 22 header', layout: 'header',
    left: ['3V3', '3V3', 'RST', 'IO4', 'IO5', 'IO6', 'IO7', 'IO15', 'IO16', 'IO17', 'IO18', 'IO8', 'IO3', 'IO46', 'IO9', 'IO10', 'IO11', 'IO12', 'IO13', 'IO14', '5V', 'GND'],
    right: ['GND', 'IO43/TX', 'IO44/RX', 'IO1', 'IO2', 'IO42', 'IO41', 'IO40', 'IO39', 'IO38', 'IO37', 'IO36', 'IO35', 'IO0', 'IO45', 'IO48', 'IO47', 'IO21', 'IO20', 'IO19', 'GND', 'GND'],
    units: [{ k: 'mcu', vlogic: 3.3, v5: '5V', v3: '3V3', gnd: 'GND', drop: 0.3, ilim: 0.8, load: 0.06 }],
    specs: [['MCU', 'ESP32-S3 dual-core 240 MHz'], ['Logic', '3.3 V'], ['5V', 'from USB; LDO → 3V3'], ['Note', 'IO35–37 used by octal PSRAM on N8R8/N16R8'], ['RGB LED', 'IO48 (v1.0) / IO38 (v1.1)'], ['USB', 'IO19/IO20 native USB']],
    notes: 'J1 on the left, J3 on the right (USB ports at the bottom). Verify with your board revision.' },
  'ESP32 DevKit V1 (30p)': { cat: 'MCU boards', desc: 'ESP32-WROOM-32 DevKit V1, 30-pin — 3.3 V logic', pkg: '2 × 15 header', layout: 'header',
    left: ['EN', 'IO36/VP', 'IO39/VN', 'IO34', 'IO35', 'IO32', 'IO33', 'IO25', 'IO26', 'IO27', 'IO14', 'IO12', 'IO13', 'GND', 'VIN'],
    right: ['IO23', 'IO22', 'IO1/TX', 'IO3/RX', 'IO21', 'IO19', 'IO18', 'IO5', 'IO17', 'IO16', 'IO4', 'IO2', 'IO15', 'GND', '3V3'],
    inputOnly: [34, 35, 36, 39],
    units: [{ k: 'mcu', vlogic: 3.3, v5: 'VIN', v3: '3V3', gnd: 'GND', drop: 1.1, ilim: 0.8, load: 0.08 }],
    specs: [['MCU', 'ESP32 dual-core 240 MHz'], ['Logic', '3.3 V'], ['VIN', '5 V (USB) → AMS1117-3.3'], ['Input-only', 'IO34, 35, 36 (VP), 39 (VN) — no pull-ups'], ['ADC2', 'unusable while Wi-Fi on'], ['Strapping', 'IO0, IO2, IO5, IO12, IO15'], ['LED', 'IO2 (blue)']],
    notes: 'Antenna at the top. IO12 must be LOW at boot (flash voltage strap).' },
  'ESP32-C3 SuperMini': { cat: 'MCU boards', desc: 'ESP32-C3 SuperMini — RISC-V, 3.3 V logic', pkg: '2 × 8 header, USB-C top', layout: 'header',
    left: ['IO5', 'IO6', 'IO7', 'IO8', 'IO9', 'IO10', 'IO20/RX', 'IO21/TX'],
    right: ['5V', 'GND', '3V3', 'IO4', 'IO3', 'IO2', 'IO1', 'IO0'],
    units: [{ k: 'mcu', vlogic: 3.3, v5: '5V', v3: '3V3', gnd: 'GND', drop: 0.25, ilim: 0.5, load: 0.04 }],
    specs: [['MCU', 'ESP32-C3 RISC-V 160 MHz'], ['Logic', '3.3 V'], ['ADC', 'IO0–IO4'], ['Strapping', 'IO2, IO8, IO9'], ['LED', 'blue on IO8'], ['BOOT', 'IO9']],
    notes: 'Verify against your board silkscreen.' },
  'Arduino Nano': { cat: 'MCU boards', desc: 'Arduino Nano (ATmega328P) — 5 V logic', pkg: '2 × 15 header', layout: 'header',
    left: ['D1/TX', 'D0/RX', 'RST', 'GND', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12'],
    right: ['VIN', 'GND', 'RST', '5V', 'A7', 'A6', 'A5', 'A4', 'A3', 'A2', 'A1', 'A0', 'AREF', '3V3', 'D13'],
    units: [{ k: 'mcu', vlogic: 5, v5: 'VIN', v3: '5V', gnd: 'GND', vreg: 5, drop: 1.2, ilim: 0.5, load: 0.02 }],
    specs: [['MCU', 'ATmega328P 16 MHz'], ['Logic', '5 V'], ['VIN', '7–12 V'], ['IO current', '20 mA rec., 40 mA abs max'], ['PWM', 'D3, D5, D6, D9, D10, D11'], ['I²C', 'A4 SDA, A5 SCL'], ['SPI', 'D10–D13'], ['A6/A7', 'analog input only']] },
  'Generic IC': { cat: 'ICs', desc: 'Generic IC — edit pin names in properties', pkg: 'DIP', layout: 'dip', generic: true,
    pins: [['P1', 'io'], ['P2', 'io'], ['P3', 'io'], ['P4', 'io'], ['P5', 'io'], ['P6', 'io'], ['P7', 'io'], ['P8', 'io']], units: [], specs: [] },
};

// ---------- geometry for IC blocks ----------
const icCache = new Map();
export function invalidateIc() { icCache.clear(); }
function pinFn(name, fnGiven) {
  if (fnGiven) return fnGiven;
  if (/^(GND|VSS|AGND|DGND)$/i.test(name)) return 'gnd';
  if (/^(5V|3V3|3\.3V|3VO|VIN|VCC|VDD|VBUS|VBAT|AVDD|DVDD)$/i.test(name)) return 'pwr';
  if (/^(EN|RST|RESET|AREF|BOOT|CHIP_PU)$/i.test(name)) return 'ctl';
  if (/^NC$/i.test(name)) return 'nc';
  return 'io';
}
function icPartDef(c) {
  const id = c.props.part;
  let d = ICS[id] || ICS['Generic IC'];
  if (d.customInline) {
    const title = String(c.props.title || 'Custom board');
    d = { ...d, name: title, left: splitPins(c.props.leftPins), right: splitPins(c.props.rightPins),
      units: [{ k: 'mcu', vlogic: num(c.props.vlogic, 3.3), v5: c.props.vinPin || '5V', v3: c.props.railPin || '3V3', gnd: 'GND', drop: 0.3, ilim: 0.5, load: 0.05 }] };
    if (!d.left.length && !d.right.length) d.left = ['GND'];
  }
  if (d.generic) {
    const names = String(c.props.pinNames || '').split(',').map((s) => s.trim()).filter(Boolean);
    const count = Math.max(2, Math.min(64, Math.round(num(c.props.pinCount, names.length || 8)) & ~1));
    const pins = [];
    for (let i = 0; i < count; i++) pins.push([names[i] || 'P' + (i + 1), 'io']);
    d = { ...d, pins, name: c.props.title || 'IC' };
  }
  return d;
}
export function icGeom(c) {
  const d = icPartDef(c);
  const key = (c.props.part || '') + '|' + (d.generic ? c.props.pinNames + c.props.pinCount + c.props.title : '') + (d.customInline ? [c.props.title, c.props.leftPins, c.props.rightPins, c.props.vlogic, c.props.vinPin, c.props.railPin].join('|') : '');
  if (icCache.has(key)) return icCache.get(key);
  let pins = [], left = [], right = [];
  if (d.layout === 'header') {
    d.left.forEach((n, i) => { pins.push({ name: n, num: String(d.nums?.[i] ?? i + 1), fn: pinFn(n) }); left.push(pins.length - 1); });
    (d.right || []).forEach((n, i) => { pins.push({ name: n, num: String(d.nums?.[d.left.length + i] ?? d.left.length + i + 1), fn: pinFn(n) }); right.push(pins.length - 1); });
  } else {
    d.pins.forEach(([n, fn], i) => pins.push({ name: n, num: String(d.nums?.[i] ?? i + 1), fn }));
    const h = pins.length / 2;
    for (let i = 0; i < h; i++) left.push(i);
    for (let i = pins.length - 1; i >= h; i--) right.push(i);
  }
  const rows = Math.max(left.length, right.length);
  const maxL = Math.max(0, ...left.map((i) => pins[i].name.length));
  const maxR = Math.max(0, ...right.map((i) => pins[i].name.length));
  const title = d.name || c.props.part;
  const halfW = Math.max(30, Math.ceil(Math.max((maxL + maxR) * 6.2 + 26, title.length * 7 + 10) / 2 / 10) * 10);
  const y0 = -((rows - 1) / 2) * 20;
  left.forEach((pi, r) => Object.assign(pins[pi], { x: -halfW - 20, y: y0 + r * 20, side: 'L' }));
  right.forEach((pi, r) => Object.assign(pins[pi], { x: halfW + 20, y: y0 + r * 20, side: 'R' }));
  const top = y0 - 32, bot = -y0 + 16;
  // bridges: same-name pins (except NC) are internally connected
  const groups = new Map();
  pins.forEach((p, i) => { if (p.fn !== 'nc' && !/^NC$/i.test(p.name)) { const k = p.name.toUpperCase(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); } });
  const bridges = [...groups.values()].filter((g) => g.length > 1);
  const g = { pins, halfW, top, bot, bridges, def: d, title, bbox: { x: -halfW - 20, y: top - 4, w: 2 * halfW + 40, h: bot - top + 8 } };
  icCache.set(key, g);
  return g;
}

// ---------- shared model builders ----------
const gainOf = (S) => (S.hom >= 1 ? 1e5 : Math.pow(10, 1 + 4 * S.hom));
export const OPAMP_A = 1e5;
const widthOf = (S, w) => (S.hom >= 1 ? w : w * (1 + 60 * (1 - S.hom)));
function opampFn(m, rails, A = 1e5) {
  // m: part params. rails: null → supply pins in v[3], v[4]; else [vpos, vneg] fixed
  const iq = m.iq || 0, ilim = m.ilim || 0.04, rout = 1;
  return (v) => {
    const vp = rails ? rails[0] : v[3], vn = rails ? rails[1] : v[4];
    const lo = vn + m.hr[0], hi = vp - m.hr[1];
    const mid = (lo + hi) / 2, half = Math.max((hi - lo) / 2, 1e-3);
    const vt = mid + half * Math.tanh((A * (v[0] - v[1]) - mid) / half);
    const s = (vt - v[2]) / rout; // linear output stage (current limit reported as a warning)
    if (rails) return [v[0] * 1e-12, v[1] * 1e-12, -s];
    const sp = fromRail(s, vp, v[2]);
    const iqI = iq * Math.tanh(Math.max(vp - vn, 0) / 2);
    return [v[0] * 1e-12, v[1] * 1e-12, -s, sp + iqI, s - sp - iqI];
  };
}
function opampAC(gbw) {
  const A = 1e5, wp = (2 * Math.PI * gbw) / A;
  return (w) => { const r = w / wp, d = 1 + r * r; const f = [1 / d, -r / d]; return [f, f]; };
}

// ---------- Type definitions ----------
const opt = (key, label, def, extra = {}) => ({ key, label, default: def, ...extra });

// ---------- extra op-amps, sensors, ADCs, clock generator ----------
const dual8 = (model, vn = 'V−', vp = 'V+') => ({
  layout: 'dip',
  pins: [['OUTA', 'out'], ['INA−', 'in'], ['INA+', 'in'], [vn, vn === 'GND' || vn === 'VSS' ? 'gnd' : 'pwr'], ['INB+', 'in'], ['INB−', 'in'], ['OUTB', 'out'], [vp, 'pwr']],
  units: ['A', 'B'].map((x) => ({ k: 'opamp', model, inp: `IN${x}+`, inn: `IN${x}−`, out: `OUT${x}`, vp, vn })),
});
const quad14 = (model, vn = 'V−', vp = 'V+') => ({
  layout: 'dip',
  pins: [['OUTA', 'out'], ['INA−', 'in'], ['INA+', 'in'], [vp, 'pwr'], ['INB+', 'in'], ['INB−', 'in'], ['OUTB', 'out'], ['OUTC', 'out'], ['INC−', 'in'], ['INC+', 'in'], [vn, vn === 'GND' || vn === 'VSS' ? 'gnd' : 'pwr'], ['IND+', 'in'], ['IND−', 'in'], ['OUTD', 'out']],
  units: ['A', 'B', 'C', 'D'].map((x) => ({ k: 'opamp', model, inp: `IN${x}+`, inn: `IN${x}−`, out: `OUT${x}`, vp, vn })),
});
Object.assign(PARTS, {
  'MCP6001': { type: 'opamp', desc: 'Single low-power rail-to-rail I/O op-amp, 1.8–6 V', gbw: 1e6, hr: [0.025, 0.025], iq: 0.1e-3, ilim: 0.023, specs: [['Supply', '1.8–6.0 V'], ['GBW', '1 MHz'], ['Slew rate', '0.6 V/µs'], ['I/O', 'rail-to-rail in & out'], ['Iq', '100 µA'], ['Package', 'SOT-23-5 / SC-70']] },
  'LMV358': { type: 'opamp', desc: 'Low-voltage rail-to-rail output op-amp, 2.7–5.5 V', gbw: 1e6, hr: [0.01, 0.05], iq: 0.21e-3, ilim: 0.06, specs: [['Supply', '2.7–5.5 V'], ['GBW', '1 MHz'], ['Slew rate', '1 V/µs'], ['Output', 'rail-to-rail'], ['Input CM', 'includes V− (to V+ − 0.8 V)'], ['Iq', '210 µA / amp']] },
  'TLV9002': { type: 'opamp', desc: 'Low-cost RRIO op-amp, 1.8–5.5 V', gbw: 1e6, hr: [0.02, 0.02], iq: 0.06e-3, ilim: 0.04, specs: [['Supply', '1.8–5.5 V'], ['GBW', '1 MHz'], ['Slew rate', '2 V/µs'], ['I/O', 'rail-to-rail in & out'], ['Iq', '60 µA / amp']] },
  'TLV2372': { type: 'opamp', desc: 'RRIO op-amp, 2.7–16 V', gbw: 3e6, hr: [0.05, 0.05], iq: 0.55e-3, ilim: 0.03, specs: [['Supply', '2.7–16 V'], ['GBW', '3 MHz'], ['Slew rate', '2.4 V/µs'], ['I/O', 'rail-to-rail in & out'], ['Iq', '550 µA / amp']] },
  'OPA2340': { type: 'opamp', desc: 'Precision CMOS RRIO op-amp, 2.7–5.5 V', gbw: 5.5e6, hr: [0.005, 0.005], iq: 0.75e-3, ilim: 0.05, specs: [['Supply', '2.7–5.5 V'], ['GBW', '5.5 MHz'], ['Slew rate', '6 V/µs'], ['I/O', 'rail-to-rail in & out'], ['Vos', '150 µV typ'], ['Iq', '750 µA / amp']] },
  'AD8606': { type: 'opamp', desc: 'Low-noise precision CMOS RRIO op-amp, 2.7–5.5 V', gbw: 10e6, hr: [0.02, 0.02], iq: 1.2e-3, ilim: 0.08, specs: [['Supply', '2.7–5.5 V'], ['GBW', '10 MHz'], ['Slew rate', '5 V/µs'], ['Noise', '8 nV/√Hz'], ['Vos', '20 µV typ'], ['I/O', 'rail-to-rail']] },
  'LM324': { type: 'opamp', desc: 'Quad single-supply op-amp (unit of LM324)', gbw: 1e6, hr: [0.02, 1.5], iq: 0.175e-3, ilim: 0.04, specs: [['Supply', '3–32 V (±1.5 … ±16 V)'], ['GBW', '1 MHz'], ['Slew rate', '0.5 V/µs'], ['Input CM', 'includes V−'], ['Output', 'to ~V−, V+ − 1.5 V']] },
  'TL082': { type: 'opamp', desc: 'General-purpose JFET op-amp (unit of TL082)', gbw: 3e6, hr: [1.5, 1.5], iq: 1.4e-3, ilim: 0.04, specs: [['Supply', '±3.5 … ±18 V'], ['GBW', '3 MHz'], ['Slew rate', '13 V/µs'], ['Note', 'not for low-voltage single supply']] },
  'OPA2134': { type: 'opamp', desc: 'High-performance audio op-amp', gbw: 8e6, hr: [1, 1], iq: 4e-3, ilim: 0.035, specs: [['Supply', '±2.5 … ±18 V'], ['GBW', '8 MHz'], ['Slew rate', '20 V/µs'], ['Noise', '8 nV/√Hz'], ['THD', '0.00008 %']] },
  // sensors
  'GL5516': { type: 'ldr', desc: 'CdS photoresistor 5 mm, 5–10 kΩ @ 10 lux', pkg: '5 mm LDR', r10: 7.5e3, gamma: 0.6, rdark: 0.5e6, specs: [['R @ 10 lux', '5–10 kΩ'], ['γ (10–100 lux)', '0.5–0.6'], ['Dark R', '≥ 0.5 MΩ'], ['Peak λ', '540 nm'], ['Response', '~30 ms rise']] },
  'GL5528': { type: 'ldr', desc: 'CdS photoresistor 5 mm, 8–20 kΩ @ 10 lux', pkg: '5 mm LDR', r10: 12e3, gamma: 0.7, rdark: 1e6, specs: [['R @ 10 lux', '8–20 kΩ'], ['γ', '0.6–0.7'], ['Dark R', '≥ 1 MΩ'], ['Max V', '150 V'], ['Power', '100 mW']] },
  'GL5537': { type: 'ldr', desc: 'CdS photoresistor 5 mm, 20–30 kΩ @ 10 lux', pkg: '5 mm LDR', r10: 25e3, gamma: 0.7, rdark: 2e6, specs: [['R @ 10 lux', '20–30 kΩ'], ['γ', '0.7'], ['Dark R', '≥ 2 MΩ']] },
  'GL5549': { type: 'ldr', desc: 'CdS photoresistor 5 mm, 45–140 kΩ @ 10 lux', pkg: '5 mm LDR', r10: 80e3, gamma: 0.8, rdark: 10e6, specs: [['R @ 10 lux', '45–140 kΩ'], ['γ', '0.8'], ['Dark R', '≥ 10 MΩ']] },
  'BPW34': { type: 'photodiode', desc: 'Silicon PIN photodiode, large area', pkg: 'DIL-2 (side-looking)', sens: 70e-6, Is: 2e-8, n: 1.6, pinout: [['A', 'Anode'], ['K', 'Cathode (marked)']], specs: [['Photocurrent', '≈ 70 µA @ 1000 lux (std A); 50 µA @ 1 mW/cm² 870 nm'], ['Dark current', '2 nA @ 10 V'], ['VOC', '350 mV @ 1000 lux'], ['Capacitance', '70 pF @ 0 V, 25 pF @ 3 V'], ['Peak λ', '900 nm (430–1100 nm)'], ['Rise time', '100 ns']] },
  'SFH203': { type: 'photodiode', desc: 'Silicon PIN photodiode, 5 mm clear', pkg: '5 mm (T1¾)', sens: 9.5e-6, Is: 1e-9, n: 1.6, pinout: [['A', 'Anode (long lead)'], ['K', 'Cathode (short lead / flat)']], specs: [['Photocurrent', '≈ 9.5 µA @ 1000 lux'], ['Dark current', '1 nA @ 20 V'], ['Capacitance', '11 pF @ 0 V'], ['Peak λ', '850 nm'], ['Rise time', '5 ns']] },
  'BPW21': { type: 'photodiode', desc: 'Photodiode with eye-response (V-λ) filter', pkg: 'TO-5', sens: 9e-6, Is: 1e-10, n: 1.6, pinout: [['A', 'Anode'], ['K', 'Cathode (case)']], specs: [['Sensitivity', '≈ 9 nA / lux'], ['Dark current', '30 pA @ 5 V'], ['Peak λ', '565 nm (eye response)']] },
  'TEPT5600': { type: 'phototransistor', desc: 'Ambient-light phototransistor (eye response)', pkg: '5 mm', sens: 2.5e-3, pinout: [['C', 'Collector (short lead)'], ['E', 'Emitter (long lead)']], specs: [['Photocurrent', '≈ 50 µA @ 20 lux (typ, VCE 5 V)'], ['Peak λ', '570 nm'], ['VCEO', '6 V'], ['Angle', '±50°']], notes: 'Linear only up to ~1000 lux. Sensitivity value approximate — set from datasheet.' },
  'PT334-6C': { type: 'phototransistor', desc: 'NPN phototransistor, 5 mm clear (IR / visible)', pkg: '5 mm', sens: 1e-3, pinout: [['C', 'Collector (short lead)'], ['E', 'Emitter (long lead)']], specs: [['IC(on)', '≈ 1–5 mA @ 1 mW/cm²'], ['Peak λ', '940 nm'], ['VCEO', '30 V'], ['Rise time', '15 µs']], notes: 'Sensitivity entered as current per 1000 lux equivalent — approximate.' },
  'Generic phototransistor': { type: 'phototransistor', desc: 'Generic NPN phototransistor', pkg: '5 mm', sens: 1e-3, pinout: [['C', 'Collector'], ['E', 'Emitter']], specs: [] },
});

const accelOut = (axis) => (vs, p) => vs / 2 + 0.1 * vs * num(p[axis], 0); // ADXL335: ratiometric, 300 mV/g @ 3 V
const fieldProp = opt('field', 'Magnetic field (south +)', '0', { unit: 'G', range: [-1500, 1500, 1] });
Object.assign(ICS, {
  // op-amp packages
  'MCP6001-IC': { cat: 'Op-amps', name: 'MCP6001', desc: 'Single RRIO op-amp, 1.8–6 V', pkg: 'SOT-23-5', layout: 'dip',
    pins: [['VOUT', 'out'], ['VSS', 'gnd'], ['VIN+', 'in'], ['VIN−', 'in'], ['VDD', 'pwr'], ['NC', 'nc']],
    units: [{ k: 'opamp', model: 'MCP6001', inp: 'VIN+', inn: 'VIN−', out: 'VOUT', vp: 'VDD', vn: 'VSS' }],
    specs: PARTS.MCP6001.specs, notes: 'Real package is SOT-23-5: 1 VOUT, 2 VSS, 3 VIN+, 4 VIN−, 5 VDD (pin 6 shown here is unused).' },
  'MCP6004-IC': { cat: 'Op-amps', name: 'MCP6004', desc: 'Quad RRIO op-amp, 1.8–6 V', pkg: 'DIP-14 / SOIC-14', ...quad14('MCP6002', 'VSS', 'VDD'), specs: PARTS.MCP6002.specs },
  'LMV358-IC': { cat: 'Op-amps', name: 'LMV358', desc: 'Dual low-voltage RRO op-amp, 2.7–5.5 V', pkg: 'SOIC-8 / VSSOP-8', ...dual8('LMV358', 'GND', 'V+'), specs: PARTS.LMV358.specs },
  'TLV9002-IC': { cat: 'Op-amps', name: 'TLV9002', desc: 'Dual RRIO op-amp, 1.8–5.5 V', pkg: 'SOIC-8', ...dual8('TLV9002', 'V−', 'V+'), specs: PARTS.TLV9002.specs },
  'TLV2372-IC': { cat: 'Op-amps', name: 'TLV2372', desc: 'Dual RRIO op-amp, 2.7–16 V', pkg: 'DIP-8 / SOIC-8', ...dual8('TLV2372', 'GND', 'VDD'), specs: PARTS.TLV2372.specs },
  'OPA2340-IC': { cat: 'Op-amps', name: 'OPA2340', desc: 'Dual precision RRIO op-amp, 2.7–5.5 V', pkg: 'SOIC-8 / MSOP-8', ...dual8('OPA2340', 'V−', 'V+'), specs: PARTS.OPA2340.specs },
  'AD8606-IC': { cat: 'Op-amps', name: 'AD8606', desc: 'Dual low-noise RRIO op-amp, 2.7–5.5 V', pkg: 'SOIC-8 / MSOP-8', ...dual8('AD8606', 'V−', 'V+'), specs: PARTS.AD8606.specs },
  'LM324-IC': { cat: 'Op-amps', name: 'LM324', desc: 'Quad single-supply op-amp, 3–32 V', pkg: 'DIP-14', ...quad14('LM324', 'GND', 'V+'), specs: PARTS.LM324.specs },
  'TL082-IC': { cat: 'Op-amps', name: 'TL082', desc: 'Dual JFET op-amp', pkg: 'DIP-8', ...dual8('TL082', 'V−', 'V+'), specs: PARTS.TL082.specs },
  'OPA2134-IC': { cat: 'Op-amps', name: 'OPA2134', desc: 'Dual audio op-amp', pkg: 'DIP-8 / SOIC-8', ...dual8('OPA2134', 'V−', 'V+'), specs: PARTS.OPA2134.specs },
  // Hall sensors
  'A3144': { cat: 'Sensors', desc: 'Hall-effect switch, unipolar, open-collector (south pole)', pkg: 'TO-92S (flat face toward you)', layout: 'header',
    left: ['VCC', 'GND', 'OUT'], extraProps: [fieldProp], supply: { vcc: 'VCC', gnd: 'GND', min: 4.5, max: 24 },
    units: [{ k: 'hall', vcc: 'VCC', gnd: 'GND', out: 'OUT', type: 'oc', on: (p) => num(p.field, 0) > 250, i: 4.4e-3 }],
    specs: [['Supply', '4.5–24 V'], ['Output', 'open collector, sinks 25 mA — needs pull-up (10 kΩ)'], ['BOP / BRP', '≈ 70–350 G / 50–330 G (switches ~250 G typ)'], ['Active', 'LOW when south pole is near the branded face'], ['Pins', '1 VCC, 2 GND, 3 OUT']] },
  'SS49E': { cat: 'Sensors', desc: 'Linear Hall-effect sensor (ratiometric analog output)', pkg: 'TO-92S', layout: 'header',
    left: ['VCC', 'GND', 'OUT'], extraProps: [fieldProp], supply: { vcc: 'VCC', gnd: 'GND', min: 2.7, max: 6.5 },
    units: [{ k: 'aout', vcc: 'VCC', gnd: 'GND', rout: 50, i: 6e-3, outs: [{ pin: 'OUT', f: (vs, p) => Math.min(0.84 * vs, Math.max(0.17 * vs, vs / 2 + 1.4e-3 * (vs / 5) * num(p.field, 0))) }] }],
    specs: [['Supply', '2.7–6.5 V'], ['Output', 'VCC/2 at 0 G, +1.4 mV/G @ 5 V (ratiometric)'], ['Range', '±1000 G (0.86–4.21 V @ 5 V)'], ['Pins', '1 VCC, 2 GND, 3 OUT']] },
  'DRV5032FB': { cat: 'Sensors', desc: 'Ultra-low-power Hall switch, omnipolar, push-pull', pkg: 'SOT-23', layout: 'header',
    left: ['VCC', 'OUT', 'GND'], extraProps: [fieldProp], supply: { vcc: 'VCC', gnd: 'GND', min: 1.65, max: 5.5 },
    units: [{ k: 'hall', vcc: 'VCC', gnd: 'GND', out: 'OUT', type: 'pp', on: (p) => Math.abs(num(p.field, 0)) > 30, i: 1e-6 }],
    specs: [['Supply', '1.65–5.5 V'], ['Output', 'push-pull, LOW when |B| > BOP'], ['BOP', '3 mT (30 G) typ'], ['Iq', '0.5–1.3 µA (5–20 Hz sampling)'], ['Pins (SOT-23)', '1 VCC, 2 OUT, 3 GND']] },
  // Accelerometers / magnetometers
  'ADXL335 (GY-61)': { cat: 'Sensors', name: 'ADXL335', desc: '3-axis ±3 g analog accelerometer module', pkg: 'GY-61 module, 5-pin header', layout: 'header',
    left: ['VCC', 'X', 'Y', 'Z', 'GND'],
    extraProps: ['ax', 'ay', 'az'].map((k, i) => opt(k, `Acceleration ${'XYZ'[i]}`, i === 2 ? '1' : '0', { unit: 'g', range: [-3, 3, 0.01] })),
    supply: { vcc: 'VCC', gnd: 'GND', min: 1.8, max: 3.6 },
    units: [{ k: 'aout', vcc: 'VCC', gnd: 'GND', rout: 32e3, i: 350e-6, outs: [{ pin: 'X', f: accelOut('ax') }, { pin: 'Y', f: accelOut('ay') }, { pin: 'Z', f: accelOut('az') }] }],
    specs: [['Supply (chip)', '1.8–3.6 V'], ['Range', '±3 g'], ['Sensitivity', '300 mV/g @ 3 V (ratiometric)'], ['0 g output', 'VCC/2'], ['Output impedance', '32 kΩ — add C for bandwidth, buffer for ADCs'], ['Current', '350 µA']],
    notes: 'Many GY-61 boards include a 3.3 V regulator; here VCC is the sensor supply.' },
  'ADXL345 (GY-291)': { cat: 'Sensors', name: 'ADXL345', desc: '3-axis ±16 g digital accelerometer (I²C / SPI)', pkg: 'GY-291 module, 8-pin header', layout: 'header',
    left: ['GND', 'VCC', 'CS', 'INT1', 'INT2', 'SDO', 'SDA', 'SCL'], supply: { vcc: 'VCC', gnd: 'GND', min: 2.0, max: 5.5 },
    units: [{ k: 'mod', vcc: 'VCC', gnd: 'GND', i: 0.15e-3, vnom: 3.3, pullups: ['SDA', 'SCL'], rpu: 4.7e3 }],
    specs: [['Supply (module)', '3.3–5 V (chip 2.0–3.6 V)'], ['Range', '±2/4/8/16 g, 13-bit'], ['Interface', 'I²C 0x53 (SDO low) / 0x1D, or SPI'], ['Current', '40–140 µA'], ['CS', 'tie HIGH for I²C']] },
  'MPU-6050 (GY-521)': { cat: 'Sensors', name: 'MPU-6050', desc: '6-axis accelerometer + gyro (I²C)', pkg: 'GY-521 module, 8-pin header', layout: 'header',
    left: ['VCC', 'GND', 'SCL', 'SDA', 'XDA', 'XCL', 'AD0', 'INT'], supply: { vcc: 'VCC', gnd: 'GND', min: 3.0, max: 5.5 },
    units: [{ k: 'mod', vcc: 'VCC', gnd: 'GND', i: 3.9e-3, vnom: 5, pullups: ['SDA', 'SCL'], rpu: 4.7e3 }],
    specs: [['Supply (module)', '3–5 V (onboard 3.3 V LDO)'], ['Accel', '±2/4/8/16 g, 16-bit'], ['Gyro', '±250 … ±2000 °/s'], ['Interface', 'I²C 0x68 (AD0 low) / 0x69'], ['Current', '3.9 mA']],
    notes: 'Module pull-ups on SDA/SCL go to its 3.3 V rail.' },
  'QMC5883L (GY-271)': { cat: 'Sensors', name: 'QMC5883L', desc: '3-axis magnetometer / compass (I²C)', pkg: 'GY-271 module, 5-pin header', layout: 'header',
    left: ['VCC', 'GND', 'SCL', 'SDA', 'DRDY'], supply: { vcc: 'VCC', gnd: 'GND', min: 3.0, max: 5.5 },
    units: [{ k: 'mod', vcc: 'VCC', gnd: 'GND', i: 2.6e-3, vnom: 3.3, pullups: ['SDA', 'SCL'], rpu: 4.7e3 }],
    specs: [['Range', '±2 / ±8 gauss'], ['Resolution', '16-bit, 2 mG'], ['Interface', 'I²C 0x0D'], ['Supply (module)', '3–5 V'], ['Note', 'Older GY-271 boards use HMC5883L (I²C 0x1E) — same pinout']] },
  'HMC5883L (GY-271)': { cat: 'Sensors', name: 'HMC5883L', desc: '3-axis magnetometer (I²C)', pkg: 'GY-271 module, 5-pin header', layout: 'header',
    left: ['VCC', 'GND', 'SCL', 'SDA', 'DRDY'], supply: { vcc: 'VCC', gnd: 'GND', min: 3.0, max: 5.5 },
    units: [{ k: 'mod', vcc: 'VCC', gnd: 'GND', i: 0.1e-3, vnom: 3.3, pullups: ['SDA', 'SCL'], rpu: 4.7e3 }],
    specs: [['Range', '±0.88 … ±8.1 gauss'], ['Resolution', '12-bit'], ['Interface', 'I²C 0x1E'], ['Supply (module)', '3–5 V']] },
  // ADCs
  'ADS1115 module': { cat: 'ADCs', name: 'ADS1115', desc: '16-bit 4-ch I²C ADC with PGA (breakout)', pkg: '10-pin header', layout: 'header',
    left: ['VDD', 'GND', 'SCL', 'SDA', 'ADDR', 'ALRT', 'A0', 'A1', 'A2', 'A3'], supply: { vcc: 'VDD', gnd: 'GND', min: 2.0, max: 5.5 },
    extraProps: [opt('pga', 'Full-scale range (PGA)', '±4.096 V', { options: ['±6.144 V', '±4.096 V', '±2.048 V', '±1.024 V', '±0.512 V', '±0.256 V'] })],
    adc: { inputs: ['A0', 'A1', 'A2', 'A3'], ref: 'GND', bits: 16, fsr: (p) => parseFloat(String(p.pga).replace('±', '')) || 4.096 },
    units: [{ k: 'mod', vcc: 'VDD', gnd: 'GND', i: 150e-6, vnom: 3.3, pullups: ['SDA', 'SCL'], rpu: 10e3 }],
    specs: [['Resolution', '16-bit (15-bit single-ended)'], ['Rate', '8–860 SPS'], ['FSR', '±0.256 … ±6.144 V (never exceed VDD + 0.3 V)'], ['Interface', 'I²C 0x48–0x4B (ADDR → GND/VDD/SDA/SCL)'], ['Supply', '2.0–5.5 V, 150 µA'], ['Input Z', '≈ 6 MΩ @ ±2.048 V']] },
  'ADS1115 (chip)': { cat: 'ADCs', name: 'ADS1115', desc: '16-bit 4-ch I²C ADC with PGA', pkg: 'MSOP-10 / X2QFN-10', layout: 'dip',
    pins: [['ADDR', 'in'], ['ALRT', 'out'], ['GND', 'gnd'], ['AIN0', 'in'], ['AIN1', 'in'], ['AIN2', 'in'], ['AIN3', 'in'], ['VDD', 'pwr'], ['SDA', 'io'], ['SCL', 'in']],
    extraProps: [opt('pga', 'Full-scale range (PGA)', '±4.096 V', { options: ['±6.144 V', '±4.096 V', '±2.048 V', '±1.024 V', '±0.512 V', '±0.256 V'] })],
    adc: { inputs: ['AIN0', 'AIN1', 'AIN2', 'AIN3'], ref: 'GND', bits: 16, fsr: (p) => parseFloat(String(p.pga).replace('±', '')) || 4.096 },
    units: [{ k: 'mod', vcc: 'VDD', gnd: 'GND', i: 150e-6, vnom: 3.3 }],
    specs: [['Resolution', '16-bit'], ['Rate', '8–860 SPS'], ['Interface', 'I²C'], ['Supply', '2.0–5.5 V']], notes: 'SDA/SCL need pull-ups (typ. 4.7–10 kΩ).' },
  'ADS1220': { cat: 'ADCs', desc: '24-bit 4-ch SPI ΔΣ ADC, PGA 1–128, internal 2.048 V ref', pkg: 'TSSOP-16', layout: 'dip',
    pins: [['SCLK', 'in'], ['CS', 'in'], ['CLK', 'in'], ['DGND', 'gnd'], ['AVSS', 'gnd'], ['AIN3/REFN1', 'in'], ['AIN2', 'in'], ['REFN0', 'in'], ['REFP0', 'in'], ['AIN1', 'in'], ['AIN0/REFP1', 'in'], ['AVDD', 'pwr'], ['DVDD', 'pwr'], ['DRDY', 'out'], ['DOUT/DRDY', 'out'], ['DIN', 'in']],
    extraProps: [opt('pga', 'PGA gain (int. 2.048 V ref)', '1', { options: ['1', '2', '4', '8', '16', '32', '64', '128'] })],
    adc: { inputs: ['AIN0/REFP1', 'AIN1', 'AIN2', 'AIN3/REFN1'], ref: 'AVSS', bits: 24, fsr: (p) => 2.048 / (+p.pga || 1) },
    units: [{ k: 'mod', vcc: 'AVDD', gnd: 'AVSS', i: 0.42e-3, vnom: 3.3 }],
    specs: [['Resolution', '24-bit ΔΣ'], ['Rate', '20–2000 SPS'], ['PGA', '1–128 (low-noise)'], ['Reference', 'internal 2.048 V or external REFP/REFN'], ['IDACs', '2 × 10 µA–1.5 mA (RTD excitation)'], ['Supply', 'AVDD 2.3–5.5 V, DVDD 2.3–5.5 V'], ['Interface', 'SPI mode 1']],
    notes: 'Pinout from memory of TSSOP-16 — verify against the TI datasheet before layout.' },
  'ADS1256': { cat: 'ADCs', desc: '24-bit 8-ch SPI ΔΣ ADC, 30 kSPS, PGA 1–64', pkg: 'SSOP-28', layout: 'dip',
    pins: [['AVDD', 'pwr'], ['AGND', 'gnd'], ['VREFN', 'in'], ['VREFP', 'in'], ['AINCOM', 'in'], ['AIN0', 'in'], ['AIN1', 'in'], ['AIN2', 'in'], ['AIN3', 'in'], ['AIN4', 'in'], ['AIN5', 'in'], ['AIN6', 'in'], ['AIN7', 'in'], ['SYNC/PDWN', 'in'], ['RESET', 'in'], ['DVDD', 'pwr'], ['DGND', 'gnd'], ['XTAL2', 'io'], ['XTAL1/CLKIN', 'in'], ['CS', 'in'], ['DRDY', 'out'], ['DOUT', 'out'], ['DIN', 'in'], ['SCLK', 'in'], ['D0/CLKOUT', 'io'], ['D1', 'io'], ['D2', 'io'], ['D3', 'io']],
    extraProps: [opt('pga', 'PGA gain (VREF 2.5 V)', '1', { options: ['1', '2', '4', '8', '16', '32', '64'] })],
    adc: { inputs: ['AIN0', 'AIN1', 'AIN2', 'AIN3', 'AIN4', 'AIN5', 'AIN6', 'AIN7'], ref: 'AINCOM', bits: 24, fsr: (p) => 5 / (+p.pga || 1) },
    units: [{ k: 'mod', vcc: 'AVDD', gnd: 'AGND', i: 38e-3, vnom: 5 }],
    specs: [['Resolution', '24-bit ΔΣ (23 bits noise-free @ 2.5 SPS)'], ['Rate', '2.5 SPS – 30 kSPS'], ['FSR', '±2·VREF / PGA (±5 V @ VREF 2.5 V, PGA 1)'], ['Supply', 'AVDD 5 V, DVDD 1.8–3.6 V'], ['Clock', '7.68 MHz crystal'], ['Interface', 'SPI']],
    notes: 'Pinout from memory of SSOP-28 — verify against the TI datasheet. Common boards (Waveshare) add a 2.5 V reference and crystal.' },
  // Clock generator
  'Si5351 module': { cat: 'Signal sources', name: 'Si5351A', desc: 'I²C programmable clock generator, 3 outputs 8 kHz–160 MHz (breakout)', pkg: 'Adafruit-style breakout', layout: 'header',
    left: ['VIN', '3Vo', 'GND', 'SCL', 'SDA'], right: ['CLK0', 'CLK1', 'CLK2'], gpioPins: ['CLK0', 'CLK1', 'CLK2'], gpioDefault: { CLK0: 'pwm' },
    supply: { vcc: 'VIN', gnd: 'GND', min: 3.0, max: 5.5 },
    extraProps: [0, 1, 2].map((i) => opt('f' + i, `CLK${i} frequency`, ['10M', '1M', '100k'][i], { unit: 'Hz', eng: true })),
    units: [{ k: 'mcu', vlogic: 3.3, v5: 'VIN', v3: '3Vo', gnd: 'GND', drop: 0.3, ilim: 0.15, load: 0.02 }, { k: 'mod', vcc: '3Vo', gnd: 'GND', i: 0, pullups: ['SDA', 'SCL'], rpu: 10e3 }],
    specs: [['Outputs', '3 × CMOS square, 8 kHz – 160 MHz (CLK0–2)'], ['Output level', '3.3 V CMOS, 50 Ω source'], ['Reference', '25 MHz crystal'], ['Interface', 'I²C 0x60'], ['Supply', 'VIN 3–5 V (onboard 3.3 V LDO)'], ['Jitter', '< 70 ps pk-pk']],
    notes: 'Enable outputs in the clock table (set to “PWM 50 %”). The DC simulation shows the average level; frequency is shown for reference.' },
  'Si5351A (chip)': { cat: 'Signal sources', name: 'Si5351A', desc: 'I²C clock generator IC, 3 outputs', pkg: 'MSOP-10', layout: 'dip',
    pins: [['VDD', 'pwr'], ['XA', 'in'], ['XB', 'in'], ['SCL', 'in'], ['SDA', 'io'], ['CLK2', 'out'], ['VDDO', 'pwr'], ['GND', 'gnd'], ['CLK1', 'out'], ['CLK0', 'out']],
    units: [{ k: 'mod', vcc: 'VDD', gnd: 'GND', i: 20e-3, vnom: 3.3 }],
    specs: [['Supply', 'VDD 2.5/3.3 V, VDDO 1.8–3.3 V'], ['Crystal', '25 / 27 MHz on XA/XB'], ['Outputs', '8 kHz – 160 MHz']], notes: 'Verify pinout against the Skyworks/Silicon Labs datasheet.' },
  // Custom board template
  'Custom board': { cat: 'MCU boards', desc: 'Define your own board — edit the pin lists in properties, or use “New custom part” to save it to your library', pkg: 'header', layout: 'header', customInline: true,
    left: ['5V', 'GND', '3V3', 'IO1', 'IO2'], right: ['IO3', 'IO4', 'IO5', 'IO6', 'IO7'],
    units: [{ k: 'mcu', vlogic: 3.3, v5: '5V', v3: '3V3', gnd: 'GND', drop: 0.3, ilim: 0.5, load: 0.05 }], specs: [] },
});
// ---------- comparators, logic, drivers, power, interface, sensors, modules ----------
const cmpPP = (o) => ({ k: 'cmp', pp: true, inp: 'IN+', inn: 'IN−', out: 'OUT', vp: 'V+', vn: 'V−', ...o });
Object.assign(ICS, {
  'LM339': { cat: 'Comparators', name: 'LM339', desc: 'Quad open-collector comparator', pkg: 'DIP-14 / SOIC-14', layout: 'dip',
    pins: [['OUT2', 'out'], ['OUT1', 'out'], ['VCC', 'pwr'], ['IN1−', 'in'], ['IN1+', 'in'], ['IN2−', 'in'], ['IN2+', 'in'], ['IN3−', 'in'], ['IN3+', 'in'], ['IN4−', 'in'], ['IN4+', 'in'], ['GND', 'gnd'], ['OUT4', 'out'], ['OUT3', 'out']],
    units: [1, 2, 3, 4].map((i) => ({ k: 'cmp', inp: `IN${i}+`, inn: `IN${i}−`, out: `OUT${i}`, vp: 'VCC', vn: 'GND', vmin: 2, iq: 0.2e-3 })),
    specs: [['Supply', '2–36 V (±1–18 V)'], ['Output', 'open collector — needs a pull-up (1–10 kΩ)'], ['Sink', '16 mA typ'], ['Response', '1.3 µs'], ['Input CM', '0 to VCC − 1.5 V'], ['Iq', '0.8 mA (all four)']],
    notes: 'Unused comparators: tie both inputs to GND. Add hysteresis with a resistor from OUT to IN+ if the input is slow or noisy.' },
  'LM311': { cat: 'Comparators', name: 'LM311', desc: 'Single fast comparator, open-collector output with separate emitter', pkg: 'DIP-8 / SOIC-8', layout: 'dip',
    pins: [['GND', 'gnd'], ['IN+', 'in'], ['IN−', 'in'], ['V−', 'pwr'], ['BAL', 'io'], ['BAL/STB', 'io'], ['OUT', 'out'], ['V+', 'pwr']],
    units: [{ k: 'cmp', inp: 'IN+', inn: 'IN−', out: 'OUT', vp: 'V+', vn: 'GND', vmin: 3.5, isink: 0.05, iq: 5e-3 }],
    specs: [['Supply', '5–30 V single or ±15 V'], ['Output', 'open collector, 50 mA sink; emitter on pin 1 (usually GND)'], ['Response', '200 ns'], ['Strobe', 'pull pin 6 low to force the output off']],
    notes: 'Pin 1 is the output transistor emitter — connect it to ground for logic outputs. Leave BAL pins open unless trimming offset.' },
  'LMV393': { cat: 'Comparators', name: 'LMV393', desc: 'Dual low-voltage open-collector comparator (LM393 pinout)', pkg: 'SOIC-8 / MSOP-8', layout: 'dip',
    pins: [['OUT1', 'out'], ['IN1−', 'in'], ['IN1+', 'in'], ['GND', 'gnd'], ['IN2+', 'in'], ['IN2−', 'in'], ['OUT2', 'out'], ['VCC', 'pwr']],
    units: [1, 2].map((i) => ({ k: 'cmp', inp: `IN${i}+`, inn: `IN${i}−`, out: `OUT${i}`, vp: 'VCC', vn: 'GND', vmin: 2.7, iq: 60e-6, isink: 0.01 })),
    specs: [['Supply', '2.7–5.5 V'], ['Output', 'open collector — pull up to the logic rail'], ['Response', '≈ 600 ns'], ['Iq', '≈ 100 µA per channel']] },
  'MCP6561': { cat: 'Comparators', name: 'MCP6561', desc: 'Low-power push-pull comparator, rail-to-rail input', pkg: 'SOT-23-5', layout: 'dip', nums: ['1', '2', '3', '4', '5', ''],
    pins: [['OUT', 'out'], ['VSS', 'gnd'], ['IN+', 'in'], ['IN−', 'in'], ['VDD', 'pwr'], ['NC', 'nc']],
    units: [cmpPP({ vp: 'VDD', vn: 'VSS', vmin: 1.8, iq: 100e-6 })],
    specs: [['Supply', '1.8–5.5 V'], ['Output', 'push-pull, no pull-up needed'], ['Response', '≈ 50 ns'], ['Iq', '100 µA'], ['Hysteresis', '≈ 3.5 mV built in']] },
  'TLV3201': { cat: 'Comparators', name: 'TLV3201', desc: 'Fast push-pull comparator, rail-to-rail input', pkg: 'SOT-23-5', layout: 'dip', nums: ['1', '2', '3', '4', '5', ''],
    pins: [['OUT', 'out'], ['V−', 'gnd'], ['IN+', 'in'], ['IN−', 'in'], ['V+', 'pwr'], ['NC', 'nc']],
    units: [cmpPP({ vmin: 2.7, iq: 40e-6 })],
    specs: [['Supply', '2.7–5.5 V'], ['Output', 'push-pull'], ['Propagation', '40 ns'], ['Iq', '40 µA'], ['Hysteresis', '≈ 1.2 mV built in']] },
  'TLV7011': { cat: 'Comparators', name: 'TLV7011', desc: 'Nanopower push-pull comparator (0.3 µA) for battery wake-up / threshold detectors', pkg: 'SOT-23-5', layout: 'dip', nums: ['1', '2', '3', '4', '5', ''],
    pins: [['OUT', 'out'], ['V−', 'gnd'], ['IN+', 'in'], ['IN−', 'in'], ['V+', 'pwr'], ['NC', 'nc']],
    units: [cmpPP({ vmin: 1.6, iq: 0.335e-6, rout: 200 })],
    specs: [['Supply', '1.6–5.5 V'], ['Output', 'push-pull'], ['Propagation', '≈ 260 ns'], ['Iq', '335 nA']], notes: 'Pinout as for the SOT-23-5 version — check the TI datasheet for the package you buy.' },
  '74HC595': { cat: 'Logic & interface', name: '74HC595', desc: '8-bit serial-in, parallel-out shift register with output latch', pkg: 'DIP-16 / SOIC-16', layout: 'dip',
    pins: [['QB', 'out'], ['QC', 'out'], ['QD', 'out'], ['QE', 'out'], ['QF', 'out'], ['QG', 'out'], ['QH', 'out'], ['GND', 'gnd'], ["QH'", 'out'], ['SRCLR', 'in'], ['SRCLK', 'in'], ['RCLK', 'in'], ['OE', 'in'], ['SER', 'in'], ['QA', 'out'], ['VCC', 'pwr']],
    units: [{ k: 'mod', vcc: 'VCC', gnd: 'GND', i: 80e-6, vnom: 5 }],
    specs: [['Supply', '2–6 V'], ['Outputs', '±6 mA each (≈ 70 mA total)'], ['SRCLR', 'active low — tie to VCC'], ['OE', 'active low — tie to GND to enable'], ['Chain', "QH' → SER of the next chip"]],
    notes: 'Clock data in on SRCLK, then pulse RCLK to copy it to the outputs. 100 nF from VCC to GND at the chip.' },
  '74HC14': { cat: 'Logic & interface', name: '74HC14', desc: 'Hex Schmitt-trigger inverter (cleans slow or noisy edges, debounce)', pkg: 'DIP-14 / SOIC-14', layout: 'dip',
    pins: [['1A', 'in'], ['1Y', 'out'], ['2A', 'in'], ['2Y', 'out'], ['3A', 'in'], ['3Y', 'out'], ['GND', 'gnd'], ['4Y', 'out'], ['4A', 'in'], ['5Y', 'out'], ['5A', 'in'], ['6Y', 'out'], ['6A', 'in'], ['VCC', 'pwr']],
    units: [1, 2, 3, 4, 5, 6].map((i) => ({ k: 'logic', inv: true, in: `${i}A`, out: `${i}Y`, vdd: 'VCC', gnd: 'GND' })),
    specs: [['Supply', '2–6 V'], ['Thresholds @5 V', '≈ 2.9 V rising / 1.8 V falling'], ['Output', '±4 mA (±25 mA abs max)']], notes: 'Tie unused inputs to GND or VCC — floating CMOS inputs oscillate and waste current.' },
  'ULN2003A': { cat: 'Drivers', name: 'ULN2003A', desc: '7-channel Darlington sink driver with flyback diodes', pkg: 'DIP-16 / SOIC-16', layout: 'dip',
    pins: [['IN1', 'in'], ['IN2', 'in'], ['IN3', 'in'], ['IN4', 'in'], ['IN5', 'in'], ['IN6', 'in'], ['IN7', 'in'], ['GND', 'gnd'], ['COM', 'io'], ['OUT7', 'out'], ['OUT6', 'out'], ['OUT5', 'out'], ['OUT4', 'out'], ['OUT3', 'out'], ['OUT2', 'out'], ['OUT1', 'out']],
    units: [1, 2, 3, 4, 5, 6, 7].map((i) => ({ k: 'sink', in: `IN${i}`, out: `OUT${i}`, gnd: 'GND' })),
    specs: [['Outputs', '500 mA sink each, 50 V'], ['Input', '5 V / 3.3 V logic (2.7 kΩ inside)'], ['Saturation', '≈ 0.9–1.1 V'], ['COM', 'flyback diode common — connect to the load supply']],
    notes: 'Loads go between the supply and OUTx; tie COM to that supply when driving relays, solenoids or steppers.' },
  'L293D': { cat: 'Drivers', name: 'L293D', desc: 'Quad half-H driver (two DC motors or one stepper), clamp diodes built in', pkg: 'DIP-16', layout: 'dip',
    pins: [['EN12', 'in'], ['1A', 'in'], ['1Y', 'out'], ['GND', 'gnd'], ['GND', 'gnd'], ['2Y', 'out'], ['2A', 'in'], ['VCC2', 'pwr'], ['EN34', 'in'], ['3A', 'in'], ['3Y', 'out'], ['GND', 'gnd'], ['GND', 'gnd'], ['4Y', 'out'], ['4A', 'in'], ['VCC1', 'pwr']],
    units: [{ k: 'mod', vcc: 'VCC1', gnd: 'GND', i: 0.024, vnom: 5 }],
    specs: [['VCC1 (logic)', '4.5–7 V'], ['VCC2 (motor)', '4.5–36 V'], ['Current', '600 mA per channel (1.2 A peak)'], ['Drop', '≈ 1.4 V high side + 1.2 V low side'], ['Heat', 'GND pins 4,5,12,13 are the heatsink']] },
  'TL431': { cat: 'Power ICs', name: 'TL431', desc: 'Adjustable shunt voltage reference (2.495 V)', pkg: 'TO-92', layout: 'dip', nums: ['1', '2', '3', ''],
    pins: [['REF', 'in'], ['ANODE', 'gnd'], ['CATHODE', 'io'], ['NC', 'nc']],
    units: [{ k: 'tl431', ref: 'REF', k2: 'CATHODE', a: 'ANODE' }],
    specs: [['Vref', '2.495 V ±0.5–2 %'], ['Cathode', '1 mA … 100 mA, up to 36 V'], ['Set', 'Vout = 2.495 × (1 + R1/R2)']], notes: 'Needs at least 1 mA through it (series resistor from the supply). TO-92 pin order REF, ANODE, CATHODE — check your package.' },
  'LM386': { cat: 'Drivers', name: 'LM386', desc: 'Low-voltage audio power amplifier (gain 20–200)', pkg: 'DIP-8', layout: 'dip',
    pins: [['GAIN1', 'io'], ['IN−', 'in'], ['IN+', 'in'], ['GND', 'gnd'], ['VOUT', 'out'], ['VS', 'pwr'], ['BYPASS', 'io'], ['GAIN8', 'io']],
    units: [{ k: 'mod', vcc: 'VS', gnd: 'GND', i: 4e-3, vnom: 9 }],
    specs: [['Supply', '4–12 V'], ['Gain', '20 (pins 1/8 open) … 200 (10 µF across 1–8)'], ['Output', '≈ 0.3–1 W into 8 Ω'], ['Parts', '250 µF out to speaker, 10 Ω + 47 nF Zobel, 10 µF on BYPASS']] },
  'TP4056': { cat: 'Power ICs', name: 'TP4056', desc: '1 A linear Li-ion charger, CC/CV to 4.2 V', pkg: 'SOP-8 (exposed pad)', layout: 'dip',
    pins: [['TEMP', 'in'], ['PROG', 'io'], ['GND', 'gnd'], ['VCC', 'pwr'], ['BAT', 'io'], ['STDBY', 'out'], ['CHRG', 'out'], ['CE', 'in']],
    units: [{ k: 'mod', vcc: 'VCC', gnd: 'GND', i: 0.3e-3, vnom: 5 }],
    specs: [['Charge current', '1200 / R_PROG(kΩ) mA (1.2 kΩ → 1 A)'], ['Float voltage', '4.2 V ±1 %'], ['Status', 'CHRG / STDBY open-drain (LEDs)'], ['TEMP', 'tie to GND if no NTC'], ['CE', 'tie high to enable']], notes: 'Charges only — add a protection IC (DW01 + MOSFETs) unless the cell has one, and a load-sharing path if the circuit runs while charging.' },
  'TP4054': { cat: 'Power ICs', name: 'TP4054', desc: '500 mA linear Li-ion charger, CC/CV to 4.2 V', pkg: 'SOT-23-5', layout: 'dip', nums: ['1', '2', '3', '4', '5', ''],
    pins: [['CHRG', 'out'], ['GND', 'gnd'], ['BAT', 'io'], ['VCC', 'pwr'], ['PROG', 'io'], ['NC', 'nc']],
    units: [{ k: 'mod', vcc: 'VCC', gnd: 'GND', i: 0.2e-3, vnom: 5 }],
    specs: [['Charge current', '1000 / R_PROG(kΩ) mA'], ['Float voltage', '4.2 V'], ['Status', 'CHRG open-drain, low while charging']] },
  'MCP23017': { cat: 'Logic & interface', name: 'MCP23017', desc: '16-bit I²C GPIO expander with interrupts', pkg: 'DIP-28 / SOIC-28', layout: 'dip',
    pins: [['GPB0', 'io'], ['GPB1', 'io'], ['GPB2', 'io'], ['GPB3', 'io'], ['GPB4', 'io'], ['GPB5', 'io'], ['GPB6', 'io'], ['GPB7', 'io'], ['VDD', 'pwr'], ['VSS', 'gnd'], ['NC', 'nc'], ['SCL', 'in'], ['SDA', 'io'], ['NC', 'nc'], ['A0', 'in'], ['A1', 'in'], ['A2', 'in'], ['RESET', 'in'], ['INTB', 'out'], ['INTA', 'out'], ['GPA0', 'io'], ['GPA1', 'io'], ['GPA2', 'io'], ['GPA3', 'io'], ['GPA4', 'io'], ['GPA5', 'io'], ['GPA6', 'io'], ['GPA7', 'io']],
    units: [{ k: 'mod', vcc: 'VDD', gnd: 'VSS', i: 1e-3, vnom: 3.3 }],
    specs: [['Supply', '1.8–5.5 V'], ['I²C', '0x20–0x27 (A2..A0), up to 1.7 MHz'], ['Outputs', '25 mA each'], ['RESET', 'active low — tie to VDD']] },
  'USBLC6-2SC6': { cat: 'Power ICs', name: 'USBLC6-2', desc: 'Low-capacitance ESD protection for USB D+/D− and VBUS', pkg: 'SOT-23-6', layout: 'dip',
    pins: [['IO1', 'io'], ['GND', 'gnd'], ['IO2', 'io'], ['IO2', 'io'], ['VBUS', 'pwr'], ['IO1', 'io']],
    units: [],
    specs: [['Lines', '2 data lines + VBUS rail'], ['Capacitance', '≈ 3.5 pF per line'], ['ESD', '±15 kV air / ±8 kV contact']], notes: 'Pins 1/6 and 3/4 are the same line (flow-through). Place right next to the connector.' },
  'DS18B20': { cat: 'Sensors', name: 'DS18B20', desc: '1-Wire digital temperature sensor (−55…125 °C)', pkg: 'TO-92', layout: 'dip', nums: ['1', '2', '3', ''],
    pins: [['GND', 'gnd'], ['DQ', 'io'], ['VDD', 'pwr'], ['NC', 'nc']],
    units: [{ k: 'mod', vcc: 'VDD', gnd: 'GND', i: 1e-3, vnom: 3.3, pullups: [] }],
    specs: [['Accuracy', '±0.5 °C (−10…85 °C)'], ['Bus', '1-Wire, 4.7 kΩ pull-up DQ → VDD'], ['Supply', '3.0–5.5 V'], ['Conversion', '750 ms at 12 bits']] },
  'LM35': { cat: 'Sensors', name: 'LM35', desc: 'Analog temperature sensor, 10 mV/°C', pkg: 'TO-92', layout: 'dip', nums: ['1', '2', '3', ''],
    pins: [['+VS', 'pwr'], ['VOUT', 'out'], ['GND', 'gnd'], ['NC', 'nc']],
    extraProps: [opt('temp', 'Temperature', '25', { unit: '°C', eng: true })],
    units: [{ k: 'lm35', vs: '+VS', out: 'VOUT', gnd: 'GND' }],
    specs: [['Output', '10 mV/°C (250 mV at 25 °C)'], ['Supply', '4–30 V'], ['Accuracy', '±0.5 °C at 25 °C'], ['Load', 'keep capacitive load < 50 pF, or add 75 Ω + 1 µF']] },
  'INA219 module': { cat: 'Sensors', name: 'INA219', desc: 'High-side current / power monitor, I²C (breakout with 0.1 Ω shunt)', pkg: 'breakout', layout: 'header',
    left: ['VCC', 'GND', 'SCL', 'SDA'], right: ['VIN+', 'VIN−'],
    units: [{ k: 'mod', vcc: 'VCC', gnd: 'GND', i: 1e-3, vnom: 3.3, pullups: ['SDA', 'SCL'], rpu: 10e3 }, { k: 'shunt', a: 'VIN+', b: 'VIN−', r: 0.1 }],
    specs: [['Range', '±3.2 A with 0.1 Ω shunt, bus up to 26 V'], ['Interface', 'I²C 0x40–0x4F'], ['Supply', '3–5.5 V']], notes: 'The load current flows VIN+ → VIN− through the shunt; put it in the positive supply line.' },
  'LSM6DS3': { cat: 'Sensors', name: 'LSM6DS3', desc: '6-axis IMU: 3-axis accelerometer + 3-axis gyroscope, I²C/SPI', pkg: 'LGA-14 2.5×3 mm', layout: 'dip', footprint: 'Package_LGA:LGA-14_3x2.5mm_P0.5mm_LayoutBorder3x4y',
    pins: [['SDO/SA0', 'in'], ['SDx', 'io'], ['SCx', 'io'], ['INT1', 'out'], ['VDDIO', 'pwr'], ['GND', 'gnd'], ['GND', 'gnd'], ['VDD', 'pwr'], ['INT2', 'out'], ['OCS_Aux', 'in'], ['SDO_Aux', 'out'], ['CS', 'in'], ['SCL', 'in'], ['SDA', 'io']],
    units: [{ k: 'mod', vcc: 'VDD', gnd: 'GND', i: 0.9e-3, vnom: 3.3 }],
    specs: [['Accel', '±2/4/8/16 g'], ['Gyro', '±125…±2000 dps'], ['I²C', '0x6A (SA0 low) / 0x6B'], ['Supply', 'VDD 1.71–3.6 V, VDDIO 1.62–3.6 V'], ['Current', '0.9 mA both on, 6 µA power-down']],
    notes: 'CS high selects I²C. Pin order follows the ST LGA-14 numbering — verify against the datasheet.' },
  'QMC5883P': { cat: 'Sensors', name: 'QMC5883P', desc: '3-axis magnetometer, I²C 0x2C (newer QMC5883L successor)', pkg: 'LGA-16 3×3 mm', layout: 'dip',
    pins: [['SCL', 'in'], ['SDA', 'io'], ['VDD', 'pwr'], ['VDDIO', 'pwr'], ['GND', 'gnd'], ['INT', 'out'], ['NC', 'nc'], ['NC', 'nc']],
    units: [{ k: 'mod', vcc: 'VDD', gnd: 'GND', i: 0.2e-3, vnom: 3.3 }],
    specs: [['Range', '±30 G / ±8 G'], ['I²C', '0x2C'], ['Supply', '2.5–3.6 V'], ['ODR', 'up to 200 Hz']], notes: 'Functional pin list (not package pad numbers).' },
  'DW01A': { cat: 'Power ICs', name: 'DW01A', desc: 'Single-cell Li-ion protection controller (drives two N-MOSFETs in the negative lead)', pkg: 'SOT-23-6', layout: 'dip', footprint: 'Package_TO_SOT_SMD:SOT-23-6',
    pins: [['OD', 'out'], ['CS', 'in'], ['OC', 'out'], ['TD', 'io'], ['VCC', 'pwr'], ['GND', 'gnd']],
    units: [{ k: 'dw01', vcc: 'VCC', gnd: 'GND', od: 'OD', oc: 'OC' }],
    specs: [['Over-charge', '4.25–4.35 V'], ['Over-discharge', '2.3–2.5 V'], ['Over-current', '≈ 150 mV across the FETs (≈ 3 A with FS8205A)'], ['Parts', '100 Ω + 100 nF on VCC, 1–2 kΩ CS → P−']],
    notes: 'GND is the cell negative (B−); CS goes to the pack negative (P−) through 1–2 kΩ. Current-limit sensing is not simulated.' },
  'FS8205A': { cat: 'Power ICs', name: 'FS8205A', desc: 'Dual N-MOSFET, common drain, for battery protection (20 V, ≈ 25 mΩ)', pkg: 'TSSOP-8', layout: 'dip', footprint: 'Package_SO:TSSOP-8_4.4x3mm_P0.65mm',
    pins: [['D', 'io'], ['S1', 'io'], ['S1', 'io'], ['G1', 'in'], ['G2', 'in'], ['S2', 'io'], ['S2', 'io'], ['D', 'io']],
    units: [{ k: 'nfet', d: 'D', g: 'G1', s: 'S1', vth: 0.7, rds: 0.025 }, { k: 'nfet', d: 'D', g: 'G2', s: 'S2', vth: 0.7, rds: 0.025 }],
    specs: [['VDS', '20 V'], ['RDS(on)', '≈ 25 mΩ each at 4.5 V'], ['Current', '≈ 6 A']], notes: 'FET1 (S1/G1) at the cell negative, driven by OD; FET2 (S2/G2) at the pack negative, driven by OC. Check the pin order of your package.' },
  'USB-C receptacle': { cat: 'Power ICs', name: 'USB-C', desc: 'USB Type-C receptacle (USB 2.0 data + power)', pkg: 'USB-C', layout: 'dip', functional: true, footprint: 'Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12',
    pins: [['VBUS', 'pwr'], ['GND', 'gnd'], ['CC1', 'io'], ['CC2', 'io'], ['NC', 'nc'], ['SHELL', 'io'], ['D−', 'io'], ['D+', 'io']],
    units: [], specs: [['CC1/CC2', '5.1 kΩ each to GND → the host supplies 5 V'], ['Current', '500 mA (USB 2.0 default), up to 3 A if the source advertises it']], notes: 'Functional symbol — pad names depend on the connector footprint.' },
  'Micro-USB receptacle': { cat: 'Power ICs', name: 'Micro-USB', desc: 'Micro-B USB receptacle', pkg: 'Micro-USB B', layout: 'dip', footprint: 'Connector_USB:USB_Micro-B_Molex-105017-0001',
    pins: [['VBUS', 'pwr'], ['D−', 'io'], ['D+', 'io'], ['ID', 'io'], ['GND', 'gnd'], ['SHELL', 'io']], nums: ['1', '2', '3', '4', '5', 'S'],
    units: [], specs: [['Current', '500 mA from a computer port, ≈ 1–2 A from chargers']] },
  'ESP32-S3-WROOM-1': { cat: 'MCU boards', name: 'ESP32-S3-WROOM-1', desc: 'ESP32-S3 module (Wi-Fi + BLE 5, PCB antenna, flash) for your own PCB — 3.3 V only', pkg: 'module 18×25.5 mm, 41 pads', layout: 'header', footprint: 'RF_Module:ESP32-S3-WROOM-1',
    left: ['GND', '3V3', 'EN', 'IO4', 'IO5', 'IO6', 'IO7', 'IO15', 'IO16', 'IO17', 'IO18', 'IO8', 'IO19', 'IO20', 'IO3', 'IO46', 'IO9', 'IO10', 'IO11', 'IO12'],
    right: ['IO13', 'IO14', 'IO21', 'IO47', 'IO48', 'IO45', 'IO0', 'IO35', 'IO36', 'IO37', 'IO38', 'IO39', 'IO40', 'IO41', 'IO42', 'RXD0', 'TXD0', 'IO2', 'IO1', 'GND', 'GND'],
    units: [{ k: 'mod', vcc: '3V3', gnd: 'GND', i: 0.08, vnom: 3.3 }],
    specs: [['Supply', '3.0–3.6 V, ≥ 500 mA peaks (Wi-Fi TX ≈ 350 mA)'], ['Current', 'Wi-Fi ≈ 80–110 mA avg, light sleep ≈ 0.24 mA, deep sleep ≈ 8 µA'], ['EN', '10 kΩ pull-up + 1 µF to GND (reset delay)'], ['Strapping', 'IO0 (boot), IO3, IO45, IO46 — leave free'], ['USB', 'native USB D−/D+ on IO19/IO20'], ['ADC', 'ADC1 = IO1–IO10 (usable with Wi-Fi)']],
    notes: 'Pads in datasheet order (1 GND, 2 3V3, 3 EN … 40 GND, 41 exposed pad GND). Keep the antenna end over the board edge with no copper underneath.' },
});
// ---------- power profiles: settings that change what a chip draws (radio, CPU clock, sleep, sensor rate) ----------
const pick = (o, k, d) => (o[k] != null ? o[k] : d);
const pctOf = (x, d = 100) => { const v = num(x, d); return Math.max(0, Math.min(100, v)); };
const ESPV = {
  s3: { cpu: { '80 MHz': 28e-3, '160 MHz': 38e-3, '240 MHz': 50e-3 }, light: 0.24e-3, deep: 8e-6, peakWifi: 0.355, peakBle: 0.1 },
  c3: { cpu: { '80 MHz': 18e-3, '160 MHz': 25e-3 }, light: 0.13e-3, deep: 5e-6, peakWifi: 0.335, peakBle: 0.09 },
  classic: { cpu: { '80 MHz': 30e-3, '160 MHz': 40e-3, '240 MHz': 50e-3 }, light: 0.8e-3, deep: 10e-6, peakWifi: 0.38, peakBle: 0.13 },
};
const RADIO_ESP = { 'Off': 0, 'BLE advertising': 8e-3, 'BLE connected': 15e-3, 'Wi-Fi connected (power save)': 20e-3, 'Wi-Fi streaming': 85e-3 };
function espProfile(v, board, boardSleep, defCpu) {
  const V = ESPV[v];
  return {
    props: [opt('radio', 'Radio', 'Wi-Fi connected (power save)', { options: Object.keys(RADIO_ESP), power: true }), opt('cpu', 'CPU clock', defCpu, { options: Object.keys(V.cpu), power: true }),
      opt('txdbm', 'Transmit power', '20 dBm', { options: ['0 dBm', '9 dBm', '15 dBm', '20 dBm'], power: true }), opt('sleepMode', 'When not awake', 'Deep sleep', { options: ['Deep sleep', 'Light sleep'], power: true }),
      opt('awake', 'Time awake', '100', { unit: '%', eng: true, power: true })],
    model: (p) => {
      const radio = pick(p, 'radio', 'Off'), cpu = V.cpu[p.cpu] ?? Object.values(V.cpu)[0];
      const active = cpu + (RADIO_ESP[radio] ?? 0) + board;
      const sleep = (p.sleepMode === 'Light sleep' ? V.light : V.deep) + boardSleep;
      const tx = num(p.txdbm, 20), pa = Math.pow(10, (tx - 20) / 20);
      const peak = /Wi-Fi/.test(radio) ? active + (V.peakWifi - active) * pa : /BLE/.test(radio) ? Math.max(active, V.peakBle * Math.max(pa, 0.6)) : active;
      return { active, sleep, duty: pctOf(p.awake), peak, txdbm: radio === 'Off' ? null : tx,
        note: `${radio}, ${p.cpu || ''}${board ? ', incl. ≈ ' + fmt(board, 'A', 2) + ' board overhead' : ''}; asleep: ${p.sleepMode || 'Deep sleep'}` };
    },
  };
}
const NRF_TX = { '-20 dBm': 3.0e-3, '-8 dBm': 3.8e-3, '0 dBm': 5.3e-3, '+4 dBm': 7.5e-3 };
const NRF_MODES = ['Off', 'Advertising, 1 s interval', 'Advertising, 100 ms interval', 'Connected, 30 ms interval', 'Continuous RX', 'Continuous TX'];
const nrfProfile = {
  props: [opt('radio', 'Radio', 'Advertising, 1 s interval', { options: NRF_MODES, power: true }), opt('tx', 'Transmit power', '0 dBm', { options: Object.keys(NRF_TX), power: true }),
    opt('dcdc', 'DC/DC regulator', 'On', { options: ['On', 'Off (LDO)'], power: true }), opt('busy', 'CPU busy', '0.2', { unit: '%', eng: true, power: true }),
    opt('sleepMode', 'Sleep', 'System ON (RTC running)', { options: ['System ON (RTC running)', 'System OFF'], power: true })],
  model: (p) => {
    const k = p.dcdc === 'Off (LDO)' ? 1.35 : 1, txI = (NRF_TX[p.tx] ?? NRF_TX['0 dBm']) * k, rxI = 5.4e-3 * k, cpuI = 3.7e-3 * (p.dcdc === 'Off (LDO)' ? 2 : 1);
    const sleep = p.sleepMode === 'System OFF' ? 0.3e-6 : 1.9e-6;
    const ev = (radioMs, overheadMs) => txI * radioMs * 1e-3 + 1.6e-3 * k * overheadMs * 1e-3;   // charge per radio event (C)
    const radio = pick(p, 'radio', NRF_MODES[1]);
    let avgRadio = 0, peak = txI;
    if (radio === NRF_MODES[1]) avgRadio = ev(1.2, 1) / 1;
    else if (radio === NRF_MODES[2]) avgRadio = ev(1.2, 1) / 0.1;
    else if (radio === NRF_MODES[3]) avgRadio = ev(0.6, 0.5) / 0.03;
    else if (radio === NRF_MODES[4]) { avgRadio = rxI; peak = rxI; }
    else if (radio === NRF_MODES[5]) avgRadio = txI;
    else peak = cpuI;
    const avg = sleep + avgRadio + cpuI * pctOf(p.busy, 0.2) / 100;
    const active = Math.max(peak, cpuI), duty = Math.min(100, Math.max(0, ((avg - sleep) / Math.max(active - sleep, 1e-12)) * 100));
    return { active, sleep, duty, peak, avg, txdbm: radio === 'Off' ? null : num(String(p.tx).replace('+', ''), 0), note: `${radio}, TX ${p.tx || '0 dBm'}, DC/DC ${p.dcdc || 'On'}` };
  },
};
const LSM_A = { 'Power-down': 0, 'Low-power 12.5 Hz': 25e-6, 'Low-power 52 Hz': 45e-6, 'Normal 104 Hz': 85e-6, 'High-performance 104 Hz': 150e-6, 'High-performance 1.66 kHz': 240e-6 };
const LSM_G = { 'Power-down': 0, 'Normal 104 Hz': 0.45e-3, 'High-performance 104 Hz': 0.6e-3, 'High-performance 1.66 kHz': 0.65e-3 };
const tableProfile = (key, label, table, def, base, note) => ({
  props: [opt(key, label, def, { options: Object.keys(table), power: true })],
  model: (p) => { const i = base + (table[p[key]] ?? table[def]); return { active: i, sleep: i, duty: 100, peak: i, note: `${p[key] || def}${note ? ' — ' + note : ''}` }; },
});
export const POWER_PROFILES = [
  { match: /^ESP32-S3-WROOM/i, ...espProfile('s3', 0, 0, '240 MHz') },
  { match: /ESP32-S3 SuperMini/i, ...espProfile('s3', 1.5e-3, 0.06e-3, '160 MHz') },
  { match: /ESP32-S3-DevKitC/i, ...espProfile('s3', 8e-3, 4e-3, '240 MHz') },
  { match: /ESP32-C3/i, ...espProfile('c3', 1.5e-3, 0.06e-3, '160 MHz') },
  { match: /ESP32 DevKit/i, ...espProfile('classic', 10e-3, 5e-3, '240 MHz') },
  { match: /nRF52/i, ...nrfProfile },
  { match: /Arduino Nano/i, ...tableProfile('state', 'State', { 'Active (16 MHz)': 19e-3, 'Idle sleep': 12e-3, 'Power-down sleep': 6e-3 }, 'Active (16 MHz)', 0, 'board LED, regulator and USB chip keep it above ≈ 6 mA') },
  { match: /LSM6DS3/i, props: [opt('accel', 'Accelerometer', 'High-performance 104 Hz', { options: Object.keys(LSM_A), power: true }), opt('gyro', 'Gyroscope', 'High-performance 104 Hz', { options: Object.keys(LSM_G), power: true })],
    model: (p) => { const i = 6e-6 + (LSM_A[p.accel] ?? LSM_A['High-performance 104 Hz']) + (LSM_G[p.gyro] ?? LSM_G['High-performance 104 Hz']); return { active: i, sleep: 6e-6, duty: 100, peak: i, note: `accel ${p.accel}, gyro ${p.gyro}` }; } },
  { match: /QMC5883P/i, ...tableProfile('mode', 'Mode', { 'Suspend': 0, 'Continuous 10 Hz': 75e-6, 'Continuous 50 Hz': 150e-6, 'Continuous 100 Hz': 250e-6, 'Continuous 200 Hz': 450e-6 }, 'Continuous 50 Hz', 3e-6, 'estimate, depends on oversampling') },
  { match: /QMC5883L|HMC5883L/i, ...tableProfile('mode', 'Mode', { 'Idle': 0, 'Continuous 15 Hz': 100e-6, 'Continuous 75 Hz': 250e-6 }, 'Continuous 15 Hz', 3e-6, 'module LED / regulator extra') },
  { match: /MPU-6050/i, ...tableProfile('mode', 'Mode', { 'Sleep': 5e-6, 'Accel only, cycle 5 Hz': 70e-6, 'Accel only': 0.5e-3, 'Accel + gyro': 3.9e-3 }, 'Accel + gyro', 0, 'GY-521 LED adds ≈ 1 mA') },
  { match: /ADXL345/i, ...tableProfile('mode', 'Mode', { 'Standby': 0.1e-6, 'Low power 25 Hz': 34e-6, '100 Hz': 140e-6, '3200 Hz': 140e-6 }, '100 Hz', 0) },
  { match: /ADS1115/i, ...tableProfile('mode', 'Conversion', { 'Single-shot (idle between)': 0.5e-6, 'Continuous': 150e-6 }, 'Continuous', 0) },
];
export function powerProfile(c) { if (c.type !== 'ic') return null; const name = c.props?.part || ''; return POWER_PROFILES.find((pp) => pp.match.test(name)) || null; }
/** Current model of a part from its power settings: { active, sleep, duty %, peak, avg, note } or null. */
export function powerOf(c) {
  const pf = powerProfile(c);
  if (!pf) return null;
  const p = {};
  for (const o of pf.props) p[o.key] = c.props[o.key] ?? o.default;
  const m = pf.model(p);
  m.avg = m.avg ?? (m.active * m.duty) / 100 + m.sleep * (1 - m.duty / 100);
  return m;
}
export const CUSTOM_INLINE_PROPS = [opt('title', 'Board name', 'My ESP32'), opt('leftPins', 'Left header (top→bottom, comma/newline)', '5V, GND, 3V3, IO1, IO2, IO3, IO4, IO5'), opt('rightPins', 'Right header (top→bottom)', 'IO6, IO7, IO8, IO9, IO10, IO11, IO12, IO13'), opt('vlogic', 'Logic level', '3.3', { unit: 'V', eng: true }), opt('vinPin', 'USB / VIN pin name', '5V'), opt('railPin', '3.3 V rail pin name', '3V3')];

/** Register a user-defined part (from the custom part editor). */
export function registerCustomPart(def) {
  const d = { ...def, custom: true };
  if (d.isMcu) d.units = [{ k: 'mcu', vlogic: num(d.vlogic, 3.3), v5: d.vinPin || '5V', v3: d.railPin || '3V3', gnd: d.gndPin || 'GND', drop: 0.3, ilim: 0.5, load: num(d.loadmA, 50) / 1000 }];
  else d.units = d.loadmA ? [{ k: 'mod', vcc: d.railPin || 'VCC', gnd: d.gndPin || 'GND', i: num(d.loadmA, 0) / 1000, vnom: num(d.vlogic, 3.3) }] : [];
  ICS[d.name] = d;
  invalidateIc();
  const i = PALETTE.findIndex((p) => p.type === 'ic' && p.part === d.name);
  const entry = { type: 'ic', part: d.name, label: d.name, cat: d.cat || 'MCU boards', kw: 'custom ' + (d.desc || ''), custom: true };
  if (i >= 0) PALETTE[i] = entry; else PALETTE.push(entry);
  return d;
}
export function unregisterCustomPart(name) {
  if (ICS[name]?.custom) delete ICS[name];
  const i = PALETTE.findIndex((p) => p.type === 'ic' && p.part === name);
  if (i >= 0) PALETTE.splice(i, 1);
  invalidateIc();
}
export const splitPins = (s) => String(s || '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

export const TYPES = {
  resistor: {
    name: 'Resistor', prefix: 'R', cat: 'Passive',
    pins: [{ x: -30, y: 0, name: '1' }, { x: 30, y: 0, name: '2' }],
    bbox: { x: -30, y: -9, w: 60, h: 18 },
    props: [opt('value', 'Resistance', '10k', { unit: 'Ω', eng: true, estep: true }), opt('power', 'Power rating', '0.25', { unit: 'W', eng: true })],
    draw: () => ({ s: P('M-30,0H-21L-18,-7L-12,7L-6,-7L0,7L6,-7L12,7L18,-7L21,0H30') }),
    label: (c) => short(num(c.props.value, 0), 'Ω'),
    stamp: (S, n, c) => S.R(n[0], n[1], Math.max(num(c.props.value, 1e3), 1e-6)),
  },
  pot: {
    name: 'Potentiometer', prefix: 'RV', cat: 'Passive',
    pins: [{ x: -30, y: 0, name: '1' }, { x: 30, y: 0, name: '3' }, { x: 0, y: -30, name: 'W' }],
    bbox: { x: -30, y: -30, w: 60, h: 39 },
    props: [opt('value', 'Total resistance', '10k', { unit: 'Ω', eng: true, estep: true }), opt('pos', 'Wiper position', 0.5, { slider: [0, 1, 0.01] })],
    draw: () => ({ s: P('M-30,0H-21L-18,-7L-12,7L-6,-7L0,7L6,-7L12,7L18,-7L21,0H30') + P('M0,-30V-11') + P('M0,-9L-4,-16H4Z', 'f') }),
    label: (c) => short(num(c.props.value, 0), 'Ω') + ' @' + Math.round(num(c.props.pos, 0.5) * 100) + '%',
    stamp: (S, n, c) => {
      const R = num(c.props.value, 1e4), p = Math.min(1, Math.max(0, num(c.props.pos, 0.5)));
      S.R(n[0], n[2], Math.max(R * p, 0.01)); S.R(n[2], n[1], Math.max(R * (1 - p), 0.01));
    },
  },
  capacitor: {
    name: 'Capacitor', prefix: 'C', cat: 'Passive',
    pins: [{ x: -30, y: 0, name: '1' }, { x: 30, y: 0, name: '2' }],
    bbox: { x: -30, y: -13, w: 60, h: 26 },
    props: [opt('value', 'Capacitance', '100n', { unit: 'F', eng: true, estep: true }), opt('vmax', 'Voltage rating', '50', { unit: 'V', eng: true })],
    draw: () => ({ s: P('M-30,0H-4M-4,-12V12M4,-12V12M4,0H30') }),
    label: (c) => short(num(c.props.value, 0), 'F'),
    stamp: (S, n, c) => S.C(n[0], n[1], num(c.props.value, 1e-7)),
  },
  cap_pol: {
    name: 'Electrolytic cap', prefix: 'C', cat: 'Passive',
    pins: [{ x: -30, y: 0, name: '+' }, { x: 30, y: 0, name: '−' }],
    bbox: { x: -30, y: -13, w: 60, h: 26 },
    props: [opt('value', 'Capacitance', '10u', { unit: 'F', eng: true, estep: true }), opt('vmax', 'Voltage rating', '25', { unit: 'V', eng: true })],
    draw: () => ({ s: P('M-30,0H-4M-4,-12V12M8,-12Q2,0 8,12M5,0H30'), t: [T(-13, -8, '+', 'tp')] }),
    label: (c) => short(num(c.props.value, 0), 'F'),
    stamp: (S, n, c) => S.C(n[0], n[1], num(c.props.value, 1e-5)),
  },
  inductor: {
    name: 'Inductor', prefix: 'L', cat: 'Passive',
    pins: [{ x: -30, y: 0, name: '1' }, { x: 30, y: 0, name: '2' }],
    bbox: { x: -30, y: -8, w: 60, h: 12 },
    props: [opt('value', 'Inductance', '10m', { unit: 'H', eng: true, estep: true }), opt('dcr', 'DC resistance', '0.1', { unit: 'Ω', eng: true })],
    draw: () => ({ s: P('M-30,0H-20a5,5 0 0 1 10,0a5,5 0 0 1 10,0a5,5 0 0 1 10,0a5,5 0 0 1 10,0H30') }),
    label: (c) => short(num(c.props.value, 0), 'H'),
    stamp: (S, n, c) => S.L(n[0], n[1], num(c.props.value, 1e-2), num(c.props.dcr, 0.1)),
  },
  fuse: {
    name: 'Fuse', prefix: 'F', cat: 'Passive',
    pins: [{ x: -30, y: 0, name: '1' }, { x: 30, y: 0, name: '2' }],
    bbox: { x: -30, y: -7, w: 60, h: 14 },
    props: [opt('rating', 'Rating', '1', { unit: 'A', eng: true }), opt('blown', 'Blown', false, { bool: true })],
    draw: (c) => ({ s: P('M-30,0H-15M15,0H30') + `<rect class="s" x="-15" y="-6" width="30" height="12" rx="2"/>` + (c.props.blown ? P('M-15,0H-4M4,0H15M-3,-4L3,4') : P('M-15,0H15')) }),
    label: (c) => short(num(c.props.rating, 1), 'A') + (c.props.blown ? ' ✕' : ''),
    stamp: (S, n, c) => { if (!c.props.blown) S.R(n[0], n[1], 0.05); },
  },
  switch: {
    name: 'Switch (SPST)', prefix: 'SW', cat: 'Passive', toggle: 'closed',
    pins: [{ x: -30, y: 0, name: '1' }, { x: 30, y: 0, name: '2' }],
    bbox: { x: -30, y: -14, w: 60, h: 18 },
    props: [opt('closed', 'Closed', false, { bool: true })],
    draw: (c) => ({ s: P('M-30,0H-13M13,0H30') + `<circle class="s" cx="-11" cy="0" r="2.5"/><circle class="s" cx="11" cy="0" r="2.5"/>` + (c.props.closed ? P('M-9,-1L10,-3') : P('M-9,-1L9,-13')) }),
    label: (c) => (c.props.closed ? 'closed' : 'open'),
    stamp: (S, n, c) => { if (c.props.closed) S.R(n[0], n[1], 0.01); },
  },
  button: {
    name: 'Push button', prefix: 'SW', cat: 'Passive', toggle: 'pressed',
    pins: [{ x: -30, y: 0, name: '1' }, { x: 30, y: 0, name: '2' }],
    bbox: { x: -30, y: -21, w: 60, h: 25 },
    props: [opt('pressed', 'Pressed', false, { bool: true }), opt('nc', 'Normally closed (NC)', false, { bool: true })],
    draw: (c) => {
      if (c.props.nc) { const y = c.props.pressed ? -12 : 3; return { s: P('M-30,0H-13M13,0H30') + `<circle class="s" cx="-11" cy="0" r="2.5"/><circle class="s" cx="11" cy="0" r="2.5"/>` + P(`M-14,${y}H14M0,${y}V-18M-6,-18H6`) }; }
      const y = c.props.pressed ? -3 : -9; return { s: P('M-30,0H-13M13,0H30') + `<circle class="s" cx="-11" cy="0" r="2.5"/><circle class="s" cx="11" cy="0" r="2.5"/>` + P(`M-14,${y}H14M0,${y}V${y - 8}M-6,${y - 8}H6`) };
    },
    label: (c) => (c.props.nc ? 'NC' : 'NO') + (c.props.pressed ? ' · pressed' : ''),
    stamp: (S, n, c) => { if (!!c.props.pressed !== !!c.props.nc) S.R(n[0], n[1], 0.01); },
  },
  spdt: {
    name: 'Switch (SPDT)', prefix: 'SW', cat: 'Passive', toggle: 'pos',
    pins: [{ x: -30, y: 0, name: 'COM' }, { x: 30, y: -10, name: 'A' }, { x: 30, y: 10, name: 'B' }],
    bbox: { x: -30, y: -14, w: 60, h: 28 },
    props: [opt('pos', 'Position B', false, { bool: true })],
    draw: (c) => ({ s: P('M-30,0H-13M13,-10H30M13,10H30') + `<circle class="s" cx="-11" cy="0" r="2.5"/><circle class="s" cx="11" cy="-10" r="2.5"/><circle class="s" cx="11" cy="10" r="2.5"/>` + (c.props.pos ? P('M-9,1L9,9') : P('M-9,-1L9,-9')) }),
    label: (c) => (c.props.pos ? '→B' : '→A'),
    stamp: (S, n, c) => S.R(n[0], c.props.pos ? n[2] : n[1], 0.01),
  },
  // ----- sources -----
  ground: {
    name: 'Ground', prefix: 'GND', cat: 'Sources', noRef: true,
    pins: [{ x: 0, y: 0, name: 'GND' }],
    bbox: { x: -11, y: 0, w: 22, h: 18 },
    props: [],
    draw: () => ({ s: P('M0,0V8M-11,8H11M-7,12.5H7M-3,17H3') }),
  },
  rail: {
    name: 'Power rail', prefix: 'VCC', cat: 'Sources', noRef: true,
    pins: [{ x: 0, y: 0, name: '+' }],
    bbox: { x: -14, y: -26, w: 28, h: 26 },
    props: [opt('volts', 'Voltage', '5', { unit: 'V', eng: true }), opt('name', 'Net name', '+5V')],
    draw: (c) => ({ s: P('M0,0V-12M-9,-12H9'), t: [T(0, -17, c.props.name || '', 'tl')] }),
    stamp: (S, n, c, e) => {
      // rails with the same net only stamped once
      const key = '__rail' + n[0];
      if (S[key] != null) return;
      S[key] = 1;
      S.V(n[0], 0, num(c.props.volts, 5));
    },
  },
  netlabel: {
    name: 'Net label', prefix: 'NET', cat: 'Sources', noRef: true,
    pins: [{ x: 0, y: 0, name: '•' }],
    bbox: { x: 0, y: -8, w: 60, h: 16 },
    props: [opt('name', 'Name', 'SIG')],
    draw: (c) => { const w = Math.max(20, String(c.props.name || '').length * 7 + 8); return { s: `<path class="s lbl" d="M0,0H5L11,-7H${11 + w}V7H11L5,0"/>`, t: [T(11 + w / 2, 0, c.props.name || '', 'tl')] }; },
  },
  battery: {
    name: 'Battery', prefix: 'BT', cat: 'Sources',
    pins: [{ x: 0, y: -30, name: '+' }, { x: 0, y: 30, name: '−' }],
    bbox: { x: -16, y: -30, w: 32, h: 60 },
    props: [opt('chem', 'Chemistry', 'Li-ion / LiPo', { options: CHEM_NAMES }), opt('series', 'Cells in series (S)', '1', { eng: true }), opt('parallel', 'Cells in parallel (P)', '1', { eng: true }),
      opt('cap', 'Capacity per cell', '100', { unit: 'mAh', eng: true }), opt('soc', 'State of charge', '80', { unit: '%', eng: true }),
      opt('rint', 'Internal resistance per cell (blank = typical)', '', { unit: 'Ω', eng: true }), opt('prot', 'Has a protection circuit', true, { bool: true })],
    draw: () => ({ s: P('M0,-30V-12M-14,-12H14M-14,0H14M0,6V30') + `<path class="s thick" d="M-7,-6H7M-7,6H7"/>`, t: [T(13, -17, '+', 'tp')] }),
    label: (c) => { const b = batteryInfo(c.props); return `${b.S}S${b.P > 1 ? b.P + 'P' : ''} ${b.chem.short} ${b.capPack >= 1000 ? +(b.capPack / 1000).toPrecision(3) + 'Ah' : Math.round(b.capPack) + 'mAh'} · ${b.V.toFixed(2)}V`; },
    stamp: (S, n, c) => { const b = batteryInfo(c.props); S.V(n[0], n[1], b.V, { rint: b.rPack }); },
  },
  vdc: {
    name: 'DC source / battery', prefix: 'V', cat: 'Sources',
    pins: [{ x: 0, y: -30, name: '+' }, { x: 0, y: 30, name: '−' }],
    bbox: { x: -13, y: -30, w: 26, h: 60 },
    props: [opt('volts', 'Voltage', '12', { unit: 'V', eng: true }), opt('rint', 'Internal resistance', '0', { unit: 'Ω', eng: true })],
    draw: () => ({ s: P('M0,-30V-4M-13,-4H13M-6,4H6M0,4V30') + `<path class="s thick" d="M-6,4H6"/>`, t: [T(11, -13, '+', 'tp')] }),
    label: (c) => short(num(c.props.volts, 0), 'V'),
    stamp: (S, n, c) => S.V(n[0], n[1], num(c.props.volts, 12), { rint: num(c.props.rint, 0) }),
  },
  vac: {
    name: 'Signal generator', prefix: 'VS', cat: 'Sources',
    pins: [{ x: 0, y: -30, name: '+' }, { x: 0, y: 30, name: '−' }],
    bbox: { x: -16, y: -30, w: 32, h: 60 },
    props: [opt('amp', 'AC amplitude', '1', { unit: 'V', eng: true }), opt('freq', 'Frequency', '1k', { unit: 'Hz', eng: true }), opt('offset', 'DC offset', '0', { unit: 'V', eng: true })],
    draw: () => ({ s: `<circle class="s" cx="0" cy="0" r="16"/>` + P('M0,-30V-16M0,16V30M-9,0Q-4.5,-12 0,0T9,0'), t: [T(11, -21, '+', 'tp')] }),
    label: (c) => short(num(c.props.amp, 1), 'V') + ' ' + short(num(c.props.freq, 1e3), 'Hz'),
    stamp: (S, n, c) => S.V(n[0], n[1], num(c.props.offset, 0)),
  },
  idc: {
    name: 'Current source', prefix: 'I', cat: 'Sources',
    pins: [{ x: 0, y: -30, name: 'out' }, { x: 0, y: 30, name: 'in' }],
    bbox: { x: -16, y: -30, w: 32, h: 60 },
    props: [opt('amps', 'Current', '10m', { unit: 'A', eng: true })],
    draw: () => ({ s: `<circle class="s" cx="0" cy="0" r="16"/>` + P('M0,-30V-16M0,16V30M0,9V-8M-4,-3L0,-9L4,-3') }),
    label: (c) => short(num(c.props.amps, 0), 'A'),
    stamp: (S, n, c) => S.Isrc(n[1], n[0], num(c.props.amps, 0.01)),
  },
  // ----- semiconductors -----
  diode: {
    name: 'Diode', prefix: 'D', cat: 'Diodes', nonlinear: true, partsOf: 'diode',
    pins: [{ x: -30, y: 0, name: 'A' }, { x: 30, y: 0, name: 'K' }],
    bbox: { x: -30, y: -10, w: 60, h: 20 },
    props: [opt('part', 'Part', '1N4148', { parts: 'diode' })],
    draw: () => ({ s: P('M-30,0H-8M8,0H30') + P('M-8,-9L8,0L-8,9Z', 'f') + P('M8,-9V9') }),
    label: (c) => c.props.part,
    stamp: (S, n, c) => { const m = PARTS[c.props.part] || PARTS['1N4148']; S.nl([n[0], n[1]], (v) => { const i = diodeI(v[0] - v[1], m.Is, m.n); return [i, -i]; }); },
  },
  schottky: {
    name: 'Schottky diode', prefix: 'D', cat: 'Diodes', nonlinear: true, partsOf: 'schottky',
    pins: [{ x: -30, y: 0, name: 'A' }, { x: 30, y: 0, name: 'K' }],
    bbox: { x: -30, y: -10, w: 60, h: 20 },
    props: [opt('part', 'Part', '1N5819', { parts: 'schottky' })],
    draw: () => ({ s: P('M-30,0H-8M8,0H30') + P('M-8,-9L8,0L-8,9Z', 'f') + P('M12,-6V-9H8V9H4V6') }),
    label: (c) => c.props.part,
    stamp: (S, n, c) => { const m = PARTS[c.props.part] || PARTS['1N5819']; S.nl([n[0], n[1]], (v) => { const i = diodeI(v[0] - v[1], m.Is, m.n); return [i, -i]; }); },
  },
  zener: {
    name: 'Zener diode', prefix: 'D', cat: 'Diodes', nonlinear: true, partsOf: 'zener',
    pins: [{ x: -30, y: 0, name: 'A' }, { x: 30, y: 0, name: 'K' }],
    bbox: { x: -30, y: -11, w: 60, h: 22 },
    props: [opt('part', 'Part', '1N4733A', { parts: 'zener', fill: { vz: 'vz' } }), opt('vz', 'Zener voltage', '5.1', { unit: 'V', eng: true })],
    draw: () => ({ s: P('M-30,0H-8M8,0H30') + P('M-8,-9L8,0L-8,9Z', 'f') + P('M4,-11L8,-9V9L12,11') }),
    label: (c) => short(num(c.props.vz, 5.1), 'V') + ' Z',
    stamp: (S, n, c) => { const bv = num(c.props.vz, 5.1); S.nl([n[0], n[1]], (v) => { const i = diodeI(v[0] - v[1], 1e-12, 1.5, bv); return [i, -i]; }); },
  },
  tvs: {
    name: 'TVS diode', prefix: 'D', cat: 'Diodes', nonlinear: true,
    pins: [{ x: -30, y: 0, name: 'A' }, { x: 30, y: 0, name: 'K' }],
    bbox: { x: -30, y: -11, w: 60, h: 22 },
    props: [opt('part', 'Part', 'SMBJ12A', { parts: 'tvs', fill: { vbr: 'vbr' } }), opt('vbr', 'Breakdown VBR', '13.3', { unit: 'V', eng: true })],
    draw: (c) => {
      const m = PARTS[c.props.part] || {};
      if (m.bi) return { s: P('M-30,0H-12M12,0H30') + P('M-12,-9L0,0L-12,9Z', 'f') + P('M12,-9L0,0L12,9Z', 'f') + P('M-4,-11L0,-9V9L4,11') };
      return { s: P('M-30,0H-8M8,0H30') + P('M-8,-9L8,0L-8,9Z', 'f') + P('M4,-11L8,-9V9L12,11') };
    },
    label: (c) => c.props.part,
    stamp: (S, n, c) => {
      const m = PARTS[c.props.part] || PARTS['SMBJ12A'];
      const vbr = num(c.props.vbr, m.vbr);
      const rd = Math.max((m.vc - m.vbr) / m.ipp, 0.01); // dynamic clamp resistance
      const bd = (x) => 1e-3 * Math.exp(Math.min((x - vbr) / 0.04, Math.log(50)));
      const x1 = vbr + 0.04 * Math.log(50);
      const clampI = (x) => (x > x1 ? 0.05 + (x - x1) / rd : bd(x));
      S.nl([n[0], n[1]], (v) => {
        const vd = v[0] - v[1];
        let i = m.bi ? clampI(vd) - clampI(-vd) : diodeI(vd, 1e-12, 1.5) - clampI(-vd);
        i += vd * 1e-12;
        return [i, -i];
      });
    },
  },
  led: {
    name: 'LED', prefix: 'D', cat: 'Diodes', nonlinear: true,
    pins: [{ x: -30, y: 0, name: 'A' }, { x: 30, y: 0, name: 'K' }],
    bbox: { x: -30, y: -20, w: 60, h: 30 },
    props: [opt('color', 'Color', 'red', { options: ['red', 'yellow', 'green', 'blue', 'white'] }), opt('imax', 'Max current', '20m', { unit: 'A', eng: true })],
    draw: (c) => ({ s: P('M-30,0H-8M8,0H30') + `<path class="led-${c.props.color}" d="M-8,-9L8,0L-8,9Z"/>` + P('M8,-9V9') + P('M0,-11L6,-18M5,-11L11,-18') + P('M6,-18l-4,1l3,3ZM11,-18l-4,1l3,3Z', 'f') }),
    label: (c) => c.props.color,
    vf: { red: 1.8, yellow: 2.0, green: 2.2, blue: 3.0, white: 3.0 },
    stamp: (S, n, c) => {
      const vf = TYPES.led.vf[c.props.color] || 2; const Is = 0.01 / Math.exp(vf / (2 * VT));
      S.nl([n[0], n[1]], (v) => { const i = diodeI(v[0] - v[1], Is, 2); return [i, -i]; });
    },
  },
  ldr: {
    name: 'Photoresistor (LDR)', prefix: 'LDR', cat: 'Sensors',
    pins: [{ x: -30, y: 0, name: '1' }, { x: 30, y: 0, name: '2' }],
    bbox: { x: -30, y: -22, w: 60, h: 30 },
    props: [opt('part', 'Part', 'GL5528', { parts: 'ldr', fill: { r10: 'r10', gamma: 'gamma', rdark: 'rdark' } }), opt('lux', 'Light level', '100', { unit: 'lux', range: [0.1, 100000, 0.01], log: true }), opt('r10', 'R @ 10 lux', '12000', { unit: 'Ω', eng: true }), opt('gamma', 'γ (log slope)', '0.7', { eng: true }), opt('rdark', 'Dark resistance', '1000000', { unit: 'Ω', eng: true })],
    draw: () => ({ s: P('M-30,0H-15M15,0H30') + `<rect class="s" x="-15" y="-6" width="30" height="12" rx="6"/>` + P('M-11,-1H11') + P('M-14,-21L-6,-11M-2,-21L6,-11') + P('M-6,-11l-1,-5l4,2ZM6,-11l-1,-5l4,2Z', 'f') }),
    label: (c) => short(ldrR(c), 'Ω') + ' @' + short(num(c.props.lux, 100), 'lx'),
    stamp: (S, n, c) => S.R(n[0], n[1], ldrR(c)),
  },
  photodiode: {
    name: 'Photodiode', prefix: 'D', cat: 'Sensors', nonlinear: true,
    pins: [{ x: -30, y: 0, name: 'A' }, { x: 30, y: 0, name: 'K' }],
    bbox: { x: -30, y: -22, w: 60, h: 32 },
    props: [opt('part', 'Part', 'BPW34', { parts: 'photodiode', fill: { sens: 'sens' } }), opt('lux', 'Light level', '1000', { unit: 'lux', range: [0, 100000, 0.01], log: true }), opt('sens', 'Photocurrent @ 1000 lux', '70u', { unit: 'A', eng: true })],
    draw: () => ({ s: P('M-30,0H-8M8,0H30') + P('M-8,-9L8,0L-8,9Z', 'f') + P('M8,-9V9') + P('M-10,-21L-3,-12M0,-21L7,-12') + P('M-3,-12l-1,-5l4,2ZM7,-12l-1,-5l4,2Z', 'f') }),
    label: (c) => c.props.part + ' ' + short(photoI(c), 'A'),
    stamp: (S, n, c) => {
      const m = PARTS[c.props.part] || PARTS.BPW34, iph = photoI(c);
      S.nl([n[0], n[1]], (v) => { const i = diodeI(v[0] - v[1], m.Is, m.n) - iph; return [i, -i]; });
    },
  },
  phototransistor: {
    name: 'Phototransistor', prefix: 'Q', cat: 'Sensors', nonlinear: true,
    pins: [{ x: 10, y: -30, name: 'C' }, { x: 10, y: 30, name: 'E' }],
    bbox: { x: -30, y: -30, w: 52, h: 60 },
    props: [opt('part', 'Part', 'TEPT5600', { parts: 'phototransistor', fill: { sens: 'sens' } }), opt('lux', 'Light level', '100', { unit: 'lux', range: [0, 100000, 0.01], log: true }), opt('sens', 'IC @ 1000 lux (linear)', '2.5m', { unit: 'A', eng: true })],
    draw: () => ({ s: `<circle class="s thin" cx="2" cy="0" r="18"/>` + P('M-6,-5L10,-16V-30M-6,5L10,16V30') + `<path class="s thick" d="M-6,-12V12"/>` + P('M7.6,14.35L0.96,13.42L4.36,8.48Z', 'f') + P('M-28,-20L-14,-8M-28,-8L-14,4') + P('M-14,-8l-2,-5l5,1ZM-14,4l-2,-5l5,1Z', 'f') }),
    label: (c) => c.props.part,
    stamp: (S, n, c) => {
      const il = photoI(c);
      S.nl([n[0], n[1]], (v) => { const ic = (il + 1e-9) * Math.tanh(spos(v[0] - v[1], 1e-3) / 0.15) + (v[0] - v[1]) * 1e-10; return [ic, -ic]; });
    },
  },
  pickup: {
    name: 'Pickup coil', prefix: 'L', cat: 'Sensors',
    pins: [{ x: -30, y: 0, name: '+' }, { x: 30, y: 0, name: '−' }],
    bbox: { x: -30, y: -16, w: 60, h: 22 },
    props: [opt('mode', 'Values', 'Defined', { options: ['Defined', 'Calculated'] }), opt('value', 'Inductance', '2.5', { unit: 'H', eng: true }), opt('dcr', 'DC resistance', '6k', { unit: 'Ω', eng: true }),
      opt('turns', 'Turns (N)', '8000', { eng: true }), opt('diaMM', 'Mean coil diameter', '20', { unit: 'mm', eng: true }), opt('lenMM', 'Winding length', '10', { unit: 'mm', eng: true }), opt('awg', 'Wire gauge', '42', { unit: 'AWG', eng: true }), opt('mur', 'Core µr (effective)', '5', { eng: true }),
      opt('amp', 'Induced EMF (AC)', '100m', { unit: 'V', eng: true })],
    draw: () => ({ s: P('M-30,0H-20a5,5 0 0 1 10,0a5,5 0 0 1 10,0a5,5 0 0 1 10,0a5,5 0 0 1 10,0H30') + P('M-20,-10H20M-20,-14H20', 's thin') + P('M-26,6l3,3l3,-3l3,3', 's thin') }),
    label: (c) => { const k = coilValues(c); return short(k.L, 'H') + ' ' + short(k.R, 'Ω'); },
    stamp: (S, n, c) => { const k = coilValues(c); S.Lsrc(n[0], n[1], k.L, k.R); },
  },
  npn: {
    name: 'NPN transistor', prefix: 'Q', cat: 'Transistors', nonlinear: true,
    pins: [{ x: -30, y: 0, name: 'B' }, { x: 10, y: -30, name: 'C' }, { x: 10, y: 30, name: 'E' }],
    bbox: { x: -30, y: -30, w: 52, h: 60 },
    props: [opt('part', 'Part', '2N2222A', { parts: 'npn', fill: { beta: 'beta' } }), opt('beta', 'hFE (β)', '150', { eng: true })],
    draw: () => ({ s: `<circle class="s thin" cx="2" cy="0" r="18"/>` + P('M-30,0H-6M-6,-5L10,-16V-30M-6,5L10,16V30') + `<path class="s thick" d="M-6,-12V12"/>` + P('M7.6,14.35L0.96,13.42L4.36,8.48Z', 'f') }),
    label: (c) => c.props.part,
    stamp: (S, n, c) => bjtStamp(S, n, c, 1),
  },
  pnp: {
    name: 'PNP transistor', prefix: 'Q', cat: 'Transistors', nonlinear: true,
    pins: [{ x: -30, y: 0, name: 'B' }, { x: 10, y: 30, name: 'C' }, { x: 10, y: -30, name: 'E' }],
    bbox: { x: -30, y: -30, w: 52, h: 60 },
    props: [opt('part', 'Part', '2N3906', { parts: 'pnp', fill: { beta: 'beta' } }), opt('beta', 'hFE (β)', '150', { eng: true })],
    draw: () => ({ s: `<circle class="s thin" cx="2" cy="0" r="18"/>` + P('M-30,0H-6M-6,-5L10,-16V-30M-6,5L10,16V30') + `<path class="s thick" d="M-6,-12V12"/>` + P('M0.4,-9.4L3.64,-15.27L7.04,-10.33Z', 'f') }),
    label: (c) => c.props.part,
    stamp: (S, n, c) => bjtStamp(S, n, c, -1),
  },
  nmos: {
    name: 'N-channel MOSFET', prefix: 'Q', cat: 'MOSFETs', nonlinear: true,
    pins: [{ x: -30, y: 0, name: 'G' }, { x: 10, y: -30, name: 'D' }, { x: 10, y: 30, name: 'S' }],
    bbox: { x: -30, y: -30, w: 52, h: 60 },
    props: [opt('part', 'Part', 'IRLZ44N', { parts: 'nmos', fill: { vth: 'vth', rds: 'rds' } }), opt('vth', 'VGS(th)', '1.5', { unit: 'V', eng: true }), opt('rds', 'RDS(on)', '0.022', { unit: 'Ω', eng: true })],
    draw: () => ({ s: `<circle class="s thin" cx="2" cy="0" r="18"/>` + P('M-30,0H-12M-12,-12V12M-6,-14V-6M-6,-4V4M-6,6V14M-6,-10H10V-30M-6,10H10V30M-6,0H10V10') + P('M-5,0L1,-3V3Z', 'f') }),
    label: (c) => c.props.part,
    stamp: (S, n, c) => mosStamp(S, n, c, 1),
  },
  pmos: {
    name: 'P-channel MOSFET', prefix: 'Q', cat: 'MOSFETs', nonlinear: true,
    pins: [{ x: -30, y: 0, name: 'G' }, { x: 10, y: 30, name: 'D' }, { x: 10, y: -30, name: 'S' }],
    bbox: { x: -30, y: -30, w: 52, h: 60 },
    props: [opt('part', 'Part', 'AO3401', { parts: 'pmos', fill: { vth: 'vth', rds: 'rds' } }), opt('vth', '|VGS(th)|', '0.9', { unit: 'V', eng: true }), opt('rds', 'RDS(on)', '0.05', { unit: 'Ω', eng: true })],
    draw: () => ({ s: `<circle class="s thin" cx="2" cy="0" r="18"/>` + P('M-30,0H-12M-12,-12V12M-6,-14V-6M-6,-4V4M-6,6V14M-6,-10H10V-30M-6,10H10V30M-6,0H10V-10') + P('M5,0L-1,-3V3Z', 'f') }),
    label: (c) => c.props.part,
    stamp: (S, n, c) => mosStamp(S, n, c, -1),
  },
  opamp: {
    name: 'Op-amp', prefix: 'U', cat: 'Op-amps', nonlinear: true,
    pins: (c) => {
      const t = c.props.plusTop !== false;
      return [{ x: -40, y: t ? -10 : 10, name: '+' }, { x: -40, y: t ? 10 : -10, name: '−' }, { x: 40, y: 0, name: 'OUT' }, { x: 0, y: -30, name: 'V+' }, { x: 0, y: 30, name: 'V−' }];
    },
    bbox: { x: -40, y: -30, w: 80, h: 60 },
    props: [opt('part', 'Model', 'TL072', { parts: 'opamp' }), opt('plusTop', '+ input on top', true, { bool: true }), opt('vpos', 'V+ if unconnected', '15', { unit: 'V', eng: true }), opt('vneg', 'V− if unconnected', '-15', { unit: 'V', eng: true })],
    draw: (c) => {
      const t = c.props.plusTop !== false;
      return { s: P('M-30,-30L-30,30L30,0Z') + P('M-40,-10H-30M-40,10H-30M30,0H40M0,-15V-30M0,15V30'), t: [T(-23, t ? -10 : 10, '+', 'tp'), T(-23, t ? 10 : -10, '−', 'tp')] };
    },
    label: (c) => c.props.part,
    stamp: (S, n, c, e) => {
      const m = PARTS[c.props.part] || PARTS.TL072;
      const ac = { acScale: opampAC(m.gbw) };
      if (e.connected[3] && e.connected[4]) S.nl([n[0], n[1], n[2], n[3], n[4]], opampFn(m, null, gainOf(S)), ac);
      else S.nl([n[0], n[1], n[2]], opampFn(m, [num(c.props.vpos, 15), num(c.props.vneg, -15)], gainOf(S)), ac);
    },
  },
  reg: {
    name: 'Voltage regulator', prefix: 'U', cat: 'Regulators', nonlinear: true,
    pins: (c) => { const m = PARTS[c.props.part] || PARTS['7805']; const nn = m.nums || ['1', '3', '2']; const p = [{ x: -50, y: 0, name: 'IN', num: nn[0] }, { x: 50, y: 0, name: 'OUT', num: nn[1] }, { x: 0, y: 40, name: m.adj ? 'ADJ' : 'GND', num: nn[2] }]; if (m.en) p.push({ x: -50, y: 20, name: 'EN', num: nn[3] }); return p; },
    bbox: { x: -50, y: -20, w: 100, h: 60 },
    props: [opt('part', 'Part', '7805', { parts: 'reg' })],
    draw: (c) => {
      const m = PARTS[c.props.part] || PARTS['7805'];
      if (m.en) return { s: `<rect class="s body" x="-36" y="-20" width="72" height="44" rx="3"/>` + P('M-50,0H-36M36,0H50M0,24V40M-50,20H-36'), t: [T(0, -8, c.props.part, 'tic'), T(-31, 4, 'IN', 'tpin', 'start'), T(31, 4, 'OUT', 'tpin', 'end'), T(-31, 18, 'EN', 'tpin', 'start'), T(8, 18, 'GND', 'tpin')] };
      return { s: `<rect class="s body" x="-36" y="-20" width="72" height="40" rx="3"/>` + P('M-50,0H-36M36,0H50M0,20V40'), t: [T(0, -6, c.props.part, 'tic'), T(-31, 9, 'IN', 'tpin', 'start'), T(31, 9, 'OUT', 'tpin', 'end'), T(0, 15, m.adj ? 'ADJ' : 'GND', 'tpin')] };
    },
    label: () => '',
    stamp: (S, n, c) => {
      const m = PARTS[c.props.part] || PARTS['7805'];
      if (m.en) {
        S.nl([n[0], n[1], n[2], n[3]], (v) => {
          const [vi, vo, vg, ven] = v;
          const on = sig((ven - vg - 0.9) / 0.05);
          const vt = vg + on * spos(smin(m.vout, vi - vg - m.drop), 0.02);
          const s = drive(vo, vt, 0.05, m.ilim), sp = fromRail(s, vi, vo);
          const iq = (on * m.iq + 0.1e-6) * Math.tanh(spos(vi - vg, 0.01) / 3), ien = (ven - vg) * 1e-7;
          return [sp + iq, -s, s - sp - iq - ien, ien];
        });
        return;
      }
      S.nl([n[0], n[1], n[2]], (v) => {
        const [vi, vo, vg] = v;
        let vt;
        if (m.adj) vt = smin(vg + 1.25, vi - m.drop);
        else vt = vg + spos(smin(m.vout, vi - vg - m.drop), 0.02);
        const s = drive(vo, vt, 0.05, m.ilim), sp = fromRail(s, vi, vo);
        const iq = m.adj ? 0 : m.iq * Math.tanh(spos(vi - vg, 0.01) / 3);
        const iadj = m.adj ? 50e-6 * Math.tanh(spos(vi - vg, 0.01)) : 0;
        return [sp + iq + iadj, -s, s - sp - iq - iadj];
      });
    },
  },
  ic: {
    name: 'IC / module', prefix: 'U', cat: 'ICs', nonlinear: true,
    pins: (c) => icGeom(c).pins,
    bbox: (c) => icGeom(c).bbox,
    props: [opt('part', 'Part', 'TC4420', { parts: 'ic' })],
    draw: (c) => drawIC(c),
    label: () => '',
    stamp: (S, n, c, e) => icStamp(S, n, c, e),
  },
};

// Generic IC extra props (only for "Generic IC")
export const GENERIC_IC_PROPS = [opt('title', 'Title', 'IC'), opt('pinCount', 'Pin count', '8', { eng: true }), opt('pinNames', 'Pin names (comma separated)', '')];

function bjtStamp(S, n, c, pol) {
  const m = PARTS[c.props.part] || (pol > 0 ? PARTS['2N2222A'] : PARTS['2N3906']);
  const bf = num(c.props.beta, m.beta || 100), br = 2, Is = m.Is || 1e-14, nf = m.nf || 1;
  const xmax = Math.log(50 / Is);
  // terminals: [C, B, E] nodes; our pins are [B, C, E]
  S.nl([n[1], n[0], n[2]], (v) => {
    const vbe = pol * (v[1] - v[2]), vbc = pol * (v[1] - v[0]);
    const ef = limexp(vbe / (nf * VT), xmax) - 1, er = limexp(vbc / (nf * VT), xmax) - 1;
    const ic = Is * (ef - er) - (Is / br) * er;
    const ib = (Is / bf) * ef + (Is / br) * er;
    return [pol * ic, pol * ib, -pol * (ic + ib)];
  });
}
function mosStamp(S, n, c, pol) {
  const m = PARTS[c.props.part] || {};
  const vth = Math.abs(num(c.props.vth, m.vth ?? 2)), rds = num(c.props.rds, m.rds ?? 0.05);
  const vgsSpec = m.vgsSpec || 10;
  const K = 1 / (rds * Math.max(vgsSpec - vth, 0.5));
  const lam = 0.01, nvt = 0.06;
  const sp = (x) => { const y = x / (2 * nvt); return y > 30 ? x : 2 * nvt * Math.log1p(Math.exp(y)); };
  const F = (x) => { const q = sp(x); return q * q; };
  // pins: [G, D, S]  → nodes [D, G, S]
  S.nl([n[1], n[0], n[2]], (v) => {
    const vd = pol * v[0], vg = pol * v[1], vs = pol * v[2];
    const id = (K / 2) * (F(vg - vs - vth) - F(vg - vd - vth)) * (1 + lam * Math.abs(vd - vs));
    const body = diodeI(vs - vd, 1e-12, 1.3); // body diode S→D
    const i = pol * (id - body);
    return [i, pol * (vg - vs) * 1e-12, -i];
  });
}


// ---------- sensor helpers ----------
export function ldrR(c) {
  const lux = Math.max(num(c.props.lux, 100), 1e-3);
  return Math.min(num(c.props.rdark, 1e6), num(c.props.r10, 12e3) * Math.pow(lux / 10, -num(c.props.gamma, 0.7)));
}
export function photoI(c) { return Math.max(0, num(c.props.lux, 0)) / 1000 * num(c.props.sens, 1e-4); }
/** Coil inductance (Wheeler, × effective µr) and DC resistance (copper, AWG). */
export function coilValues(c) {
  const p = c.props;
  if (p.mode !== 'Calculated') return { L: num(p.value, 1), R: Math.max(num(p.dcr, 1), 1e-3) };
  const N = num(p.turns, 1000), dia = num(p.diaMM, 20), len = Math.max(num(p.lenMM, 10), 0.1), awg = num(p.awg, 42), mur = Math.max(num(p.mur, 1), 1);
  const rIn = dia / 2 / 25.4, lIn = len / 25.4;
  const L = ((rIn * rIn * N * N) / (9 * rIn + 10 * lIn)) * 1e-6 * mur;
  const dWire = 0.127 * Math.pow(92, (36 - awg) / 39); // mm
  const area = Math.PI * (dWire / 2) ** 2 * 1e-6; // m²
  const R = (1.72e-8 * N * Math.PI * dia * 1e-3) / area;
  return { L, R, dWire, wireLen: N * Math.PI * dia * 1e-3 };
}

// ---------- IC models ----------
function icStamp(S, n, c, e) {
  const g = icGeom(c);
  const w5 = widthOf(S, 0.05), w1 = widthOf(S, 1e-3);
  const d = g.def;
  const idx = (name) => g.pins.findIndex((p) => p.name === name);
  const node = (name) => { const i = idx(name); return i < 0 ? 0 : n[i]; };
  for (const u of d.units || []) {
    if (u.k === 'opamp') {
      const m = PARTS[u.model] || PARTS.TL072;
      S.nl([node(u.inp), node(u.inn), node(u.out), node(u.vp), node(u.vn)], opampFn(m, null, gainOf(S)), { acScale: opampAC(m.gbw) });
    } else if (u.k === 'cmp') {
      const vmin = u.vmin ?? 1.5, ik = u.isink ?? 0.016, iq0 = u.iq ?? 0.4e-3;
      if (u.pp) {
        // push-pull output: drives to the rails through a small output resistance
        S.nl([node(u.inp), node(u.inn), node(u.out), node(u.vp), node(u.vn)], (v) => {
          const sup = sig((v[3] - v[4] - vmin) / 0.1), hi = sig((v[0] - v[1]) / w1);
          const vt = v[4] + hi * (v[3] - v[4]);
          const s = drive(v[2], vt, u.rout ?? 60, u.ilim ?? 0.025) * sup, sp = fromRail(s, v[3], v[2]);
          const iq = iq0 * Math.tanh(spos(v[3] - v[4], 0.01) / 2);
          return [v[0] * 1e-12, v[1] * 1e-12, -s, sp + iq, s - sp - iq];
        });
      } else {
        S.nl([node(u.inp), node(u.inn), node(u.out), node(u.vp), node(u.vn)], (v) => {
          const on = sig(-(v[0] - v[1]) / w1) * sig((v[3] - v[4] - vmin) / 0.1);
          const isink = ik * Math.tanh((v[2] - v[4]) / (50 * ik)) * on;
          const iq = iq0 * Math.tanh(spos(v[3] - v[4], 0.01) / 2);
          return [v[0] * 1e-12, v[1] * 1e-12, isink, iq, -isink - iq];
        });
      }
    } else if (u.k === 'nfet') {
      // N-MOSFET inside an IC (same square-law model as the discrete part, body diode S→D)
      const vth = u.vth ?? 0.7, rds = u.rds ?? 0.025, K = 1 / (rds * Math.max((u.vgsSpec ?? 4.5) - vth, 0.5)), nvt = 0.06;
      const sp = (x) => { const y = x / (2 * nvt); return y > 30 ? x : 2 * nvt * Math.log1p(Math.exp(y)); };
      const F = (x) => { const q = sp(x); return q * q; };
      S.nl([node(u.d), node(u.g), node(u.s)], (v) => {
        const [vd, vg, vs] = v;
        const id = (K / 2) * (F(vg - vs - vth) - F(vg - vd - vth));
        const body = diodeI(vs - vd, 1e-12, 1.3);
        return [id - body, (vg - vs) * 1e-12, -(id - body)];
      });
    } else if (u.k === 'dw01') {
      // Li-ion protector: OD (discharge FET gate) high while VCC > 2.4 V, OC (charge FET gate) high while VCC < 4.3 V
      S.nl([node(u.vcc), node(u.gnd), node(u.od), node(u.oc)], (v) => {
        const vc = v[0] - v[1];
        const odT = v[1] + vc * sig((vc - 2.4) / 0.03), ocT = v[1] + vc * sig((4.3 - vc) / 0.03);
        const so = drive(v[2], odT, 1000, 2e-3), sc = drive(v[3], ocT, 1000, 2e-3);
        const spO = fromRail(so, v[0], v[2]), spC = fromRail(sc, v[0], v[3]);
        const iq = 3e-6 * Math.tanh(spos(vc, 0.01));
        return [iq + spO + spC, so - spO + sc - spC - iq, -so, -sc];
      });
    } else if (u.k === 'logic') {
      // CMOS gate (inverter or buffer); threshold at half supply, Schmitt hysteresis ignored in DC
      S.nl([node(u.in), node(u.out), node(u.vdd), node(u.gnd)], (v) => {
        const [vin, vo, vdd, vg] = v;
        let l = sig((vin - vg - 0.5 * (vdd - vg)) / w5);
        if (u.inv) l = 1 - l;
        l *= sig((vdd - vg - 1.5) / 0.1);
        const s = drive(vo, vg + l * (vdd - vg), u.rout ?? 50, u.ilim ?? 0.025), sp = fromRail(s, vdd, vo);
        const iq = 1e-6 * Math.tanh(spos(vdd - vg, 0.01));
        return [vin * 1e-12, -s, sp + iq, s - sp - iq];
      });
    } else if (u.k === 'sink') {
      // Darlington low-side sink (ULN2003 channel): 2.7 kΩ base resistor, ≈ 0.9 V saturation
      S.nl([node(u.in), node(u.out), node(u.gnd)], (v) => {
        const vb = v[0] - v[2];
        const on = sig((vb - 1.4) / 0.08), iin = spos(vb - 1.4, 0.01) / 2700;
        const isk = (u.imax ?? 0.5) * Math.tanh(spos(v[1] - v[2] - 0.85, 0.02) / 0.25) * on;
        return [iin, isk, -iin - isk];
      });
    } else if (u.k === 'tl431') {
      // shunt regulator: sinks cathode current until REF sits 2.495 V above the anode
      S.nl([node(u.ref), node(u.k2), node(u.a)], (v) => {
        const x = v[0] - v[2] - 2.495, en = sig((v[1] - v[2] - 1.0) / 0.1);
        const ik = 0.1 * Math.tanh((8 * spos(x, 1e-4)) / 0.1) * en + 0.3e-3 * Math.tanh(spos(v[1] - v[2], 0.01));
        const iref = 2e-6 * Math.tanh(v[0] - v[2]);
        return [iref, ik, -ik - iref];
      });
    } else if (u.k === 'lm35') {
      const t = num(c.props.temp, 25);
      S.nl([node(u.vs), node(u.out), node(u.gnd)], (v) => {
        const vt = v[2] + 0.01 * t * sig((v[0] - v[2] - 3.5) / 0.1);
        const s = drive(v[1], vt, 1, 0.01), sp = fromRail(s, v[0], v[1]);
        const iq = 60e-6 * Math.tanh(spos(v[0] - v[2], 0.01));
        return [sp + iq, -s, s - sp - iq];
      });
    } else if (u.k === 'shunt') {
      const ia = idx(u.a), ib = idx(u.b);
      if (ia >= 0 && ib >= 0) S.R(n[ia], n[ib], u.r);
    } else if (u.k === 'drv') {
      S.nl([node(u.in), node(u.out), node(u.vdd), node(u.gnd)], (v) => {
        const [vin, vo, vdd, vg] = v;
        let l = sig((vin - vg - u.th) / w5);
        if (u.inv) l = 1 - l;
        l *= sig((vdd - vg - u.uvlo) / 0.1);
        const vt = vg + l * (vdd - vg);
        const s = drive(vo, vt, u.rout, u.ilim), sp = fromRail(s, vdd, vo);
        const iq = 0.5e-3 * Math.tanh(spos(vdd - vg, 0.01) / 3);
        return [vin * 1e-12, -s, sp + iq, s - sp - iq];
      });
    } else if (u.k === 'ir2110') {
      S.nl(['LO', 'COM', 'VCC', 'VS', 'VB', 'HO', 'VDD', 'HIN', 'SD', 'LIN', 'VSS'].map(node), (v) => {
        const [lo, com, vcc, vs, vb, ho, vdd, hin, sd, lin, vss] = v;
        const th = Math.max(1, 0.5 * (vdd - vss));
        const en = 1 - sig((sd - vss - th) / w5);
        const uvc = sig((vcc - com - 8.6) / 0.1), uvb = sig((vb - vs - 8.6) / 0.1);
        const lL = sig((lin - vss - th) / w5) * en * uvc;
        const lH = sig((hin - vss - th) / w5) * en * uvc * uvb;
        const sL = drive(lo, com + lL * (vcc - com), 6, 2.5), sLp = fromRail(sL, vcc, lo);
        const sH = drive(ho, vs + lH * (vb - vs), 6, 2.5), sHp = fromRail(sH, vb, ho);
        const iqc = 0.23e-3 * Math.tanh(spos(vcc - com, 0.01) / 3), iqb = 0.125e-3 * Math.tanh(spos(vb - vs, 0.01) / 3);
        // [LO, COM, VCC, VS, VB, HO, VDD, HIN, SD, LIN, VSS]
        return [-sL, sL - sLp - iqc, sLp + iqc, sH - sHp - iqb, sHp + iqb, -sH, 0, hin * 1e-12, sd * 1e-12, lin * 1e-12, 0];
      });
    } else if (u.k === 'ir2104') {
      S.nl(['VCC', 'IN', 'SD̅', 'COM', 'LO', 'VS', 'HO', 'VB'].map(node), (v) => {
        const [vcc, vin, sd, com, lo, vs, ho, vb] = v;
        const en = sig((sd - com - 1.6) / w5);
        const inH = sig((vin - com - 1.6) / w5);
        const uvc = sig((vcc - com - 8.9) / 0.1), uvb = sig((vb - vs - 8.9) / 0.1);
        const lH = inH * en * uvc * uvb, lL = (1 - inH) * en * uvc;
        const sL = drive(lo, com + lL * (vcc - com), 60, 0.27), sLp = fromRail(sL, vcc, lo);
        const sH = drive(ho, vs + lH * (vb - vs), 60, 0.27), sHp = fromRail(sH, vb, ho);
        const iqc = 0.15e-3 * Math.tanh(spos(vcc - com, 0.01) / 3), iqb = 0.06e-3 * Math.tanh(spos(vb - vs, 0.01) / 3);
        return [sLp + iqc, vin * 1e-12, sd * 1e-12, sL - sLp - iqc, -sL, sH - sHp - iqb, -sH, sHp + iqb];
      });
    } else if (u.k === 'opto') {
      S.nl([node(u.a), node(u.kk), node(u.e), node(u.c)], (v) => {
        const iF = diodeI(v[0] - v[1], 1.25e-13, 1.8);
        const ic = (u.ctr || 1) * spos(iF, 1e-9) * Math.tanh(spos(v[3] - v[2], 1e-3) / 0.15);
        return [iF, -iF, -ic, ic];
      });
    } else if (u.k === 'mod') {
      const iv = idx(u.vcc), ig = idx(u.gnd);
      if (iv < 0 || ig < 0) continue;
      const pwr = powerOf(c), iMod = pwr ? pwr.avg : u.i;
      if (iMod) S.R(n[iv], n[ig], (u.vnom || 3.3) / iMod);
      for (const pn of u.pullups || []) { const i = idx(pn); if (i >= 0) S.R(n[i], n[iv], u.rpu || 10e3); }
    } else if (u.k === 'aout') {
      const iv = idx(u.vcc), ig = idx(u.gnd);
      if (iv < 0 || ig < 0) continue;
      if (u.i) S.R(n[iv], n[ig], 3.3 / u.i);
      for (const o of u.outs) {
        const io = idx(o.pin);
        if (io < 0) continue;
        S.nl([n[io], n[iv], n[ig]], (v) => {
          const vs = Math.max(0, v[1] - v[2]);
          const vt = v[2] + o.f(vs, c.props);
          const s = (vt - v[0]) / u.rout, sp = fromRail(s, v[1], v[0]);
          return [-s, sp, s - sp];
        });
      }
    } else if (u.k === 'hall') {
      const iv = idx(u.vcc), ig = idx(u.gnd), io = idx(u.out);
      if (iv < 0 || ig < 0 || io < 0) continue;
      const act = u.on(c.props) ? 1 : 0;
      if (u.i) S.R(n[iv], n[ig], 5 / u.i);
      if (u.type === 'oc') {
        if (act) S.nl([n[io], n[ig], n[iv]], (v) => { const pw = sig((v[2] - v[1] - 2.5) / 0.1); const is = pw * 0.025 * Math.tanh((v[0] - v[1]) / (20 * 0.025)); return [is, -is, 0]; });
      } else {
        S.nl([n[io], n[iv], n[ig]], (v) => { const vt = v[2] + (act ? 0 : 1) * (v[1] - v[2]); const s = drive(v[0], vt, 100, 0.005), sp = fromRail(s, v[1], v[0]); return [-s, sp, s - sp]; });
      }
    } else if (u.k === 'mcu') {
      const i5 = idx(u.v5), i3 = idx(u.v3), ig = idx(u.gnd);
      if (i3 < 0 || ig < 0) continue;
      const n5 = i5 >= 0 ? n[i5] : 0, n3 = n[i3], ng = n[ig];
      const vreg = u.vreg || 3.3;
      // onboard regulator 5V/VIN → 3V3 (or VIN → 5V for Nano)
      if (i5 >= 0 && e.connected[i5]) {
        S.nl([n5, n3, ng], (v) => {
          const vt = v[2] + spos(smin(vreg, v[0] - v[2] - u.drop), 0.02);
          const s = drive(v[1], vt, 0.05, u.ilim), sp = fromRail(s, v[0], v[1]);
          return [sp, -s, s - sp];
        });
      }
      const pwr = powerOf(c);
      S.R(n3, ng, vreg / Math.max(pwr ? pwr.avg : u.load, 1e-9)); // board / MCU current draw (from its power settings)
      const gpio = c.props.gpio || {};
      g.pins.forEach((p, i) => {
        if (p.fn !== 'io' || (d.gpioPins && !d.gpioPins.includes(p.name))) return;
        const mode = gpio[p.name] || 'in';
        if (mode === 'in_pu') S.R(n[i], n3, 45e3);
        else if (mode === 'in_pd') S.R(n[i], ng, 45e3);
        else if (mode === 'high' || mode === 'low' || mode === 'pwm') {
          const lvl = mode === 'high' ? 1 : mode === 'low' ? 0 : Math.min(1, Math.max(0, num((c.props.duty || {})[p.name], 50) / 100));
          S.nl([n[i], n3, ng], (v) => {
            const vt = v[2] + lvl * (v[1] - v[2]);
            const s = drive(v[0], vt, 35, 0.04), sp = fromRail(s, v[1], v[0]);
            return [-s, sp, s - sp];
          });
        }
      });
    }
  }
}

function drawIC(c) {
  const g = icGeom(c);
  let s = `<rect class="s body" x="${-g.halfW}" y="${g.top}" width="${2 * g.halfW}" height="${g.bot - g.top}" rx="3"/>`;
  if (g.def.layout === 'dip') s += P(`M-7,${g.top}a7,7 0 0 0 14,0`);
  else s += `<rect class="s thin" x="-12" y="${g.top - 4}" width="24" height="8" rx="2"/>`;
  const t = [T(0, g.top + 13, g.title, 'tic')];
  const gpio = c.props.gpio || {};
  for (const p of g.pins) {
    const L = p.side === 'L';
    const xb = L ? -g.halfW : g.halfW;
    s += P(`M${p.x},${p.y}H${xb}`, 's pinl');
    t.push(T(xb + (L ? 4 : -4), p.y, p.name, 'tpin pf-' + p.fn, L ? 'start' : 'end'));
    t.push(T((p.x + xb) / 2, p.y - 6, p.num, 'tnum'));
    const mode = gpio[p.name];
    if (mode && mode !== 'in') {
      const tag = { high: 'H', low: 'L', pwm: '~', in_pu: '↑', in_pd: '↓' }[mode] || '';
      t.push(T(xb + (L ? 1 : -1) * (p.name.length * 6 + 11), p.y, tag, 'tgpio g-' + mode));
    }
  }
  return { s, t };
}

// ---------- public geometry helpers ----------
export function getDef(c) { return TYPES[c.type]; }
export function getPins(c) {
  const d = TYPES[c.type];
  if (!d) return [];
  return typeof d.pins === 'function' ? d.pins(c) : d.pins;
}
export function getBBox(c) {
  const d = TYPES[c.type];
  if (!d) return { x: -10, y: -10, w: 20, h: 20 };
  if (c.type === 'netlabel') { const w = Math.max(20, String(c.props.name || '').length * 7 + 8); return { x: 0, y: -8, w: 11 + w, h: 16 }; }
  if (c.type === 'rail') { const w = Math.max(28, String(c.props.name || '').length * 7 + 6); return { x: -w / 2, y: -26, w, h: 26 }; }
  return typeof d.bbox === 'function' ? d.bbox(c) : d.bbox;
}
export function getBridges(c) { return c.type === 'ic' ? icGeom(c).bridges : []; }
export function drawSymbol(c) { const d = TYPES[c.type]; return d ? d.draw(c) : { s: '' }; }
export function compLabel(c) { const d = TYPES[c.type]; return d && d.label ? d.label(c) : ''; }
export function propDefs(c) {
  const d = TYPES[c.type];
  if (!d) return [];
  if (c.type === 'ic') {
    const def = ICS[c.props.part] || {};
    if (def.generic) return [...d.props, ...GENERIC_IC_PROPS];
    if (def.customInline) return [...d.props, ...CUSTOM_INLINE_PROPS];
    const pf = powerProfile(c);
    return [...d.props, ...(def.extraProps || []), ...(pf ? pf.props : [])];
  }
  return d.props;
}

/** Options for a 'parts' dropdown. */
export function partOptions(kind) {
  if (kind === 'ic') return Object.keys(ICS);
  if (kind === 'diode') return Object.keys(PARTS).filter((k) => PARTS[k].type === 'diode');
  return Object.keys(PARTS).filter((k) => PARTS[k].type === kind);
}

/** Default props for a new component. */
export function defaultProps(type, part) {
  const d = TYPES[type];
  const p = {};
  for (const o of d.props) p[o.key] = o.default;
  if (part) { p.part = part; applyPartFill(type, p); }
  if (type === 'ic') {
    p.gpio = {}; p.duty = {};
    for (const o of GENERIC_IC_PROPS) p[o.key] = o.default;
    for (const o of CUSTOM_INLINE_PROPS) if (p[o.key] == null || o.key !== 'title') p[o.key] = p[o.key] ?? o.default;
    applyPartFill(type, p);
    if (part === 'Custom board') p.title = 'My ESP32';
  }
  return p;
}
export function applyPartFill(type, props) {
  const d = TYPES[type];
  const po = d.props.find((o) => o.key === 'part');
  const m = PARTS[props.part];
  if (po && po.fill && m) for (const [k, src] of Object.entries(po.fill)) if (m[src] != null) props[k] = typeof m[src] === 'number' ? fmt(m[src]).replace(/\s/g, '').replace('µ', 'u') : String(m[src]);
  if (type === 'ic') {
    const def = ICS[props.part] || {};
    for (const o of def.extraProps || []) if (props[o.key] == null) props[o.key] = o.default;
    if (def.gpioDefault) { props.gpio = { ...def.gpioDefault, ...(props.gpio || {}) }; props.duty = { CLK0: 50, CLK1: 50, CLK2: 50, ...(props.duty || {}) }; }
  }
}

/** Spec card info for a component. */
export function partInfo(c) {
  const d = TYPES[c.type];
  if (c.type === 'ic') {
    const g = icGeom(c);
    const def = g.def;
    return {
      title: def.name || c.props.part, desc: def.desc, pkg: def.pkg,
      pinout: g.pins.map((p) => [p.num, p.name, fnLabel(p.fn)]), specs: def.specs || [], notes: def.notes, ic: g,
    };
  }
  const m = PARTS[c.props.part];
  if (m) return { title: c.props.part, desc: m.desc, pkg: m.pkg, pinout: m.pinout, specs: m.specs || [], notes: m.notes, type: c.type };
  return { title: d.name, desc: GENERIC_INFO[c.type] || '', specs: [], type: c.type };
}
const fnLabel = (f) => ({ pwr: 'power', gnd: 'ground', in: 'input', out: 'output', io: 'I/O', nc: 'not connected', ctl: 'control' }[f] || f);
const GENERIC_INFO = {
  resistor: 'Fixed resistor. Enter values like 4.7k, 4k7, 100, 1M. Power rating is used to warn about overheating.',
  pot: 'Potentiometer. Drag the wiper slider to sweep the divider live.',
  capacitor: 'Non-polarised capacitor (ceramic / film). Open at DC, impedance 1/(2πfC) in AC analysis.',
  cap_pol: 'Polarised electrolytic. Keep + at the higher potential; a reverse-bias warning is shown.',
  inductor: 'Inductor with DC resistance. Short (DCR) at DC, impedance 2πfL in AC analysis.',
  vdc: 'Ideal DC voltage source / battery with optional internal resistance.',
  vac: 'Signal generator. DC offset is used for the operating point; it is used as the stimulus for frequency-response analysis.',
  idc: 'Ideal DC current source (current flows out of the "out" pin).',
  led: 'Light-emitting diode. Forward voltage depends on colour (red ≈ 1.8 V, blue/white ≈ 3 V). Lights up in the simulation when current flows.',
  ground: 'Ground reference (0 V). All ground symbols are the same net.',
  rail: 'Power rail symbol: a voltage source from this net to ground. Rails with the same name are the same net.',
  netlabel: 'Net label. All labels with the same name are connected without drawing a wire.',
  switch: 'SPST switch. Tap “Toggle” (or the switch in Debug/Measure mode) to open/close it.',
  button: 'Momentary push button (normally open).',
  spdt: 'Single-pole double-throw switch.',
  fuse: 'Fuse. Mark as blown to simulate an open fuse during troubleshooting.',
  zener: 'Zener diode: conducts in reverse above VZ. Useful as a gate clamp or simple reference.',
  ldr: 'Light-dependent resistor: R = R10·(lux/10)^−γ, limited to the dark resistance. Drag the light slider to see the divider respond.',
  pickup: 'Inductive pickup coil: series inductance + DC resistance, with an induced EMF used as the stimulus in Freq. response. Values can be entered or calculated from turns, diameter, length, wire gauge and core.',
  tvs: 'Transient-voltage-suppressor: nearly open below its stand-off voltage, clamps hard above VBR. Bidirectional (CA) types clamp both polarities.',
};

// ---------- Palette (the part bank shown in the Add drawer) ----------
export const PALETTE = [
  { type: 'resistor', label: 'Resistor', cat: 'Basic' },
  { type: 'resistor', label: 'Power resistor 5 W', cat: 'Basic', preset: { value: '10', power: '5' }, kw: 'load wirewound' },
  { type: 'pot', label: 'Potentiometer', cat: 'Basic', kw: 'trimmer variable' },
  { type: 'capacitor', label: 'Capacitor', cat: 'Basic', kw: 'ceramic film' },
  { type: 'cap_pol', label: 'Electrolytic', cat: 'Basic', kw: 'capacitor polarized' },
  { type: 'inductor', label: 'Inductor / coil', cat: 'Coils', kw: 'coil choke' },
  { type: 'inductor', label: 'Coil 10 µH', cat: 'Coils', preset: { value: '10u', dcr: '0.02' }, kw: 'inductor choke buck' },
  { type: 'inductor', label: 'Coil 100 µH', cat: 'Coils', preset: { value: '100u', dcr: '0.1' }, kw: 'inductor choke' },
  { type: 'inductor', label: 'Coil 1 mH', cat: 'Coils', preset: { value: '1m', dcr: '1' }, kw: 'inductor choke' },
  { type: 'inductor', label: 'Coil 10 mH', cat: 'Coils', preset: { value: '10m', dcr: '5' }, kw: 'inductor choke' },
  { type: 'inductor', label: 'Relay coil 12 V', cat: 'Coils', preset: { value: '200m', dcr: '400' }, kw: 'relay solenoid inductor' },
  { type: 'switch', label: 'Toggle switch (SPST)', cat: 'Switches', kw: 'switch on off' },
  { type: 'spdt', label: 'Changeover (SPDT)', cat: 'Switches', kw: 'switch toggle selector' },
  { type: 'button', label: 'Push button (NO)', cat: 'Switches', kw: 'switch momentary tactile' },
  { type: 'button', label: 'Push button (NC)', cat: 'Switches', preset: { nc: true }, kw: 'switch momentary normally closed' },
  ...['0.5', '1', '2', '5', '10'].map((a) => ({ type: 'fuse', label: `Fuse ${a} A`, cat: 'Fuses', preset: { rating: a }, kw: 'fuse protection polyfuse' })),
  { type: 'ground', label: 'Ground', cat: 'Sources' },
  { type: 'rail', label: 'Power rail', cat: 'Sources' },
  { type: 'netlabel', label: 'Net label', cat: 'Sources' },
  { type: 'vdc', label: 'DC source', cat: 'Sources', kw: 'battery supply' },
  { type: 'battery', label: 'LiPo 1S 100 mAh', cat: 'Sources', preset: { chem: 'Li-ion / LiPo', cap: '100' }, kw: 'battery lipo lithium cell pouch' },
  { type: 'battery', label: '18650 Li-ion 1S 2500 mAh', cat: 'Sources', preset: { chem: 'Li-ion / LiPo', cap: '2500' }, kw: 'battery 18650 lithium cell' },
  { type: 'battery', label: 'Li-ion 2S 2000 mAh', cat: 'Sources', preset: { chem: 'Li-ion / LiPo', cap: '2000', series: '2' }, kw: 'battery lipo 2s 7.4v pack' },
  { type: 'battery', label: 'LiFePO4 1S 1500 mAh', cat: 'Sources', preset: { chem: 'LiFePO4', cap: '1500' }, kw: 'battery lifepo4 lfp' },
  { type: 'battery', label: '3 × AA alkaline', cat: 'Sources', preset: { chem: 'Alkaline', cap: '2500', series: '3', prot: false }, kw: 'battery aa alkaline 4.5v' },
  { type: 'battery', label: '4 × AA NiMH', cat: 'Sources', preset: { chem: 'NiMH', cap: '2000', series: '4', prot: false }, kw: 'battery aa nimh rechargeable 4.8v' },
  { type: 'battery', label: 'CR2032 coin cell', cat: 'Sources', preset: { chem: 'Lithium coin (CR2032)', cap: '225', prot: false }, kw: 'battery coin cr2032 button' },
  { type: 'battery', label: '12 V SLA 7 Ah', cat: 'Sources', preset: { chem: 'Lead-acid (SLA)', cap: '7000', series: '6', prot: false }, kw: 'battery lead acid sla 12v' },
  { type: 'vac', label: 'Signal gen', cat: 'Sources', kw: 'function generator ac sine' },
  { type: 'idc', label: 'Current src', cat: 'Sources' },
  ...['red', 'yellow', 'green', 'blue', 'white'].map((col) => ({ type: 'led', label: `LED ${col}`, cat: 'LEDs', preset: { color: col }, kw: 'led light diode indicator' })),
  ...['1N4148', '1N914', '1N5819', 'BAT54'].map((p) => ({ type: PARTS[p].type, part: p, label: p, cat: 'Diodes', kw: 'switching signal diode' })),
  ...['1N4001', '1N4007', '1N5408', 'UF4007', 'FR107', '1N5822', 'SS34'].map((p) => ({ type: PARTS[p].type, part: p, label: p, cat: 'Diodes', kw: 'rectifier diode power' })),
  ...['BZX55C3V3', '1N4728A', '1N4733A', '1N4740A', '1N4742A', '1N4744A', '1N4750A'].map((p) => ({ type: 'zener', part: p, label: p + ' (' + PARTS[p].vz + 'V)', cat: 'Zeners', kw: 'zener diode reference clamp' })),
  ...['SMAJ5.0A', 'SMBJ5.0A', 'SMBJ12A', 'SMBJ15A', 'SMBJ24A', 'SMBJ33A', 'P6KE6.8A', 'P6KE15A', 'P6KE33A', '1.5KE18A', 'SMAJ5.0CA', 'SMBJ5.0CA', 'SMBJ12CA', 'SMBJ15CA', 'SMBJ24CA', 'SMBJ33CA', 'P6KE6.8CA', 'P6KE15CA', 'P6KE33CA', '1.5KE18CA'].map((p) => ({ type: 'tvs', part: p, label: PARTS[p].bi ? p + ' (bi)' : p, cat: 'TVS', kw: (PARTS[p].bi ? 'bidirectional bipolar bi-directional ' : 'unidirectional ') + 'tvs transient suppressor surge esd protection diode' })),
  ...['2N2222A', '2N3904', 'BC547', 'TIP31C', 'TIP120'].map((p) => ({ type: 'npn', part: p, label: p, cat: 'Transistors', kw: p === '2N2222A' ? '2N2222 PN2222 npn bjt' : 'npn bjt' })),
  ...['2N3906', 'BC557', 'TIP42C'].map((p) => ({ type: 'pnp', part: p, label: p, cat: 'Transistors' })),
  ...['IRLZ44N', 'IRFB4410', 'IRF540N', 'IRFZ44N', 'IRF3205', 'IRLB8721', 'IRFP260N', '2N7000', 'BSS138', 'AO3400'].map((p) => ({ type: 'nmos', part: p, label: p, cat: 'MOSFETs', kw: p === 'IRFB4410' ? 'IRBF4410 nmos n-channel' : 'nmos n-channel' })),
  ...['IRF9540N', 'IRF4905', 'AO3401'].map((p) => ({ type: 'pmos', part: p, label: p, cat: 'MOSFETs' })),
  ...['TL072', 'LM358', 'NE5532', 'MCP6002', 'LM741', 'Ideal'].map((p) => ({ type: 'opamp', part: p, label: p === 'Ideal' ? 'Ideal op-amp' : p + ' (symbol)', cat: 'Op-amps' })),
  ...['TL072-IC', 'LM358-IC', 'NE5532-IC', 'MCP6002-IC', 'TL074-IC'].map((p) => ({ type: 'ic', part: p, label: ICS[p].name + ' ' + ICS[p].pkg.split(' ')[0], cat: 'Op-amps' })),
  ...['7805', '7809', '7812', '7815', 'LM317', 'AMS1117-3.3', 'AMS1117-5.0', 'LM2940-5', 'MCP1700-3302'].map((p) => ({ type: 'reg', part: p, label: p, cat: 'Regulators' })),
  ...['TC4420', 'TC4429', 'TC4427', 'TC4426', 'IR2110', 'IR2104'].map((p) => ({ type: 'ic', part: p, label: p, cat: 'Gate drivers' })),
  ...['ESP32-S3 SuperMini', 'ESP32-S3-DevKitC-1', 'ESP32 DevKit V1 (30p)', 'ESP32-C3 SuperMini', 'Arduino Nano'].map((p) => ({ type: 'ic', part: p, label: p, cat: 'MCU boards' })),
  ...['NE555', 'PC817', 'Generic IC'].map((p) => ({ type: 'ic', part: p, label: p, cat: 'ICs' })),
  { type: 'ic', part: 'Custom board', label: 'Custom board (inline)', cat: 'MCU boards', kw: 'custom esp32 define pinout' },
  // low-voltage op-amps
  ...['MCP6001', 'LMV358', 'TLV9002', 'TLV2372', 'OPA2340', 'AD8606', 'LM324', 'TL082', 'OPA2134'].map((p) => ({ type: 'opamp', part: p, label: p + ' (symbol)', cat: 'Op-amps', kw: 'opamp op amp ' + (PARTS[p].desc || '') + (/5\.5|6 V|16 V|32 V/.test(PARTS[p].desc) ? ' low voltage single supply 3.3V 5V rail-to-rail' : '') })),
  ...['MCP6001-IC', 'MCP6004-IC', 'LMV358-IC', 'TLV9002-IC', 'TLV2372-IC', 'OPA2340-IC', 'AD8606-IC', 'LM324-IC', 'TL082-IC', 'OPA2134-IC'].map((p) => ({ type: 'ic', part: p, label: ICS[p].name + ' ' + ICS[p].pkg.split(' ')[0], cat: 'Op-amps', kw: 'opamp op amp ' + ICS[p].desc + ' low voltage' })),
  // sensors
  ...['GL5516', 'GL5528', 'GL5537', 'GL5549'].map((p) => ({ type: 'ldr', part: p, label: 'LDR ' + p, cat: 'Sensors', kw: 'photoresistor ldr light cds' })),
  ...['BPW34', 'SFH203', 'BPW21'].map((p) => ({ type: 'photodiode', part: p, label: 'Photodiode ' + p, cat: 'Sensors', kw: 'photodiode light optical' })),
  ...['TEPT5600', 'PT334-6C', 'Generic phototransistor'].map((p) => ({ type: 'phototransistor', part: p, label: p === 'Generic phototransistor' ? 'Phototransistor' : 'Phototransistor ' + p, cat: 'Sensors', kw: 'phototransistor light optical' })),
  { type: 'pickup', label: 'Pickup coil (single-coil)', cat: 'Sensors', preset: { value: '2.5', dcr: '6k' }, kw: 'pickup coil guitar inductive sensor' },
  { type: 'pickup', label: 'Pickup coil (humbucker)', cat: 'Sensors', preset: { value: '4', dcr: '8k' }, kw: 'pickup coil guitar humbucker' },
  { type: 'pickup', label: 'Pickup coil (calculated)', cat: 'Sensors', preset: { mode: 'Calculated' }, kw: 'pickup coil search coil inductive turns awg wheeler calculated' },
  ...['A3144', 'SS49E', 'DRV5032FB'].map((p) => ({ type: 'ic', part: p, label: 'Hall ' + p, cat: 'Sensors', kw: 'hall effect magnetic sensor ' + ICS[p].desc })),
  ...['ADXL335 (GY-61)', 'ADXL345 (GY-291)', 'MPU-6050 (GY-521)'].map((p) => ({ type: 'ic', part: p, label: p, cat: 'Sensors', kw: 'accelerometer imu gyro ' + ICS[p].desc })),
  ...['QMC5883L (GY-271)', 'HMC5883L (GY-271)'].map((p) => ({ type: 'ic', part: p, label: p, cat: 'Sensors', kw: 'magnetometer compass ' + ICS[p].desc })),
  ...['ADS1115 module', 'ADS1115 (chip)', 'ADS1220', 'ADS1256'].map((p) => ({ type: 'ic', part: p, label: p, cat: 'ADCs', kw: 'adc analog digital converter ads ' + ICS[p].desc })),
  ...['LM393-IC', 'LM339', 'LM311', 'LMV393', 'MCP6561', 'TLV3201', 'TLV7011'].map((p) => ({ type: 'ic', part: p, label: (ICS[p].name || p) + ' ' + ICS[p].pkg.split(' ')[0], cat: 'Comparators', kw: 'comparator threshold schmitt ' + ICS[p].desc })),
  ...['74HC595', '74HC14', 'MCP23017'].map((p) => ({ type: 'ic', part: p, label: p, cat: 'Logic & interface', kw: 'logic cmos digital ' + ICS[p].desc })),
  ...['ULN2003A', 'L293D', 'LM386'].map((p) => ({ type: 'ic', part: p, label: p, cat: 'Drivers', kw: 'driver motor relay audio ' + ICS[p].desc })),
  ...['TL431', 'TP4056', 'TP4054', 'DW01A', 'FS8205A', 'USBLC6-2SC6', 'USB-C receptacle', 'Micro-USB receptacle'].map((p) => ({ type: 'ic', part: p, label: p, cat: 'Power ICs', kw: 'power reference charger esd ' + ICS[p].desc })),
  ...['AP2112K-3.3', 'ME6211C33'].map((p) => ({ type: 'reg', part: p, label: p, cat: 'Regulators', kw: 'ldo regulator 3.3 enable' })),
  ...['DS18B20', 'LM35', 'INA219 module', 'LSM6DS3', 'QMC5883P'].map((p) => ({ type: 'ic', part: p, label: p, cat: 'Sensors', kw: 'sensor ' + ICS[p].desc })),
  { type: 'ic', part: 'ESP32-S3-WROOM-1', label: 'ESP32-S3-WROOM-1 module', cat: 'MCU boards', kw: 'esp32 s3 module wroom wifi bluetooth ble' },
  ...['Si5351 module', 'Si5351A (chip)'].map((p) => ({ type: 'ic', part: p, label: p, cat: 'Signal sources', kw: 'si5351 clock generator signal generator oscillator rf' })),
];
export const CATEGORIES = ['Basic', 'Coils', 'Switches', 'Fuses', 'Sources', 'LEDs', 'Diodes', 'Zeners', 'TVS', 'Transistors', 'MOSFETs', 'Op-amps', 'Comparators', 'Sensors', 'ADCs', 'Signal sources', 'Regulators', 'Power ICs', 'Logic & interface', 'Drivers', 'Gate drivers', 'MCU boards', 'ICs'];

export const helpers = { sig, spos, smin, diodeI, num, fmt };
