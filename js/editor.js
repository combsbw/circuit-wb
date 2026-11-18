// Schematic canvas: rendering + pointer interaction (touch-first).
import { getPins, drawSymbol, compLabel, TYPES, GRID } from './library.js';
import { xf, pinPos, compBBox, wirePoints, makeIndex, endPos, nearestOnWire, snap, addWire, addJunc, splitWire, mergeJunc, cleanup, designBBox } from './doc.js';
import { fmt } from './units.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r1 = (v) => Math.round(v * 10) / 10;

export class Editor {
  constructor(svg, app) {
    this.svg = svg;
    this.app = app;
    this.world = svg.querySelector('#world');
    this.ly = { under: svg.querySelector('#lyUnder'), wires: svg.querySelector('#lyWires'), comps: svg.querySelector('#lyComps'), juncs: svg.querySelector('#lyJuncs'), over: svg.querySelector('#lyOver') };
    this.grid = svg.querySelector('#gridPat');
    this.view = { x: 60, y: 60, k: 1 };
    this.ptrs = new Map();
    this.drag = null;
    this.pinch = null;
    this.ghost = null;
    this.boxMode = false;
    this.hover = null;
    this._raf = 0;
    this._bind();
  }

  // ---------- view ----------
  applyView() {
    const { x, y, k } = this.view;
    this.world.setAttribute('transform', `translate(${r1(x)},${r1(y)}) scale(${k})`);
    const g = 20 * k;
    let step = g;
    while (step < 12) step *= 2; // keep grid readable when zoomed out
    this.grid.setAttribute('width', step);
    this.grid.setAttribute('height', step);
    this.grid.setAttribute('patternTransform', `translate(${r1(x % step)},${r1(y % step)})`);
  }
  toWorld(cx, cy) {
    const r = this.svg.getBoundingClientRect();
    return [(cx - r.left - this.view.x) / this.view.k, (cy - r.top - this.view.y) / this.view.k];
  }
  zoomAt(f, sx, sy) {
    const r = this.svg.getBoundingClientRect();
    if (sx == null) { sx = r.width / 2; sy = r.height / 2; }
    const k = Math.min(6, Math.max(0.15, this.view.k * f));
    const wx = (sx - this.view.x) / this.view.k, wy = (sy - this.view.y) / this.view.k;
    this.view = { k, x: sx - wx * k, y: sy - wy * k };
    this.applyView();
    this.app.viewChanged();
  }
  /** Canvas area not covered by the floating side panel (desktop) or floating buttons. */
  visibleRect() {
    const r = this.svg.getBoundingClientRect();
    let w = r.width;
    const sh = document.getElementById('sheet');
    if (sh && !sh.classList.contains('empty') && getComputedStyle(sh).position === 'absolute') w = Math.max(200, Math.min(w, sh.getBoundingClientRect().left - r.left));
    return { width: w, height: r.height, left: r.left, top: r.top };
  }
  fit(pad = 50) {
    const b = designBBox(this.app.doc);
    const r = this.visibleRect();
    pad = Math.max(pad, r.width < 600 ? 66 : 50);
    if (!b || !r.width) { this.view = { x: r.width / 2, y: r.height / 2, k: 1 }; this.applyView(); return; }
    const k = Math.min(1.8, Math.max(0.2, Math.min((r.width - 2 * pad) / Math.max(b.w, 60), (r.height - 2 * pad) / Math.max(b.h, 60))));
    this.view = { k, x: r.width / 2 - (b.x + b.w / 2) * k, y: r.height / 2 - (b.y + b.h / 2) * k };
    this.applyView();
    this.app.viewChanged();
  }
  centerOn(x, y) {
    const r = this.visibleRect();
    this.view = { ...this.view, x: r.width / 2 - x * this.view.k, y: r.height / 2.6 - y * this.view.k };
    this.applyView();
  }
  viewCenterWorld() {
    const r = this.visibleRect();
    return [(r.width / 2 - this.view.x) / this.view.k, (r.height / 2.4 - this.view.y) / this.view.k];
  }

  // ---------- hit testing ----------
  hitTest(pt, opts = {}) {
    const d = this.app.doc, k = this.view.k;
    const touch = opts.touch;
    const tolPin = (touch ? 20 : 13) / k, tolW = (touch ? 13 : 8) / k;
    const idx = makeIndex(d);
    const exclude = opts.exclude || {};
    const app = this.app;
    // probes (measure mode)
    if (app.mode === 'measure' && !opts.noProbes) {
      for (const which of ['red', 'black']) {
        const p = app.probePos(which);
        if (p && Math.hypot(pt[0] - (p[0] + 14), pt[1] - (p[1] - 30)) < 22 / k) return { kind: 'probe', which };
      }
    }
    // selected wire endpoint handles
    if (app.mode === 'edit' && app.sel.wire && !opts.noHandles) {
      const w = d.wires.find((x) => x.id === app.sel.wire);
      if (w) for (const end of ['a', 'b']) {
        const p = endPos(d, w[end], idx);
        if (p && Math.hypot(pt[0] - p[0], pt[1] - p[1]) < (touch ? 22 : 14) / k) return { kind: 'handle', wire: w.id, end, pos: p };
      }
    }
    // pins
    let best = null;
    for (const c of d.comps) {
      if (exclude.comp === c.id) continue;
      const pins = getPins(c);
      for (let i = 0; i < pins.length; i++) {
        const [x, y] = xf(c, pins[i].x, pins[i].y);
        const dd = Math.hypot(pt[0] - x, pt[1] - y);
        if (dd < tolPin && (!best || dd < best.d)) best = { kind: 'pin', c: c.id, p: i, pos: [x, y], d: dd };
      }
    }
    for (const j of d.juncs) {
      if (exclude.junc === j.id) continue;
      const dd = Math.hypot(pt[0] - j.x, pt[1] - j.y);
      if (dd < tolPin && (!best || dd < best.d - 0.01)) best = { kind: 'junc', j: j.id, pos: [j.x, j.y], d: dd };
    }
    if (best) return best;
    // components (top-most last drawn)
    for (let i = d.comps.length - 1; i >= 0; i--) {
      const c = d.comps[i];
      if (exclude.comp === c.id) continue;
      const b = compBBox(c);
      const pad = 4 / k;
      if (pt[0] >= b.x - pad && pt[0] <= b.x + b.w + pad && pt[1] >= b.y - pad && pt[1] <= b.y + b.h + pad) return { kind: 'comp', c: c.id };
    }
    // wires
    let bw = null;
    for (const w of d.wires) {
      if (exclude.wire === w.id) continue;
      const pts = wirePoints(d, w, idx);
      if (!pts) continue;
      const n = nearestOnWire(pts, pt);
      if (n && n.d < tolW && (!bw || n.d < bw.d)) bw = { kind: 'wire', w: w.id, pos: n.q, d: n.d };
    }
    if (bw) return bw;
    return { kind: 'none' };
  }

  // ---------- events ----------
  _bind() {
    const s = this.svg;
    s.addEventListener('pointerdown', (e) => this._down(e));
    s.addEventListener('pointermove', (e) => this._move(e));
    s.addEventListener('pointerup', (e) => this._up(e));
    s.addEventListener('pointercancel', (e) => this._cancel(e));
    s.addEventListener('lostpointercapture', (e) => { if (this.ptrs.has(e.pointerId)) this._cancel(e); });
    s.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = s.getBoundingClientRect();
      const zoom = e.ctrlKey || (e.deltaMode === 1) || (Math.abs(e.deltaY) >= 40 && e.deltaX === 0 && Number.isInteger(e.deltaY));
      if (zoom) this.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
      else { this.view.x -= e.deltaX; this.view.y -= e.deltaY; this.applyView(); this.app.viewChanged(); }
    }, { passive: false });
    // iOS Safari gesture events (prevent page zoom)
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) s.addEventListener(ev, (e) => e.preventDefault());
  }

  _down(e) {
    this.svg.setPointerCapture(e.pointerId);
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.ptrs.size === 2) {
      // start pinch; abort any single-pointer action
      if (this.drag && this.drag.active) this._abortDrag();
      this.drag = null;
      const [a, b] = [...this.ptrs.values()];
      const r = this.svg.getBoundingClientRect();
      this.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), k0: this.view.k, mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top, v0: { ...this.view } };
      return;
    }
    if (this.ptrs.size > 2) return;
    const pt = this.toWorld(e.clientX, e.clientY);
    const touch = e.pointerType !== 'mouse';
    const hit = this.hitTest(pt, { touch });
    this.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, start: pt, hit, touch, active: false, shift: e.shiftKey, v0: { ...this.view } };
    // long press → info / context
    clearTimeout(this._lp);
    this._lp = setTimeout(() => {
      if (this.drag && !this.drag.active && this.drag.id === e.pointerId) { const h = this.drag.hit; this.drag = null; this.app.longPress(h); }
    }, 550);
  }

  _move(e) {
    const p = this.ptrs.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') this._hover(e);
      return;
    }
    p.x = e.clientX; p.y = e.clientY;
    if (this.pinch && this.ptrs.size >= 2) {
      const [a, b] = [...this.ptrs.values()];
      const r = this.svg.getBoundingClientRect();
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const k = Math.min(6, Math.max(0.15, this.pinch.k0 * (d / this.pinch.d0)));
      const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
      const v0 = this.pinch.v0;
      const wx = (this.pinch.mx - v0.x) / v0.k, wy = (this.pinch.my - v0.y) / v0.k;
      this.view = { k, x: mx - wx * k, y: my - wy * k };
      this.applyView();
      this.app.viewChanged();
      return;
    }
    const dr = this.drag;
    if (!dr || dr.id !== e.pointerId) return;
    const dist = Math.hypot(e.clientX - dr.sx, e.clientY - dr.sy);
    if (!dr.active) {
      if (dist < (dr.touch ? 9 : 5)) return;
      clearTimeout(this._lp);
      dr.active = true;
      this._beginDrag(dr);
    }
    const pt = this.toWorld(e.clientX, e.clientY);
    this._dragTo(dr, pt, e);
  }

  _up(e) {
    clearTimeout(this._lp);
    this.ptrs.delete(e.pointerId);
    if (this.pinch) { if (this.ptrs.size < 2) this.pinch = null; return; }
    const dr = this.drag;
    this.drag = null;
    if (!dr || dr.id !== e.pointerId) return;
    if (!dr.active) { this.app.tap(dr.hit, dr.start, { shift: dr.shift || e.shiftKey, touch: dr.touch }); return; }
    this._endDrag(dr, this.toWorld(e.clientX, e.clientY));
  }
  _cancel(e) {
    clearTimeout(this._lp);
    this.ptrs.delete(e.pointerId);
    if (this.ptrs.size < 2) this.pinch = null;
    if (this.drag && this.drag.id === e.pointerId) { if (this.drag.active) this._abortDrag(); this.drag = null; }
  }
  _hover(e) {
    const pt = this.toWorld(e.clientX, e.clientY);
    const h = this.hitTest(pt, { touch: false, noHandles: true });
    const key = h.kind === 'pin' ? `p${h.c}:${h.p}` : h.kind === 'junc' ? 'j' + h.j : '';
    this.svg.style.cursor = h.kind === 'pin' || h.kind === 'junc' ? 'crosshair' : h.kind === 'comp' ? (this.app.mode === 'edit' ? 'move' : 'pointer') : h.kind === 'wire' || h.kind === 'probe' || h.kind === 'handle' ? 'pointer' : 'default';
    if (key !== this._hoverKey) { this._hoverKey = key; this.hover = h.kind === 'pin' || h.kind === 'junc' ? h : null; this.render(); }
  }

  _beginDrag(dr) {
    const app = this.app, h = dr.hit, mode = app.mode;
    dr.kind = 'pan';
    if (mode === 'measure' && h.kind === 'probe') { dr.kind = 'probe'; dr.which = h.which; return; }
    if (mode !== 'edit') return;
    if (this.boxMode && (h.kind === 'none' || h.kind === 'wire')) { dr.kind = 'box'; return; }
    if (h.kind === 'pin') { dr.kind = 'wire'; dr.from = { c: h.c, p: h.p }; dr.fromPos = h.pos; return; }
    if (h.kind === 'handle') { dr.kind = 'handle'; return; }
    if (h.kind === 'junc') {
      app.checkpoint();
      dr.kind = 'junc';
      const j = app.doc.juncs.find((x) => x.id === h.j);
      dr.j = j; dr.off = [j.x - dr.start[0], j.y - dr.start[1]];
      return;
    }
    if (h.kind === 'wire') { dr.kind = 'branch'; dr.fromWire = h.w; dr.fromPos = [snap(h.pos[0]), snap(h.pos[1])]; return; }
    if (h.kind === 'comp') {
      app.checkpoint();
      dr.kind = 'move';
      const ids = app.sel.comps.has(h.c) ? [...app.sel.comps] : [h.c];
      if (!app.sel.comps.has(h.c)) app.select({ comps: [h.c] }, true);
      dr.items = ids.map((id) => { const c = app.doc.comps.find((x) => x.id === id); return { c, x0: c.x, y0: c.y }; });
      // junctions inside a multi-selection move along
      dr.juncs = ids.length > 1 ? app.doc.juncs.filter((j) => app.sel.juncs?.has(j.id)).map((j) => ({ j, x0: j.x, y0: j.y })) : [];
      return;
    }
  }

  _target(pt, dr, exclude) {
    const h = this.hitTest(pt, { touch: dr.touch, noHandles: true, noProbes: true, exclude });
    return h.kind === 'pin' || h.kind === 'junc' || h.kind === 'wire' ? h : null;
  }

  _dragTo(dr, pt) {
    const d = this.app.doc;
    switch (dr.kind) {
      case 'pan':
        this.view.x = dr.v0.x + (this.ptrs.get(dr.id).x - dr.sx);
        this.view.y = dr.v0.y + (this.ptrs.get(dr.id).y - dr.sy);
        this.applyView();
        this.app.viewChanged();
        return;
      case 'box':
        this.ghost = { box: [dr.start, pt] };
        break;
      case 'wire': case 'branch': {
        const tgt = this._target(pt, dr, dr.kind === 'wire' ? {} : { wire: dr.fromWire });
        const valid = tgt && !(tgt.kind === 'pin' && dr.from && tgt.c === dr.from.c && tgt.p === dr.from.p);
        const to = valid ? (tgt.kind === 'wire' ? [snap(tgt.pos[0]), snap(tgt.pos[1])] : tgt.pos) : [snap(pt[0]), snap(pt[1])];
        this.ghost = { from: dr.fromPos, to, target: valid ? tgt : null };
        dr.tgt = valid ? tgt : null; dr.to = to;
        break;
      }
      case 'handle': {
        const w = d.wires.find((x) => x.id === dr.hit.wire);
        const other = endPos(d, w[dr.hit.end === 'a' ? 'b' : 'a']);
        const tgt = this._target(pt, dr, { wire: w.id });
        const to = tgt ? (tgt.kind === 'wire' ? [snap(tgt.pos[0]), snap(tgt.pos[1])] : tgt.pos) : [snap(pt[0]), snap(pt[1])];
        this.ghost = { from: other, to, target: tgt, hideWire: w.id };
        dr.tgt = tgt; dr.to = to;
        break;
      }
      case 'junc': {
        dr.j.x = snap(pt[0] + dr.off[0]); dr.j.y = snap(pt[1] + dr.off[1]);
        const tgt = this._target(pt, dr, { junc: dr.j.id });
        // can't merge onto a wire attached to this junction
        dr.tgt = tgt && !(tgt.kind === 'wire' && d.wires.find((w) => w.id === tgt.w && (w.a.j === dr.j.id || w.b.j === dr.j.id))) ? tgt : null;
        this.ghost = dr.tgt ? { target: dr.tgt } : null;
        break;
      }
      case 'move': {
        const dx = snap(pt[0] - dr.start[0]), dy = snap(pt[1] - dr.start[1]);
        for (const it of dr.items) { it.c.x = it.x0 + dx; it.c.y = it.y0 + dy; }
        for (const it of dr.juncs) { it.j.x = it.x0 + dx; it.j.y = it.y0 + dy; }
        dr.moved = dx || dy;
        break;
      }
      case 'probe': {
        const tgt = this._target(pt, dr, {});
        this.ghost = { probe: dr.which, at: tgt ? tgt.pos : pt, target: tgt };
        dr.tgt = tgt;
        break;
      }
    }
    this.render();
  }

  _endDrag(dr, pt) {
    const app = this.app, d = app.doc;
    this.ghost = null;
    switch (dr.kind) {
      case 'pan': app.viewChanged(true); break;
      case 'box': {
        const [a, b] = [dr.start, pt];
        const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
        const comps = d.comps.filter((c) => { const bb = compBBox(c); return bb.x >= x0 && bb.x + bb.w <= x1 && bb.y >= y0 && bb.y + bb.h <= y1; }).map((c) => c.id);
        const juncs = d.juncs.filter((j) => j.x >= x0 && j.x <= x1 && j.y >= y0 && j.y <= y1).map((j) => j.id);
        app.select({ comps, juncs });
        break;
      }
      case 'wire': case 'branch': {
        if (!dr.to) break;
        const start = dr.fromPos;
        if (!dr.tgt && Math.hypot(dr.to[0] - start[0], dr.to[1] - start[1]) < GRID) break;
        app.checkpoint();
        let from = dr.from;
        if (dr.kind === 'branch') { const j = splitWire(d, dr.fromWire, start); from = { j: j.id }; }
        const to = this._resolveTarget(dr.tgt, dr.to);
        const w = addWire(d, from, to);
        cleanup(d);
        app.changed('wire');
        if (w) app.select({ wire: w.id }, true);
        break;
      }
      case 'handle': {
        const w = d.wires.find((x) => x.id === dr.hit.wire);
        if (!w || !dr.to) break;
        app.checkpoint();
        const to = this._resolveTarget(dr.tgt, dr.to);
        w[dr.hit.end] = to;
        cleanup(d);
        app.changed('rewire');
        break;
      }
      case 'junc': {
        if (dr.tgt) {
          const to = this._resolveTarget(dr.tgt, dr.tgt.pos);
          mergeJunc(d, dr.j.id, to);
        }
        cleanup(d);
        app.changed('move');
        break;
      }
      case 'move': {
        if (dr.moved) { this._autoConnect(dr.items.map((i) => i.c)); app.changed('move'); }
        else app.cancelCheckpoint();
        break;
      }
      case 'probe': {
        if (dr.tgt) app.setProbe(dr.which, dr.tgt);
        break;
      }
    }
    this.render();
  }
  _abortDrag() {
    const dr = this.drag;
    this.ghost = null;
    if (dr && dr.kind === 'move') { for (const it of dr.items) { it.c.x = it.x0; it.c.y = it.y0; } for (const it of dr.juncs) { it.j.x = it.x0; it.j.y = it.y0; } this.app.cancelCheckpoint(); }
    if (dr && dr.kind === 'junc') this.app.undo(true);
    this.render();
  }
  _resolveTarget(tgt, pos) {
    const d = this.app.doc;
    if (!tgt) { const j = addJunc(d, pos[0], pos[1]); return { j: j.id }; }
    if (tgt.kind === 'pin') return { c: tgt.c, p: tgt.p };
    if (tgt.kind === 'junc') return { j: tgt.j };
    const j = splitWire(d, tgt.w, pos);
    return { j: j.id };
  }
  /** After moving components: connect pins that now sit exactly on another pin/junction. */
  _autoConnect(comps) {
    const d = this.app.doc;
    const nets = this.app.nets();
    for (const c of comps) {
      getPins(c).forEach((p, i) => {
        const [x, y] = pinPos(c, i);
        if (nets && nets.connected(c.id, i)) return;
        for (const o of d.comps) {
          if (o === c || comps.includes(o)) continue;
          const pins = getPins(o);
          for (let k = 0; k < pins.length; k++) {
            const [ox, oy] = pinPos(o, k);
            if (Math.abs(ox - x) < 0.5 && Math.abs(oy - y) < 0.5) { addWire(d, { c: c.id, p: i }, { c: o.id, p: k }); return; }
          }
        }
        for (const j of d.juncs) if (Math.abs(j.x - x) < 0.5 && Math.abs(j.y - y) < 0.5) { addWire(d, { c: c.id, p: i }, { j: j.id }); return; }
      });
    }
  }

  // ---------- rendering ----------
  render() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._render(); });
  }
  renderNow() { cancelAnimationFrame(this._raf); this._raf = 0; this._render(); }

  _render() {
    const app = this.app, d = app.doc, k = this.view.k;
    const idx = makeIndex(d);
    const nets = app.nets();
    const mode = app.mode;
    const ckt = app.simVisible() ? app.ckt : null;
    const selNet = app.sel.net;
    const st = (id) => d.status[id] || {};
    let under = '', wires = '', comps = '', juncs = '', over = '';

    // voltage scale
    let vmax = 1;
    if (ckt && ckt.op) for (let i = 1; i < ckt.N; i++) vmax = Math.max(vmax, Math.abs(ckt.op[i]));
    const vcolor = (net) => {
      if (!ckt || !ckt.op || net == null) return null;
      const v = ckt.V(net);
      if (!Number.isFinite(v)) return null;
      const t = Math.min(1, Math.abs(v) / vmax);
      if (t < 0.004) return 'hsl(150 35% 42%)';
      return v > 0 ? `hsl(${352 - 10 * (1 - t)} ${45 + 40 * t}% ${58 - 18 * t}%)` : `hsl(220 ${45 + 40 * t}% ${58 - 15 * t}%)`;
    };

    // ---- wires ----
    const tagPts = new Map(); // net → [x, y, len]
    for (const w of d.wires) {
      if (this.ghost && this.ghost.hideWire === w.id) continue;
      const pts = wirePoints(d, w, idx);
      if (!pts) continue;
      const dstr = 'M' + pts.map((p) => p[0] + ',' + p[1]).join('L');
      const net = nets ? nets.endNet(w.a) : null;
      const s = st(w.id);
      let cls = 'wire';
      if (app.sel.wire === w.id) cls += ' sel';
      else if (selNet != null && net === selNet) cls += ' hl';
      if (mode === 'build' && !s.b) cls += ' planned';
      if (mode === 'debug' && s.d) under += `<path class="wire-under wh-${['', 'ok', 'warn', 'err'][s.d]}" d="${dstr}"/>`;
      if (mode === 'build' && s.b) under += `<path class="wire-under wh-ok" style="opacity:.5" d="${dstr}"/>`;
      if (app.sel.wire === w.id) under += `<path class="wire-under wh-sel" d="${dstr}"/>`;
      const col = !cls.includes('sel') && !cls.includes('hl') ? vcolor(net) : null;
      wires += `<path class="${cls}" d="${dstr}"${col ? ` style="stroke:${col}"` : ''}/>`;
      if (ckt && net != null && !(nets.nets[net] || {}).isGnd) {
        for (let i = 0; i < pts.length - 1; i++) {
          const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
          const prev = tagPts.get(net);
          if (!prev || len > prev[2]) tagPts.set(net, [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2, len, pts[i][1] === pts[i + 1][1]]);
        }
      }
    }

    // ---- components ----
    const pinDeg = new Map();
    for (const w of d.wires) for (const e of [w.a, w.b]) { const key = e.j != null ? 'j' + e.j : e.c + ':' + e.p; pinDeg.set(key, (pinDeg.get(key) || 0) + 1); }
    for (const c of d.comps) {
      const def = TYPES[c.type];
      if (!def) continue;
      const sym = drawSymbol(c);
      const s = st(c.id);
      const bb = compBBox(c);
      let cls = 'comp';
      if (mode === 'build' && !s.b && !def.noRef) cls += ' planned';
      if (this.drag && this.drag.kind === 'move' && this.drag.items?.some((i) => i.c === c)) cls += ' dragging';
      // halos
      if (mode === 'debug' && s.d) under += `<rect class="halo-${['', 'ok', 'warn', 'err'][s.d]}" x="${bb.x - 6}" y="${bb.y - 6}" width="${bb.w + 12}" height="${bb.h + 12}" rx="10"/>`;
      if (app.sel.comps.has(c.id)) under += `<rect class="selbox" x="${bb.x - 7}" y="${bb.y - 7}" width="${bb.w + 14}" height="${bb.h + 14}" rx="9"/>`;
      // LED glow when lit
      if (ckt && ckt.op && c.type === 'led') {
        const I = ckt.pinI.get(c.id);
        if (I && I[0] > 2e-4) {
          const [cx, cy] = xf(c, 0, 0);
          const col = { red: '#ff4d4d', yellow: '#ffd43b', green: '#40e070', blue: '#4d8dff', white: '#ffffff' }[c.props.color] || '#ff4d4d';
          under += `<circle class="ledglow" cx="${cx}" cy="${cy}" r="${16 + Math.min(14, I[0] * 800)}" fill="${col}" opacity="${Math.min(0.95, 0.25 + I[0] * 50)}"/>`;
        }
      }
      const tr = `translate(${c.x},${c.y})${c.rot ? ` rotate(${c.rot * 90})` : ''}${c.flip ? ' scale(-1,1)' : ''}`;
      comps += `<g class="${cls}" data-id="${c.id}"><g transform="${tr}">${sym.s}</g>`;
      // symbol texts (kept upright)
      const flipA = (c.flip ? 1 : 0) ^ (c.rot === 2 ? 1 : 0);
      for (const [tx, ty, txt, tcls, anchor] of sym.t || []) {
        const [x, y] = xf(c, tx, ty);
        let a = anchor;
        if (c.rot & 1) a = 'middle';
        else if (flipA && a !== 'middle') a = a === 'start' ? 'end' : 'start';
        comps += `<text class="${tcls}" x="${r1(x)}" y="${r1(y)}" text-anchor="${a}">${esc(txt)}</text>`;
      }
      // ref / value label
      if (!def.noRef) {
        const val = compLabel(c);
        const wide = bb.w >= bb.h || c.type === 'ic' || c.type === 'reg';
        if (c.type === 'opamp' && !(c.rot & 1)) {
          const [tx, ty] = xf(c, c.rot === 2 ? -10 : 10, c.rot === 2 ? 26 : -26);
          comps += `<text class="cref" x="${tx}" y="${ty}" text-anchor="start">${esc(c.ref)}<tspan class="cval" dx="5">${esc(val)}</tspan></text>`;
        } else if (wide) {
          const tx = bb.x + bb.w / 2;
          comps += `<text class="cref" x="${tx}" y="${bb.y - 8}" text-anchor="middle">${esc(c.ref)}<tspan class="cval" dx="5">${esc(val)}</tspan></text>`;
        } else {
          const tx = bb.x + bb.w + 5;
          comps += `<text class="cref" x="${tx}" y="${bb.y + bb.h / 2 - 7}" text-anchor="start">${esc(c.ref)}</text><text class="cval" x="${tx}" y="${bb.y + bb.h / 2 + 7}" text-anchor="start">${esc(val)}</text>`;
        }
      }
      // pins: open = hollow ring, multi-wire = dot
      const pins = getPins(c);
      for (let i = 0; i < pins.length; i++) {
        const [x, y] = xf(c, pins[i].x, pins[i].y);
        const deg = pinDeg.get(c.id + ':' + i) || 0;
        const connected = nets ? nets.connected(c.id, i) : deg > 0;
        const net = nets ? nets.pinNet(c.id, i) : null;
        const hot = (this.hover && this.hover.kind === 'pin' && this.hover.c === c.id && this.hover.p === i) || (this.ghost && this.ghost.target && this.ghost.target.kind === 'pin' && this.ghost.target.c === c.id && this.ghost.target.p === i);
        if (hot) comps += `<circle class="pinhot" cx="${x}" cy="${y}" r="${Math.max(6, 9 / k)}"/>`;
        else if (!connected && (c.type !== 'ic' || pins[i].fn !== 'nc')) comps += `<circle class="pinopen${mode === 'build' ? ' build' : ''}" cx="${x}" cy="${y}" r="3"/>`;
        else if (deg >= 2) comps += `<circle class="jdot${selNet != null && net === selNet ? ' hl' : ''}" cx="${x}" cy="${y}" r="3.6"/>`;
        else if (selNet != null && net === selNet) comps += `<circle class="jdot hl" cx="${x}" cy="${y}" r="3"/>`;
      }
      // status badges
      const bx = bb.x + bb.w + 2, by = bb.y - 2;
      if (mode === 'build' && s.b && !def.noRef) comps += badge(bx, by, 'ok', '✓');
      if (mode === 'debug' && s.d) comps += badge(bx, by, ['', 'ok', 'warn', 'err'][s.d], ['', '✓', '?', '!'][s.d]);
      if ((mode === 'debug' || mode === 'measure') && app.warnComps && app.warnComps.has(c.id) && !s.d) comps += badge(bx, by, app.warnComps.get(c.id) === 'err' ? 'err' : 'warn', '!');
      comps += '</g>';
    }

    // ---- junctions ----
    for (const j of d.juncs) {
      const deg = pinDeg.get('j' + j.id) || 0;
      const net = nets ? nets.juncNet(j.id) : null;
      const hl = selNet != null && net === selNet;
      const hot = (this.hover && this.hover.kind === 'junc' && this.hover.j === j.id) || (this.ghost && this.ghost.target && this.ghost.target.kind === 'junc' && this.ghost.target.j === j.id);
      if (hot) juncs += `<circle class="pinhot" cx="${j.x}" cy="${j.y}" r="${Math.max(6, 9 / k)}"/>`;
      if (deg >= 3) juncs += `<circle class="jdot${hl ? ' hl' : ''}" cx="${j.x}" cy="${j.y}" r="4"/>`;
      else if (deg === 1) juncs += `<circle class="jopen" cx="${j.x}" cy="${j.y}" r="4"/>`;
      else if (mode === 'edit') juncs += `<circle class="jbend" cx="${j.x}" cy="${j.y}" r="2.6"/>`;
      if (app.sel.junc === j.id || app.sel.juncs?.has(j.id)) juncs += `<circle class="selbox" cx="${j.x}" cy="${j.y}" r="9"/>`;
    }

    // ---- overlays ----
    if (app.mode === 'edit' && app.sel.wire) {
      const w = d.wires.find((x) => x.id === app.sel.wire);
      if (w && !(this.ghost && this.ghost.hideWire)) for (const e of ['a', 'b']) {
        const p = endPos(d, w[e], idx);
        if (p) over += `<circle class="pinhot" cx="${p[0]}" cy="${p[1]}" r="${Math.max(5, 8 / k)}"/>`;
      }
    }
    if (ckt && ckt.op && app.showTags) {
      // nets with a label: put the tag beside the label; nets with a rail symbol need no tag
      for (const c of d.comps) {
        if (c.type !== 'netlabel' && c.type !== 'rail') continue;
        const net = nets.pinNet(c.id, 0);
        if (c.type === 'rail') { tagPts.delete(net); tagPts.set('skip' + net, null); continue; }
        if (tagPts.get('skip' + net) === null || tagPts.get('done' + net) || (nets.nets[net] || {}).isGnd) continue;
        tagPts.set('done' + net, 1);
        const bb = compBBox(c);
        const txt = fmtV(ckt.V(net)), w = txt.length * 6.2 + 8;
        const left = c.flip;
        tagPts.set(net, [left ? bb.x - w / 2 - 4 : bb.x + bb.w + w / 2 + 4, bb.y + bb.h / 2, 0, 'label']);
      }
      for (const [net, val] of tagPts) {
        if (!val || typeof net === 'string') continue;
        const [x, y, , horiz] = val;
        const v = ckt.V(net);
        if (!Number.isFinite(v)) continue;
        const txt = fmtV(v);
        const w = txt.length * 6.2 + 8;
        const ty = horiz === 'label' ? y : horiz ? y - 11 : y;
        const tx = horiz === 'label' ? x : horiz ? x : x + w / 2 + 6;
        over += `<g class="vtag" transform="translate(${r1(tx)},${r1(ty)})"><rect x="${-w / 2}" y="-8" width="${w}" height="16" rx="8"${vcolor(net) ? ` style="stroke:${vcolor(net)}"` : ''}/><text>${txt}</text></g>`;
      }
    }
    if (app.mode === 'measure') {
      for (const which of ['red', 'black']) {
        let p = app.probePos(which);
        if (this.ghost && this.ghost.probe === which) p = this.ghost.at;
        if (!p) continue;
        over += probeSvg(p, which, app.activeProbe === which, app.meterFn === 'bode' ? (which === 'red' ? 'IN' : 'OUT') : which === 'red' ? '+' : '−');
      }
    }
    if (this.ghost) {
      const g = this.ghost;
      if (g.from && g.to) {
        const a = g.from, b = g.to;
        const pts = a[0] === b[0] || a[1] === b[1] ? [a, b] : [a, [b[0], a[1]], b];
        over += `<path class="wire ghost" d="M${pts.map((p) => p.join(',')).join('L')}"/>`;
        if (!g.target) over += `<circle class="jopen" cx="${b[0]}" cy="${b[1]}" r="4"/>`;
      }
      if (g.target) over += `<circle class="pinhot" cx="${g.target.pos[0]}" cy="${g.target.pos[1]}" r="${Math.max(7, 11 / k)}"/>`;
      if (g.box) {
        const [a, b] = g.box;
        over += `<rect class="boxsel" x="${Math.min(a[0], b[0])}" y="${Math.min(a[1], b[1])}" width="${Math.abs(b[0] - a[0])}" height="${Math.abs(b[1] - a[1])}"/>`;
      }
    }
    this.ly.under.innerHTML = under;
    this.ly.wires.innerHTML = wires;
    this.ly.comps.innerHTML = comps;
    this.ly.juncs.innerHTML = juncs;
    this.ly.over.innerHTML = over;
  }
}

function badge(x, y, cls, t) { return `<g class="badge b-${cls}"><circle cx="${x}" cy="${y}" r="8"/><text x="${x}" y="${y + 0.5}">${t}</text></g>`; }
function probeSvg(p, which, active, label) {
  const [x, y] = p, tx = x + 14, ty = y - 30;
  return `<g class="probe ${which}${active ? ' active' : ''}"><path class="stem" d="M${x},${y}L${tx},${ty}"/><circle cx="${x}" cy="${y}" r="3" class="tip"/><circle class="tip" cx="${tx}" cy="${ty}" r="11"/><text x="${tx}" y="${ty + 0.5}"${label.length > 2 ? ' style="font-size:7.5px"' : ''}>${label}</text></g>`;
}
export function fmtV(v) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a < 1e-3) return (a < 1e-4 ? '0' : (v * 1e3).toFixed(2) + 'm') + 'V';
  if (a < 10) return v.toFixed(2) + 'V';
  return v.toFixed(1) + 'V';
}

/** Standalone SVG of a design (thumbnail / export). */
export function designSvg(d, { pad = 30, bg = true, width } = {}) {
  const b = designBBox(d) || { x: 0, y: 0, w: 100, h: 60 };
  const idx = makeIndex(d);
  let s = '';
  for (const w of d.wires) { const pts = wirePoints(d, w, idx); if (pts) s += `<path d="M${pts.map((p) => p.join(',')).join('L')}" fill="none" stroke="#2f3b4a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`; }
  const deg = new Map();
  for (const w of d.wires) for (const e of [w.a, w.b]) { const k = e.j != null ? 'j' + e.j : e.c + ':' + e.p; deg.set(k, (deg.get(k) || 0) + 1); }
  for (const j of d.juncs) if ((deg.get('j' + j.id) || 0) >= 3) s += `<circle cx="${j.x}" cy="${j.y}" r="4" fill="#2f3b4a"/>`;
  for (const c of d.comps) {
    const sym = drawSymbol(c);
    const tr = `translate(${c.x},${c.y})${c.rot ? ` rotate(${c.rot * 90})` : ''}${c.flip ? ' scale(-1,1)' : ''}`;
    s += `<g transform="${tr}">${sym.s}</g>`;
    for (const [tx, ty, txt, tcls, anchor] of sym.t || []) { const [x, y] = xf(c, tx, ty); s += `<text class="${tcls}" x="${r1(x)}" y="${r1(y)}" text-anchor="${c.rot & 1 ? 'middle' : anchor}">${esc(txt)}</text>`; }
    if (!TYPES[c.type].noRef) {
      const bb = compBBox(c), val = compLabel(c);
      if (bb.w >= bb.h || c.type === 'ic' || c.type === 'reg') s += `<text class="cref" x="${bb.x + bb.w / 2}" y="${bb.y - 8}" text-anchor="middle">${esc(c.ref)} ${esc(val)}</text>`;
      else s += `<text class="cref" x="${bb.x + bb.w + 5}" y="${bb.y + bb.h / 2 - 7}">${esc(c.ref)}</text><text class="cval" x="${bb.x + bb.w + 5}" y="${bb.y + bb.h / 2 + 7}">${esc(val)}</text>`;
    }
  }
  const vb = `${b.x - pad} ${b.y - pad - 14} ${b.w + 2 * pad} ${b.h + 2 * pad + 14}`;
  const style = `<style>.s{stroke:#1f2a37;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}.s.thin{stroke-width:1.2;opacity:.55}.s.thick{stroke-width:3.5}.s.body{fill:#f4f6f9}.s.lbl{fill:#fff}.f{fill:#1f2a37;stroke:#1f2a37;stroke-width:1.2}text{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;fill:#17202b;dominant-baseline:central}.tn{font-size:10px}.tp{font-size:14px;font-weight:700}.tl{font-size:11px;font-weight:650}.tic{font-size:12px;font-weight:750}.tpin{font-size:9.5px;font-family:Menlo,monospace}.tnum{font-size:8px;fill:#687586}.tgpio{font-size:10px;font-weight:800}.cref{font-size:11px;font-weight:700;fill:#555}.cval{font-size:11px;font-family:Menlo,monospace}.led-red{fill:#ef4444;stroke:#1f2a37}.led-yellow{fill:#facc15;stroke:#1f2a37}.led-green{fill:#22c55e;stroke:#1f2a37}.led-blue{fill:#3b82f6;stroke:#1f2a37}.led-white{fill:#f8fafc;stroke:#1f2a37}</style>`;
  const wAttr = width ? ` width="${width}" height="${Math.round((width * (b.h + 2 * pad + 14)) / (b.w + 2 * pad))}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${wAttr}>${style}${bg ? `<rect x="${b.x - pad}" y="${b.y - pad - 14}" width="${b.w + 2 * pad}" height="${b.h + 2 * pad + 14}" fill="#ffffff"/>` : ''}${s}</svg>`;
}
