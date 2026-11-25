// Battery tool and battery charger / monitor designer (Tools dialog), with "Insert into circuit".
import { fmt, parseEng, E24, E12 } from './units.js';
import { newDesign, makeComp, addWire, pinPos } from './doc.js';
import { getPins, TYPES } from './library.js';
import { CHEMS, CHEM_NAMES, batteryInfo, ocv, runtimeHours } from './battery.js';
import { eRound } from './design.js';
import { plannerSummary } from './power.js';

let APP = null;
export function setToolsApp(app) { APP = app; }
const num = (x, d = 0) => { const v = parseEng(x); return Number.isFinite(v) ? v : d; };
const designBatteries = () => (APP ? APP.doc.comps.filter((c) => c.type === 'battery') : []);
const batLabel = (c) => `From the design: ${c.ref} ${TYPES.battery.label(c)}`;
const fromDesign = (v) => designBatteries().find((c) => batLabel(c) === v.src);
const life = (h) => (!Number.isFinite(h) ? '—' : h > 48 ? `${(h / 24).toFixed(h > 240 ? 0 : 1)} days` : h >= 1 ? `${h.toFixed(1)} h` : `${(h * 60).toFixed(0)} min`);

/** Rough CC/CV (or chemistry-specific) charge time in hours. */
function chargeHours(info, I) {
  if (!(I > 0) || info.chem.primary) return Infinity;
  const C = info.capPack / 1000, rate = I / C;
  if (info.chem.short === 'Li-ion' || info.chem.short === 'LiFePO4') return 1.05 / rate + (rate > 0.5 ? 0.45 : 0.25);
  if (info.chem.short === 'NiMH') return 1.4 / rate;
  return 1.6 / rate; // lead-acid bulk + absorption
}

// ---------------------------------------------------------------- template helpers
function builder(name) {
  const d = newDesign(name);
  const put = (type, x, y, props = {}, rot = 0, part) => { const c = makeComp(d, type, part, x, y); c.rot = rot; Object.assign(c.props, props); d.comps.push(c); return c; };
  const pin = (c, n) => (typeof n === 'number' ? n : getPins(c).findIndex((p) => p.name === n));
  const lab = (c, pn, net) => { const i = pin(c, pn), [x, y] = pinPos(c, i), left = x < c.x; const l = put('netlabel', x + (left ? -20 : 20), y, { name: net }); l.flip = left; addWire(d, { c: c.id, p: i }, { c: l.id, p: 0 }); return l; };
  const gnd = (c, pn) => { if (c.type === 'ic') return lab(c, pn, 'GND'); const i = pin(c, pn), [x, y] = pinPos(c, i); const g = put('ground', x, y + 30); addWire(d, { c: c.id, p: i }, { c: g.id, p: 0 }); };
  const ev = (x) => fmt(x).replace(/\s/g, '').replace('µ', 'u');
  const shunt = (type, x, y, value, net) => { const c = put(type, x, y, { value: ev(value) }, 1); lab(c, 0, net); gnd(c, 1); return c; };
  const between = (type, x, y, value, a, b, extra = {}) => { const c = put(type, x, y, value == null ? extra : { value: ev(value), ...extra }, 0, extra.part); lab(c, 0, a); lab(c, 1, b); return c; };
  const vert = (type, x, y, value, a, b) => { const c = put(type, x, y, { value: ev(value) }, 1); lab(c, 0, a); lab(c, 1, b); return c; };
  return { d, put, lab, gnd, shunt, between, vert, pin };
}

// ---------------------------------------------------------------- battery tool
const batteryInputs = [
  { k: 'src', label: 'Battery', options: () => ['Custom', ...designBatteries().map(batLabel)], def: 'Custom', onSelect: (v, val) => { const c = designBatteries().find((x) => batLabel(x) === val); if (c) Object.assign(v, { chem: c.props.chem, S: num(c.props.series, 1), P: num(c.props.parallel, 1), cap: num(c.props.cap, 100), soc: num(c.props.soc, 80) }); } },
  { k: 'chem', label: 'Chemistry', options: CHEM_NAMES, def: 'Li-ion / LiPo' },
  { k: 'S', label: 'Cells in series (S)', unit: '', range: [1, 12], step: 1, def: 1 },
  { k: 'P', label: 'Cells in parallel (P)', unit: '', range: [1, 10], step: 1, def: 1 },
  { k: 'cap', label: 'Capacity per cell (mAh)', unit: '', range: [10, 100000], log: true, def: 100 },
  { k: 'soc', label: 'State of charge now (%)', unit: '', range: [0, 100], step: 1, def: 80 },
  { k: 'loadSrc', label: 'Load', options: () => ['Power budget average (this design)', 'Current', 'Power'], def: 'Power budget average (this design)' },
  { k: 'I', label: 'Load current', unit: 'A', range: [1e-6, 50], log: true, def: 0.05 },
  { k: 'Pw', label: 'Load power', unit: 'W', range: [1e-4, 500], log: true, def: 0.25 },
  { k: 'eff', label: 'Converter efficiency (power mode)', unit: '', range: [50, 100], step: 1, def: 90 },
  { k: 'Ich', label: 'Charge current', unit: 'A', range: [0.001, 20], log: true, def: 0.05 },
];
export const batteryCalc = {
  id: 'battery', name: 'Battery', inputs: batteryInputs,
  hide: (v) => (v.loadSrc === 'Current' ? ['Pw', 'eff'] : v.loadSrc === 'Power' ? ['I'] : ['I', 'Pw', 'eff']),
  compute: (v) => {
    const c = fromDesign(v);
    const props = c ? c.props : { chem: v.chem, series: v.S, parallel: v.P, cap: v.cap, soc: v.soc };
    const b = batteryInfo(props);
    let I = v.I, src = 'entered';
    if (v.loadSrc === 'Power') I = v.Pw / ((v.eff / 100) * b.Vnom);
    if (v.loadSrc.startsWith('Power budget')) {
      const P = APP ? plannerSummary(APP) : null;
      I = P && P.ibat > 0 ? P.ibat : v.I; src = P && P.ibat > 0 ? 'average from the Power budget' : 'Power budget is empty — using the entered current';
    }
    const C = b.capPack / 1000, rate = I / C;
    const vLoad = (soc) => ocv(b.chemName, soc) * b.S - I * b.rPack;
    const tFull = runtimeHours(b, I, 100), tNow = runtimeHours(b, I, b.soc);
    const tCh = chargeHours(b, v.Ich);
    const rows = [
      ['__h', 'Pack'],
      ['Configuration', `${b.S}S${b.P}P ${b.chemName}, ${fmt(b.capPack / 1000, 'Ah')}`],
      ['Voltage nominal / full / cut-off', `${b.Vnom.toFixed(2)} / ${b.Vfull.toFixed(2)} / ${b.Vcut.toFixed(2)} V`],
      ['Energy', `${b.energyWh.toFixed(b.energyWh < 1 ? 2 : 1)} Wh`],
      ['Internal resistance (pack)', fmt(b.rPack, 'Ω')],
      ['Resting voltage now', `${fmt(b.V, 'V', 3)} at ${b.soc} %`],
      ['__h', 'Load'],
      ['Load current', `${fmt(I, 'A')} (${src})`],
      ['C-rate', `${rate.toFixed(rate < 0.1 ? 3 : 2)}C (continuous limit ≈ ${fmt(b.maxI, 'A')})`],
      ['Voltage under load now / at 20 %', `${fmt(vLoad(b.soc), 'V', 3)} / ${fmt(vLoad(20), 'V', 3)}`],
      ['Heat in the cells (I²R)', fmt(I * I * b.rPack, 'W')],
      ['Runtime from full', life(tFull)],
      ['Runtime from now', life(tNow)],
      ['Shelf life (self-discharge)', b.chem.selfPerMonth ? `≈ ${(1 / b.chem.selfPerMonth).toFixed(0)} months to empty` : '—'],
      ['__h', 'Charging'],
      ['Charge time at ' + fmt(v.Ich, 'A'), b.chem.primary ? 'not rechargeable' : `≈ ${life(tCh)} (${(v.Ich / C).toFixed(2)}C)`],
      ['Charge voltage', b.Vcharge ? `${b.Vcharge.toFixed(2)} V (${b.chem.chargeV} V per cell)` : '—'],
    ];
    const table = { head: ['Charge', 'Resting', 'Under load', 'Time left'], rows: [100, 75, 50, 25, 10].map((s) => [`${s} %`, fmt(ocv(b.chemName, s) * b.S, 'V', 3), fmt(vLoad(s), 'V', 3), life(runtimeHours(b, I, s))]) };
    const warns = [];
    if (I > b.maxI) warns.push(`The load (${fmt(I, 'A')}) is above this pack's ≈ ${fmt(b.maxI, 'A')} continuous rating — the voltage will sag and the cells heat up. Add cells in parallel or choose a higher-rate cell.`);
    if (vLoad(20) < b.Vcut) warns.push(`Under this load the voltage hits the ${b.Vcut.toFixed(2)} V cut-off before the pack is empty — usable capacity is less than shown.`);
    if (b.chem.primary && v.Ich > 0) warns.push(`${b.chemName} cells are not rechargeable — never connect a charger.`);
    else if (v.Ich / C > b.chem.chargeC * 1.05) warns.push(`Charging at ${(v.Ich / C).toFixed(2)}C is above the ≈ ${b.chem.chargeC}C limit for ${b.chem.short}.`);
    if (b.chemName === 'Lithium coin (CR2032)') warns.push('Coin cells deliver ≈ 3 mA continuously; for radio bursts put 100–470 µF in parallel and keep average current in the µA range.');
    warns.push(b.chem.note);
    return { main: ['Runtime from the present charge', life(tNow)], rows, table, warns, insert: () => batteryTemplate(props), measure: 'V', note: 'Resting-voltage curves are typical. Runtime uses a Peukert-style derating above 0.2C, which matters most for alkaline and lead-acid cells.' };
  },
};
function batteryTemplate(props) {
  const B = builder('battery');
  const bt = B.put('battery', 0, 60, { ...props, series: String(props.series), parallel: String(props.parallel), cap: String(props.cap), soc: String(props.soc) });
  B.lab(bt, 0, 'BAT'); B.gnd(bt, 1);
  return { d: B.d, inRef: { c: bt.id, p: 0 }, outRef: { c: bt.id, p: 0 } };
}

// ---------------------------------------------------------------- charger & monitor designer
const IC = ['TP4056 (up to 1 A, NTC input, two status pins)', 'TP4054 (up to 500 mA, one status pin)'];
const MON = ['None', 'Divider to ADC (always on)', 'Switched divider (≈ 0 µA when off)', 'INA219 current + voltage monitor'];
const chargerInputs = [
  { k: 'src', label: 'Battery', options: () => ['Custom', ...designBatteries().map(batLabel)], def: 'Custom', onSelect: (v, val) => { const c = designBatteries().find((x) => batLabel(x) === val); if (c) { const b = batteryInfo(c.props); v.cap = b.capPack; v.chem = b.chemName; v.series = b.S; } } },
  { k: 'cap', label: 'Battery capacity (mAh)', unit: '', range: [20, 10000], log: true, def: 100 },
  { k: 'crate', label: 'Charge rate (× capacity)', unit: '', range: [0.1, 1], step: 0.05, def: 0.5 },
  { k: 'ic', label: 'Charger IC', options: IC, def: IC[0] },
  { k: 'input', label: 'Power input', options: ['USB-C', 'Micro-USB', '5 V pads'], def: 'USB-C' },
  { k: 'status', label: 'Charge status', options: ['LEDs (red = charging, green = full)', 'To microcontroller pins', 'None'], def: 'LEDs (red = charging, green = full)' },
  { k: 'ntc', label: 'Battery temperature', options: ['No sensor (TEMP to GND)', '10 kΩ NTC thermistor, B = 3950'], def: 'No sensor (TEMP to GND)' },
  { k: 'prot', label: 'Protection', options: ['The cell has its own protection board', 'Add DW01A + FS8205A protection'], def: 'The cell has its own protection board' },
  { k: 'share', label: 'Load sharing', options: ['System runs from USB when plugged in (diode + P-MOSFET)', 'Load on the battery (simplest)'], def: 'System runs from USB when plugged in (diode + P-MOSFET)' },
  { k: 'mon', label: 'Battery monitoring', options: MON, def: MON[1] },
  { k: 'adcFs', label: 'ADC full-scale voltage', unit: 'V', range: [1, 5], step: 0.05, def: 3.1 },
  { k: 'drain', label: 'Allowed divider drain (always-on)', unit: 'A', range: [1e-7, 1e-3], log: true, def: 2e-6 },
];
function chargerPlan(v) {
  const tp56 = v.ic === IC[0], k = tp56 ? 1200 : 1000, imax = tp56 ? 1 : 0.5;
  const want = Math.min((v.cap / 1000) * v.crate, imax);
  const rProg = eRound((k / (want * 1000)) * 1000, E24, true);                    // larger R → never above the target
  const ich = (k / (rProg / 1000)) / 1000;
  const info = batteryInfo({ chem: v.chem || 'Li-ion / LiPo', cap: v.cap, series: v.series || 1 });
  // battery divider for the ADC: aim for 90 % of full scale at 4.25 V
  const kDiv = Math.min(1, (0.9 * v.adcFs) / 4.25);
  const rTot = v.mon === MON[2] ? 200e3 : Math.max(20e3, 4.25 / v.drain);
  const r2 = eRound(kDiv * rTot, E24, false), r1 = kDiv >= 0.999 ? 0 : eRound(r2 * (1 / kDiv - 1), E24, true);
  const ratio = r1 ? r2 / (r1 + r2) : 1;
  // NTC window for TP4056 (TEMP between 45 % and 80 % of VCC)
  const B = 3950, R25 = 10e3, rNtc = (tC) => R25 * Math.exp(B * (1 / (tC + 273.15) - 1 / 298.15)), tOf = (r) => 1 / (Math.log(r / R25) / B + 1 / 298.15) - 273.15;
  const rT = 6.8e3, cold = tOf(4 * rT), hot = tOf((0.45 / 0.55) * rT);
  return { tp56, k, imax, want, rProg, ich, info, ratio, r1, r2, rT, cold, hot, rNtc };
}
export const chargerCalc = {
  id: 'charger', name: 'Charger & monitor', inputs: chargerInputs,
  hide: (v) => (v.mon === MON[0] || v.mon === MON[3] ? ['adcFs', 'drain'] : v.mon === MON[2] ? ['drain'] : []).concat(v.ic === IC[1] ? ['ntc'] : []),
  compute: (v) => {
    const p = chargerPlan(v);
    const C = v.cap / 1000, tCh = chargeHours(p.info, p.ich);
    const vin = 5, pStart = (vin - 3.0) * p.ich, pMid = (vin - 3.7) * p.ich;
    const rows = [
      ['__h', 'Charging'],
      ['Charge current', `${fmt(p.ich, 'A')} (${(p.ich / C).toFixed(2)}C) — PROG resistor ${fmt(p.rProg, 'Ω')} (${p.k}/R)`],
      ['Charge time', `≈ ${life(tCh)} to full (CC then CV to 4.2 V)`],
      ['Charger heat', `${fmt(pMid, 'W')} typical, ${fmt(pStart, 'W')} at the start of a deep charge`],
      ['Input', v.input === 'USB-C' ? 'USB-C with 5.1 kΩ on CC1 and CC2 (5 V from any host / charger)' : v.input === 'Micro-USB' ? 'Micro-USB (5 V)' : '5 V pads'],
      ['Status', v.status.startsWith('LEDs') ? `LEDs with 1.5 kΩ from VBUS (≈ 2 mA)${p.tp56 ? ': red on CHRG, green on STDBY' : ' on CHRG'}` : v.status.startsWith('To') ? `CHRG${p.tp56 ? ' / STDBY' : ''} are open-drain: enable the MCU pull-ups (low = active)` : '—'],
    ];
    if (p.tp56) rows.push(['Temperature', v.ntc.startsWith('10') ? `6.8 kΩ VCC→TEMP + 10 kΩ NTC → charges only between ≈ ${p.cold.toFixed(0)} °C and ${p.hot.toFixed(0)} °C` : 'TEMP tied to GND (no sensing)']);
    rows.push(['Protection', v.prot.startsWith('Add') ? 'DW01A + FS8205A: cuts off above ≈ 4.3 V, below ≈ 2.4 V and above ≈ 3 A' : 'relies on the protection board inside the cell']);
    rows.push(['System supply', v.share.startsWith('System') ? 'VSYS ≈ 4.7 V from USB through the Schottky, battery isolated by the P-MOSFET; on battery VSYS ≈ BAT − 20 mV' : 'the load hangs on BAT; charge termination can be confused by the load current']);
    if (v.mon === MON[1] || v.mon === MON[2]) {
      rows.push(['__h', 'Battery voltage to the ADC']);
      rows.push(['Divider', `${fmt(p.r1, 'Ω')} / ${fmt(p.r2, 'Ω')} (× ${p.ratio.toFixed(3)}) + 100 nF`]);
      rows.push(['ADC reads at 4.2 V / 3.0 V', `${fmt(4.2 * p.ratio, 'V', 3)} / ${fmt(3.0 * p.ratio, 'V', 3)} of ${fmt(v.adcFs, 'V')}`]);
      rows.push(['Divider drain', v.mon === MON[2] ? '≈ 0 µA when off (P-MOSFET switch, enable with VBAT_EN high)' : `${fmt(4.2 / (p.r1 + p.r2), 'A')} — ${(4.2 / (p.r1 + p.r2) * 8760 / (v.cap / 1000)).toFixed(1)} % of the cell per year`]);
    } else if (v.mon === MON[3]) {
      rows.push(['__h', 'INA219']);
      rows.push(['Measures', 'system current through its 0.1 Ω shunt (±3.2 A) and the bus voltage, over I²C (0x40)']);
    }
    const warns = [];
    if (p.info.chem.short !== 'Li-ion') warns.push(`This designer is for single Li-ion / LiPo cells (4.2 V). ${p.info.chemName} needs a different charger.`);
    if ((v.series || 1) > 1) warns.push('Multi-cell packs need a balancing charger — the TP4056 / TP4054 charge one cell only.');
    if (p.want < (v.cap / 1000) * v.crate - 1e-6) warns.push(`The requested ${fmt((v.cap / 1000) * v.crate, 'A')} is above the ${fmt(p.imax, 'A')} this IC can deliver.`);
    if (p.ich > 0.5 && v.input !== '5 V pads') warns.push(`${fmt(p.ich, 'A')} is above the 500 mA a computer USB 2.0 port must supply; most wall chargers are fine.`);
    if (pStart > 1) warns.push(`Up to ${fmt(pStart, 'W')} of heat in the charger — give it copper area or lower the current (the IC reduces current itself above ≈ 120 °C).`);
    if (v.share.startsWith('Load on')) warns.push('Without load sharing the charger sees battery + load current, so it may never finish (it waits for the current to fall to C/10).');
    return { main: ['Charge current', `${fmt(p.ich, 'A')} · ≈ ${life(tCh)}`], rows, warns, insert: () => chargerTemplate(v, p), measure: 'V', note: 'Insert adds the circuit with net labels (VBUS, BAT, VSYS, CHG, STDBY, VBAT_ADC …) so it joins nets of the same name in your design. V_USB and S_USB are simulation-only.' };
  },
};

function chargerTemplate(v, p) {
  const B = builder('charger');
  const { put, lab, gnd, shunt, between, vert } = B;
  // USB input (simulation source + switch) and connector
  const vu = put('vdc', 0, 120, { volts: '5', rint: '0.1' }); gnd(vu, 1);
  const sw = put('switch', 80, 60, { closed: true }); addWire(B.d, { c: vu.id, p: 0 }, { c: sw.id, p: 0 }); lab(sw, 1, 'VBUS');
  vu.ref = 'V_USB'; sw.ref = 'S_USB';
  if (v.input !== '5 V pads') {
    const usbc = v.input === 'USB-C';
    const j = put('ic', 320, 120, {}, 0, usbc ? 'USB-C receptacle' : 'Micro-USB receptacle');
    lab(j, 'VBUS', 'VBUS'); gnd(j, 'GND'); gnd(j, 'SHELL');
    if (usbc) { lab(j, 'CC1', 'CC1'); lab(j, 'CC2', 'CC2'); shunt('resistor', 540, 110, 5.1e3, 'CC1'); shunt('resistor', 640, 110, 5.1e3, 'CC2'); }
  }
  shunt('capacitor', 760, 110, 10e-6, 'VBUS');
  // charger
  const ic = put('ic', 320, 380, {}, 0, p.tp56 ? 'TP4056' : 'TP4054');
  lab(ic, 'VCC', 'VBUS'); lab(ic, 'BAT', 'BAT'); gnd(ic, 'GND'); lab(ic, 'PROG', 'PROG');
  shunt('resistor', 560, 380, p.rProg, 'PROG');
  if (p.tp56) {
    lab(ic, 'CE', 'VBUS');
    if (v.ntc.startsWith('10')) { lab(ic, 'TEMP', 'TEMP'); vert('resistor', 660, 340, p.rT, 'VBUS', 'TEMP'); shunt('resistor', 660, 440, 10e3, 'TEMP'); }
    else gnd(ic, 'TEMP');
  }
  const stat = [['CHRG', 'CHG', 'red']].concat(p.tp56 ? [['STDBY', 'STDBY', 'green']] : []);
  stat.forEach(([pn, net, col], i) => {
    lab(ic, pn, net);
    if (v.status.startsWith('LEDs')) { vert('resistor', 820 + i * 110, 330, 1.5e3, 'VBUS', net + '_LED'); const l = put('led', 820 + i * 110, 430, { color: col }, 1); lab(l, 0, net + '_LED'); lab(l, 1, net); }
  });
  shunt('capacitor', 1060, 380, 10e-6, 'BAT');
  // battery (+ optional protection in the negative lead)
  const addProt = v.prot.startsWith('Add');
  const bt = put('battery', 0, 640, { chem: 'Li-ion / LiPo', cap: String(Math.round(v.cap)), soc: '60', prot: true });
  bt.ref = 'BT1';
  lab(bt, '+', 'BAT');
  if (addProt) {
    lab(bt, '−', 'B−');
    const dw = put('ic', 320, 660, {}, 0, 'DW01A');
    lab(dw, 'VCC', 'DW_VCC'); lab(dw, 'GND', 'B−'); lab(dw, 'OD', 'OD'); lab(dw, 'OC', 'OC'); lab(dw, 'CS', 'CS');
    between('resistor', 560, 600, 100, 'BAT', 'DW_VCC');
    const cdw = put('capacitor', 700, 650, { value: '100n' }, 1); lab(cdw, 0, 'DW_VCC'); lab(cdw, 1, 'B−');
    between('resistor', 560, 700, 1e3, 'CS', 'GND');
    const fs = put('ic', 900, 660, {}, 0, 'FS8205A');
    getPins(fs).forEach((pp, i) => { if (pp.name === 'S1') lab(fs, i, 'B−'); else if (pp.name === 'S2') lab(fs, i, 'GND'); else if (pp.name === 'G1') lab(fs, i, 'OD'); else if (pp.name === 'G2') lab(fs, i, 'OC'); });
  } else gnd(bt, '−');
  // load sharing
  const sys = v.share.startsWith('System') ? 'VSYS' : 'BAT';
  if (sys === 'VSYS') {
    between('schottky', 120, 900, null, 'VBUS', 'VSYS_IN', { part: '1N5819' });
    const q = put('pmos', 360, 900, { part: 'AO3401' }, 0, 'AO3401'); lab(q, 'G', 'VBUS'); lab(q, 'D', 'BAT'); lab(q, 'S', 'VSYS_IN');
    shunt('resistor', 520, 900, 100e3, 'VBUS');
    shunt('capacitor', 620, 900, 10e-6, 'VSYS_IN');
  }
  const railIn = sys === 'VSYS' ? 'VSYS_IN' : 'BAT';
  // monitoring
  if (v.mon === MON[3]) {
    const ina = put('ic', 1000, 900, {}, 0, 'INA219 module');
    lab(ina, 'VIN+', railIn); lab(ina, 'VIN−', 'VSYS'); lab(ina, 'VCC', '3V3'); gnd(ina, 'GND'); lab(ina, 'SDA', 'SDA'); lab(ina, 'SCL', 'SCL');
  } else if (sys === 'VSYS') {
    // join VSYS_IN to the VSYS net with a label pair so the user's regulator connects to VSYS
    const l = put('netlabel', 760, 960, { name: 'VSYS' }); const l2 = put('netlabel', 700, 960, { name: 'VSYS_IN' }); l2.flip = true; addWire(B.d, { c: l2.id, p: 0 }, { c: l.id, p: 0 });
  }
  if (v.mon === MON[1]) {
    vert('resistor', 1200, 600, p.r1, 'BAT', 'VBAT_ADC'); shunt('resistor', 1200, 720, p.r2, 'VBAT_ADC'); shunt('capacitor', 1300, 720, 100e-9, 'VBAT_ADC');
  } else if (v.mon === MON[2]) {
    const qp = put('pmos', 1180, 560, { part: 'AO3401' }, 0, 'AO3401'); lab(qp, 'S', 'BAT'); lab(qp, 'D', 'DIV_TOP'); lab(qp, 'G', 'DIV_G');
    vert('resistor', 1340, 520, 100e3, 'BAT', 'DIV_G');
    const qn = put('nmos', 1340, 660, { part: 'BSS138' }, 0, 'BSS138'); lab(qn, 'D', 'DIV_G'); lab(qn, 'G', 'VBAT_EN'); gnd(qn, 'S');
    shunt('resistor', 1500, 680, 100e3, 'VBAT_EN');
    vert('resistor', 1200, 780, p.r1, 'DIV_TOP', 'VBAT_ADC'); shunt('resistor', 1200, 900, p.r2, 'VBAT_ADC'); shunt('capacitor', 1300, 900, 100e-9, 'VBAT_ADC');
  }
  // references: keep auto numbering but name the simulation helpers
  return { d: B.d, inRef: { c: bt.id, p: 0 }, outRef: { c: bt.id, p: 0 } };
}
