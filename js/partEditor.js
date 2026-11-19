// Custom part / board editor: define any MCU board, module or IC pinout and keep it in the on-device library.
import { ICS, registerCustomPart, unregisterCustomPart, splitPins, drawSymbol, getBBox, invalidateIc } from './library.js';
import { store } from './store.js';
import { icon } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CATS = ['MCU boards', 'Sensors', 'ADCs', 'Signal sources', 'ICs'];

export async function loadCustomParts() {
  const list = (await store.getState('customParts').catch(() => null)) || [];
  for (const d of list) registerCustomPart(d);
  return list;
}
async function saveList() {
  const list = Object.values(ICS).filter((d) => d.custom).map(serial);
  await store.putState('customParts', list);
}
function serial(d) {
  const o = {};
  for (const k of ['name', 'cat', 'desc', 'pkg', 'layout', 'left', 'right', 'pins', 'isMcu', 'vlogic', 'vinPin', 'railPin', 'gndPin', 'loadmA', 'notes', 'specs', 'rowSpacing']) if (d[k] != null) o[k] = d[k];
  return o;
}
/** Custom definitions used by a design (embedded on save/export so the file is portable). */
export function customDefsFor(doc) {
  const names = new Set(doc.comps.filter((c) => c.type === 'ic' && ICS[c.props.part]?.custom).map((c) => c.props.part));
  return [...names].map((n) => serial(ICS[n]));
}
/** Register custom parts embedded in a loaded design (if not already in the library). */
export async function adoptCustomDefs(doc) {
  let added = 0;
  for (const d of doc.customParts || []) if (!ICS[d.name] || ICS[d.name].custom) { registerCustomPart(d); added++; }
  if (added) await saveList();
  return added;
}

function fromExisting(name) {
  const d = ICS[name];
  if (!d) return null;
  if (d.custom) return serial(d);
  const mcu = (d.units || []).find((u) => u.k === 'mcu');
  return {
    name: (d.name || name) + ' (custom)', cat: d.cat || 'MCU boards', desc: d.desc, layout: d.layout === 'dip' ? 'dip' : 'header',
    left: d.layout === 'header' ? d.left : [], right: d.layout === 'header' ? d.right || [] : [],
    pins: d.layout === 'dip' ? d.pins.map(([n, f]) => `${n}:${f}`) : [],
    isMcu: !!mcu, vlogic: mcu?.vlogic ?? 3.3, vinPin: mcu?.v5 || '5V', railPin: mcu?.v3 || '3V3', gndPin: mcu?.gnd || 'GND', loadmA: mcu ? Math.round(mcu.load * 1000) : 0,
    notes: d.notes || '', specs: d.specs || [],
  };
}

export function openPartEditor(app, startName) {
  let st = (startName && fromExisting(startName)) || {
    name: '', cat: 'MCU boards', desc: '', layout: 'header', left: ['5V', 'GND', '3V3', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5'], right: ['GPIO6', 'GPIO7', 'GPIO8', 'GPIO9', 'GPIO10', 'GPIO11', 'GPIO12', 'GPIO13'],
    pins: [], isMcu: true, vlogic: 3.3, vinPin: '5V', railPin: '3V3', gndPin: 'GND', loadmA: 50, notes: '', specs: [],
  };
  if (startName && ICS[startName]?.custom) st.name = startName;
  const editingName = startName && ICS[startName]?.custom ? startName : null;
  const starters = Object.keys(ICS).filter((k) => !ICS[k].generic && !ICS[k].customInline && (ICS[k].layout === 'header' || ICS[k].custom));

  const render = () => `
    <div class="hint">Define any board, module or IC by listing its pins. It is saved in this device's part library (and embedded in designs that use it), with a spec card and simulation model.</div>
    <div class="field"><label>Start from</label><select class="inp" id="peStart"><option value="">— keep current —</option>${starters.map((k) => `<option>${esc(k)}</option>`).join('')}</select></div>
    <div class="field"><label>Part name</label><input class="inp" id="peName" value="${esc(st.name)}" placeholder="e.g. ESP32-S3 Zero" autocapitalize="off"></div>
    <div class="field"><label>Category</label><select class="inp" id="peCat">${CATS.map((c) => `<option ${c === st.cat ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    <div class="field"><label>Description</label><input class="inp" id="peDesc" value="${esc(st.desc)}" placeholder="MCU, logic level, notes…"></div>
    <div class="field"><label>Pin layout</label><select class="inp" id="peLayout"><option value="header" ${st.layout === 'header' ? 'selected' : ''}>Two headers (left / right)</option><option value="dip" ${st.layout === 'dip' ? 'selected' : ''}>IC numbering (DIP / SOIC, 1…n)</option></select></div>
    ${st.layout === 'header'
    ? `<div class="field"><label>Left header<br><small>top → bottom, one per line or comma</small></label><textarea class="inp" id="peLeft" rows="6" autocapitalize="off" spellcheck="false">${esc(st.left.join('\n'))}</textarea></div>
       <div class="field"><label>Right header<br><small>top → bottom</small></label><textarea class="inp" id="peRight" rows="6" autocapitalize="off" spellcheck="false">${esc((st.right || []).join('\n'))}</textarea></div>
       <div class="field"><label>Header row spacing<br><small>holes between the two headers (2.54 mm each) — used by the board designer</small></label><div class="valrow"><input class="inp" id="peSpacing" value="${esc(st.rowSpacing || 6)}" inputmode="numeric"><span class="unit">holes</span></div></div>`
    : `<div class="field"><label>Pins 1…n<br><small>one per line; optional <code>:pwr / :gnd / :in / :out / :nc</code></small></label><textarea class="inp" id="pePins" rows="8" autocapitalize="off" spellcheck="false">${esc((st.pins || []).join('\n'))}</textarea></div>`}
    <div class="field"><label>Microcontroller board</label><div class="row"><button class="toggle ${st.isMcu ? 'on' : ''}" id="peMcu"></button><span class="unit">${st.isMcu ? 'GPIOs configurable, onboard regulator modelled' : 'pins only (+ optional supply current)'}</span></div></div>
    ${st.isMcu ? `<div class="field"><label>Logic level</label><select class="inp" id="peVlogic"><option ${+st.vlogic === 3.3 ? 'selected' : ''}>3.3</option><option ${+st.vlogic === 5 ? 'selected' : ''}>5</option><option ${+st.vlogic === 1.8 ? 'selected' : ''}>1.8</option></select></div>
      <div class="field"><label>USB / VIN pin</label><input class="inp" id="peVin" value="${esc(st.vinPin)}" autocapitalize="off"></div>
      <div class="field"><label>Regulated rail pin</label><input class="inp" id="peRail" value="${esc(st.railPin)}" autocapitalize="off"></div>`
    : `<div class="field"><label>Supply pin</label><input class="inp" id="peRail" value="${esc(st.railPin || 'VCC')}" autocapitalize="off"></div>`}
    <div class="field"><label>Ground pin</label><input class="inp" id="peGnd" value="${esc(st.gndPin || 'GND')}" autocapitalize="off"></div>
    <div class="field"><label>Supply current</label><div class="valrow"><input class="inp" id="peLoad" value="${esc(st.loadmA)}" inputmode="decimal"><span class="unit">mA</span></div></div>
    <div class="field"><label>Specs<br><small>one “key: value” per line</small></label><textarea class="inp" id="peSpecs" rows="3">${esc((st.specs || []).map(([k, v]) => `${k}: ${v}`).join('\n'))}</textarea></div>
    <div class="field"><label>Notes</label><textarea class="inp" id="peNotes" rows="2">${esc(st.notes || '')}</textarea></div>
    <div class="sec">Preview</div><div class="card" id="pePreview" style="padding:6px"></div>
    <div class="actions"><button class="btn pri" id="peSave">${icon('save')}Save to library</button><button class="btn" id="peSaveAdd">${icon('plus')}Save &amp; add to circuit</button>${editingName ? `<button class="btn danger" id="peDelete">${icon('trash')}Delete</button>` : ''}</div>`;

  const read = (b) => {
    const g = (id) => b.querySelector(id);
    st.name = g('#peName').value.trim();
    st.cat = g('#peCat').value;
    st.desc = g('#peDesc').value.trim();
    if (g('#peLeft')) { st.left = splitPins(g('#peLeft').value); st.right = splitPins(g('#peRight').value); }
    if (g('#pePins')) st.pins = splitPins(g('#pePins').value);
    if (g('#peSpacing')) st.rowSpacing = Math.max(2, Math.min(20, Math.round(+g('#peSpacing').value || 6)));
    if (g('#peVlogic')) st.vlogic = +g('#peVlogic').value;
    if (g('#peVin')) st.vinPin = g('#peVin').value.trim();
    st.railPin = g('#peRail').value.trim();
    st.gndPin = g('#peGnd').value.trim() || 'GND';
    st.loadmA = +g('#peLoad').value || 0;
    st.specs = g('#peSpecs').value.split('\n').map((l) => l.split(':')).filter((p) => p.length > 1 && p[0].trim()).map(([k, ...v]) => [k.trim(), v.join(':').trim()]);
    st.notes = g('#peNotes').value.trim();
  };
  const toDef = () => {
    const d = { ...st, pkg: st.layout === 'header' ? 'custom header' : `custom ${st.pins.length}-pin` };
    if (st.layout === 'dip') {
      const pins = st.pins.map((s) => { const [n, f] = s.split(':').map((x) => x.trim()); return [n, f || (/^(GND|VSS)$/i.test(n) ? 'gnd' : /^(VCC|VDD|VIN|5V|3V3)$/i.test(n) ? 'pwr' : /^NC$/i.test(n) ? 'nc' : 'io')]; });
      if (pins.length % 2) pins.push(['NC', 'nc']);
      d.pins = pins; delete d.left; delete d.right;
    } else { delete d.pins; if (!d.left.length && !d.right.length) d.left = ['GND']; }
    return d;
  };
  const preview = (b) => {
    const d = toDef();
    const tmp = registerCustomPart({ ...d, name: '__preview__' });
    const c = { id: 'pv', type: 'ic', x: 0, y: 0, rot: 0, props: { part: '__preview__', gpio: {} } };
    tmp.name = d.name || 'Preview';
    invalidateIc();
    const sym = drawSymbol(c), bb = getBBox(c);
    let t = '';
    for (const [x, y, s, cls, a] of sym.t || []) t += `<text class="${cls}" x="${x}" y="${y}" text-anchor="${a}">${esc(s)}</text>`;
    unregisterCustomPart('__preview__');
    const warn = d.isMcu && ![...(d.left || []), ...(d.right || []), ...(d.pins || []).map((p) => p[0])].includes(d.railPin) ? `<div class="note">Rail pin “${esc(d.railPin)}” is not in the pin list — the board will not be powered in the simulation.</div>` : '';
    b.querySelector('#pePreview').innerHTML = `<svg class="pinout-svg" viewBox="${bb.x - 12} ${bb.y - 12} ${bb.w + 24} ${bb.h + 24}" style="max-height:420px">${sym.s}${t}</svg>${warn}`;
  };
  const save = async (b, add) => {
    read(b);
    if (!st.name) { app.toast('Give the part a name'); return; }
    if (ICS[st.name] && !ICS[st.name].custom) { app.toast('That name is a built-in part — choose another'); return; }
    if (editingName && editingName !== st.name) unregisterCustomPart(editingName);
    registerCustomPart(toDef());
    await saveList();
    app.closeModal();
    app.toast(`Saved “${st.name}” to your part library`);
    // refresh comps that use it
    app.changed('prop', { noDirty: true });
    if (add) app.addPart({ type: 'ic', part: st.name, label: st.name, cat: st.cat });
  };
  const bind = (b) => {
    const rerender = () => { read(b); b.innerHTML = render(); bind(b); };
    b.querySelector('#peStart').onchange = (e) => { if (e.target.value) { const keep = st.name; st = fromExisting(e.target.value); if (keep) st.name = keep; b.innerHTML = render(); bind(b); } };
    b.querySelector('#peLayout').onchange = (e) => {
      read(b);
      if (e.target.value === 'dip' && !st.pins.length) st.pins = [...st.left, ...[...(st.right || [])].reverse()];
      if (e.target.value === 'header' && !st.left.length) { const h = Math.ceil(st.pins.length / 2); st.left = st.pins.slice(0, h).map((p) => p.split(':')[0]); st.right = st.pins.slice(h).map((p) => p.split(':')[0]).reverse(); }
      st.layout = e.target.value; b.innerHTML = render(); bind(b);
    };
    b.querySelector('#peMcu').onclick = () => { read(b); st.isMcu = !st.isMcu; if (!st.isMcu && !st.railPin) st.railPin = 'VCC'; b.innerHTML = render(); bind(b); };
    b.querySelectorAll('input, textarea, select').forEach((el) => { if (!['peStart', 'peLayout'].includes(el.id)) el.addEventListener('input', () => { read(b); preview(b); }); });
    b.querySelector('#peSave').onclick = () => save(b, false);
    b.querySelector('#peSaveAdd').onclick = () => save(b, true);
    const del = b.querySelector('#peDelete');
    if (del) del.onclick = async () => {
      if (!confirm(`Delete “${editingName}” from your library? Designs that use it keep a copy of its definition.`)) return;
      unregisterCustomPart(editingName); await saveList(); app.closeModal(); app.toast('Deleted'); app.changed('prop', { noDirty: true });
    };
    preview(b);
    void rerender;
  };
  app.openModal(editingName ? 'Edit custom part' : 'New custom part', render(), bind);
}
