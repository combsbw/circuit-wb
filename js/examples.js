// Built-in example circuits.
import { newDesign, makeComp, addWire, pinPos } from './doc.js';
import { getPins } from './library.js';
import { TEMPLATES } from './tools.js';

function put(d, type, x, y, props = {}, rot = 0, part, flip = false) {
  const c = makeComp(d, type, part, x, y);
  c.rot = rot; c.flip = flip;
  Object.assign(c.props, props);
  d.comps.push(c);
  return c;
}
const pin = (c, name) => (typeof name === 'number' ? name : getPins(c).findIndex((p) => p.name === name));
const W = (d, a, pa, b, pb) => addWire(d, { c: a.id, p: pin(a, pa) }, { c: b.id, p: pin(b, pb) });
/** Net label on a pin, placed 20 units outward (to the left or right). */
function lab(d, c, pinName, name) {
  const i = pin(c, pinName);
  const [x, y] = pinPos(c, i);
  const left = x < c.x;
  const l = put(d, 'netlabel', x + (left ? -20 : 20), y, { name }, 0, undefined, left);
  addWire(d, { c: c.id, p: i }, { c: l.id, p: 0 });
  return l;
}

export const EXAMPLES = [
  {
    name: 'Voltage divider + LED', desc: '9 V battery, 10k/4.7k divider and an LED indicator',
    build() {
      const d = newDesign('Voltage divider + LED');
      const v = put(d, 'vdc', 0, 60, { volts: '9' });
      const g0 = put(d, 'ground', 0, 120); W(d, v, 1, g0, 0);
      const r1 = put(d, 'resistor', 80, 30, { value: '10k' }, 1);
      const r2 = put(d, 'resistor', 80, 110, { value: '4.7k' }, 1);
      const g1 = put(d, 'ground', 80, 160);
      W(d, v, 0, r1, 0); W(d, r1, 1, r2, 0); W(d, r2, 1, g1, 0);
      const r3 = put(d, 'resistor', 150, 0, { value: '470' });
      const led = put(d, 'led', 210, 30, { color: 'red' }, 1);
      const g2 = put(d, 'ground', 210, 90);
      W(d, r1, 0, r3, 0); W(d, r3, 1, led, 0); W(d, led, 1, g2, 0);
      lab(d, r2, 0, 'VOUT');
      return d;
    },
  },
  {
    name: 'RC low-pass filter', desc: '1 kΩ / 159 nF — f−3dB ≈ 1 kHz. Try Measure → Freq. response',
    build() {
      const t = TEMPLATES.ladder(['R'], ['C'], { R: 1e3, C: 159e-9, L: 1e-3 });
      t.d.name = 'RC low-pass filter';
      return t.d;
    },
  },
  {
    name: 'Twin-T notch filter', desc: '10 kΩ / 15.9 nF — null at ≈ 1 kHz',
    build() { const t = TEMPLATES.twinT({ R: 10e3, C: 15.9e-9 }); t.d.name = 'Twin-T notch filter'; return t.d; },
  },
  {
    name: 'Sallen-Key low-pass (TL072)', desc: 'Unity-gain 2nd-order active filter on ±12 V rails',
    build() {
      const d = newDesign('Sallen-Key low-pass');
      const s = put(d, 'vac', 0, 60, { amp: '1', freq: '1k' });
      const g0 = put(d, 'ground', 0, 120); W(d, s, 1, g0, 0);
      const r1 = put(d, 'resistor', 60, 0, { value: '10k' });
      const r2 = put(d, 'resistor', 150, 0, { value: '10k' });
      W(d, s, 0, r1, 0); W(d, r1, 1, r2, 0);
      const u = put(d, 'opamp', 260, 10, {}, 0, 'TL072');
      W(d, r2, 1, u, '+');
      const c2 = put(d, 'capacitor', 190, 40, { value: '10n' }, 1);
      const g1 = put(d, 'ground', 190, 90);
      W(d, c2, 0, r2, 1); W(d, c2, 1, g1, 0);
      const c1 = put(d, 'capacitor', 200, -80, { value: '22n' });
      W(d, c1, 0, r1, 1); W(d, c1, 1, u, 'OUT');
      // unity-gain feedback routed under the op-amp
      const j1 = { id: 'jfb1' + Date.now(), x: 210, y: 80 }, j2 = { id: 'jfb2' + Date.now(), x: 320, y: 80 };
      d.juncs.push(j1, j2);
      addWire(d, { c: u.id, p: pin(u, '−') }, { j: j1.id });
      addWire(d, { j: j1.id }, { j: j2.id });
      addWire(d, { j: j2.id }, { c: u.id, p: pin(u, 'OUT') });
      const vp = put(d, 'rail', 260, -30, { volts: '12', name: '+12V' }); W(d, vp, 0, u, 'V+');
      const vn = put(d, 'rail', 260, 60, { volts: '-12', name: '-12V' }, 2); W(d, vn, 0, u, 'V−');
      lab(d, u, 'OUT', 'OUT');
      return d;
    },
  },
  {
    name: 'ESP32-S3 → TC4420 → MOSFET', desc: 'GPIO drives a 6 A gate driver switching a 12 V load',
    build() {
      const d = newDesign('ESP32-S3 gate drive');
      const esp = put(d, 'ic', 0, 0, {}, 0, 'ESP32-S3 SuperMini');
      esp.props.gpio = { IO13: 'high' };
      lab(d, esp, '5V', '+5V'); lab(d, esp, 'GND', 'GND'); lab(d, esp, 'IO13', 'PWM');
      const reg = put(d, 'reg', 300, -200, {}, 0, '7805');
      const r12 = put(d, 'rail', 230, -200, { volts: '12', name: '+12V' }); W(d, r12, 0, reg, 'IN');
      const gr = put(d, 'ground', 300, -140); W(d, reg, 'GND', gr, 0);
      lab(d, reg, 'OUT', '+5V');
      const cin = put(d, 'capacitor', 250, -150, { value: '330n' }, 1); W(d, cin, 0, reg, 'IN'); const gc = put(d, 'ground', 250, -110); W(d, cin, 1, gc, 0);
      const drv = put(d, 'ic', 300, 0, {}, 0, 'TC4420');
      lab(d, drv, 0, '+12V'); lab(d, drv, 'IN', 'PWM'); lab(d, drv, 3, 'GND');
      const rg = put(d, 'resistor', 410, -10, { value: '10' });
      W(d, drv, 6, rg, 0);
      const q = put(d, 'nmos', 480, -10, {}, 0, 'IRFZ44N');
      W(d, rg, 1, q, 'G');
      const rpd = put(d, 'resistor', 450, 40, { value: '10k' }, 1); W(d, q, 'G', rpd, 0);
      const g1 = put(d, 'ground', 450, 90); W(d, rpd, 1, g1, 0);
      const g2 = put(d, 'ground', 490, 90); W(d, q, 'S', g2, 0);
      const rl = put(d, 'resistor', 490, -80, { value: '12', power: '25' }, 1); W(d, q, 'D', rl, 1);
      const r12b = put(d, 'rail', 490, -130, { volts: '12', name: '+12V' }); W(d, r12b, 0, rl, 0);
      return d;
    },
  },
  {
    name: 'IR2110 half-bridge', desc: 'Bootstrap high/low-side driver on a 48 V bus — toggle HIN/LIN in Measure mode',
    build() {
      const d = newDesign('IR2110 half-bridge');
      const u = put(d, 'ic', 0, 0, {}, 0, 'IR2110');
      lab(d, u, 'LO', 'LO'); lab(d, u, 'COM', 'GND'); lab(d, u, 'VCC', '+12V'); lab(d, u, 'VS', 'SW'); lab(d, u, 'VB', 'VB'); lab(d, u, 'HO', 'HO');
      lab(d, u, 'VSS', 'GND'); lab(d, u, 'LIN', 'LIN'); lab(d, u, 'SD', 'GND'); lab(d, u, 'HIN', 'HIN'); lab(d, u, 'VDD', '+5V');
      // power stage
      const q1 = put(d, 'nmos', -300, -80, {}, 0, 'IRF540N');
      const q2 = put(d, 'nmos', -300, 60, {}, 0, 'IRF540N');
      const bus = put(d, 'rail', -290, -140, { volts: '48', name: '+48V' }); W(d, bus, 0, q1, 'D');
      W(d, q1, 'S', q2, 'D');
      const g = put(d, 'ground', -290, 120); W(d, q2, 'S', g, 0);
      const rg1 = put(d, 'resistor', -380, -80, { value: '10' }); W(d, rg1, 1, q1, 'G'); lab(d, rg1, 0, 'HO');
      const rg2 = put(d, 'resistor', -380, 60, { value: '10' }); W(d, rg2, 1, q2, 'G'); lab(d, rg2, 0, 'LO');
      const rl = put(d, 'resistor', -200, 60, { value: '24', power: '100' }, 1); W(d, q2, 'D', rl, 0);
      const g2 = put(d, 'ground', -200, 110); W(d, rl, 1, g2, 0);
      lab(d, rl, 0, 'SW');
      // bootstrap
      const v12 = put(d, 'rail', -110, 160, { volts: '12', name: '+12V' });
      const db = put(d, 'diode', -60, 160, {}, 0, 'UF4007'); W(d, v12, 0, db, 'A');
      const cb = put(d, 'capacitor', 0, 190, { value: '1u' }, 1); W(d, db, 'K', cb, 0);
      lab(d, cb, 0, 'VB'); lab(d, cb, 1, 'SW');
      // logic: SPDT switches select +5V or GND for HIN / LIN
      const v5 = put(d, 'rail', 260, -120, { volts: '5', name: '+5V' }); void v5;
      const s1 = put(d, 'spdt', 220, -40, { pos: true }, 0, undefined, true);
      const s2 = put(d, 'spdt', 220, 40, { pos: false }, 0, undefined, true);
      for (const [s, name] of [[s1, 'HIN'], [s2, 'LIN']]) { lab(d, s, 'COM', name); lab(d, s, 'A', '+5V'); lab(d, s, 'B', 'GND'); }
      return d;
    },
  },
  {
    name: 'BLE IMU + magnetometer tag (from photos)', desc: 'nRF52832 + LSM6DS3 + QMC5883P, USB-C + LiPo charging, PCB antenna — reconstructed, verify before building',
    file: './examples/ble-tag-board.cwb.json',
    build() { return newDesign('BLE IMU + magnetometer tag'); },
  },
  {
    name: 'ESP32-S3 IMU + magnetometer tag', desc: 'ESP32-S3-WROOM-1 + LSM6DS3 + QMC5883P, USB-C with ESD, TP4054 charging, USB/battery load sharing, AP2112K — redesign of the BLE tag',
    file: './examples/esp32s3-imu-mag.cwb.json',
    build() { return newDesign('ESP32-S3 IMU + magnetometer tag'); },
  },
];
