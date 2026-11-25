// PCB fab hand-off: a KiCad netlist and a JLCPCB-style BOM generated from the schematic.
// The app has no copper layout, so Gerber / drill / pick-and-place files come from the layout tool
// (KiCad, EasyEDA …) that imports this netlist; this module makes sure the parts, pads and nets arrive correctly.
import { buildNets } from './netlist.js';
import { getPins, TYPES, PARTS, ICS } from './library.js';
import { PHYSICAL } from './boards.js';
import { parseEng, short } from './units.js';
import { icon } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const FP_SUGGEST = [
  'Resistor_SMD:R_0402_1005Metric', 'Resistor_SMD:R_0603_1608Metric', 'Resistor_SMD:R_0805_2012Metric',
  'Capacitor_SMD:C_0402_1005Metric', 'Capacitor_SMD:C_0603_1608Metric', 'Capacitor_SMD:C_0805_2012Metric', 'Capacitor_SMD:C_1206_3216Metric',
  'Inductor_SMD:L_0402_1005Metric', 'Inductor_SMD:L_0603_1608Metric', 'Inductor_SMD:L_0805_2012Metric',
  'LED_SMD:LED_0603_1608Metric', 'Diode_SMD:D_SOD-123', 'Diode_SMD:D_SOD-323',
  'Package_TO_SOT_SMD:SOT-23', 'Package_TO_SOT_SMD:SOT-23-5', 'Package_TO_SOT_SMD:SOT-23-6', 'Package_TO_SOT_SMD:SOT-223-3_TabPin2',
  'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm', 'Package_SO:TSSOP-16_4.4x5mm_P0.65mm', 'Package_SO:MSOP-10_3x3mm_P0.5mm', 'Package_DIP:DIP-8_W7.62mm',
  'Package_DFN_QFN:QFN-48-1EP_6x6mm_P0.4mm_EP4.6x4.6mm', 'Package_DFN_QFN:QFN-16-1EP_3x3mm_P0.5mm_EP1.7x1.7mm', 'Package_LGA:LGA-14_3x2.5mm_P0.5mm_LayoutBorder3x4y',
  'Crystal:Crystal_SMD_3215-2Pin_3.2x1.5mm', 'Crystal:Crystal_SMD_2016-4Pin_2.0x1.6mm',
  'Button_Switch_SMD:SW_SPST_FSMSM', 'Connector_PinHeader_1.27mm:PinHeader_1x04_P1.27mm_Vertical', 'Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical',
  'TestPoint:TestPoint_Pad_D1.0mm',
];

const PKG_FP = [
  [/SOT-?23-?5/i, 'Package_TO_SOT_SMD:SOT-23-5'], [/SOT-?23-?6/i, 'Package_TO_SOT_SMD:SOT-23-6'], [/SOT-?223/i, 'Package_TO_SOT_SMD:SOT-223-3_TabPin2'], [/SOT-?23/i, 'Package_TO_SOT_SMD:SOT-23'],
  [/SOIC-?8|SO-?8/i, 'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm'], [/TSSOP-?16/i, 'Package_SO:TSSOP-16_4.4x5mm_P0.65mm'], [/MSOP-?10/i, 'Package_SO:MSOP-10_3x3mm_P0.5mm'], [/DIP-?8/i, 'Package_DIP:DIP-8_W7.62mm'],
];

const num = (x, d = 0) => { const v = parseEng(x); return Number.isFinite(v) ? v : d; };

/** Default footprint and pad numbers for a component. status 'ok' = trustworthy, 'check' = verify before layout. */
export function defaultFootprint(c) {
  const pins = getPins(c);
  const sequential = pins.map((_, i) => String(i + 1));
  const val = num(c.props.value, 0);
  switch (c.type) {
    case 'resistor': return { fp: 'Resistor_SMD:R_0402_1005Metric', pads: ['1', '2'], status: 'ok' };
    case 'capacitor': return { fp: val > 10e-6 ? 'Capacitor_SMD:C_0805_2012Metric' : val > 1e-6 ? 'Capacitor_SMD:C_0603_1608Metric' : 'Capacitor_SMD:C_0402_1005Metric', pads: ['1', '2'], status: 'ok' };
    case 'inductor': return { fp: val >= 1e-6 ? 'Inductor_SMD:L_0805_2012Metric' : 'Inductor_SMD:L_0402_1005Metric', pads: ['1', '2'], status: 'ok' };
    case 'fuse': return { fp: 'Fuse:Fuse_0603_1608Metric', pads: ['1', '2'], status: 'ok' };
    case 'led': return { fp: 'LED_SMD:LED_0603_1608Metric', pads: pins.map((p) => (/^A|\+/.test(p.name) ? '2' : '1')), status: 'check', why: 'polarity: pad 1 = cathode, pad 2 = anode' };
    case 'diode': case 'schottky': case 'zener': case 'tvs': return { fp: 'Diode_SMD:D_SOD-123', pads: pins.map((p) => (/^A/.test(p.name) ? '2' : '1')), status: 'check', why: 'polarity: pad 1 = cathode, pad 2 = anode' };
    case 'switch': case 'button': return { fp: 'Button_Switch_SMD:SW_SPST_FSMSM', pads: ['1', '2'], status: 'check', why: 'choose the switch you will buy' };
    case 'cap_pol': return { fp: '', pads: ['1', '2'], status: 'check', why: 'pad 1 = +, pick the electrolytic / tantalum footprint' };
    case 'ic': {
      const d = ICS[c.props.part] || {};
      const nums = pins.map((p) => p.num);
      if (d.custom && d.fabSkip) return { skip: true, fp: '', pads: [], status: 'skip', why: 'a board feature (draw it in the layout tool)' };
      if (d.custom) {
        const pads = d.nums ? d.nums.map((n) => String(n)) : nums;
        return { fp: d.footprint || '', pads, status: d.functional || !d.footprint ? 'check' : 'ok', why: d.functional ? 'pin numbers in the symbol are NOT package pad numbers — enter the real pads' : !d.footprint ? 'no footprint chosen' : '' };
      }
      if (d.layout === 'header') return { fp: `Connector_PinHeader_2.54mm:PinHeader_1x${pins.length}_P2.54mm_Vertical`, pads: nums, status: 'check', why: 'a module on headers — pick a footprint for the module' };
      const hit = PKG_FP.find(([re]) => re.test(d.pkg || ''));
      return { fp: hit ? hit[1] : '', pads: nums, status: hit ? 'ok' : 'check', why: hit ? '' : 'package not recognised' };
    }
    case 'reg': { const m = PARTS[c.props.part] || {}; const hit = PKG_FP.find(([re]) => re.test(m.pkg || '')); return { fp: hit ? hit[1] : 'Package_TO_SOT_SMD:SOT-23', pads: pins.map((p) => p.num), status: 'check', why: `pad numbers follow the library's ${m.pkg || ''} package — check them against the footprint you choose (SMD versions number the pins differently)` }; }
    case 'opamp': return { fp: 'Package_TO_SOT_SMD:SOT-23-5', pads: sequential, status: 'check', why: 'symbol pins are not package pads' };
    default: return { fp: '', pads: pins.map((p) => p.num), status: 'check', why: 'choose a footprint' };
  }
}

/** One row per fabricated part, with any user overrides from doc.fab applied. */
export function fabRows(doc) {
  const ov = doc.fab || {};
  const rows = [], skipped = [], offboard = [];
  for (const c of doc.comps) {
    if (!TYPES[c.type] || TYPES[c.type].noRef) continue;
    if (!PHYSICAL(c)) { offboard.push(c); continue; }
    const base = defaultFootprint(c);
    if (base.skip) { skipped.push({ c, why: base.why }); continue; }
    const o = ov[c.id] || {};
    const pads = o.pads ? String(o.pads).split(/[\s,;]+/).filter((x) => x !== '') : base.pads;
    const pinCount = getPins(c).length;
    const fixed = pads.length === pinCount ? pads : base.pads;
    rows.push({
      id: c.id, c, ref: c.ref, value: valueOf(c),
      fp: o.fp != null ? o.fp : base.fp, pads: fixed, status: o.pads && (o.fp || base.fp) ? 'ok' : base.status, why: base.why,
      lcsc: o.lcsc || '', pins: getPins(c),
    });
  }
  rows.sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
  return { rows, skipped, offboard };
}
function valueOf(c) {
  const p = c.props || {};
  const ascii = (t) => String(t).replace(/µ/g, 'u').replace(/\s+/g, '');
  if (c.type === 'resistor') return ascii(short(num(p.value), ''));
  if (c.type === 'capacitor' || c.type === 'cap_pol') { const v = num(p.value); return v < 1e-9 ? +(v * 1e12).toPrecision(3) + 'pF' : ascii(short(v, 'F')); }
  if (c.type === 'inductor') return ascii(short(num(p.value), 'H'));
  if (p.part) return p.part;
  return TYPES[c.type]?.name || c.type;
}

// ---------------------------------------------------------------- outputs
const q = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function kicadNetlist(doc, rows) {
  const nl = buildNets(doc);
  const usable = rows.filter((r) => r.fp !== undefined);
  const nets = new Map();
  for (const r of usable) {
    r.pins.forEach((pin, i) => {
      const pad = r.pads[i];
      if (pad == null || pad === '') return;
      const id = nl.pinNet(r.c.id, i);
      if (id == null) return;
      if (!nets.has(id)) nets.set(id, []);
      nets.get(id).push({ ref: r.ref, pad, fn: pin.name });
    });
  }
  const used = new Set();
  const out = [];
  out.push('(export (version "E")');
  out.push(`  (design (source ${q('Circuit Workbench: ' + doc.name)}) (date ${q(new Date().toISOString())}) (tool "Circuit Workbench"))`);
  out.push('  (components');
  usable.forEach((r, i) => {
    out.push(`    (comp (ref ${q(r.ref)}) (value ${q(r.value)}) (footprint ${q(r.fp || '')}) (libsource (lib "cwb") (part ${q(r.c.type === 'ic' ? r.c.props.part : r.c.type)}) (description ${q(TYPES[r.c.type]?.name || '')})) (sheetpath (names "/") (tstamps "/")) (tstamps ${q(uuid(i + 1))}))`);
  });
  out.push('  )');
  out.push('  (nets');
  let code = 1;
  const ordered = [...nets.entries()].sort((a, b) => (nl.nets[a[0]].isGnd ? -1 : 0) - (nl.nets[b[0]].isGnd ? -1 : 0));
  for (const [id, nodes] of ordered) {
    let name = nl.nets[id].isGnd ? 'GND' : nl.nets[id].name;
    if (!name || /^#?N\d+$/.test(name)) name = `Net-(${nodes[0].ref}-Pad${nodes[0].pad})`;
    name = String(name).replace(/\s+/g, '_');
    let u = name, k = 2; while (used.has(u)) u = name + '_' + k++;
    used.add(u);
    out.push(`    (net (code ${q(code++)}) (name ${q(u)})`);
    for (const n of nodes) out.push(`      (node (ref ${q(n.ref)}) (pin ${q(n.pad)}) (pinfunction ${q(n.fn)}))`);
    out.push('    )');
  }
  out.push('  )');
  out.push(')');
  return out.join('\n') + '\n';
}

const shortFp = (fp) => { const m = /_(\d{4})_\d{4}Metric/.exec(fp); return m ? m[1] : (fp.split(':')[1] || fp); };
const csv = (a) => a.map((x) => (/[",\n]/.test(String(x)) ? '"' + String(x).replace(/"/g, '""') + '"' : String(x))).join(',');

/** JLCPCB BOM upload format: Comment, Designator, Footprint, LCSC Part #. */
export function jlcBom(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = [r.value, r.fp, r.lcsc].join('|');
    if (!groups.has(key)) groups.set(key, { value: r.value, fp: r.fp, lcsc: r.lcsc, refs: [] });
    groups.get(key).refs.push(r.ref);
  }
  const lines = [csv(['Comment', 'Designator', 'Footprint', 'LCSC Part #'])];
  for (const g of [...groups.values()].sort((a, b) => a.refs[0].localeCompare(b.refs[0], undefined, { numeric: true }))) {
    g.refs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    lines.push(csv([g.value, g.refs.join(','), shortFp(g.fp || ''), g.lcsc]));
  }
  return lines.join('\n') + '\n';
}

/** Plain pin → net list (ref, pad, pin name, net) for any other tool. */
export function pinNetCsv(doc, rows) {
  const nl = buildNets(doc);
  const lines = [csv(['Designator', 'Pad', 'Pin name', 'Net'])];
  for (const r of rows) r.pins.forEach((p, i) => { const id = nl.pinNet(r.c.id, i); if (id == null || !r.pads[i]) return; const n = nl.nets[id]; lines.push(csv([r.ref, r.pads[i], p.name, n.isGnd ? 'GND' : n.name || ''])); });
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- UI
export function openFab(app) {
  const doc = app.doc;
  const render = () => {
    const { rows, skipped, offboard } = fabRows(doc);
    const bad = rows.filter((r) => r.status === 'check' || !r.fp);
    let h = `<div class="hint">This produces what a PCB tool needs from your schematic: a <b>KiCad netlist</b> (parts, footprints, pads and nets) and a <b>JLCPCB-format BOM</b>. The app has no copper layout, so <b>Gerber, drill and pick-and-place files come from the layout tool</b>: import the netlist into KiCad (Pcbnew → File → Import → Netlist), place and route, then Plot / Fabrication Outputs, or let JLCPCB's EasyEDA import it. Pad numbers matter — check every row marked ⚠.</div>`;
    if (bad.length) h += `<div class="note">⚠ ${bad.length} part${bad.length === 1 ? '' : 's'} need a check before layout: functional symbols and guessed footprints are not package-accurate.</div>`;
    h += `<div class="actions"><button class="btn pri" data-fab="net">${icon('download')}KiCad netlist (.net)</button><button class="btn" data-fab="bom">${icon('download')}JLCPCB BOM (.csv)</button><button class="btn" data-fab="pins">${icon('download')}Pin–net list (.csv)</button></div>`;
    rows.sort((a, b) => (a.status === 'ok' && a.fp ? 1 : 0) - (b.status === 'ok' && b.fp ? 1 : 0));
    h += `<div class="rtw"><table class="rt fabt"><thead><tr><th></th><th>Ref</th><th>Value</th><th>Footprint (KiCad library id)</th><th>Pads (in pin order)</th><th>LCSC #</th></tr></thead><tbody>`;
    for (const r of rows) {
      const pinTxt = r.pins.map((p, i) => `${p.name}→${r.pads[i] ?? '·'}`).join('  ');
      h += `<tr data-id="${r.id}"><td title="${esc(r.why || 'looks right')}">${r.status === 'ok' && r.fp ? '✓' : '⚠'}</td><td>${esc(r.ref)}</td><td>${esc(r.value)}</td>
        <td><input class="inp" data-f="fp" list="fpList" value="${esc(r.fp)}" autocapitalize="off" spellcheck="false"></td>
        <td><input class="inp" data-f="pads" value="${esc(r.pads.join(', '))}" title="${esc(pinTxt)}" autocapitalize="off" spellcheck="false">${r.status !== 'ok' && r.why ? `<div class="t2">${esc(r.why)}</div>` : ''}</td>
        <td><input class="inp" data-f="lcsc" value="${esc(r.lcsc)}" placeholder="C…" autocapitalize="off" spellcheck="false"></td></tr>`;
    }
    h += `</tbody></table></div><datalist id="fpList">${FP_SUGGEST.map((f) => `<option value="${esc(f)}">`).join('')}</datalist>`;
    if (skipped.length) h += `<div class="hint">Not exported (draw in the layout tool): ${skipped.map((s) => `${esc(s.c.ref)} — ${esc(s.why)}`).join('; ')}.</div>`;
    if (offboard.length) h += `<div class="hint">Simulation-only items left out: ${offboard.map((c) => esc(c.ref || c.type)).join(', ')}. Anything that must connect to the board (battery, connectors) needs a part with pads in the schematic.</div>`;
    return h;
  };
  const bind = (body) => {
    body.querySelectorAll('tr[data-id] input').forEach((el) => el.addEventListener('change', () => {
      const id = el.closest('tr').dataset.id;
      doc.fab ||= {};
      (doc.fab[id] ||= {})[el.dataset.f] = el.value.trim();
      app.dirty = true; app._updateTitle?.(); app.saveSession?.();
      const sy = body.scrollTop; body.innerHTML = render(); bind(body); body.scrollTop = sy;
    }));
    body.querySelectorAll('[data-fab]').forEach((b) => b.addEventListener('click', () => {
      const { rows } = fabRows(doc);
      const risky = rows.filter((r) => r.status !== 'ok' || !r.fp);
      if (risky.length && b.dataset.fab !== 'bom' && !confirm(`${risky.length} part(s) still have unverified pad numbers or footprints (${risky.slice(0, 6).map((r) => r.ref).join(', ')}${risky.length > 6 ? '…' : ''}). The netlist will connect to the wrong pads if these are wrong. Export anyway?`)) return;
      const slug = (doc.name || 'design').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'design';
      if (b.dataset.fab === 'net') app.download(slug + '.net', kicadNetlist(doc, rows), 'text/plain');
      else if (b.dataset.fab === 'bom') app.download(slug + '-bom.csv', jlcBom(rows), 'text/csv');
      else app.download(slug + '-pins.csv', pinNetCsv(doc, rows), 'text/csv');
    }));
  };
  app.openModal('Export for PCB fab', render(), bind);
}
