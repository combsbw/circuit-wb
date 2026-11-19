// Circuit Workbench — main controller.
import { TYPES, PALETTE, CATEGORIES, PARTS, ICS, getPins, drawSymbol, getBBox, propDefs, partOptions, applyPartFill, partInfo, icGeom, helpers } from './library.js';
import { buildNets } from './netlist.js';
import { Circuit } from './sim.js';
import { resistance, lcr, thevenin, bode, zSweep, designChecks } from './analysis.js';
import { Editor, fmtV, designSvg } from './editor.js';
import { newDesign, uid, snap, makeComp, removeComps, detachComp, duplicate, cleanup, splitWire, addWire, copyFragment, pasteFragment, pinPos, endPos, wirePoints, nearestOnWire, compBBox, describeEnd, makeIndex, xf } from './doc.js';
import { store } from './store.js';
import { icon } from './icons.js';
import { fmt, parseEng, stepE } from './units.js';
import { drawPlot } from './plot.js';
import { openTools } from './tools.js';
import { EXAMPLES } from './examples.js';
import { infoHtml } from './info.js';
import { openPartEditor, loadCustomParts, customDefsFor, adoptCustomDefs } from './partEditor.js';
import { ldrR, photoI, coilValues, defaultProps } from './library.js';
import { adcInfo } from './analysis.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const { num } = helpers;
const MODES = ['edit', 'build', 'debug', 'measure'];
const DEBUG_STATES = [['Unchecked', ''], ['OK', 'ok'], ['Suspect', 'warn'], ['Fault', 'err']];

class App {
  constructor() {
    this.doc = newDesign();
    this.mode = 'edit';
    this.sel = { comps: new Set(), juncs: new Set(), wire: null, junc: null, net: null };
    this.undoStack = []; this.redoStack = [];
    this.ver = 0;
    this.dirty = false;
    this.simOn = true; this.showTags = true;
    this.probes = { red: null, black: null };
    this.activeProbe = 'red';
    this.meterFn = 'V';
    this.meter = { lcrF: 1000, fmin: 1, fmax: 1e6, isolate: false, srcShort: false };
    this.settings = { autoInfo: true, theme: 'auto' };
    this.sheetCollapsed = false;
    this.ckt = null;
    this.checks = [];
    this.warnComps = new Map();
    this._nets = null;
  }

  // ======================= startup =======================
  async init() {
    this.editor = new Editor($('#canvas'), this);
    this._decorate();
    this._bindUI();
    try { await loadCustomParts(); } catch (e) { console.warn('custom parts', e); }
    try {
      const sess = await store.getState('session');
      if (sess && sess.doc) {
        this.doc = sess.doc;
        await adoptCustomDefs(this.doc);
        normalize(this.doc);
        Object.assign(this, { mode: sess.mode || 'edit', simOn: sess.simOn ?? true, showTags: sess.showTags ?? true, meterFn: sess.meterFn || 'V', dirty: !!sess.dirty });
        if (sess.probes) this.probes = sess.probes;
        if (sess.meter) Object.assign(this.meter, sess.meter);
        if (sess.settings) Object.assign(this.settings, sess.settings);
        if (sess.clipboard) this.clipboard = sess.clipboard;
        if (sess.view) this.editor.view = sess.view;
      } else {
        this.doc = EXAMPLES[0].build();
      }
    } catch (e) { console.warn('restore failed', e); }
    this.applyTheme();
    this.setMode(this.mode, true);
    this.editor.applyView();
    if (!this.doc.comps.length || !(await store.getState('session'))) setTimeout(() => this.editor.fit(), 50);
    this.changed(null, { noDirty: true, noUndo: true });
    this._updateTitle();
    store.persist();
    this._registerSW();
    window.addEventListener('resize', () => this.render());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.saveSession(true); });
    window.addEventListener('pagehide', () => this.saveSession(true));
  }

  _decorate() {
    const set = (sel, name) => { const el = $(sel); if (el) el.innerHTML = icon(name); };
    set('#btnFiles', 'folder'); set('#btnUndo', 'undo'); set('#btnRedo', 'redo'); set('#btnSim', 'bolt'); set('#btnTools', 'calc'); set('#btnInstall', 'download');
    set('#btnAdd', 'plus'); set('#btnBox', 'box'); set('#btnZoomIn', 'zin'); set('#btnZoomOut', 'zout'); set('#btnFit', 'fit'); set('#partsClose', 'x'); set('#modalClose', 'x');
    document.querySelectorAll('.mi[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
  }

  _bindUI() {
    $('#modes').addEventListener('click', (e) => { const b = e.target.closest('button[data-mode]'); if (b) this.setMode(b.dataset.mode); });
    $('#btnUndo').onclick = () => this.undo();
    $('#btnRedo').onclick = () => this.redo();
    $('#btnSim').onclick = () => { this.simOn = !this.simOn; this.toast(this.simOn ? 'Live voltages on' : 'Live voltages off'); this.render(); this.saveSession(); };
    $('#btnTools').onclick = () => openTools(this);
    $('#btnInstall').onclick = () => this.openInstall();
    $('#btnFiles').onclick = () => this.openFiles();
    $('#docTitle').onclick = () => this.rename();
    $('#btnAdd').onclick = () => this.openParts();
    $('#btnBox').onclick = () => { this.editor.boxMode = !this.editor.boxMode; $('#btnBox').classList.toggle('on', this.editor.boxMode); this.toast(this.editor.boxMode ? 'Box select: drag on empty space' : 'Box select off'); };
    $('#btnZoomIn').onclick = () => this.editor.zoomAt(1.25);
    $('#btnZoomOut').onclick = () => this.editor.zoomAt(0.8);
    $('#btnFit').onclick = () => this.editor.fit();
    $('#partsClose').onclick = () => this.closeParts();
    $('#partsDrawer').addEventListener('click', (e) => { if (e.target.id === 'partsDrawer') this.closeParts(); });
    $('#modalClose').onclick = () => this.closeModal();
    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') this.closeModal(); });
    $('#sheetGrip').onclick = () => { this.sheetCollapsed = !this.sheetCollapsed; $('#sheet').classList.toggle('collapsed', this.sheetCollapsed); };
    $('#partSearch').addEventListener('input', () => this.renderParts());
    $('#fileImport').addEventListener('change', (e) => this.importFile(e.target.files[0]));
    $('#hud').addEventListener('click', (e) => {
      if (e.target.closest('#warnPill')) { if (this.mode === 'edit' || this.mode === 'build') this.setMode('debug'); this.sheetCollapsed = false; $('#sheet').classList.remove('collapsed'); const el = $('#sheetBody .checks'); if (el) el.scrollIntoView({ behavior: 'smooth' }); }
      if (e.target.closest('#progressPill')) { this.sheetCollapsed = false; $('#sheet').classList.remove('collapsed'); }
    });
    window.addEventListener('keydown', (e) => this._key(e));
  }

  _key(e) {
    if (e.target.matches('input, textarea, select')) { if (e.key === 'Escape') e.target.blur(); return; }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); this.saveDesign(); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); this.act('dup'); return; }
    if (mod && e.key.toLowerCase() === 'c' && this.mode === 'edit') { e.preventDefault(); this.act('copy'); return; }
    if (mod && e.key.toLowerCase() === 'x' && this.mode === 'edit') { e.preventDefault(); this.act('cut'); return; }
    if (mod && e.key.toLowerCase() === 'v' && this.mode === 'edit') { e.preventDefault(); this.act('paste'); return; }
    if (!$('#modal').hidden || !$('#partsDrawer').hidden) { if (e.key === 'Escape') { this.closeModal(); this.closeParts(); } return; }
    if (this.mode !== 'edit') { if (e.key === 'Escape') this.select({}); return; }
    const k = e.key.toLowerCase();
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); this.act('delete'); }
    else if (k === 'r') this.act('rotate');
    else if (k === 'f') this.act('flip');
    else if (k === 'a') this.openParts();
    else if (k === 'escape') this.select({});
  }

  // ======================= document / history =======================
  snapshot() { return JSON.stringify({ comps: this.doc.comps, wires: this.doc.wires, juncs: this.doc.juncs, status: this.doc.status, readings: this.doc.readings }); }
  checkpoint() { this.undoStack.push(this.snapshot()); if (this.undoStack.length > 150) this.undoStack.shift(); this.redoStack = []; }
  cancelCheckpoint() { this.undoStack.pop(); }
  _restore(s) { Object.assign(this.doc, JSON.parse(s)); this.select({}, true); this.changed(null, { noUndo: true }); }
  undo(silent) { if (!this.undoStack.length) return; this.redoStack.push(this.snapshot()); this._restore(this.undoStack.pop()); if (!silent) this.toast('Undo'); }
  redo() { if (!this.redoStack.length) return; this.undoStack.push(this.snapshot()); this._restore(this.redoStack.pop()); this.toast('Redo'); }

  /** Call after any mutation of the document. */
  changed(what, opts = {}) {
    this.ver++;
    this._nets = null;
    if (!opts.noDirty) { this.dirty = true; this.doc.updated = Date.now(); }
    this._validateSel();
    this.runSim();
    this.editor.render();
    if (!opts.keepSheet) this.renderSheet();
    this._updateTitle();
    this._updateHud();
    $('#btnUndo').disabled = !this.undoStack.length;
    $('#btnRedo').disabled = !this.redoStack.length;
    this.saveSession();
  }
  nets() { if (!this._nets) this._nets = buildNets(this.doc); return this._nets; }

  _validateSel() {
    const ids = new Set(this.doc.comps.map((c) => c.id));
    for (const id of [...this.sel.comps]) if (!ids.has(id)) this.sel.comps.delete(id);
    const jids = new Set(this.doc.juncs.map((j) => j.id));
    for (const id of [...this.sel.juncs]) if (!jids.has(id)) this.sel.juncs.delete(id);
    if (this.sel.wire && !this.doc.wires.some((w) => w.id === this.sel.wire)) this.sel.wire = null;
    if (this.sel.junc && !jids.has(this.sel.junc)) this.sel.junc = null;
  }

  // ======================= simulation =======================
  scheduleSim() {
    clearTimeout(this._simT);
    this._simT = setTimeout(() => this.runSim(), 30);
  }
  runSim() {
    const subset = this.mode === 'measure' && this.meter.isolate && this.sel.comps.size > 1 ? new Set(this.sel.comps) : null;
    try {
      const prev = this.ckt && this.ckt.op && !subset && !this.ckt._subset ? this.ckt.op : null;
      const ckt = new Circuit(this.doc, { subset });
      ckt._subset = !!subset;
      ckt._ver = this.ver;
      ckt.dcop(prev && prev.length === ckt.N ? prev : null);
      this.ckt = ckt;
      this.checks = designChecks(ckt);
    } catch (e) {
      console.error(e);
      this.ckt = null;
      this.checks = [{ level: 'err', msg: 'Simulation error: ' + e.message }];
    }
    this.warnComps = new Map();
    for (const w of this.checks) if (w.comp && w.level !== 'info') this.warnComps.set(w.comp, w.level === 'err' ? 'err' : this.warnComps.get(w.comp) || 'warn');
    this._bodeCache = null;
    this.editor.render();
    this._updateHud();
    this.updateLive();
  }
  simVisible() { return this.simOn && this.ckt && this.ckt.op && this.ckt._ver === this.ver; }

  // ======================= modes & selection =======================
  setMode(m, initial) {
    if (!MODES.includes(m)) m = 'edit';
    this.mode = m;
    document.body.className = 'mode-' + m;
    document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    if (m !== 'edit') { this.editor.boxMode = false; $('#btnBox').classList.remove('on'); }
    if (m === 'measure' && !this.probes.black) this._autoBlack();
    this.sel.net = null;
    this.pendingConnect = null;
    this.sheetCollapsed = false;
    $('#sheet').classList.remove('collapsed');
    if (!initial) { this.scheduleSim(); this.saveSession(); }
    this.renderSheet();
    this.editor.render();
    this._updateHud();
  }
  select(s, keepSheet) {
    this.sel = { comps: new Set(s.comps || []), juncs: new Set(s.juncs || []), wire: s.wire || null, junc: s.junc || null, net: s.net ?? null };
    if (this.sel.wire) { const w = this.doc.wires.find((x) => x.id === this.sel.wire); if (w) this.sel.net = this.nets().endNet(w.a); }
    if (this.sheetCollapsed && (this.sel.comps.size || this.sel.wire || this.sel.junc)) { this.sheetCollapsed = false; $('#sheet').classList.remove('collapsed'); }
    this.editor.render();
    void keepSheet;
    this.renderSheet();
  }

  // ---------- pointer callbacks from editor ----------
  tap(hit, pt, { shift } = {}) {
    const m = this.mode;
    if (m === 'measure') {
      if (hit.kind === 'pin' || hit.kind === 'junc' || hit.kind === 'wire') { this.setProbe(this.activeProbe, hit); return; }
      if (hit.kind === 'comp') {
        const c = this.comp(hit.c);
        if (c && TYPES[c.type].toggle) { this.toggleSwitch(c); return; }
        this.select({ comps: [hit.c] });
        return;
      }
      if (hit.kind === 'probe') { this.activeProbe = hit.which; this.renderSheet(); this.editor.render(); return; }
      return;
    }
    if (m === 'build' || m === 'debug') {
      const id = hit.kind === 'comp' ? hit.c : hit.kind === 'wire' ? hit.w : hit.kind === 'pin' ? hit.c : null;
      if (!id) { this.select({}); return; }
      const already = hit.kind === 'wire' ? this.sel.wire === id : this.sel.comps.has(id);
      this.select(hit.kind === 'wire' ? { wire: id } : { comps: [id] });
      if (already || !this.settings.selectFirst) this.cycleStatus(id);
      return;
    }
    // edit
    const node = hit.kind === 'pin' ? { c: hit.c, p: hit.p } : hit.kind === 'junc' ? { j: hit.j } : null;
    const pend = this.pendingConnect;
    if (pend && (node || hit.kind === 'wire')) {
      // second tap of tap-to-connect
      const same = node && (node.j != null ? node.j === pend.j : node.c === pend.c && node.p === pend.p);
      this.pendingConnect = null;
      if (same) { this.select({}); this.toast('Connection cancelled'); return; }
      this.checkpoint();
      let to = node;
      if (!to) { const j = splitWire(this.doc, hit.w, hit.pos); to = { j: j.id }; }
      const w = addWire(this.doc, pend, to);
      cleanup(this.doc);
      this.changed('wire');
      if (w) { this.select({ wire: w.id }); this.toast('Connected'); } else { this.select({}); this.toast('Already connected'); }
      return;
    }
    if (pend) { this.pendingConnect = null; this.editor.render(); }
    switch (hit.kind) {
      case 'comp':
        if (shift) { const s = new Set(this.sel.comps); s.has(hit.c) ? s.delete(hit.c) : s.add(hit.c); this.select({ comps: [...s] }); }
        else if (this.sel.comps.size === 1 && this.sel.comps.has(hit.c)) this.select({}); // tap again to unselect
        else this.select({ comps: [hit.c] });
        break;
      case 'wire': this.select(this.sel.wire === hit.w ? {} : { wire: hit.w }); break;
      case 'junc': case 'pin':
        // first tap of tap-to-connect: highlight this node; tap another node (or a wire) to join them
        this.pendingConnect = node;
        this.select({ net: hit.kind === 'pin' ? this.nets().pinNet(hit.c, hit.p) : this.nets().juncNet(hit.j), junc: hit.kind === 'junc' ? hit.j : null });
        this.toast('Tap another pin, node or wire to connect · tap again to cancel');
        break;
      case 'handle': break;
      default: this.select({});
    }
  }
  longPress(hit) {
    if (this.mode === 'edit' && hit.kind === 'wire') {
      this.checkpoint();
      const j = splitWire(this.doc, hit.w, hit.pos);
      cleanup(this.doc);
      this.changed('node');
      this.pendingConnect = { j: j.id };
      this.select({ junc: j.id, net: this.nets().juncNet(j.id) });
      if (navigator.vibrate) navigator.vibrate(15);
      this.toast('Node added — drag from it, or tap another pin to connect');
      return;
    }
    if (hit.kind === 'comp') { this.select({ comps: [hit.c] }); this.showInfo(this.comp(hit.c)); }
    else if (hit.kind === 'pin' || hit.kind === 'wire' || hit.kind === 'junc') {
      const net = hit.kind === 'pin' ? this.nets().pinNet(hit.c, hit.p) : hit.kind === 'junc' ? this.nets().juncNet(hit.j) : this.nets().endNet(this.doc.wires.find((w) => w.id === hit.w).a);
      this.select({ net });
    }
  }
  _pinHint(hit) {
    if (!this._pinHintShown) { this._pinHintShown = true; this.toast('Tip: drag from a pin to draw a wire'); }
    void hit;
  }
  viewChanged(end) { if (end) this.saveSession(); }
  comp(id) { return this.doc.comps.find((c) => c.id === id); }

  // ---------- build / debug status ----------
  status(id) { return this.doc.status[id] || (this.doc.status[id] = {}); }
  cycleStatus(id) {
    this.checkpoint();
    const s = this.status(id);
    if (this.mode === 'build') { s.b = s.b ? 0 : 1; this.toast(s.b ? '✓ Marked as placed / connected' : 'Marked as planned'); }
    else { s.d = ((s.d || 0) + 1) % 4; this.toast('Status: ' + DEBUG_STATES[s.d][0]); }
    this.changed('status');
  }
  setStatus(id, key, v) { this.checkpoint(); this.status(id)[key] = v; this.changed('status'); }
  progress() {
    const items = this.buildItems();
    const done = items.filter((i) => (this.doc.status[i.id] || {}).b).length;
    return { done, total: items.length };
  }
  buildItems() {
    const out = [];
    for (const c of this.doc.comps) if (!TYPES[c.type].noRef) out.push({ id: c.id, kind: 'comp', c });
    for (const w of this.doc.wires) out.push({ id: w.id, kind: 'wire', w });
    return out;
  }

  // ---------- probes ----------
  _autoBlack() {
    const g = this.doc.comps.find((c) => c.type === 'ground');
    if (g) this.probes.black = { kind: 'pin', c: g.id, p: 0 };
  }
  setProbe(which, hit) {
    let ref = null;
    if (hit.kind === 'pin') ref = { kind: 'pin', c: hit.c, p: hit.p };
    else if (hit.kind === 'junc') ref = { kind: 'junc', j: hit.j };
    else if (hit.kind === 'wire') ref = { kind: 'wire', w: hit.w, pos: [snap(hit.pos[0], 1), snap(hit.pos[1], 1)] };
    if (!ref) return;
    this.probes[which] = ref;
    this.activeProbe = which === 'black' ? 'red' : 'red';
    this._bodeCache = null;
    this.editor.render();
    this.updateLive(true);
    this.saveSession();
  }
  probeNet(which) {
    const r = this.probes[which];
    if (!r) return null;
    const n = this.nets();
    if (r.kind === 'pin') return this.comp(r.c) ? n.pinNet(r.c, r.p) : null;
    if (r.kind === 'junc') return this.doc.juncs.some((j) => j.id === r.j) ? n.juncNet(r.j) : null;
    if (r.kind === 'wire') { const w = this.doc.wires.find((x) => x.id === r.w); return w ? n.endNet(w.a) : null; }
    return null;
  }
  probePos(which) {
    const r = this.probes[which];
    if (!r) return null;
    if (r.kind === 'pin') { const c = this.comp(r.c); return c ? pinPos(c, r.p) : null; }
    if (r.kind === 'junc') { const j = this.doc.juncs.find((x) => x.id === r.j); return j ? [j.x, j.y] : null; }
    if (r.kind === 'wire') { const w = this.doc.wires.find((x) => x.id === r.w); if (!w) return null; const pts = wirePoints(this.doc, w); const n = pts && nearestOnWire(pts, r.pos); return n ? n.q : null; }
    return null;
  }
  probeLabel(which) {
    const net = this.probeNet(which);
    if (net == null) return { name: 'tap a node', sub: '' };
    const n = this.nets();
    return { name: n.nets[net]?.name || 'net', sub: n.describe(net) };
  }

  toggleSwitch(c) {
    const key = TYPES[c.type].toggle;
    this.checkpoint();
    c.props[key] = !c.props[key];
    this.toast(`${c.ref}: ${TYPES[c.type].label(c) || (c.props[key] ? 'on' : 'off')}`);
    this.changed('prop');
  }

  // ======================= sheet (bottom / side panel) =======================
  renderSheet() {
    const body = $('#sheetBody');
    let html = '';
    if (this.mode === 'edit') html = this.sheetEdit();
    else if (this.mode === 'build') html = this.sheetBuild();
    else if (this.mode === 'debug') html = this.sheetDebug();
    else html = this.sheetMeasure();
    body.innerHTML = html;
    $('#sheet').classList.toggle('empty', !html);
    document.body.classList.toggle('sheet-hidden', !html);
    this._bindSheet(body);
    this.updateLive();
  }

  _bindSheet(body) {
    body.querySelectorAll('[data-act]').forEach((el) => {
      const ev = el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' ? 'change' : el.tagName === 'INPUT' ? (el.type === 'range' ? 'input' : 'change') : 'click';
      el.addEventListener(ev, (e) => { e.stopPropagation(); this.act(el.dataset.act, el, e); });
    });
    body.querySelectorAll('[data-prop]').forEach((el) => {
      const handler = () => this.setProp(el.dataset.cid, el.dataset.prop, el.value, el);
      if (el.type === 'range') el.addEventListener('input', handler);
      else {
        el.addEventListener('change', handler);
        if (el.tagName === 'INPUT') {
          // apply as you type (no need to press Enter / leave the field)
          el.addEventListener('input', () => this.setProp(el.dataset.cid, el.dataset.prop, el.value, el, true));
          el.addEventListener('blur', () => { if (this._typingEl === el) this._typingEl = null; });
          el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
        }
      }
    });
    // reference designator & notes also apply as you type
    body.querySelectorAll('input[data-act=ref]').forEach((el) => el.addEventListener('input', () => this.act('ref', el, { type: 'input' })));
    body.querySelectorAll('textarea[data-act=note]').forEach((el) => el.addEventListener('input', () => { this.status(el.dataset.id).note = el.value; this.dirty = true; this._updateTitle(); this.saveSession(); }));
  }

  sheetEdit() {
    const s = this.sel;
    if (s.comps.size === 1) return this.propSheet(this.comp([...s.comps][0]));
    if (s.comps.size > 1) {
      return `<div class="sh-head"><h3>${s.comps.size} components selected</h3></div>
      <div class="actions">${this.btn('rotate', 'Rotate', 'rotate')}${this.btn('copy', 'Copy', 'copy')}${this.clipboard ? this.btn('paste', 'Paste', 'paste') : ''}${this.btn('dup', 'Duplicate', 'copy')}${this.btn('delete', 'Delete', 'trash', 'danger')}${this.btn('clearsel', 'Clear', 'x')}</div>
      <div class="hint">Drag any selected part to move the group. In <b>Measure</b> mode you can analyse just this selection (“Isolate”).</div>`;
    }
    if (s.wire) {
      const w = this.doc.wires.find((x) => x.id === s.wire);
      const net = this.nets().endNet(w.a);
      return `<div class="sh-head"><h3>Wire</h3><span class="sub">${esc(this.endLabel(w.a, w))} → ${esc(this.endLabel(w.b, w))}</span></div>
      <div class="kv"><dt>Net</dt><dd>${esc(this.nets().nets[net]?.name)}</dd><dt>Voltage</dt><dd data-live="netv" data-net="${net}">—</dd></div>
      <div class="actions">${this.btn('bend', 'Bend', 'bend')}${this.btn('delwire', 'Delete wire', 'trash', 'danger')}</div>
      <div class="hint">Drag the blue end handles to move a connection to another pin, or onto empty space to disconnect it.</div>`;
    }
    if (s.junc) {
      return `<div class="sh-head"><h3>Junction</h3></div><div class="kv"><dt>Voltage</dt><dd data-live="netv" data-net="${this.nets().juncNet(s.junc)}">—</dd></div>
      <div class="actions">${this.btn('deljunc', 'Delete junction', 'trash', 'danger')}</div><div class="hint">Drag the junction to move it; drop it on a pin to connect. Or tap another pin / node / wire to wire it there.</div>`;
    }
    if (s.net != null) return this.netSheet(s.net);
    const n = this.doc.comps.length;
    return `<div class="sh-head"><h3>${n ? 'Editing' : 'Start a circuit'}</h3></div>
      <div class="hint">${n ? '' : 'Tap <b>+</b> to add parts. '}Tap a part to edit its values. <b>Drag from a pin</b> to wire it; drop on a pin, a wire or empty space. Pinch / scroll to zoom, drag the background to pan.</div>
      <div class="actions">${this.btn('addpart', 'Add part', 'plus', 'pri')}${this.clipboard ? this.btn('paste', `Paste (${this.clipboard.comps.length})`, 'paste') : ''}${this.btn('examples', 'Examples', 'book')}${this.btn('tools', 'Calculators', 'calc')}</div>`;
  }

  netSheet(net) {
    const n = this.nets();
    return `<div class="sh-head"><h3>Node ${esc(n.nets[net]?.name)}</h3></div>
    <div class="kv"><dt>Voltage</dt><dd data-live="netv" data-net="${net}">—</dd><dt>Connects</dt><dd style="font-family:inherit">${esc(n.describe(net)) || '—'}</dd></div>
    <div class="actions">${this.btn('probe-red', 'Red probe here', 'meter')}${this.btn('probe-black', 'Black probe here', 'meter')}</div>`;
  }

  btn(act, label, ic, cls = '', data = '') { return `<button class="btn ${cls}" data-act="${act}" ${data}>${ic ? icon(ic) : ''}${label}</button>`; }

  propSheet(c) {
    if (!c) return '';
    const def = TYPES[c.type];
    const info = partInfo(c);
    let h = `<div class="sh-head"><input class="refin" data-act="ref" value="${esc(c.ref)}" ${def.noRef ? 'hidden' : ''} aria-label="Reference"><h3>${esc(c.type === 'ic' ? info.title : def.name)}${c.props.part && c.type !== 'ic' ? ` <span class="sub">${esc(c.props.part)}</span>` : ''}</h3>
      <button class="ib" data-act="info" title="Specs & pinout">${icon('info')}</button></div>`;
    h += '<div class="props">';
    for (const o of propDefs(c)) h += this.propField(c, o);
    h += '</div>';
    if (c.type === 'ic' && (icGeom(c).def.units || []).some((u) => u.k === 'mcu')) h += this.gpioTable(c);
    if (c.type === 'ic') {
      const def = ICS[c.props.part] || {};
      if (def.custom) h += `<div class="actions">${this.btn('editpart', 'Edit part definition', 'edit')}</div>`;
      else if (def.layout === 'header' || def.customInline) h += `<div class="actions">${this.btn('editpart', 'Customize pinout → save as new part', 'chip')}</div>`;
    }
    h += `<div class="actions">`;
    if (def.toggle) h += this.btn('toggle', 'Toggle', 'toggle', 'pri');
    h += this.btn('rotate', 'Rotate', 'rotate') + this.btn('flip', 'Flip', 'flip') + this.btn('copy', 'Copy', 'copy') + (this.clipboard ? this.btn('paste', 'Paste', 'paste') : '') + this.btn('dup', 'Duplicate', 'copy') + this.btn('detach', 'Detach', 'unlink') + this.btn('delete', 'Delete', 'trash', 'danger');
    h += `</div>`;
    h += `<div class="sec">Operating point</div><div data-live="comp" data-cid="${c.id}" class="kv"></div><div data-live="compwarn" data-cid="${c.id}"></div>`;
    if (info.pinout && info.pinout.length && c.type !== 'ic') {
      h += `<div class="sec">Pinout · ${esc(info.pkg || '')}</div><table class="pins-table">${info.pinout.map(([a, b]) => `<tr><td class="mono">${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table>`;
    }
    if (info.specs && info.specs.length) h += `<div class="sec">Key specs</div><table class="specs">${info.specs.slice(0, 6).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;
    if (info.desc && !info.specs.length) h += `<div class="hint">${esc(info.desc)}</div>`;
    return h;
  }

  propField(c, o) {
    const v = c.props[o.key];
    const id = `p_${o.key}`;
    let ctl;
    if (o.parts) {
      const opts = partOptions(o.parts);
      ctl = `<select class="inp" id="${id}" data-cid="${c.id}" data-prop="${o.key}">${opts.map((p) => `<option ${p === v ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>`;
    } else if (o.options) {
      ctl = `<select class="inp" id="${id}" data-cid="${c.id}" data-prop="${o.key}">${o.options.map((p) => `<option ${p === v ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>`;
    } else if (o.bool) {
      ctl = `<button class="toggle ${v ? 'on' : ''}" data-act="bool" data-cid="${c.id}" data-key="${o.key}" aria-label="${esc(o.label)}"></button>`;
    } else if (o.range) {
      const [a, b, st] = o.range;
      const x = num(v, a);
      const sv = o.log ? Math.log10(Math.max(x, a > 0 ? a : 0.01)) : x;
      const smin = o.log ? Math.log10(a > 0 ? a : 0.01) : a, smax = o.log ? Math.log10(b) : b;
      ctl = `<div class="valrow"><input type="range" min="${smin}" max="${smax}" step="${o.log ? 0.01 : st}" value="${sv}" data-cid="${c.id}" data-prop="${o.key}" ${o.log ? 'data-log="1"' : ''} style="flex:1;min-width:80px"><input class="inp" style="flex:0 0 84px" type="text" id="${id}" value="${esc(v)}" data-cid="${c.id}" data-prop="${o.key}" autocomplete="off" autocapitalize="off" spellcheck="false"><span class="unit">${esc(o.unit || '')}</span></div>`;
    } else if (o.slider) {
      const [a, b, st] = o.slider;
      ctl = `<div class="valrow"><input type="range" min="${a}" max="${b}" step="${st}" value="${num(v, 0.5)}" data-cid="${c.id}" data-prop="${o.key}"><span class="unit" data-live="slv">${Math.round(num(v, 0.5) * 100)}%</span></div>`;
    } else {
      ctl = `<div class="valrow">${o.estep ? `<button class="stepb" data-act="estep" data-dir="-1" data-cid="${c.id}" data-key="${o.key}">−</button>` : ''}<input class="inp" type="text" id="${id}" value="${esc(v)}" data-cid="${c.id}" data-prop="${o.key}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">${o.estep ? `<button class="stepb" data-act="estep" data-dir="1" data-cid="${c.id}" data-key="${o.key}">+</button>` : ''}<span class="unit">${esc(o.unit || '')}</span></div>`;
    }
    return `<div class="field"><label for="${id}">${esc(o.label)}</label>${ctl}</div>`;
  }

  gpioTable(c) {
    const g = icGeom(c);
    const unit = g.def.units.find((u) => u.k === 'mcu');
    const io = g.pins.map((p, i) => [p, i]).filter(([p]) => p.fn === 'io' && (!g.def.gpioPins || g.def.gpioPins.includes(p.name)));
    const only = new Set((g.def.inputOnly || []).map((n) => 'IO' + n));
    const clocks = !!g.def.gpioPins;
    const modes = [['in', 'Input (Hi-Z)'], ['in_pu', 'Input + pull-up'], ['in_pd', 'Input + pull-down'], ['high', 'Output HIGH'], ['low', 'Output LOW'], ['pwm', 'PWM (avg)']];
    if (clocks) modes.splice(0, modes.length, ['low', 'Disabled (LOW)'], ['pwm', 'Enabled (square, avg)'], ['high', 'Forced HIGH']);
    let h = `<div class="sec">${clocks ? 'Clock outputs' : 'GPIO states'} · ${unit.vlogic} V logic</div><table class="pins-table"><tr><th>Pin</th><th>Mode</th><th>V</th></tr>`;
    for (const [p, i] of io) {
      const m = (c.props.gpio || {})[p.name] || 'in';
      const isOnly = only.has(p.name.split('/')[0]);
      h += `<tr><td class="mono">${esc(p.name)}</td><td><select class="inp" data-act="gpio" data-cid="${c.id}" data-pin="${esc(p.name)}" style="padding:5px 26px 5px 8px;font-size:13px">${modes.filter(([k]) => !isOnly || k === 'in').map(([k, l]) => `<option value="${k}" ${k === m ? 'selected' : ''}>${l}</option>`).join('')}</select>${m === 'pwm' ? `<input class="inp" style="width:64px;margin-top:4px;padding:4px 6px" data-act="duty" data-cid="${c.id}" data-pin="${esc(p.name)}" value="${esc((c.props.duty || {})[p.name] ?? 50)}" inputmode="decimal" autocapitalize="off"> %` : ''}</td><td class="mono" data-live="pinv" data-cid="${c.id}" data-pin="${i}">—</td></tr>`;
    }
    return h + '</table>';
  }

  setProp(cid, key, val, el, live) {
    const c = this.comp(cid);
    if (!c) return;
    const o = propDefs(c).find((x) => x.key === key) || {};
    if (o.eng) {
      const v = parseEng(val);
      if (!Number.isFinite(v)) { el?.classList.add('bad'); if (!live) this.toast('Could not read “' + val + '” — try 4.7k, 100n, 10u'); return; }
      el?.classList.remove('bad');
    }
    if (!live && el?.type !== 'range' && String(c.props[key]) === String(val) && key !== 'part') return; // already applied while typing
    if (live) {
      if (this._typingEl !== el) { this.checkpoint(); this._typingEl = el; }
      c.props[key] = val;
      if (o.range) { const r = el.parentElement?.querySelector('input[type=range]'); const x = parseEng(val); if (r && Number.isFinite(x)) r.value = r.dataset.log ? Math.log10(Math.max(x, 1e-3)) : x; }
      this.changed('prop', { keepSheet: true });
      return;
    }
    if (o.slider) { const live = el?.parentElement?.querySelector('[data-live=slv]'); if (live) live.textContent = Math.round(val * 100) + '%'; }
    if (o.range && el?.type === 'range') {
      let x = +val;
      if (el.dataset.log) x = Math.pow(10, x);
      x = +x.toPrecision(3);
      val = String(x);
      const t = el.parentElement.querySelector('input[type=text]'); if (t) t.value = val;
    } else if (o.range) {
      const x = parseEng(val);
      const r = el?.parentElement?.querySelector('input[type=range]');
      if (r && Number.isFinite(x)) r.value = el && r.dataset.log ? Math.log10(Math.max(x, 1e-3)) : x;
    }
    const sliding = (o.slider || o.range) && el?.type === 'range';
    if (!sliding || !this._sliding) { this.checkpoint(); this._sliding = sliding; }
    if (sliding) { clearTimeout(this._slideT); this._slideT = setTimeout(() => { this._sliding = false; }, 600); }
    c.props[key] = o.slider ? +val : val;
    if (key === 'part') {
      if (c.type === 'ic') { c.props.gpio = {}; c.props.duty = {}; }
      applyPartFill(c.type, c.props);
      this.changed('prop');
      if (this.settings.autoInfo && (PARTS[val]?.pinout || ICS[val])) this.showInfo(c);
      return;
    }
    const rerender = c.type === 'ic' && ['pinCount', 'pinNames', 'title', 'leftPins', 'rightPins', 'vinPin', 'railPin', 'vlogic'].includes(key) || key === 'mode';
    this.changed('prop', { keepSheet: !rerender });
  }

  // ---------- build sheet ----------
  sheetBuild() {
    const { done, total } = this.progress();
    const pct = total ? Math.round((done / total) * 100) : 0;
    let h = `<div class="sh-head"><h3>Build progress</h3><span class="sub">${done}/${total} · ${pct}%</span></div>
      <div class="pbar" style="width:100%;height:8px;margin-bottom:8px"><i style="width:${pct}%"></i></div>`;
    const selId = this.sel.wire || (this.sel.comps.size === 1 ? [...this.sel.comps][0] : null);
    if (selId) {
      const s = this.doc.status[selId] || {};
      h += `<div class="card"><div class="row" style="margin-bottom:8px"><b>${esc(this.itemLabel(selId))}</b></div>
        <div class="statusbar">${this.btn('bstat', 'Planned', '', !s.b ? 'sel' : '', 'data-v="0"')}${this.btn('bstat', 'Placed ✓', '', s.b ? 'sel ok' : '', 'data-v="1"')}</div>
        <textarea class="inp" style="margin-top:8px" placeholder="Build note (e.g. used 4.7k instead)…" data-act="note" data-id="${selId}">${esc(s.note || '')}</textarea></div>`;
    } else h += `<div class="hint">Tap parts and wires on the schematic as you place them on the board — they turn solid with a ✓. Faded items are still to do.</div>`;
    h += `<div class="actions">${this.btn('ball', 'Mark all placed', 'check')}${this.btn('breset', 'Reset build', 'undo', 'danger')}</div>`;
    const items = this.buildItems();
    const comps = items.filter((i) => i.kind === 'comp').sort((a, b) => a.c.ref.localeCompare(b.c.ref, undefined, { numeric: true }));
    const wires = items.filter((i) => i.kind === 'wire');
    const row = (it) => {
      const s = this.doc.status[it.id] || {};
      return `<div class="li" data-act="locate" data-id="${it.id}"><button class="chk ${s.b ? 'on' : ''}" data-act="bchk" data-id="${it.id}">${s.b ? icon('check') : ''}</button><div class="grow"><div class="t1">${esc(this.itemLabel(it.id))}</div>${s.note ? `<div class="t2">${esc(s.note)}</div>` : ''}</div></div>`;
    };
    h += `<div class="sec">Components (${comps.filter((i) => (this.doc.status[i.id] || {}).b).length}/${comps.length})</div><div class="list">${comps.map(row).join('') || '<div class="hint">No components yet.</div>'}</div>`;
    h += `<div class="sec">Connections (${wires.filter((i) => (this.doc.status[i.id] || {}).b).length}/${wires.length})</div><div class="list">${wires.map(row).join('') || '<div class="hint">No wires yet.</div>'}</div>`;
    return h;
  }

  itemLabel(id) {
    const c = this.comp(id);
    if (c) { const v = TYPES[c.type].label ? TYPES[c.type].label(c) : ''; return `${c.ref}  ${c.type === 'ic' ? c.props.part : v || TYPES[c.type].name}`; }
    const w = this.doc.wires.find((x) => x.id === id);
    if (w) return `${this.endLabel(w.a, w)} → ${this.endLabel(w.b, w)}`;
    return id;
  }
  /** Describe a wire end; for junctions, list the pins reachable through it. */
  endLabel(e, fromWire) {
    if (e.j == null) return describeEnd(this.doc, e);
    const seen = new Set([fromWire?.id]), found = [], stack = [e.j], vis = new Set();
    while (stack.length && found.length < 3) {
      const j = stack.pop();
      if (vis.has(j)) continue;
      vis.add(j);
      for (const w of this.doc.wires) {
        if (seen.has(w.id)) continue;
        let other = null;
        if (w.a.j === j) other = w.b; else if (w.b.j === j) other = w.a;
        if (!other) continue;
        seen.add(w.id);
        if (other.j != null) stack.push(other.j); else found.push(describeEnd(this.doc, other));
      }
    }
    return found.length ? found.join(' / ') : 'junction';
  }

  // ---------- debug sheet ----------
  sheetDebug() {
    const items = this.buildItems();
    const cnt = [0, 0, 0, 0];
    for (const it of items) cnt[(this.doc.status[it.id] || {}).d || 0]++;
    let h = `<div class="sh-head"><h3>Troubleshoot</h3><span class="sub">✓ ${cnt[1]} · ? ${cnt[2]} · ! ${cnt[3]} · ${cnt[0]} unchecked</span></div>`;
    const selId = this.sel.wire || (this.sel.comps.size === 1 ? [...this.sel.comps][0] : null);
    if (selId) {
      const s = this.doc.status[selId] || {};
      h += `<div class="card"><div class="row" style="margin-bottom:8px"><b>${esc(this.itemLabel(selId))}</b></div>
        <div class="statusbar">${DEBUG_STATES.map(([l, cls], i) => this.btn('dstat', l, '', (s.d || 0) === i ? 'sel ' + cls : '', `data-v="${i}"`)).join('')}</div>
        ${this.comp(selId) ? `<div class="sec">Expected (simulated)</div><div class="kv" data-live="comp" data-cid="${selId}"></div><div data-live="compwarn" data-cid="${selId}"></div>` : ''}
        <textarea class="inp" style="margin-top:8px" placeholder="Finding / note (e.g. cold joint on pin 3)…" data-act="note" data-id="${selId}">${esc(s.note || '')}</textarea></div>`;
    } else h += `<div class="hint">Tap a part or wire to cycle its state: <b>OK → Suspect → Fault → unchecked</b>. Use <b>Measure</b> to compare real readings with the simulated values.</div>`;
    h += `<div class="sec">Design checks</div><div class="checks" data-live="checks"></div>`;
    const flagged = items.filter((it) => (this.doc.status[it.id] || {}).d >= 2 || (this.doc.status[it.id] || {}).note);
    if (flagged.length) h += `<div class="sec">Flagged items</div><div class="list">${flagged.map((it) => { const s = this.doc.status[it.id]; return `<div class="li" data-act="locate" data-id="${it.id}"><i class="dot ${['', 'ok', 'warn', 'err'][s.d || 0]}"></i><div class="grow"><div class="t1">${esc(this.itemLabel(it.id))}</div>${s.note ? `<div class="t2">${esc(s.note)}</div>` : ''}</div></div>`; }).join('')}</div>`;
    h += this.readingsHtml();
    h += `<div class="actions">${this.btn('dreset', 'Reset troubleshooting', 'undo', 'danger')}</div>`;
    return h;
  }
  readingsHtml() {
    const r = this.doc.readings || [];
    if (!r.length) return `<div class="sec">Readings log</div><div class="hint">In Measure mode, enter what your real meter shows and tap <b>Log</b> to compare it with the expected value.</div>`;
    return `<div class="sec">Readings log</div><div class="list">${r.slice().reverse().map((x) => {
      const dev = Number.isFinite(x.expected) && Math.abs(x.expected) > 1e-9 ? ((x.measured - x.expected) / Math.abs(x.expected)) * 100 : null;
      const cls = dev == null ? 'info' : Math.abs(dev) < 5 ? 'ok' : Math.abs(dev) < 15 ? 'warn' : 'err';
      return `<div class="li"><i class="dot ${cls}"></i><div class="grow"><div class="t1">${esc(x.what)}: ${esc(fmt(x.measured, x.unit))} <span class="t2">expected ${esc(fmt(x.expected, x.unit))}${dev != null ? ` · ${dev > 0 ? '+' : ''}${dev.toFixed(1)}%` : ''}</span></div><div class="t2">${new Date(x.t).toLocaleString()}</div></div><button class="ib" data-act="delreading" data-t="${x.t}">${icon('x')}</button></div>`;
    }).join('')}</div>`;
  }

  // ---------- measure sheet ----------
  sheetMeasure() {
    const fns = [['V', 'V⎓ Volts'], ['R', 'Ω Ohms'], ['LCR', 'C · L · Z'], ['bode', '∿ Freq. response'], ['node', '⊿ Node / divider']];
    const red = this.probeLabel('red'), black = this.probeLabel('black');
    const bodeMode = this.meterFn === 'bode';
    let h = `<div class="meter"><div class="fnchips">${fns.map(([k, l]) => `<button data-act="fn" data-fn="${k}" class="${this.meterFn === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="lcd" data-live="lcd"><div class="lbl">—</div><div class="main">—</div><div class="sub"></div></div>
      <div class="probes">
        <button class="probebtn red ${this.activeProbe === 'red' ? 'active' : ''}" data-act="aprobe" data-p="red"><i></i><span><b>${bodeMode ? 'IN' : 'Red'}:</b> ${esc(red.name)}<small>${esc(red.sub)}</small></span></button>
        <button class="probebtn black ${this.activeProbe === 'black' ? 'active' : ''}" data-act="aprobe" data-p="black"><i></i><span><b>${bodeMode ? 'OUT' : 'Black'}:</b> ${esc(black.name)}<small>${esc(black.sub)}</small></span></button>
        <button class="ib" data-act="swap" title="Swap probes">${icon('swap')}</button>
      </div>`;
    h += `<div class="hint" style="padding:0">${this.activeProbe === 'red' ? 'Tap a node to place the <b style="color:var(--red)">' + (bodeMode ? 'input' : 'red') + '</b> probe' : 'Tap a node to place the <b>' + (bodeMode ? 'output' : 'black') + '</b> probe'} · drag probes to move · tap switches to toggle them.</div>`;
    if (this.meterFn === 'LCR' || this.meterFn === 'bode') {
      h += `<canvas class="plot" data-live="plot"></canvas><div class="summary" data-live="summary"></div>`;
    }
    if (this.meterFn === 'LCR') {
      const lf = Math.log10(this.meter.lcrF);
      h += `<div class="field"><label>Test frequency</label><div class="valrow"><input type="range" min="1" max="7" step="0.01" value="${lf}" data-act="lcrf"><input class="inp" style="flex:0 0 100px" autocapitalize="off" data-act="lcrft" value="${fmt(this.meter.lcrF, 'Hz')}"></div></div>`;
    }
    if (this.meterFn === 'bode') {
      h += `<div class="field"><label>Sweep range</label><div class="valrow"><input class="inp" autocapitalize="off" data-act="fmin" value="${fmt(this.meter.fmin, 'Hz')}"><span class="unit">to</span><input class="inp" autocapitalize="off" data-act="fmax" value="${fmt(this.meter.fmax, 'Hz')}"></div></div>`;
    }
    if (this.meterFn === 'R' || this.meterFn === 'LCR') {
      h += `<div class="field"><label>Power sources</label><div class="row"><button class="toggle ${this.meter.srcShort ? 'on' : ''}" data-act="srcshort"></button><span class="unit">${this.meter.srcShort ? 'shorted (supplies as 0 Ω)' : 'removed (power off)'}</span></div></div>`;
    }
    h += `<div class="field"><label>Isolate selection</label><div class="row"><button class="toggle ${this.meter.isolate ? 'on' : ''}" data-act="isolate"></button><span class="unit">${this.sel.comps.size > 1 ? this.sel.comps.size + ' parts selected' : 'select parts in Edit (box select) to analyse only them'}</span></div></div>`;
    if (this.meterFn === 'V' || this.meterFn === 'R' || this.meterFn === 'node') {
      h += `<div class="sec">Log a real measurement</div><div class="valrow"><input class="inp" id="measIn" placeholder="Your meter reads… (e.g. 4.97, 3k3)" autocapitalize="off" autocorrect="off" autocomplete="off"><button class="btn pri" data-act="logreading">${icon('log')}Log</button></div>`;
    }
    return h + '</div>';
  }

  /** Update all live readouts (sim-dependent) without rebuilding the sheet. */
  updateLive(full) {
    if (full && this.mode === 'measure') { this.renderSheet(); return; }
    const body = $('#sheetBody');
    const ckt = this.ckt;
    body.querySelectorAll('[data-live=netv]').forEach((el) => { el.textContent = ckt && ckt.op ? fmt(ckt.V(+el.dataset.net), 'V', 4) : '—'; });
    body.querySelectorAll('[data-live=pinv]').forEach((el) => {
      const c = this.comp(el.dataset.cid);
      if (!c || !ckt || !ckt.op) { el.textContent = '—'; return; }
      const i = +el.dataset.pin, v = ckt.pinV(c.id, i), I = (ckt.pinI.get(c.id) || [])[i] || 0;
      el.textContent = fmtV(v) + (Math.abs(I) > 1e-5 ? ` ${fmt(-I, 'A', 2)}` : '');
    });
    body.querySelectorAll('[data-live=comp]').forEach((el) => { el.innerHTML = this.compReadout(this.comp(el.dataset.cid)); });
    body.querySelectorAll('[data-live=compwarn]').forEach((el) => { const id = el.dataset.cid; el.innerHTML = this.checks.filter((w) => w.comp === id).map((w) => `<div class="wmsg"><i class="dot ${w.level}"></i><div>${esc(w.msg)}</div></div>`).join(''); });
    body.querySelectorAll('[data-live=checks]').forEach((el) => {
      el.innerHTML = this.checks.length ? this.checks.map((w) => `<div class="wmsg" data-loc="${w.comp || ''}"><i class="dot ${w.level}"></i><div>${esc(w.msg)}</div></div>`).join('') : '<div class="hint">✓ No problems found in the simulated design.</div>';
      el.querySelectorAll('[data-loc]').forEach((m) => m.addEventListener('click', () => { if (m.dataset.loc) this.locate(m.dataset.loc); }));
    });
    if (this.mode === 'measure') this.updateMeter();
  }

  compReadout(c) {
    const ckt = this.ckt;
    if (!c) return '';
    if (!ckt || !ckt.op) return '<dt>Simulation</dt><dd>not solved</dd>';
    const pins = getPins(c);
    const I = ckt.pinI.get(c.id) || [];
    const V = pins.map((_, i) => ckt.pinV(c.id, i));
    let h = '';
    const two = pins.length === 2 && !['ground', 'rail', 'netlabel'].includes(c.type);
    if (c.type === 'ldr') h += `<dt>Resistance</dt><dd>${fmt(ldrR(c), 'Ω', 4)} @ ${fmt(num(c.props.lux, 0), 'lux')}</dd>`;
    if (c.type === 'photodiode') h += `<dt>Photocurrent</dt><dd>${fmt(photoI(c), 'A')} @ ${fmt(num(c.props.lux, 0), 'lux')}</dd>`;
    if (c.type === 'pickup') {
      const k = coilValues(c);
      h += `<dt>Inductance</dt><dd>${fmt(k.L, 'H', 4)}</dd><dt>DC resistance</dt><dd>${fmt(k.R, 'Ω', 4)}</dd><dt>L/R corner</dt><dd>${fmt(k.R / (2 * Math.PI * k.L), 'Hz')}</dd>`;
      if (k.dWire) h += `<dt>Wire</dt><dd>⌀${k.dWire.toFixed(4)} mm · ${fmt(k.wireLen, 'm')}</dd>`;
      h += `<dt>Resonance w/ 470 pF cable</dt><dd>${fmt(1 / (2 * Math.PI * Math.sqrt(k.L * 470e-12)), 'Hz')}</dd>`;
    }
    if (two) {
      const vd = V[0] - V[1];
      h += `<dt>Voltage across</dt><dd>${fmt(vd, 'V', 4)}</dd><dt>Current</dt><dd>${fmt(I[0], 'A', 3)}</dd>`;
      if (c.type !== 'capacitor' && c.type !== 'cap_pol') h += `<dt>Power</dt><dd>${fmt(Math.abs(vd * I[0]), 'W', 3)}</dd>`;
      h += `<dt>Pin voltages</dt><dd>${pins.map((p, i) => `${p.name}: ${fmtV(V[i])}`).join(' · ')}</dd>`;
    } else if (c.type === 'ic') {
      const g = icGeom(c);
      const rows = g.pins.map((p, i) => [p, i]).filter(([p]) => p.fn !== 'nc');
      const adc = adcInfo(c, g, V);
      if (adc) h += `<dt><b>ADC</b></dt><dd>${adc.bits}-bit · FSR ±${fmt(adc.fsr, 'V', 4)} · LSB ${fmt(adc.lsb, 'V', 3)}</dd>` + adc.channels.map((ch) => `<dt>${esc(ch.name)} → code</dt><dd>${fmt(ch.v, 'V', 5)} → ${ch.code} (0x${ch.hex})${ch.clip ? ' ⚠ clipped' : ''}</dd>`).join('');
      const def = g.def;
      if (def.gpioPins && def.extraProps) h += def.gpioPins.map((pn, k) => `<dt>${pn}</dt><dd>${(c.props.gpio || {})[pn] === 'pwm' ? fmt(parseEng(c.props['f' + k]), 'Hz') + ' square' : 'off'}</dd>`).join('');
      h += rows.map(([p, i]) => `<dt>${esc(p.num)} ${esc(p.name)}</dt><dd>${fmtV(V[i])}${Math.abs(I[i] || 0) > 1e-5 ? ' · ' + fmt(-I[i], 'A', 2) : ''}</dd>`).join('');
    } else {
      h += pins.map((p, i) => `<dt>${esc(p.name)}</dt><dd>${fmtV(V[i])}${Math.abs(I[i] || 0) > 1e-6 ? ' · ' + fmt(-I[i], 'A', 3) + ' out' : ''}</dd>`).join('');
      if (c.type === 'nmos' || c.type === 'pmos') h += `<dt>VGS / VDS</dt><dd>${fmtV(V[0] - V[2])} / ${fmtV(V[1] - V[2])}</dd><dt>ID</dt><dd>${fmt(Math.abs(I[1] || 0), 'A')}</dd>`;
      if (c.type === 'npn' || c.type === 'pnp') h += `<dt>VBE / VCE</dt><dd>${fmtV(V[0] - V[2])} / ${fmtV(V[1] - V[2])}</dd><dt>IC / IB</dt><dd>${fmt(Math.abs(I[1] || 0), 'A')} / ${fmt(Math.abs(I[0] || 0), 'A')}</dd>`;
      if (c.type === 'reg') h += `<dt>Dissipation</dt><dd>${fmt(Math.abs((V[0] - V[1]) * (I[1] || 0)), 'W')}</dd>`;
      if (c.type === 'phototransistor') h += `<dt>Light current</dt><dd>${fmt(photoI(c), 'A')}</dd>`;
    }
    return h;
  }

  updateMeter() {
    const lcd = $('#sheetBody [data-live=lcd]');
    if (!lcd) return;
    const ckt = this.ckt;
    const red = this.probeNet('red'), black = this.probeNet('black') ?? (this.nets().gndNet >= 0 ? this.nets().gndNet : null);
    const set = (lbl, main, sub = '', ol = false) => { lcd.innerHTML = `<div class="lbl">${lbl}</div><div class="main${ol ? ' ol' : ''}">${main}</div><div class="sub">${sub}</div>`; };
    this._lastReading = null;
    if (!ckt) { set('Error', 'ERR', 'Circuit could not be simulated'); return; }
    const fn = this.meterFn;
    if (red == null) { set(fn === 'bode' ? 'Frequency response' : 'Probe', '— — —', 'Tap a node on the schematic to place the red probe'); return; }
    if (fn === 'V') {
      if (!ckt.op) { set('DC volts', 'ERR', 'DC operating point did not converge'); return; }
      const v = ckt.V(red) - (black != null ? ckt.V(black) : 0);
      const vr = ckt.V(red), vb = black != null ? ckt.V(black) : 0;
      const ratio = Math.abs(vb) > 1e-9 ? vr / vb : null;
      set('DC volts · red − black', fmt(v, 'V', 5), `Red to GND ${fmt(vr, 'V', 4)} · Black to GND ${fmt(vb, 'V', 4)}${ratio != null && black !== this.nets().gndNet ? `<br>Ratio red/black ${ratio.toFixed(4)}` : ''}`);
      this._lastReading = { value: v, unit: 'V', what: `V ${this.probeLabel('red').name}→${this.probeLabel('black').name}` };
    } else if (fn === 'R') {
      if (black == null || black === red) { set('Ohms', '0 Ω', 'Place the black probe on a different node'); return; }
      const r = resistance(ckt, red, black, { srcShort: this.meter.srcShort });
      if (r.open || !Number.isFinite(r.ohms)) set('Ohms · power off', 'O.L', 'Open circuit (> 1 GΩ)', true);
      else set('Ohms · power off', fmt(r.ohms, 'Ω', 5), 'Capacitors open, inductors = DCR, semiconductors & ICs removed');
      this._lastReading = { value: r.ohms, unit: 'Ω', what: `R ${this.probeLabel('red').name}–${this.probeLabel('black').name}` };
    } else if (fn === 'LCR') {
      if (black == null || black === red) { set('LCR', '—', 'Place the black probe on a different node'); return; }
      const m = lcr(ckt, red, black, this.meter.lcrF, { srcShort: this.meter.srcShort });
      if (!m || m.open) { set(`LCR @ ${fmt(this.meter.lcrF, 'Hz')}`, 'O.L', 'Open circuit', true); }
      else {
        const main = m.cs ? fmt(m.cs, 'F', 4) : m.ls ? fmt(m.ls, 'H', 4) : fmt(m.rs, 'Ω', 4);
        const kind = m.cs ? 'Capacitive (Cs)' : m.ls ? 'Inductive (Ls)' : 'Resistive';
        set(`LCR @ ${fmt(this.meter.lcrF, 'Hz')} · ${kind}`, main, `|Z| ${fmt(m.z, 'Ω', 4)} ∠ ${m.phase.toFixed(1)}° · ESR ${fmt(m.rs, 'Ω', 3)}${m.d != null ? ` · D ${m.d.toFixed(4)}` : ''}${m.q != null ? ` · Q ${m.q.toFixed(2)}` : ''}`);
      }
      this._plotZ(red, black);
    } else if (fn === 'bode') {
      if (black == null || black === red) { set('Frequency response', '—', 'Place the OUT (black) probe on the output node'); return; }
      this._plotBode(red, black, set);
    } else if (fn === 'node') {
      if (!ckt.op) { set('Node', 'ERR', 'DC did not converge'); return; }
      const t = thevenin(ckt, red);
      const vb = black != null ? ckt.V(black) : 0;
      const ratio = Math.abs(vb) > 1e-9 && black !== this.nets().gndNet ? t.vth / vb : null;
      set('Node voltage (to GND)', fmt(t.vth, 'V', 5), `Thevenin: ${fmt(t.vth, 'V', 4)} behind R<sub>th</sub> ${fmt(t.rth, 'Ω', 4)}${ratio != null ? `<br>Divider ratio vs black node (${fmt(vb, 'V', 4)}): ${ratio.toFixed(4)} (${(20 * Math.log10(Math.abs(ratio))).toFixed(2)} dB)` : '<br>Put the black probe on the supply node to read the divider ratio'}<br>Loading with R<sub>load</sub> drops it to Vth·RL/(RL+Rth)`);
      this._lastReading = { value: t.vth, unit: 'V', what: `V ${this.probeLabel('red').name}` };
    }
  }

  _plotBode(inNet, outNet, set) {
    const key = `${this.ver}|${inNet}|${outNet}|${this.meter.fmin}|${this.meter.fmax}|${this.meter.isolate}`;
    if (!this._bodeCache || this._bodeCache.key !== key) {
      const b = bode(this.ckt, inNet, outNet, null, this.meter.fmin, this.meter.fmax, 241);
      this._bodeCache = { key, b };
    }
    const b = this._bodeCache.b;
    if (!b) return;
    const s = b.summary;
    const main = s.fc ? fmt(s.fc, 'Hz', 4) : s.f0 ? fmt(s.f0, 'Hz', 4) : (s.max ?? 0).toFixed(2) + ' dB';
    set(`${s.type} · ${s.fc ? 'f−3dB' : s.f0 ? 'f₀' : 'gain'}`, main, s.text);
    const sum = $('#sheetBody [data-live=summary]');
    if (sum) sum.innerHTML = `<b>${esc(s.type)}</b> — ${esc(s.text)}${s.phaseAtFc != null ? `. Phase at fc ${s.phaseAtFc.toFixed(1)}°` : ''}.<br><span class="t2" style="color:var(--muted);font-size:12.5px">Computed from the actual circuit between IN and OUT (${esc(s.stim)}), including loading and op-amp bandwidth.</span>`;
    const cv = $('#sheetBody [data-live=plot]');
    if (cv) drawPlot(cv, { f: b.f, y1: b.db, y2: b.ph, y1Label: 'dB', y2Label: '°', markers: [s.fc, s.f0, s.fl, s.fh].filter(Boolean) });
  }
  _plotZ(a, b) {
    const key = `z|${this.ver}|${a}|${b}|${this.meter.srcShort}|${this.meter.lcrF}`;
    if (!this._zCache || this._zCache.key !== key) this._zCache = { key, z: zSweep(this.ckt, a, b, 1, 1e7, 140, { srcShort: this.meter.srcShort }) };
    const z = this._zCache.z;
    const cv = $('#sheetBody [data-live=plot]');
    if (cv) drawPlot(cv, { f: z.f, y1: z.mag.map((m) => (m > 0 ? Math.log10(m) : NaN)), y2: z.phase, y1Label: '|Z|', y1Log: true, y2Label: '°', markers: [this.meter.lcrF] });
    const sum = $('#sheetBody [data-live=summary]');
    if (sum) {
      // resonance detection: phase zero-crossings
      const res = [];
      for (let i = 1; i < z.phase.length; i++) if (Number.isFinite(z.phase[i]) && Number.isFinite(z.phase[i - 1]) && Math.sign(z.phase[i]) !== Math.sign(z.phase[i - 1]) && Math.abs(z.phase[i] - z.phase[i - 1]) < 170) res.push(z.f[i]);
      sum.innerHTML = `Impedance between the probes, power off.${res.length ? ` Resonance near ${res.slice(0, 3).map((f) => fmt(f, 'Hz')).join(', ')}.` : ''}`;
    }
  }

  // ======================= actions =======================
  act(name, el, e) {
    const sel1 = this.sel.comps.size === 1 ? this.comp([...this.sel.comps][0]) : null;
    const selIds = [...this.sel.comps];
    switch (name) {
      case 'addpart': this.openParts(); break;
      case 'examples': this.openFiles('examples'); break;
      case 'tools': openTools(this); break;
      case 'clearsel': this.select({}); break;
      case 'rotate':
        if (!selIds.length) return;
        this.checkpoint();
        for (const id of selIds) { const c = this.comp(id); c.rot = (c.rot + 1) & 3; }
        this.changed('rotate', { keepSheet: true });
        break;
      case 'flip':
        if (!sel1) return;
        this.checkpoint(); sel1.flip = !sel1.flip; this.changed('flip', { keepSheet: true });
        break;
      case 'copy': {
        if (!selIds.length) return;
        this.clipboard = copyFragment(this.doc, selIds, [...this.sel.juncs]);
        this.toast(`Copied ${this.clipboard.comps.length} part${this.clipboard.comps.length > 1 ? 's' : ''} — Paste works in any design`);
        this.saveSession();
        this.renderSheet();
        break;
      }
      case 'paste': {
        if (!this.clipboard) return;
        this.checkpoint();
        const ids = pasteFragment(this.doc, this.clipboard, this.editor.viewCenterWorld());
        this.changed('paste');
        this.select({ comps: ids });
        this.toast(`Pasted ${ids.length} part${ids.length > 1 ? 's' : ''}`);
        break;
      }
      case 'cut': this.act('copy'); this.act('delete'); break;
      case 'dup': {
        if (!selIds.length) return;
        this.checkpoint();
        const ids = duplicate(this.doc, selIds);
        this.changed('dup');
        this.select({ comps: ids });
        break;
      }
      case 'delete':
        if (this.sel.wire) return this.act('delwire');
        if (this.sel.junc) return this.act('deljunc');
        if (!selIds.length) return;
        this.checkpoint();
        removeComps(this.doc, selIds);
        this.select({});
        this.changed('delete');
        this.toast('Deleted — Undo to restore');
        break;
      case 'detach':
        if (!sel1) return;
        this.checkpoint(); detachComp(this.doc, sel1.id); this.changed('detach', { keepSheet: true }); this.toast(`${sel1.ref} disconnected — loose wire ends shown in red`);
        break;
      case 'toggle': if (sel1) this.toggleSwitch(sel1); break;
      case 'info': if (sel1) this.showInfo(sel1); break;
      case 'editpart': if (sel1) openPartEditor(this, sel1.props.part === 'Custom board' ? null : sel1.props.part); break;
      case 'newpart': this.closeParts(); openPartEditor(this); break;
      case 'ref': if (sel1 && el.value.trim() && el.value.trim() !== sel1.ref) { if (this._typingEl !== el) { this.checkpoint(); this._typingEl = el; } sel1.ref = el.value.trim(); this.changed('ref', { keepSheet: true }); } break;
      case 'bool': {
        const c = this.comp(el.dataset.cid);
        this.checkpoint();
        c.props[el.dataset.key] = !c.props[el.dataset.key];
        el.classList.toggle('on', !!c.props[el.dataset.key]);
        this.changed('prop', { keepSheet: el.dataset.key !== 'plusTop' });
        break;
      }
      case 'estep': {
        const c = this.comp(el.dataset.cid), k = el.dataset.key;
        const v = parseEng(c.props[k]);
        if (!Number.isFinite(v)) return;
        const nv = stepE(v, +el.dataset.dir);
        this.checkpoint();
        c.props[k] = fmt(nv).replace(/\s/g, '').replace('µ', 'u');
        const inp = el.parentElement.querySelector('input');
        if (inp) inp.value = c.props[k];
        this.changed('prop', { keepSheet: true });
        break;
      }
      case 'gpio': {
        const c = this.comp(el.dataset.cid);
        this.checkpoint();
        c.props.gpio = { ...(c.props.gpio || {}), [el.dataset.pin]: el.value };
        this.changed('prop');
        break;
      }
      case 'duty': {
        const c = this.comp(el.dataset.cid);
        this.checkpoint();
        c.props.duty = { ...(c.props.duty || {}), [el.dataset.pin]: el.value };
        this.changed('prop', { keepSheet: true });
        break;
      }
      case 'bend': {
        const w = this.doc.wires.find((x) => x.id === this.sel.wire);
        if (!w) return;
        this.checkpoint();
        const order = [undefined, 'h', 'v', 's'];
        const pts = wirePoints(this.doc, w);
        const cur = w.bend || (pts && pts.length === 3 ? (pts[1][0] === pts[0][0] ? 'v' : 'h') : undefined);
        w.bend = cur === 'h' ? 'v' : cur === 'v' ? 's' : 'h';
        void order;
        this.changed('bend', { keepSheet: true });
        break;
      }
      case 'delwire': this.checkpoint(); this.doc.wires = this.doc.wires.filter((w) => w.id !== this.sel.wire); cleanup(this.doc); this.select({}); this.changed('delwire'); break;
      case 'deljunc': this.checkpoint(); this.doc.wires = this.doc.wires.filter((w) => w.a.j !== this.sel.junc && w.b.j !== this.sel.junc); cleanup(this.doc); this.select({}); this.changed('deljunc'); break;
      case 'probe-red': case 'probe-black': {
        const net = this.sel.net;
        const n = this.nets();
        const key = n.nets[net]?.keys.find((k) => k[0] === 'c') || n.nets[net]?.keys[0];
        if (!key) return;
        const parts = key.split(':');
        this.probes[name === 'probe-red' ? 'red' : 'black'] = parts[0] === 'c' ? { kind: 'pin', c: parts[1], p: +parts[2] } : { kind: 'junc', j: parts[1] };
        this.setMode('measure');
        break;
      }
      // build
      case 'bstat': this.setStatus(this.sel.wire || selIds[0], 'b', +el.dataset.v); break;
      case 'bchk': { this.checkpoint(); const s = this.status(el.dataset.id); s.b = s.b ? 0 : 1; this.changed('status'); break; }
      case 'ball': this.checkpoint(); for (const it of this.buildItems()) this.status(it.id).b = 1; this.changed('status'); break;
      case 'breset': if (confirm('Reset build progress for all items?')) { this.checkpoint(); for (const s of Object.values(this.doc.status)) s.b = 0; this.changed('status'); } break;
      case 'note': this.checkpoint(); this.status(el.dataset.id).note = el.value; this.changed('note', { keepSheet: true }); break;
      case 'locate': if (!e.target.closest('[data-act=bchk]')) this.locate(el.dataset.id); break;
      // debug
      case 'dstat': this.setStatus(this.sel.wire || selIds[0], 'd', +el.dataset.v); break;
      case 'dreset': if (confirm('Clear all troubleshooting states and notes?')) { this.checkpoint(); for (const s of Object.values(this.doc.status)) { s.d = 0; delete s.note; } this.doc.readings = []; this.changed('status'); } break;
      case 'delreading': this.checkpoint(); this.doc.readings = (this.doc.readings || []).filter((r) => String(r.t) !== el.dataset.t); this.changed('reading'); break;
      // meter
      case 'fn': this.meterFn = el.dataset.fn; this.renderSheet(); this.editor.render(); this.saveSession(); break;
      case 'aprobe': this.activeProbe = el.dataset.p; this.renderSheet(); this.editor.render(); break;
      case 'swap': [this.probes.red, this.probes.black] = [this.probes.black, this.probes.red]; this._bodeCache = null; this.renderSheet(); this.editor.render(); break;
      case 'lcrf': this.meter.lcrF = Math.pow(10, +el.value); { const t = $('#sheetBody [data-act=lcrft]'); if (t) t.value = fmt(this.meter.lcrF, 'Hz'); } this.updateMeter(); break;
      case 'lcrft': { const v = parseEng(el.value); if (v > 0) { this.meter.lcrF = v; this.renderSheet(); } } break;
      case 'fmin': case 'fmax': { const v = parseEng(el.value); if (v > 0) { this.meter[name] = v; if (this.meter.fmax <= this.meter.fmin) this.meter.fmax = this.meter.fmin * 10; this._bodeCache = null; this.renderSheet(); } } break;
      case 'srcshort': this.meter.srcShort = !this.meter.srcShort; this.renderSheet(); break;
      case 'isolate': this.meter.isolate = !this.meter.isolate; this.runSim(); this.renderSheet(); break;
      case 'logreading': {
        const inp = $('#measIn');
        const v = parseEng(inp.value);
        if (!Number.isFinite(v)) { this.toast('Enter the value your meter shows (e.g. 4.97 or 3k3)'); return; }
        if (!this._lastReading) { this.toast('Place probes first'); return; }
        this.checkpoint();
        (this.doc.readings ||= []).push({ t: Date.now(), what: this._lastReading.what, unit: this._lastReading.unit, expected: this._lastReading.value, measured: v });
        this.changed('reading', { keepSheet: true });
        const dev = this._lastReading.value ? ((v - this._lastReading.value) / Math.abs(this._lastReading.value)) * 100 : 0;
        this.toast(`Logged · ${dev > 0 ? '+' : ''}${dev.toFixed(1)}% from expected${Math.abs(dev) > 10 ? ' — investigate!' : ''}`);
        inp.value = '';
        break;
      }
    }
  }

  locate(id) {
    const c = this.comp(id);
    if (c) { const b = compBBox(c); this.editor.centerOn(b.x + b.w / 2, b.y + b.h / 2); this.select({ comps: [id] }); return; }
    const w = this.doc.wires.find((x) => x.id === id);
    if (w) { const pts = wirePoints(this.doc, w); if (pts) { const m = pts[Math.floor(pts.length / 2)]; this.editor.centerOn(m[0], m[1]); } this.select({ wire: id }); }
  }

  // ======================= parts drawer =======================
  openParts() {
    if (this.mode !== 'edit') this.setMode('edit');
    $('#partsDrawer').hidden = false;
    this._partCat = this._partCat || 'All';
    this.renderParts();
    if (matchMedia('(pointer:fine)').matches) setTimeout(() => $('#partSearch').focus(), 50);
  }
  closeParts() { $('#partsDrawer').hidden = true; }
  renderParts() {
    const q = $('#partSearch').value.trim().toLowerCase();
    const pinned = (this.settings.pinned || []).map(findPal).filter(Boolean);
    const recent = (this.settings.recent || []).map(findPal).filter(Boolean);
    const cats = ['All', ...(pinned.length ? ['★ Pinned'] : []), ...(recent.length ? ['Recent'] : []), ...CATEGORIES];
    if (!cats.includes(this._partCat)) this._partCat = 'All';
    $('#partCats').innerHTML = cats.map((c) => `<button class="${this._partCat === c ? 'on' : ''}" data-cat="${c}">${c}</button>`).join('');
    $('#partCats').querySelectorAll('button').forEach((b) => b.onclick = () => { this._partCat = b.dataset.cat; this.renderParts(); });
    const match = (p) => {
      if (!q) return true;
      const desc = (p.part && (PARTS[p.part]?.desc || ICS[p.part]?.desc)) || TYPES[p.type].name;
      const hay = (p.label + ' ' + desc + ' ' + p.cat + ' ' + (p.part || '') + ' ' + (p.kw || '')).toLowerCase();
      return q.split(/\s+/).every((w) => hay.includes(w) || hay.replace(/[^a-z0-9]/g, '').includes(w.replace(/[^a-z0-9]/g, '')));
    };
    const pinSet = new Set(this.settings.pinned || []);
    const tile = (p) => {
      const i = PALETTE.indexOf(p);
      const desc = p.part ? (PARTS[p.part]?.desc || ICS[p.part]?.desc || '') : '';
      const on = pinSet.has(palKey(p));
      return `<div class="ptile" role="button" tabindex="0" data-i="${i}"><button class="pstar${on ? ' on' : ''}" data-pin="${i}" title="${on ? 'Unpin' : 'Pin'}" aria-label="${on ? 'Unpin' : 'Pin'} ${esc(p.label)}">${on ? '★' : '☆'}</button>${this.thumb(p)}<b>${esc(p.label)}</b>${desc ? `<small>${esc(desc.length > 38 ? desc.slice(0, 36) + '…' : desc)}</small>` : ''}</div>`;
    };
    const NEWPART = `<div class="ptile" role="button" data-act="newpart" style="border-style:dashed">${icon('chip', 'icon')}<b>New custom part</b><small>define any ESP32 / module pinout</small></div>`;
    let h = '';
    if (this._partCat === '★ Pinned') h = pinned.filter(match).map(tile).join('');
    else if (this._partCat === 'Recent') h = recent.filter(match).map(tile).join('');
    else {
      if (this._partCat === 'All' && !q) {
        if (pinned.length) h += `<div class="pgroup">★ Pinned</div>` + pinned.map(tile).join('');
        if (recent.length) h += `<div class="pgroup">Recently used</div>` + recent.map(tile).join('');
      }
      let lastCat = null;
      for (const p of PALETTE) {
        if (this._partCat !== 'All' && p.cat !== this._partCat && !q) continue;
        if (!match(p)) continue;
        if (this._partCat === 'All' && !q && p.cat !== lastCat) { h += `<div class="pgroup">${p.cat}</div>`; lastCat = p.cat; if (p.cat === 'MCU boards') h += NEWPART; }
        h += tile(p);
      }
      if ((this._partCat !== 'All' || q) && (q ? 'custom new board esp32 module part pinout'.includes(q) || q.includes('custom') : ['MCU boards', 'ICs', 'Sensors', 'ADCs', 'Signal sources'].includes(this._partCat))) h = NEWPART + h;
    }
    $('#partGrid').innerHTML = h || `<div class="hint" style="grid-column:1/-1">${this._partCat === '★ Pinned' ? 'Tap ☆ on any part to pin it here.' : 'No parts match. Use “New custom part” to define your own pinout.'}</div>`;
    const np = $('#partGrid [data-act=newpart]'); if (np) np.onclick = () => this.act('newpart');
    $('#partGrid').querySelectorAll('.ptile[data-i]').forEach((b) => b.onclick = (e) => {
      if (e.target.closest('.pstar')) return;
      this.addPart(PALETTE[+b.dataset.i]);
    });
    $('#partGrid').querySelectorAll('.pstar').forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      const key = palKey(PALETTE[+b.dataset.pin]);
      const list = this.settings.pinned || (this.settings.pinned = []);
      const k = list.indexOf(key);
      if (k >= 0) list.splice(k, 1); else list.push(key);
      this.toast(k >= 0 ? 'Unpinned' : '★ Pinned — shown at the top of the parts list');
      this.saveSession();
      this.renderParts();
    });
  }
  _noteRecent(p) {
    const key = palKey(p);
    const r = (this.settings.recent || []).filter((k) => k !== key);
    r.unshift(key);
    this.settings.recent = r.slice(0, 10);
  }
  thumb(p) {
    const c = { id: 't', type: p.type, x: 0, y: 0, rot: 0, props: { ...defaultPropsSafe(p) } };
    const b = getBBox(c);
    const sym = drawSymbol(c);
    const pad = 6;
    const big = c.type === 'ic';
    let texts = '';
    if (!big) for (const [x, y, t, cls, a] of sym.t || []) texts += `<text class="${cls}" x="${x}" y="${y}" text-anchor="${a}">${esc(t)}</text>`;
    else texts = `<text class="tic" x="0" y="0" text-anchor="middle" style="font-size:${Math.max(14, b.h / 6)}px">${esc(icGeom(c).title)}</text>`;
    const pins = big ? icGeom(c).pins.map((q) => `<path class="s" d="M${q.x},${q.y}H${q.side === 'L' ? -icGeom(c).halfW : icGeom(c).halfW}"/>`).join('') : '';
    const body = big ? `<rect class="s body" x="${-icGeom(c).halfW}" y="${icGeom(c).top}" width="${2 * icGeom(c).halfW}" height="${icGeom(c).bot - icGeom(c).top}" rx="3"/>${pins}` : sym.s;
    return `<svg viewBox="${b.x - pad} ${b.y - pad} ${b.w + 2 * pad} ${b.h + 2 * pad}" preserveAspectRatio="xMidYMid meet">${body}${texts}</svg>`;
  }
  addPart(p) {
    this.closeParts();
    if (PALETTE.includes(p)) this._noteRecent(p);
    this.checkpoint();
    let [x, y] = this.editor.viewCenterWorld();
    x = snap(x, 20); y = snap(y, 20);
    const c = makeComp(this.doc, p.type, p.part, x, y);
    if (p.preset) Object.assign(c.props, p.preset);
    // find a free spot (no bounding-box overlap) spiralling out from the view centre
    const boxes = this.doc.comps.map((o) => compBBox(o));
    const hits = () => { const b = compBBox(c); return boxes.some((o) => b.x < o.x + o.w + 16 && b.x + b.w + 16 > o.x && b.y < o.y + o.h + 16 && b.y + b.h + 16 > o.y); };
    outer: for (let r = 0; r < 14 && hits(); r++) {
      for (let a = 0; a < 8; a++) {
        c.x = snap(x + Math.cos((a * Math.PI) / 4) * (r + 1) * 50, 20); c.y = snap(y + Math.sin((a * Math.PI) / 4) * (r + 1) * 50, 20);
        if (!hits()) break outer;
      }
    }
    this.doc.comps.push(c);
    this.changed('add');
    this.select({ comps: [c.id] });
    if (this.settings.autoInfo && p.part && (PARTS[p.part]?.pinout || ICS[p.part])) this.showInfo(c);
    else this.toast(`${c.ref} added — drag to place, drag from its pins to wire`);
  }

  // ======================= modals =======================
  openModal(title, html, onBind) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    $('#modal').hidden = false;
    if (onBind) onBind($('#modalBody'));
  }
  closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; if (this._modalClose) { const f = this._modalClose; this._modalClose = null; f(); } }

  showInfo(c) {
    if (!c) return;
    this.openModal(partInfo(c).title, infoHtml(c, this.settings.autoInfo), (body) => {
      const cb = body.querySelector('#autoInfo');
      if (cb) cb.onchange = () => { this.settings.autoInfo = cb.checked; this.saveSession(); };
    });
  }

  rename() {
    const n = prompt('Design name', this.doc.name);
    if (n && n.trim()) { this.doc.name = n.trim(); this.dirty = true; this._updateTitle(); this.saveSession(); }
  }

  async openFiles(tab = 'designs') {
    const list = await store.listDesigns().catch(() => []);
    const tabs = `<div class="tabs"><button data-tab="designs" class="${tab === 'designs' ? 'on' : ''}">My designs</button><button data-tab="examples" class="${tab === 'examples' ? 'on' : ''}">Examples</button><button data-tab="settings" class="${tab === 'settings' ? 'on' : ''}">Settings</button></div>`;
    let h = tabs;
    if (tab === 'designs') {
      h += `<div class="card"><div class="row" style="justify-content:space-between"><div style="min-width:0"><b>${esc(this.doc.name)}</b><div class="t2" style="color:var(--muted);font-size:13px">${this.doc.comps.length} parts · ${this.dirty ? 'unsaved changes' : 'saved'}</div></div></div>
        <div class="actions">${this.btn('f-save', 'Save', 'save', 'pri')}${this.btn('f-saveas', 'Save as…', 'copy')}${this.btn('f-new', 'New', 'file')}${this.btn('f-export', 'Export file', 'download')}${this.btn('f-import', 'Import', 'upload')}${this.btn('f-svg', 'SVG', 'image')}${this.btn('f-png', 'PNG', 'image')}</div></div>`;
      h += `<div class="sec">Saved on this device (${list.length})</div><div class="list dlist">`;
      h += list.map((d) => `<div class="li" data-open="${d.id}"><div class="thumb">${d.thumb || ''}</div><div class="grow"><div class="t1">${esc(d.name)}${d.id === this.doc.id ? ' <span class="pf io">open</span>' : ''}</div><div class="t2">${new Date(d.updated).toLocaleString()} · ${d.comps?.length || 0} parts${buildPct(d)}</div></div>
        <button class="ib" data-ren="${d.id}" title="Rename">${icon('edit')}</button><button class="ib" data-exp="${d.id}" title="Export">${icon('download')}</button><button class="ib" data-del="${d.id}" title="Delete">${icon('trash')}</button></div>`).join('') || '<div class="hint">Nothing saved yet. Tap <b>Save</b> to keep this design in the on-device library (IndexedDB). Your current work is also auto-saved continuously.</div>';
      h += `</div><div class="actions">${list.length ? this.btn('f-backup', 'Download all (backup)', 'download') : ''}</div>`;
    } else if (tab === 'examples') {
      h += `<div class="hint">Open a ready-made circuit to explore. Your current design stays in the library if you save it first.</div><div class="list">${EXAMPLES.map((ex, i) => `<div class="li" data-ex="${i}"><div class="grow"><div class="t1">${esc(ex.name)}</div><div class="t2">${esc(ex.desc)}</div></div>${icon('file')}</div>`).join('')}</div>`;
    } else {
      h += `<div class="field"><label>Theme</label><select class="inp" id="setTheme">${['auto', 'light', 'dark'].map((t) => `<option ${this.settings.theme === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label>Specs pop-up when adding parts</label><div><button class="toggle ${this.settings.autoInfo ? 'on' : ''}" id="setInfo"></button></div></div>
        <div class="field"><label>Voltage tags on wires</label><div><button class="toggle ${this.showTags ? 'on' : ''}" id="setTags"></button></div></div>
        <div class="field"><label>Build/Debug: first tap selects</label><div><button class="toggle ${this.settings.selectFirst ? 'on' : ''}" id="setSelFirst"></button></div></div>
        <div class="sec">Shortcuts</div><div class="hint"><kbd>A</kbd> add part · <kbd>R</kbd> rotate · <kbd>F</kbd> flip · <kbd>Del</kbd> delete · <kbd>Ctrl/⌘ Z</kbd> undo · <kbd>Ctrl/⌘ D</kbd> duplicate · <kbd>Ctrl/⌘ S</kbd> save · Shift-click multi-select · long-press a part for its datasheet card.</div>
        <div class="sec">About</div><div class="hint">Circuit Workbench · DC operating point via Newton-Raphson MNA; AC/filter analysis linearised around it. Models are idealised — always verify with datasheets.</div>`;
    }
    this.openModal('Designs', h, (body) => {
      body.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => this.openFiles(b.dataset.tab));
      body.querySelectorAll('[data-act]').forEach((b) => b.onclick = () => this.fileAct(b.dataset.act));
      body.querySelectorAll('[data-open]').forEach((el) => el.onclick = (e) => { if (!e.target.closest('button')) this.loadDesign(el.dataset.open); });
      body.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { const d = list.find((x) => x.id === b.dataset.del); if (confirm(`Delete “${d.name}” from this device?`)) { await store.deleteDesign(d.id); this.openFiles('designs'); } });
      body.querySelectorAll('[data-ren]').forEach((b) => b.onclick = async () => { const d = list.find((x) => x.id === b.dataset.ren); const n = prompt('Rename design', d.name); if (n && n.trim()) { d.name = n.trim(); await store.putDesign(d); if (d.id === this.doc.id) { this.doc.name = d.name; this._updateTitle(); } this.openFiles('designs'); } });
      body.querySelectorAll('[data-exp]').forEach((b) => b.onclick = () => { const d = list.find((x) => x.id === b.dataset.exp); this.download(slug(d.name) + '.cwb.json', JSON.stringify(stripDesign(d), null, 1), 'application/json'); });
      body.querySelectorAll('[data-ex]').forEach((el) => el.onclick = () => this.loadExample(+el.dataset.ex));
      const th = body.querySelector('#setTheme'); if (th) th.onchange = () => { this.settings.theme = th.value; this.applyTheme(); this.saveSession(); };
      const tg = (id, fn) => { const el = body.querySelector(id); if (el) el.onclick = () => { fn(); el.classList.toggle('on'); this.saveSession(); this.render(); }; };
      tg('#setInfo', () => { this.settings.autoInfo = !this.settings.autoInfo; });
      tg('#setTags', () => { this.showTags = !this.showTags; });
      tg('#setSelFirst', () => { this.settings.selectFirst = !this.settings.selectFirst; });
    });
  }

  async fileAct(a) {
    switch (a) {
      case 'f-save': await this.saveDesign(); this.openFiles('designs'); break;
      case 'f-saveas': {
        const n = prompt('Save as', this.doc.name + ' copy');
        if (!n) return;
        this.doc = { ...JSON.parse(JSON.stringify(this.doc)), id: uid('d'), name: n.trim(), created: Date.now() };
        await this.saveDesign(); this.openFiles('designs'); break;
      }
      case 'f-new':
        if (this.dirty && this.doc.comps.length && !confirm('Start a new design? Unsaved changes to the current one will be lost (save it first to keep it).')) return;
        this.doc = newDesign(); this.undoStack = []; this.redoStack = []; this.probes = { red: null, black: null }; this.dirty = false;
        this.closeModal(); this.select({}); this.changed(null, { noDirty: true }); this.editor.fit(); break;
      case 'f-export': this.doc.customParts = customDefsFor(this.doc); this.download(slug(this.doc.name) + '.cwb.json', JSON.stringify(stripDesign(this.doc), null, 1), 'application/json'); break;
      case 'f-import': $('#fileImport').value = ''; $('#fileImport').click(); break;
      case 'f-svg': this.download(slug(this.doc.name) + '.svg', designSvg(this.doc), 'image/svg+xml'); break;
      case 'f-png': this.exportPng(); break;
      case 'f-backup': { const all = await store.listDesigns(); this.download('circuit-workbench-backup.json', JSON.stringify({ backup: true, designs: all.map(stripDesign) }, null, 1), 'application/json'); break; }
    }
  }

  async saveDesign() {
    this.doc.updated = Date.now();
    this.doc.customParts = customDefsFor(this.doc);
    const rec = { ...JSON.parse(JSON.stringify(this.doc)), thumb: designSvg(this.doc, { pad: 20 }) };
    await store.putDesign(rec);
    this.dirty = false;
    this._updateTitle();
    this.saveSession();
    this.toast(`Saved “${this.doc.name}”`);
  }
  async loadDesign(id) {
    if (this.dirty && this.doc.comps.length && id !== this.doc.id && !confirm('Open another design? Unsaved changes to the current design will be lost.')) return;
    const d = await store.getDesign(id);
    if (!d) return;
    delete d.thumb;
    this._setDoc(d);
    this.toast(`Opened “${d.name}”`);
  }
  loadExample(i) {
    if (this.dirty && this.doc.comps.length && !confirm('Open the example? Unsaved changes to the current design will be lost.')) return;
    const d = EXAMPLES[i].build();
    this._setDoc(d);
    this.dirty = true;
    this._updateTitle();
  }
  _setDoc(d) {
    adoptCustomDefs(d).then((n) => { if (n) { this.changed(null, { noDirty: true }); this.toast(`Added ${n} custom part definition(s) to your library`); } });
    normalize(d);
    this.doc = d;
    this.undoStack = []; this.redoStack = [];
    this.probes = { red: null, black: null };
    this.ckt = null;
    this.dirty = false;
    this.closeModal();
    this.select({});
    this.changed(null, { noDirty: true });
    if (this.mode === 'measure') this._autoBlack();
    setTimeout(() => this.editor.fit(), 30);
  }
  async importFile(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.backup && Array.isArray(data.designs)) {
        for (const d of data.designs) { normalize(d); d.thumb = designSvg(d, { pad: 20 }); await store.putDesign(d); }
        this.toast(`Imported ${data.designs.length} designs`);
        this.openFiles('designs');
        return;
      }
      if (!Array.isArray(data.comps)) throw new Error('not a circuit file');
      data.id = data.id || uid('d');
      this._setDoc(data);
      this.dirty = true;
      this._updateTitle();
      this.toast(`Imported “${data.name || 'design'}” — tap Save to keep it`);
    } catch (e) { alert('Could not import: ' + e.message); }
  }
  async download(name, text, type) {
    const blob = text instanceof Blob ? text : new Blob([text], { type });
    // iOS (esp. Home-Screen apps) handles files best through the share sheet
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios && navigator.canShare) {
      try {
        const file = new File([blob], name, { type: blob.type || type || 'application/octet-stream' });
        if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
      } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  exportPng() {
    const svg = designSvg(this.doc, { width: 2000 });
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      cv.getContext('2d').drawImage(img, 0, 0);
      cv.toBlob((b) => this.download(slug(this.doc.name) + '.png', b), 'image/png');
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  openInstall() {
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const sw = 'serviceWorker' in navigator && navigator.serviceWorker.controller;
    let h = `<div class="card"><div class="row"><i class="dot ${sw ? 'ok' : 'warn'}"></i><b>${sw ? 'Available offline' : 'Preparing offline copy…'}</b></div><div class="hint">${sw ? 'Everything the app needs is cached on this device. It works with no connection; designs are stored locally in IndexedDB.' : 'Reload once while online to finish caching the app for offline use.'}</div></div>`;
    if (standalone) h += `<div class="card"><b>✓ Installed</b><div class="hint">You are running the installed app.</div></div>`;
    else if (ios) h += `<div class="card"><b>Install on iPhone / iPad</b><ol class="hint" style="margin:6px 0 0 18px;padding:0"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (square with arrow).</li><li>Choose <b>Add to Home Screen</b> → <b>Add</b>.</li></ol><div class="hint">It then launches full-screen from your Home Screen and works fully offline.</div></div>`;
    else if (this._installEvt) h += `<div class="card"><b>Install app</b><div class="hint">Add Circuit Workbench to your device for offline use.</div><div class="actions">${this.btn('install', 'Install', 'download', 'pri')}</div></div>`;
    else h += `<div class="card"><b>Install</b><div class="hint">Use your browser menu → <b>Install app</b> / <b>Add to Home screen</b>.</div></div>`;
    h += `<div class="card"><b>Back up your designs</b><div class="hint">Download every saved design as one file; re-import it on any device.</div><div class="actions">${this.btn('backup', 'Download backup', 'download')}${this.btn('export1', 'Export current design', 'file')}</div></div>`;
    this.openModal('Download & offline', h, (body) => {
      body.querySelectorAll('[data-act]').forEach((b) => b.onclick = async () => {
        if (b.dataset.act === 'install' && this._installEvt) { this._installEvt.prompt(); this._installEvt = null; this.closeModal(); }
        if (b.dataset.act === 'backup') this.fileAct('f-backup');
        if (b.dataset.act === 'export1') this.fileAct('f-export');
      });
    });
  }

  // ======================= persistence =======================
  saveSession(now) {
    clearTimeout(this._saveT);
    const doit = () => store.putState('session', {
      doc: this.doc, mode: this.mode, view: this.editor.view, simOn: this.simOn, showTags: this.showTags, probes: this.probes, clipboard: this.clipboard,
      meterFn: this.meterFn, meter: this.meter, settings: this.settings, dirty: this.dirty, t: Date.now(),
    }).catch((e) => console.warn('autosave failed', e));
    if (now) doit(); else this._saveT = setTimeout(doit, 400);
  }

  _registerSW() {
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); this._installEvt = e; });
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw && nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) this.toast('Update ready — tap to reload', () => { this.saveSession(true); location.reload(); });
        });
      });
    }).catch((e) => console.warn('SW failed', e));
  }

  applyTheme() {
    const t = this.settings.theme;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }

  // ======================= misc UI =======================
  render() { this.editor.render(); }
  _updateTitle() {
    $('#docName').textContent = this.doc.name;
    $('#dirtyDot').classList.toggle('on', this.dirty);
    document.title = this.doc.name + ' · Circuit Workbench';
    $('#btnSim').classList.toggle('on', this.simOn);
  }
  _updateHud() {
    const pp = $('#progressPill'), wp = $('#warnPill');
    if (this.mode === 'build') {
      const { done, total } = this.progress();
      const pct = total ? Math.round((done / total) * 100) : 0;
      pp.hidden = false;
      pp.innerHTML = `Build ${done}/${total}<span class="pbar"><i style="width:${pct}%"></i></span>${pct}%`;
    } else if (this.mode === 'debug') {
      const items = this.buildItems();
      const ok = items.filter((i) => (this.doc.status[i.id] || {}).d === 1).length;
      const bad = items.filter((i) => (this.doc.status[i.id] || {}).d >= 2).length;
      pp.hidden = false;
      pp.innerHTML = `Checked ${ok}/${items.length}<span class="pbar"><i style="width:${items.length ? (ok / items.length) * 100 : 0}%"></i></span>${bad ? `<span style="color:var(--err)">${bad} flagged</span>` : ''}`;
    } else pp.hidden = true;
    const e = this.checks.filter((w) => w.level === 'err').length, w = this.checks.filter((x) => x.level === 'warn').length;
    wp.hidden = !(e || w) || this.mode === 'build';
    wp.innerHTML = `${icon('alert')}${e ? `<span class="n-err">${e} error${e > 1 ? 's' : ''}</span>` : ''}${w ? `<span class="n-warn">${w} warning${w > 1 ? 's' : ''}</span>` : ''}`;
  }
  toast(msg, onClick) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    t.classList.toggle('act', !!onClick);
    t.onclick = onClick || null;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('on'), onClick ? 8000 : 2200);
  }
}

// ---------- helpers ----------
function defaultPropsSafe(p) {
  const props = defaultProps(p.type, p.part);
  if (p.preset) Object.assign(props, p.preset);
  return props;
}
const palKey = (p) => `${p.type}|${p.part || ''}|${p.label}`;
const findPal = (key) => PALETTE.find((p) => palKey(p) === key);
function normalize(d) {
  d.comps ||= []; d.wires ||= []; d.juncs ||= []; d.status ||= {}; d.readings ||= [];
  d.name ||= 'Untitled circuit'; d.id ||= uid('d');
  for (const c of d.comps) { c.rot ||= 0; c.props ||= {}; if (!TYPES[c.type]) c.type = 'resistor'; }
  cleanup(d);
}
function stripDesign(d) { const o = { ...d }; delete o.thumb; return o; }
function slug(s) { return String(s || 'circuit').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'circuit'; }
function buildPct(d) {
  const items = (d.comps || []).length + (d.wires || []).length;
  if (!items) return '';
  const done = Object.values(d.status || {}).filter((s) => s.b).length;
  return done ? ` · built ${Math.round((done / items) * 100)}%` : '';
}

const app = new App();
window.cwb = app;
app.init();
