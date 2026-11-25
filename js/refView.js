// Reference: a searchable library of component guides and circuit theory.
// Content lives in js/ref/*.js and is loaded on first open.
import { icon } from './icons.js';
import { PALETTE, ICS } from './library.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const CATS = ['Theory', 'Passive', 'Sources & symbols', 'Semiconductors', 'Optoelectronics & sensors', 'Analog ICs', 'Power', 'Digital & interface ICs', 'Microcontrollers & modules', 'Connectors & protection', 'Wiring & build'];
const FIELDS = [
  ['all', 'Everything'], ['purpose', 'Purpose & use'], ['how', 'How it works'], ['integration', 'Integration'], ['circuits', 'Circuits & function'],
  ['tips', 'Wiring tips'], ['traps', 'Traps & mistakes'], ['companions', 'Used with'], ['theory', 'Theory & formulas'],
];
const SECTION_TITLES = { purpose: 'What it is for', how: 'How it works', integration: 'How it is wired in', circuits: 'Where you will meet it', tips: 'Wiring tips', traps: 'Traps & common mistakes', companions: 'Often used with' };

let DATA = null, BY_ID = new Map();
async function load() {
  if (DATA) return DATA;
  const mods = await Promise.all([import('./ref/theory.js'), import('./ref/components-a.js'), import('./ref/components-b.js')].map((p) => p.catch((e) => { console.warn(e); return {}; })));
  const [t, a, b] = mods;
  DATA = [...(t.REF_THEORY || []).map((e) => ({ ...e, kind: 'theory', cat: 'Theory' })), ...(a.REF_A || []), ...(b.REF_B || [])].map((e) => ({ kind: 'component', ...e }));
  for (const e of DATA) {
    const list = (x) => (Array.isArray(x) ? x.join(' \n ') : x || '');
    e._f = {
      title: norm(e.title), aliases: norm((e.aliases || []).join(' ')), summary: norm(e.summary),
      purpose: norm(e.purpose), how: norm(e.how), integration: norm(e.integration), circuits: norm(list(e.circuits)),
      tips: norm(list(e.tips)), traps: norm(list(e.traps)), companions: norm(list(e.companions)),
      theory: norm([...(e.sections || []).map((s) => s.h + ' ' + s.p), ...(e.formulas || []).map((f) => f.join(' ')), e.example || '', list(e.pitfalls)].join(' ')),
      parts: norm((e.parts || []).join(' ')),
    };
    BY_ID.set(e.id, e);
  }
  return DATA;
}

/** Best reference entry for a schematic component. */
export async function entryForComp(c) {
  await load();
  const part = c.props?.part;
  if (part) { const hit = DATA.find((e) => (e.parts || []).includes(part)); if (hit) return hit.id; }
  if (c.type === 'ic') {
    const cat = ICS[part]?.cat || '';
    const byCat = { 'Comparators': 'comparator', 'Op-amps': 'op-amp', 'Gate drivers': 'gate-driver', 'MCU boards': 'microcontroller-board', 'ADCs': 'adc', 'Signal sources': 'clock-generator', 'Logic & interface': 'logic-ic', 'Drivers': 'motor-driver', 'Power ICs': 'battery-charger' }[cat];
    if (/esp32-s3-wroom/i.test(part || '')) return 'esp32-s3-module';
    if (/nrf52/i.test(part || '')) return 'nrf52-ble-soc';
    if (/lsm6|imu|accel|mpu-/i.test(part || '')) return 'accelerometer-imu';
    if (/5883|magnet/i.test(part || '')) return 'magnetometer';
    if (/usb-c/i.test(part || '')) return 'usb-c-connector';
    if (/crystal/i.test(part || '')) return 'crystal';
    if (/battery/i.test(part || '')) return 'lipo-battery';
    if (/charger|tp40/i.test(part || '')) return 'battery-charger';
    if (byCat && BY_ID.has(byCat)) return byCat;
  }
  const hit = DATA.find((e) => (e.types || []).includes(c.type));
  return hit ? hit.id : null;
}

// ---------------------------------------------------------------- search
function search(q, cat, field, inDesign) {
  const toks = norm(q).split(/[\s,]+/).filter(Boolean);
  const out = [];
  for (const e of DATA) {
    if (cat === 'design') { if (!inDesign.has(e.id)) continue; } else if (cat !== 'All' && e.cat !== cat) continue;
    if (!toks.length) { out.push({ e, score: 0 }); continue; }
    const keys = field === 'all' ? Object.keys(e._f) : field === 'purpose' ? ['purpose', 'summary', 'title', 'aliases'] : [field];
    let score = 0, ok = true;
    for (const t of toks) {
      let hit = 0;
      for (const k of keys) {
        const s = e._f[k]; if (!s) continue;
        const i = s.indexOf(t); if (i < 0) continue;
        hit += k === 'title' ? 12 : k === 'aliases' ? 8 : k === 'parts' ? 6 : k === 'summary' ? 4 : 1;
        if (k === 'title' && i === 0) hit += 6;
      }
      if (!hit) { ok = false; break; }
      score += hit;
    }
    if (ok) out.push({ e, score });
  }
  out.sort((a, b) => b.score - a.score || CATS.indexOf(a.e.cat) - CATS.indexOf(b.e.cat) || a.e.title.localeCompare(b.e.title));
  return { list: out, toks };
}
function mark(text, toks) {
  let h = esc(text);
  for (const t of toks) { if (t.length < 2) continue; const re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'); h = h.replace(re, '<mark>$1</mark>'); }
  return h;
}
function snippet(e, toks, field) {
  if (!toks.length) return esc(e.summary || '');
  const fields = field === 'all' ? ['summary', 'purpose', 'how', 'integration', 'circuits', 'tips', 'traps', 'companions'] : field === 'purpose' ? ['purpose', 'summary'] : [field];
  for (const f of fields) {
    let raw = e[f];
    if (f === 'theory' || (e.kind === 'theory' && !raw)) raw = [...(e.sections || []).map((s) => s.p), e.example || ''].join(' ');
    if (Array.isArray(raw)) raw = raw.join(' · ');
    if (!raw) continue;
    const n = norm(raw), i = toks.map((t) => n.indexOf(t)).filter((x) => x >= 0).sort((a, b) => a - b)[0];
    if (i == null) continue;
    const a = Math.max(0, i - 60), b = Math.min(raw.length, i + 140);
    return (a ? '…' : '') + mark(raw.slice(a, b), toks) + (b < raw.length ? '…' : '');
  }
  return mark(e.summary || '', toks);
}

// ---------------------------------------------------------------- view
const S = { q: '', cat: 'All', field: 'all', id: null, back: [] };
let root = null, appRef = null;

function inDesignIds() {
  const set = new Set();
  if (!appRef) return set;
  for (const c of appRef.doc.comps) {
    const part = c.props?.part;
    for (const e of DATA) if ((part && (e.parts || []).includes(part)) || (e.types || []).includes(c.type)) set.add(e.id);
  }
  return set;
}

function listHtml() {
  const inD = inDesignIds();
  const { list, toks } = search(S.q, S.cat, S.field, inD);
  if (!list.length) return `<div class="hint" style="padding:16px">Nothing matches “${esc(S.q)}”${S.cat !== 'All' ? ' in this category' : ''}. Try fewer words or “Everything”.</div>`;
  let h = '', lastCat = null;
  const grouped = !toks.length && S.cat === 'All';
  for (const { e } of list) {
    if (grouped && e.cat !== lastCat) { h += `<div class="rf-group">${esc(e.cat)}</div>`; lastCat = e.cat; }
    h += `<button class="rf-item ${e.id === S.id ? 'on' : ''}" data-id="${esc(e.id)}"><div class="rf-t">${mark(e.title, toks)}${e.kind === 'theory' ? ' <span class="rf-badge th">theory</span>' : ''}</div><div class="rf-s">${snippet(e, toks, S.field)}</div></button>`;
  }
  return `<div class="rf-count">${list.length} ${list.length === 1 ? 'entry' : 'entries'}</div>` + h;
}

function para(title, text, toks, cls = '') { return text ? `<section class="rf-sec ${cls}"><h3>${esc(title)}</h3><p>${mark(text, toks)}</p></section>` : ''; }
function items(title, arr, toks, cls = '') { return arr && arr.length ? `<section class="rf-sec ${cls}"><h3>${esc(title)}</h3><ul>${arr.map((x) => `<li>${mark(x, toks)}</li>`).join('')}</ul></section>` : ''; }

function detailHtml() {
  const e = BY_ID.get(S.id);
  if (!e) return `<div class="rf-empty">${icon('book')}<p>Pick a topic on the left, tap a category above, or search for a part, a word or a problem (“flyback”, “pull-up”, “battery life”, “hysteresis”).</p></div>`;
  const toks = norm(S.q).split(/[\s,]+/).filter((t) => t.length > 1);
  let h = `<div class="rf-detail-head">${S.back.length ? `<button class="btn small" data-rf="back">${icon('undo')}Back</button>` : ''}<span class="rf-badge">${esc(e.cat)}</span></div>`;
  h += `<h2 class="rf-title">${esc(e.title)}</h2><p class="rf-lead">${mark(e.summary, toks)}</p>`;
  if (e.kind === 'theory') {
    for (const s of e.sections || []) h += para(s.h, s.p, toks);
    if (e.formulas?.length) h += `<section class="rf-sec"><h3>Key formulas</h3><table class="rf-f">${e.formulas.map(([f, m]) => `<tr><td class="fx">${esc(f)}</td><td>${mark(m, toks)}</td></tr>`).join('')}</table></section>`;
    if (e.example) h += `<section class="rf-sec rf-ex"><h3>Worked example</h3><p>${mark(e.example, toks)}</p></section>`;
    h += items('Common misunderstandings', e.pitfalls, toks, 'rf-traps');
    if (e.calculators?.length) h += `<section class="rf-sec"><h3>Try it</h3><div class="rf-chips">${e.calculators.map((c) => `<button class="btn small" data-calc="${esc(c)}">${icon('calc')}${esc(CALC_NAMES[c] || c)} calculator</button>`).join('')}</div></section>`;
  } else {
    h += para(SECTION_TITLES.purpose, e.purpose, toks) + para(SECTION_TITLES.how, e.how, toks) + para(SECTION_TITLES.integration, e.integration, toks);
    h += items(SECTION_TITLES.circuits, e.circuits, toks) + items(SECTION_TITLES.tips, e.tips, toks, 'rf-tips') + items(SECTION_TITLES.traps, e.traps, toks, 'rf-traps') + items(SECTION_TITLES.companions, e.companions, toks);
    const pal = paletteFor(e);
    if (pal.length) h += `<section class="rf-sec"><h3>In the part library</h3><div class="rf-chips">${pal.slice(0, 24).map((p, i) => `<button class="chip" data-add="${i}">${icon('plus')}${esc(p.label)}</button>`).join('')}</div><div class="hint">Tap to add one to your design.</div></section>`;
  }
  const rel = (e.related || []).map((id) => BY_ID.get(id)).filter(Boolean);
  if (rel.length) h += `<section class="rf-sec"><h3>Related</h3><div class="rf-chips">${rel.map((r) => `<button class="chip" data-go="${esc(r.id)}">${r.kind === 'theory' ? '📖 ' : ''}${esc(r.title)}</button>`).join('')}</div></section>`;
  return h;
}
const CALC_NAMES = { filter: 'Filters', opamp: 'Op-amp designer', divider: 'Voltage divider', led: 'LED resistor', ohm: "Ohm's law", react: 'Reactance', lm317: 'LM317', 555: '555 astable', gate: 'MOSFET gate drive', decap: 'Decoupling', sensor: 'Sensor → ADC', rf: 'RF link budget', power: 'Power budget' };
function paletteFor(e) {
  const parts = new Set(e.parts || []), types = new Set(e.types || []);
  return PALETTE.filter((p) => (p.part && parts.has(p.part)) || (!p.part && types.has(p.type)) || (p.part && types.has(p.type) && !parts.size));
}

function render(focusSearch) {
  const inD = appRef ? inDesignIds() : new Set();
  const cats = ['All', ...(inD.size ? ['design'] : []), ...CATS];
  root.querySelector('.rf-cats').innerHTML = cats.map((c) => `<button class="chip ${S.cat === c ? 'on' : ''}" data-cat="${esc(c)}">${c === 'design' ? '★ In this design' : c === 'Theory' ? '📖 Theory' : esc(c)}</button>`).join('');
  root.querySelector('.rf-fields').innerHTML = `<span>Search in</span>` + FIELDS.map(([k, n]) => `<button class="chip small ${S.field === k ? 'on' : ''}" data-field="${k}">${esc(n)}</button>`).join('');
  root.querySelector('.rf-list').innerHTML = listHtml();
  root.querySelector('.rf-detail').innerHTML = detailHtml();
  root.classList.toggle('show-detail', !!S.id);
  if (focusSearch) root.querySelector('.rf-search').focus();
}
function go(id) { if (S.id && S.id !== id) S.back.push(S.id); S.id = id; render(); root.querySelector('.rf-detail').scrollTop = 0; }

function build() {
  root = document.createElement('div');
  root.id = 'refView';
  root.innerHTML = `<div class="rf-head"><h2>${icon('book')}Reference</h2><input class="inp rf-search" type="search" placeholder="Search parts, functions, tips, traps, theory…" autocapitalize="off" autocorrect="off" spellcheck="false"><button class="ib" data-rf="close" title="Close" aria-label="Close">${icon('x')}</button></div>
    <div class="rf-cats"></div><div class="rf-fields"></div>
    <div class="rf-main"><div class="rf-list"></div><div class="rf-detail"></div></div>`;
  document.body.appendChild(root);
  const inp = root.querySelector('.rf-search');
  let t = null;
  inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { S.q = inp.value; root.querySelector('.rf-list').innerHTML = listHtml(); if (S.id) root.querySelector('.rf-detail').innerHTML = detailHtml(); }, 80); });
  inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { const first = root.querySelector('.rf-item'); if (first) go(first.dataset.id); } if (ev.key === 'Escape') closeReference(); });
  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.rf === 'close') return closeReference();
    if (b.dataset.rf === 'back') { S.id = S.back.pop() || null; render(); return; }
    if (b.dataset.cat) { S.cat = b.dataset.cat; render(); return; }
    if (b.dataset.field) { S.field = b.dataset.field; render(); return; }
    if (b.dataset.id) { go(b.dataset.id); return; }
    if (b.dataset.go) { go(b.dataset.go); return; }
    if (b.dataset.calc && appRef) { const c = b.dataset.calc; closeReference(); import('./tools.js').then((m) => m.openTools(appRef, c)); return; }
    if (b.dataset.add != null && appRef) { const p = paletteFor(BY_ID.get(S.id))[+b.dataset.add]; if (p) { closeReference(); appRef.addPart(p); } }
  });
}

export async function openReference(app, id, query) {
  appRef = app;
  await load();
  if (!root) build();
  if (query != null && !(id && BY_ID.has(id))) { S.q = query; S.cat = 'All'; S.field = 'all'; S.id = null; root.querySelector('.rf-search').value = query; }
  if (id && BY_ID.has(id)) { if (S.id && S.id !== id) S.back.push(S.id); S.id = id; }
  root.hidden = false;
  document.body.classList.add('ref-open');
  render(!id && !S.id && window.innerWidth > 760);
}
export function closeReference() { if (root) root.hidden = true; document.body.classList.remove('ref-open'); }
export function isReferenceOpen() { return !!root && !root.hidden; }
export async function referenceData() { return load(); }
