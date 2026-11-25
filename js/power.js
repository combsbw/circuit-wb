// Power budget: per-component power from the DC simulation (whole circuit, selection or a board),
// plus a duty-cycle battery-life planner. Used as a custom tab in the Calculators dialog.
import { TYPES, ICS, PARTS } from './library.js';
import { fmt, parseEng } from './units.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (x, d = 0) => { const v = parseEng(x); return Number.isFinite(v) ? v : d; };
const SOURCES = new Set(['vdc', 'vac', 'idc', 'rail']);
const SKIP = new Set(['netlabel', 'ground']);

/** Typical active / sleep currents for parts the planner knows (A). Matched against the part name. */
export const POWER_HINTS = [
  [/ESP32-S3-WROOM|ESP32-S3/i, { active: 0.08, peak: 0.35, sleep: 8e-6, duty: 100, note: 'Wi-Fi on ≈ 80 mA avg (350 mA TX peaks); BLE only ≈ 30–60 mA; deep sleep ≈ 8 µA' }],
  [/ESP32-C3/i, { active: 0.06, peak: 0.33, sleep: 5e-6, duty: 100, note: 'Wi-Fi ≈ 60 mA avg; deep sleep ≈ 5 µA' }],
  [/ESP32/i, { active: 0.09, peak: 0.4, sleep: 10e-6, duty: 100, note: 'Wi-Fi ≈ 90 mA avg; deep sleep ≈ 10 µA (plus board LDO / USB chip)' }],
  [/nRF52/i, { active: 5.3e-3, peak: 7e-3, sleep: 1.9e-6, duty: 2, note: 'radio TX 0 dBm ≈ 5.3 mA; system-ON sleep ≈ 1.9 µA; BLE connection ≈ 1–3 % duty' }],
  [/Arduino Nano/i, { active: 0.02, sleep: 6e-3, duty: 100, note: 'ATmega328 + USB chip + LED: board never drops below a few mA' }],
  [/LSM6DS3/i, { active: 0.9e-3, sleep: 6e-6, duty: 100, note: 'accel + gyro high performance 0.9 mA; accel only low power ≈ 25 µA' }],
  [/QMC5883P/i, { active: 0.2e-3, sleep: 3e-6, duty: 100, note: 'continuous mode, depends on ODR / oversampling' }],
  [/QMC5883L|HMC5883L/i, { active: 0.1e-3, sleep: 3e-6, duty: 100 }],
  [/MPU-6050/i, { active: 3.9e-3, sleep: 5e-6, duty: 100 }],
  [/ADXL345/i, { active: 0.14e-3, sleep: 0.1e-6, duty: 100 }],
  [/ADXL335/i, { active: 0.35e-3, sleep: 0.35e-3, duty: 100 }],
  [/ADS1115/i, { active: 0.15e-3, sleep: 0.5e-6, duty: 100 }],
  [/ADS1220/i, { active: 0.42e-3, sleep: 0.1e-6, duty: 100 }],
  [/ADS1256/i, { active: 38e-3, sleep: 30e-6, duty: 100 }],
  [/DS18B20/i, { active: 1e-3, sleep: 0.75e-6, duty: 10, note: 'converts ≈ 750 ms, then idles' }],
  [/Si5351/i, { active: 20e-3, sleep: 20e-3, duty: 100 }],
  [/MCP1700/i, { active: 1.6e-6, sleep: 1.6e-6, duty: 100, note: 'quiescent current' }],
  [/AP2112/i, { active: 55e-6, sleep: 55e-6, duty: 100, note: 'quiescent current' }],
  [/ME6211/i, { active: 40e-6, sleep: 40e-6, duty: 100, note: 'quiescent current' }],
  [/AMS1117/i, { active: 5e-3, sleep: 5e-3, duty: 100, note: 'quiescent current — poor for batteries' }],
  [/TLV7011/i, { active: 0.335e-6, sleep: 0.335e-6, duty: 100 }],
  [/MCP6561/i, { active: 100e-6, sleep: 100e-6, duty: 100 }],
];
export function hintFor(name) { const h = POWER_HINTS.find(([re]) => re.test(name || '')); return h ? h[1] : null; }

const partName = (c) => c.props?.part || TYPES[c.type]?.name || c.type;

/** Power of every component at the DC operating point. P > 0 absorbs, P < 0 delivers. */
export function componentPowers(ckt, doc) {
  const rows = [];
  for (const c of doc.comps) {
    if (SKIP.has(c.type) || !TYPES[c.type]) continue;
    const I = ckt.pinI.get(c.id);
    if (!I) continue;
    let p = 0, iMax = 0;
    I.forEach((i, k) => { const v = ckt.pinV(c.id, k); if (Number.isFinite(v)) p += v * i; iMax = Math.max(iMax, Math.abs(i)); });
    const two = I.length === 2;
    const vAcross = two ? ckt.pinV(c.id, 0) - ckt.pinV(c.id, 1) : null;
    // supply current: current flowing into the most positive pin (ICs) or through the part (2-pin)
    let iSup = two ? Math.abs(I[0]) : 0;
    if (!two) { let best = -Infinity; I.forEach((i, k) => { const v = ckt.pinV(c.id, k); if (i > 0 && v > best) { best = v; iSup = i; } }); }
    const rating = c.type === 'resistor' ? num(c.props.power, 0.25) : null;
    rows.push({ c, id: c.id, ref: c.ref, part: partName(c), source: SOURCES.has(c.type), p, vAcross, iSup, iMax, rating });
  }
  return rows;
}

// ---------------------------------------------------------------- UI (custom calculator tab)
const st = { scope: 'all' };
export function setPowerScope(s) { st.scope = s; }
function scopeIds(app) {
  const doc = app.doc;
  if (st.scope === 'sel') return new Set(app.sel.comps);
  if (st.scope.startsWith('board:')) { const b = (doc.boards || []).find((x) => x.id === st.scope.slice(6)); return new Set(b ? b.compIds : []); }
  return null;
}
const fW = (w) => (Math.abs(w) < 1e-9 ? '0 W' : fmt(w, 'W', 3));
const fA = (a) => (Math.abs(a) < 1e-12 ? '0 A' : fmt(a, 'A', 3));

function plannerRows(app, sim, all, scoped) {
  const doc = app.doc;
  const saved = (doc.power ||= { rows: {}, extra: [], cap: 100, vbat: 3.7, usable: 80, reg: 'Linear (battery current = load current)', eff: 85, vload: 3.3 });
  saved.rows ||= {}; saved.extra ||= [];
  const rows = [];
  const loads = sim.filter((r) => !r.source && r.p > 1e-7 && ['ic', 'reg', 'led', 'opamp'].includes(r.c.type));
  for (const r of loads) {
    const isReg = r.c.type === 'reg';
    const iq = isReg ? (PARTS[r.c.props.part]?.iq ?? 0) : 0;
    const h = hintFor(r.part) || {};
    const sv = saved.rows[r.id] || {};
    const simI = isReg ? iq : r.iSup;
    rows.push({ key: r.id, name: `${r.ref} ${r.part}`, sim: simI, active: sv.active ?? (isReg ? iq : h.active ?? simI), sleep: sv.sleep ?? (isReg ? iq : h.sleep ?? simI), duty: sv.duty ?? (isReg ? 100 : h.duty ?? 100), note: isReg ? 'quiescent current — the load current through it is counted with each load' : h.note || '', peak: h.peak });
  }
  if (!scoped) {
    // whatever the sources deliver that the rows above do not explain: dividers, pull-ups, bias networks, leakage
    const src = all.filter((r) => r.source && r.p < 0 && r.c.type !== 'rail').reduce((s, r) => s + r.iMax, 0) || all.filter((r) => r.source && r.p < 0).reduce((s, r) => s + r.iMax, 0);
    const rest = Math.max(0, src - rows.reduce((s, r) => s + r.sim, 0));
    if (rest > 1e-9) { const sv = saved.rows.__rest || {}; rows.push({ key: '__rest', name: 'Rest of the circuit (dividers, pull-ups, bias, LEDs off-list)', sim: rest, active: sv.active ?? rest, sleep: sv.sleep ?? rest, duty: sv.duty ?? 100, note: 'source current not explained by the parts above' }); }
  }
  for (const [i, x] of saved.extra.entries()) rows.push({ key: 'x' + i, extra: i, name: x.name || 'Extra load', sim: null, active: x.active ?? 0, sleep: x.sleep ?? 0, duty: x.duty ?? 100, note: '' });
  return { rows, saved };
}

function render(app) {
  const doc = app.doc;
  if (!app.ckt || !app.ckt.op) { try { app.runSim(); } catch { /* ignore */ } }
  const ckt = app.ckt;
  let h = `<div class="hint">Power from the live DC simulation (P = V × I at every pin), for the whole circuit, your selection or one board — then a battery-life planner for parts that sleep, transmit in bursts or use PWM. <span class="lnk" data-ref="theory-batteries-power-budget">How this works</span></div>`;
  const scopes = [['all', 'Whole circuit']];
  if (app.sel.comps.size) scopes.push(['sel', `Selected (${app.sel.comps.size})`]);
  for (const b of doc.boards || []) scopes.push(['board:' + b.id, b.name]);
  if (!scopes.some((s) => s[0] === st.scope)) st.scope = 'all';
  h += `<div class="pchips">${scopes.map(([k, n]) => `<button class="chip ${st.scope === k ? 'on' : ''}" data-scope="${esc(k)}">${esc(n)}</button>`).join('')}</div>`;
  if (!ckt || !ckt.op) return h + `<div class="note">The simulation has no operating point yet — add a source and finish the wiring, then come back.</div>`;
  const all = componentPowers(ckt, doc);
  const ids = scopeIds(app);
  const inScope = ids ? all.filter((r) => ids.has(r.id)) : all;
  const loads = inScope.filter((r) => !r.source).sort((a, b) => b.p - a.p);
  const srcs = all.filter((r) => r.source);
  const supplied = srcs.reduce((s, r) => s + Math.max(0, -r.p), 0);
  const absorbed = all.filter((r) => !r.source).reduce((s, r) => s + Math.max(0, r.p), 0);
  const scopeTotal = loads.reduce((s, r) => s + r.p, 0);
  h += `<div class="res"><div class="t2" style="color:var(--muted);font-size:13px">${ids ? 'Power used by ' + esc(scopes.find((s) => s[0] === st.scope)[1]) : 'Total power drawn from the sources'}</div><div class="big">${fW(ids ? scopeTotal : supplied)}</div>`;
  h += `<dl class="kv"><dt class="sec">Sources</dt>`;
  for (const r of srcs) { if (Math.abs(r.p) < 1e-6) continue; h += `<dt>${esc(r.ref || r.c.props.name || r.part)} ${esc(r.c.type === 'rail' ? r.c.props.name : '')}</dt><dd>${r.p <= 0 ? 'delivers' : 'absorbs (charging)'} ${fW(Math.abs(r.p))} · ${fA(r.iMax)}</dd>`; }
  h += `<dt>Dissipated in the circuit</dt><dd>${fW(absorbed)}${supplied > 0 ? ` (${((absorbed / supplied) * 100).toFixed(0)} % of supplied)` : ''}</dd></dl>`;
  const maxP = Math.max(1e-12, ...loads.map((r) => Math.abs(r.p)));
  const shown = loads.filter((r) => Math.abs(r.p) >= 1e-7), tiny = loads.length - shown.length;
  h += `<div class="rtw"><table class="rt pwt"><thead><tr><th>Part</th><th>Power</th><th></th><th>Current</th><th>Voltage</th><th>Share</th></tr></thead><tbody>`;
  for (const r of shown) {
    const over = r.rating && r.p > r.rating * 0.7;
    h += `<tr class="${over ? 'hot' : ''}" data-cid="${r.id}"><td>${esc(r.ref)} <small>${esc(r.part)}</small></td><td>${fW(r.p)}${r.rating ? `<div class="t2">${((r.p / r.rating) * 100).toFixed(0)} % of ${fmt(r.rating, 'W')}</div>` : ''}</td><td class="bar"><i style="width:${Math.max(2, (Math.abs(r.p) / maxP) * 100).toFixed(1)}%"></i></td><td>${fA(r.iSup)}</td><td>${r.vAcross != null ? fmt(r.vAcross, 'V', 3) : ''}</td><td>${scopeTotal > 0 ? ((r.p / scopeTotal) * 100).toFixed(1) + ' %' : ''}</td></tr>`;
  }
  h += `</tbody></table></div>${tiny ? `<div class="hint">${tiny} part${tiny === 1 ? '' : 's'} below 0.1 µW not listed.</div>` : ''}`;
  const hot = shown.filter((r) => r.rating && r.p > r.rating * 0.7);
  if (hot.length) h += `<ul class="cw">${hot.map((r) => `<li>${esc(r.ref)} dissipates ${fW(r.p)} — ${r.p > r.rating ? 'above' : 'close to'} its ${fmt(r.rating, 'W')} rating. Use a bigger resistor or less current.</li>`).join('')}</ul>`;
  h += `</div>`;
  // ---- planner
  const { rows, saved } = plannerRows(app, ids ? all.filter((r) => ids.has(r.id)) : all, all, !!ids);
  const linear = saved.reg.startsWith('Linear');
  let avg = 0, act = 0, slp = 0, peak = 0;
  for (const r of rows) { const a = num(r.active), s = num(r.sleep), d = Math.min(100, Math.max(0, num(r.duty, 100))) / 100; avg += a * d + s * (1 - d); act += a; slp += s; peak += r.peak ?? a; }
  const ibat = linear ? avg : (avg * saved.vload) / ((saved.eff / 100) * saved.vbat);
  const usable = (saved.cap * saved.usable) / 100;
  const hours = ibat > 0 ? usable / 1000 / ibat : Infinity;
  const life = hours > 48 ? `${(hours / 24).toFixed(hours > 240 ? 0 : 1)} days` : `${hours.toFixed(1)} h`;
  h += `<div class="sec">Battery-life planner</div><div class="hint">Currents start from the simulation and typical datasheet figures; edit them for your firmware. "% active" is the share of time a part is awake (a BLE radio is often 1–3 %, a streaming IMU 100 %).</div>`;
  h += `<div class="pwbat">
    <label>Capacity <input class="inp" data-pw="cap" value="${esc(saved.cap)}"> mAh</label>
    <label>Cell voltage <input class="inp" data-pw="vbat" value="${esc(saved.vbat)}"> V</label>
    <label>Usable <input class="inp" data-pw="usable" value="${esc(saved.usable)}"> %</label>
    <label>Regulator <select class="inp" data-pw="reg">${['Linear (battery current = load current)', 'Switching (power conversion)'].map((o) => `<option ${o === saved.reg ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
    ${linear ? '' : `<label>Efficiency <input class="inp" data-pw="eff" value="${esc(saved.eff)}"> %</label><label>Load voltage <input class="inp" data-pw="vload" value="${esc(saved.vload)}"> V</label>`}
  </div>`;
  h += `<div class="rtw"><table class="rt pwplan"><thead><tr><th>Load</th><th>Active</th><th>Sleep</th><th>% active</th><th>Average</th></tr></thead><tbody>`;
  for (const r of rows) {
    const a = num(r.active), s = num(r.sleep), d = Math.min(100, Math.max(0, num(r.duty, 100))) / 100;
    h += `<tr data-key="${esc(r.key)}"><td>${r.extra != null ? `<input class="inp" data-f="name" value="${esc(r.name)}">` : esc(r.name)}${r.note ? `<div class="t2">${esc(r.note)}</div>` : ''}</td>
      <td><input class="inp" data-f="active" value="${esc(fmt(a, 'A', 3))}"></td><td><input class="inp" data-f="sleep" value="${esc(fmt(s, 'A', 3))}"></td>
      <td><input class="inp" data-f="duty" value="${esc(+num(r.duty, 100).toFixed(3))}"></td><td>${fA(a * d + s * (1 - d))}${r.extra != null ? ` <button class="ib" data-rmx="${r.extra}" title="Remove">×</button>` : ''}</td></tr>`;
  }
  h += `</tbody></table></div><div class="actions"><button class="btn small" data-pwadd="1">+ Add a load</button><button class="btn small" data-pwreset="1">Reset to simulation</button></div>`;
  h += `<div class="res"><div class="t2" style="color:var(--muted);font-size:13px">Estimated battery life</div><div class="big">${ibat > 0 ? life : '—'}</div><dl class="kv">
    <dt>Average current${linear ? '' : ' (load side)'}</dt><dd>${fA(avg)}</dd>${linear ? '' : `<dt>Average battery current</dt><dd>${fA(ibat)}</dd>`}
    <dt>Everything awake</dt><dd>${fA(act)} → ${act > 0 ? (usable / 1000 / act).toFixed(1) + ' h' : '—'}</dd>
    <dt>Everything asleep</dt><dd>${fA(slp)} → ${slp > 0 ? ((usable / 1000 / slp) / 24).toFixed(0) + ' days' : '—'}</dd>
    <dt>Peak (bursts)</dt><dd>${fA(peak)} — size the regulator and battery for this</dd>
    <dt>Average power</dt><dd>${fW(ibat * saved.vbat)} · ${fmt(ibat * saved.vbat * 24, 'Wh', 3)} per day</dd></dl></div>`;
  return h;
}

export const powerCalc = {
  id: 'power', name: 'Power budget', theory: 'theory-batteries-power-budget', inputs: [],
  custom: {
    render,
    bind(el, app, rerender) {
      const doc = app.doc;
      const save = () => { app.dirty = true; app._updateTitle?.(); app.saveSession?.(); rerender(); };
      el.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => { st.scope = b.dataset.scope; rerender(); }));
      el.querySelectorAll('[data-pw]').forEach((i) => i.addEventListener('change', () => { const k = i.dataset.pw; doc.power[k] = k === 'reg' ? i.value : num(i.value, doc.power[k]); save(); }));
      el.querySelectorAll('tr[data-key] input').forEach((i) => i.addEventListener('change', () => {
        const key = i.closest('tr').dataset.key, f = i.dataset.f;
        const val = f === 'name' ? i.value : f === 'duty' ? num(i.value, 100) : num(i.value, 0);
        if (key.startsWith('x')) { doc.power.extra[+key.slice(1)][f] = val; } else { (doc.power.rows[key] ||= {})[f] = val; }
        save();
      }));
      el.querySelectorAll('[data-rmx]').forEach((b) => b.addEventListener('click', () => { doc.power.extra.splice(+b.dataset.rmx, 1); save(); }));
      el.querySelector('[data-pwadd]')?.addEventListener('click', () => { doc.power.extra.push({ name: 'Extra load', active: 1e-3, sleep: 0, duty: 100 }); save(); });
      el.querySelector('[data-pwreset]')?.addEventListener('click', () => { doc.power.rows = {}; save(); });
      el.querySelectorAll('tr[data-cid]').forEach((tr) => tr.addEventListener('click', () => { app.select({ comps: [tr.dataset.cid] }); }));
    },
  },
};
