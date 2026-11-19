// Board designer view: physical layout on breadboard / solderable breadboard / perfboard.
import { BOARD_TYPES, OBJECTIVES, EFFORT, optimize, layout, steps, holeName, RAIL_ROW, RAIL_LABEL, weightsOf, conflictParts, PHYSICAL, currentReport, AWG, ampOf, recommendAwg, LIMITS, gaugeOf, trailGauge } from './boards.js';
import { icon } from './icons.js';
import { fmt, parseEng } from './units.js';
import { addWire, cleanup, describeEnd } from './doc.js';
import { getPins } from './library.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PITCH = 10;
const NET_COLORS = ['#16a34a', '#2563eb', '#eab308', '#9333ea', '#f97316', '#0891b2', '#db2777', '#65a30d', '#7c3aed'];

let V = null; // view state

export function openBoard(app, id) {
  const board = (app.doc.boards || []).find((b) => b.id === id);
  if (!board) return;
  closeBoard();
  const el = document.createElement('div');
  el.id = 'boardView';
  el.innerHTML = `
    <header class="bv-top">
      <div class="seg bv-toggle" role="tablist" aria-label="View"><button data-bv="close" title="Back to the schematic">${icon('edit')}<b>Design</b></button><button class="on"><span class="mi">${icon('chip')}</span><b>Board</b></button></div>
      <input class="bv-name inp" aria-label="Board name">
      <div class="bv-stats"></div>
      <div class="bv-actions">
        <div class="seg bv-mode" role="tablist" aria-label="Mode"><button data-bv="mlayout" class="on">Layout</button><button data-bv="mbuild" title="Tap parts and connections as you build them">${icon('build')}Build</button></div>
        <button class="btn" data-bv="add" title="Add a part to this board (and the schematic)">${icon('plus')}Add part</button>
        <button class="btn" data-bv="new" title="Start from a new random layout">${icon('rotate')}Rebuild</button>
        <button class="btn pri" data-bv="opt">${icon('bolt')}Optimize</button>
      </div>
    </header>
    <div class="bv-main">
      <div class="bv-canvas">
        <svg class="bv-svg" xmlns="http://www.w3.org/2000/svg"></svg>
        <div class="bv-banner" hidden></div>
        <div class="bv-partbar" hidden></div>
        <div class="bv-progress" hidden><div class="bv-pbar"><i></i></div><span></span><button class="btn small" data-bv="stop">Stop</button></div>
        <div class="bv-zoom"><button class="fab sm" data-bv="zin">${icon('zin')}</button><button class="fab sm" data-bv="zout">${icon('zout')}</button><button class="fab sm" data-bv="fit">${icon('fit')}</button><button class="fab sm" data-bv="rotview" title="Rotate view 90°">${icon('rotate')}</button><button class="fab sm" data-bv="flipview" title="Top / bottom view">${icon('flip')}</button></div>
      </div>
      <aside class="bv-panel">
        <div class="tabs bv-tabs"><button data-tab="setup" class="on">Setup</button><button data-tab="steps">Build steps</button><button data-tab="cur">Wire &amp; current</button><button data-tab="links">Connections</button></div>
        <div class="bv-body"></div>
      </aside>
    </div>`;
  document.body.appendChild(el);
  V = { app, board, el, svg: el.querySelector('.bv-svg'), tab: 'setup', sel: null, net: null, ext: null, pin: null, pending: null, build: !!board.build, skip: new Set(), rot: 0, bottom: false, vb: null, ptrs: new Map(), L: null };
  el.querySelector('.bv-name').value = board.name;
  el.querySelector('.bv-name').addEventListener('input', (e) => { board.name = e.target.value || 'Board'; app.changed('board', { keepSheet: true }); });
  el.addEventListener('click', onClick);
  el.querySelectorAll('.bv-tabs button').forEach((b) => b.addEventListener('click', () => { V.tab = b.dataset.tab; el.querySelectorAll('.bv-tabs button').forEach((x) => x.classList.toggle('on', x === b)); renderPanel(); }));
  bindCanvas();
  relayout();
  fit();
  renderPanel();
  el.classList.toggle('building', V.build);
  el.querySelectorAll('.bv-mode button').forEach((x) => x.classList.toggle('on', (x.dataset.bv === 'mbuild') === V.build));
  app.onBoardPartAdded = () => { if (V) settle(); };
  if (!Object.keys(board.params || {}).length) { if (board.compIds.length) runOptimize(true); }
  else if (V.L.stale || V.L.parts.some((p) => !p.ok)) settle();
}
export function closeBoard() {
  if (!V) return;
  V.el.remove();
  const app = V.app;
  app.onBoardPartAdded = null; app._partBoard = null;
  V = null;
  app.editor.render();
  app.renderSheet();
}
export function isBoardOpen() { return !!V; }

// ------------------------------------------------------------------ layout & rendering
function relayout() {
  V.L = layout(V.app.doc, V.board);
  V.rep = currentReport(V.L, V.board, V.app.ckt);
  render();
  renderStats();
}
// ------------------------------------------------------------------ build-progress tracking (tap parts & connections as you complete them)
const stepKey = (t) => (t.k === 'part' ? 'part:' + t.id : t.k === 'jumper' ? 'jumper:' + t.i : t.k === 'trace' ? 'trace:' + t.i : t.k === 'ext' ? 'ext:' + t.net : 'bus:' + t.y);
function stepIndex() { const S = steps(V.L), m = new Map(); for (const s of S) if (s.target) m.set(stepKey(s.target), s); return { S, m }; }
function isDoneStep(s) { return s.target && s.target.k === 'part' ? !!(V.app.doc.status[s.target.id] || {}).b : !!(V.board.done || {})[s.id]; }
function setDoneStep(s, v) {
  const app = V.app, b = V.board;
  app.checkpoint();
  if (s.target && s.target.k === 'part') app.status(s.target.id).b = v ? 1 : 0; else (b.done ||= {})[s.id] = !!v;
  app.changed('status', { keepSheet: true });
}
const progress = () => { const { S } = stepIndex(); return { done: S.filter(isDoneStep).length, total: S.length }; };
const gw = (awg) => Math.max(1.4, Math.min(5.5, 1.5 + (30 - awg) * 0.2));
function distSeg(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy; let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)); }
function hitConn(w) {
  const { M } = vgeom(), L = V.L; let best = null;
  const test = (pts, tol, t) => { for (let k = 1; k < pts.length; k++) { const d = distSeg(w, pts[k - 1], pts[k]); if (d < tol && (!best || d < best.d)) best = { d, ...t }; } };
  L.jumpers.forEach((j, i) => test((j.path || [j.a, j.b]).map(([x, y]) => M(x, y)), 6, { k: 'jumper', i }));
  (L.traces || []).forEach((t, i) => test(t.cells.map(([x, y]) => M(x, y)), 5, { k: 'trace', i }));
  for (const bus of L.buses || []) test([M(0, bus.y), M(L.W - 1, bus.y)], 5, { k: 'bus', y: bus.y });
  return best;
}
function tapBuild(target) {
  const { m } = stepIndex(), st = m.get(stepKey(target));
  if (!st) return;
  const v = !isDoneStep(st);
  setDoneStep(st, v);
  V.app.toast(`${v ? '✓' : '○'} ${st.text.split(':')[0].slice(0, 46)}`);
  render(); renderStats(); if (V.tab === 'steps') renderPanel();
}
function nextStep() {
  const { S } = stepIndex(), open = S.filter((s) => !isDoneStep(s));
  return open.find((s) => !V.skip.has(s.id)) || open[0] || null;
}

/** Board geometry in unrotated "base" pixels. */
function baseGeom() {
  const L = V.L;
  if (L.kind === 'bb') { const C = L.C; return { X: (x) => 64 + x * PITCH, Y: (y) => 46 + (y + 3) * PITCH, w: 64 + 34 + (C - 1) * PITCH, h: 46 + 18 * PITCH + 30 }; }
  return { X: (x) => 64 + x * PITCH, Y: (y) => 34 + y * PITCH, w: 64 + 60 + (L.W - 1) * PITCH, h: 68 + (L.H - 1) * PITCH };
}
/** View transform: optional mirror (bottom view), then rotation in 90° steps. M maps hole coordinates → screen. */
function vgeom() {
  const G = baseGeom(), r = V.rot || 0, m = V.bottom ? 1 : 0;
  const F = (px, py) => { if (m) px = G.w - px; switch (r) { case 1: return [G.h - py, px]; case 2: return [G.w - px, G.h - py]; case 3: return [py, G.w - px]; default: return [px, py]; } };
  const o = F(0, 0), ex = F(1, 0), ey = F(0, 1);
  const mat = [ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]];
  return { G, F, mat, out: r % 2 ? { w: G.h, h: G.w } : { w: G.w, h: G.h }, M: (x, y) => F(G.X(x), G.Y(y)) };
}
const netColor = (L, n) => {
  const info = L.prob.nets[n];
  if (!info) return '#64748b';
  if (info.isGnd) return 'var(--bv-gnd)';
  if (info.supply) return '#dc2626';
  let h = 0; for (const ch of info.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return NET_COLORS[h % NET_COLORS.length];
};
const r1 = (v) => Math.round(v * 10) / 10;
const textW = (t, cls) => String(t).length * (cls === 'bv-extl' ? 4.5 : 4.2) + 3;
const ovl = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

/** Place text labels so they overlap neither each other nor parts / markers / board text. */
function placeLabels(items, obstacles, fixed) {
  const placed = [], out = [];
  for (const it of items) {
    const w = textW(it.text, it.cls), h = 8.2;
    const [x0, y0, x1, y1] = it.box, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const ring = (d) => [[cx, y0 - h / 2 - d], [cx, y1 + h / 2 + d], [x1 + w / 2 + d, cy], [x0 - w / 2 - d, cy], [x1 + w / 2 + d, y0 - h / 2 - d], [x0 - w / 2 - d, y0 - h / 2 - d], [x1 + w / 2 + d, y1 + h / 2 + d], [x0 - w / 2 - d, y1 + h / 2 + d]];
    const cands = [...ring(0.5), ...ring(8), ...ring(17), ...ring(28), ...ring(40)];
    let best = null;
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i], r = [c[0] - w / 2, c[1] - h / 2, c[0] + w / 2, c[1] + h / 2];
      let sc = i * 0.03;
      for (const q of placed) sc += ovl(r, q) * 5;
      for (const o of obstacles) if (o.id !== it.own) sc += ovl(r, [o.box[0] + 1.5, o.box[1] + 1.5, o.box[2] - 1.5, o.box[3] - 1.5]) * 2;
      for (const f of fixed) sc += ovl(r, f) * 4;
      if (!best || sc < best.sc) best = { c, r, sc, i };
      if (sc < 0.3) break;
    }
    placed.push(best.r);
    let svg = '';
    if (best.i >= 8) {
      // leader line from the anchor to the nearest edge of the label
      const lx = Math.max(best.r[0], Math.min(cx, best.r[2])), ly = Math.max(best.r[1], Math.min(cy, best.r[3]));
      svg += `<line class="bv-leader" x1="${r1(cx)}" y1="${r1(cy)}" x2="${r1(lx)}" y2="${r1(ly)}"/>`;
    }
    svg += `<text class="${it.cls}" x="${r1(best.c[0])}" y="${r1(best.c[1])}" text-anchor="middle"${it.style ? ` style="${it.style}"` : ''}>${esc(it.text)}</text>`;
    out.push(svg);
  }
  return out.join('');
}
function roundedPath(pts, rad = 4) {
  if (pts.length === 2) return `M${pts[0]}L${pts[1]}`;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
    const l1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1, l2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1, r = Math.min(rad, l1 / 2, l2 / 2);
    d += `L${r1(p1[0] - ((p1[0] - p0[0]) / l1) * r)},${r1(p1[1] - ((p1[1] - p0[1]) / l1) * r)}Q${p1[0]},${p1[1]} ${r1(p1[0] + ((p2[0] - p1[0]) / l2) * r)},${r1(p1[1] + ((p2[1] - p1[1]) / l2) * r)}`;
  }
  return d + `L${pts[pts.length - 1]}`;
}

function render() {
  const L = V.L, b = V.board, VG = vgeom(), { G, M, mat } = VG, { X, Y } = G;
  const SI = V.build ? stepIndex() : null;
  const doneT = (i) => { if (!SI) return false; const st = SI.m.get('trace:' + i); return st ? isDoneStep(st) : false; };
  const solder = b.type === 'solderable';
  let shapes = '', texts = '';
  const fixed = [];
  const T = (x, y, t, cls = 'bv-lbl') => { const [px, py] = M(x, y); fixed.push([px - 3.5, py - 3.5, px + 3.5, py + 3.5]); return `<text class="${cls}" x="${r1(px)}" y="${r1(py)}">${esc(t)}</text>`; };
  // ---- board (shapes live in the rotated / mirrored group, text stays upright)
  if (L.kind === 'bb') {
    const C = L.C, rails = b.rails !== false;
    shapes += `<rect class="${solder ? 'bv-pcb' : 'bv-bb'}" x="${X(-1.6)}" y="${Y(rails ? -4.6 : -1.4)}" width="${X(C - 1 + 1.6) - X(-1.6)}" height="${Y(rails ? 15.6 : 12.4) - Y(rails ? -4.6 : -1.4)}" rx="8"/>`;
    shapes += `<rect class="bv-channel" x="${X(-1)}" y="${Y(4.75)}" width="${X(C) - X(-1)}" height="${Y(6.25) - Y(4.75)}" rx="2"/>`;
    if (rails) {
      for (const [y, cls] of [[-3.65, 'bv-red'], [-1.35, 'bv-blue'], [12.35, 'bv-blue'], [14.65, 'bv-red']]) shapes += `<line class="${cls}" x1="${X(-0.5)}" x2="${X(C - 0.5)}" y1="${Y(y)}" y2="${Y(y)}"/>`;
      for (const [y, t] of [[-3, '+'], [-2, '−'], [13, '−'], [14, '+']]) texts += T(-1.1, y, t) + T(C - 1 + 1.1, y, t);
    }
    const rows = [...(rails ? [-3, -2] : []), 0, 1, 2, 3, 4, 7, 8, 9, 10, 11, ...(rails ? [13, 14] : [])];
    let holes = '';
    if (solder) {
      for (let x = 0; x < C; x++) holes += `M${X(x)},${Y(0)}V${Y(4)}M${X(x)},${Y(7)}V${Y(11)}`;
      shapes += `<path class="bv-copper" d="${holes}"/>`;
      if (rails) shapes += `<path class="bv-copper" d="${[-3, -2, 13, 14].map((y) => `M${X(0)},${Y(y)}H${X(C - 1)}`).join('')}"/>`;
      holes = '';
      for (const y of rows) for (let x = 0; x < C; x++) holes += `M${X(x) - 3},${Y(y)}a3,3 0 1 0 6,0a3,3 0 1 0 -6,0`;
      shapes += `<path class="bv-pad" d="${holes}"/>`;
    } else {
      for (const y of rows) for (let x = 0; x < C; x++) holes += `M${X(x) - 1.6},${Y(y) - 1.6}h3.2v3.2h-3.2z`;
      shapes += `<path class="bv-hole" d="${holes}"/>`;
    }
    for (let x = 0; x < C; x++) if (x === 0 || (x + 1) % 5 === 0) texts += T(x, -0.95, x + 1, 'bv-num') + T(x, 11.95, x + 1, 'bv-num');
    'abcde'.split('').forEach((r, i) => { texts += T(-1.1, i, r); });
    'fghij'.split('').forEach((r, i) => { texts += T(-1.1, i + 7, r); });
  } else {
    shapes += `<rect class="bv-perf" x="${X(-1.4)}" y="${Y(-1.4)}" width="${X(L.W - 1 + 1.4) - X(-1.4)}" height="${Y(L.H - 1 + 1.4) - Y(-1.4)}" rx="6"/>`;
    let pads = '';
    for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) pads += `M${X(x) - 3.4},${Y(y)}a3.4,3.4 0 1 0 6.8,0a3.4,3.4 0 1 0 -6.8,0`;
    shapes += `<path class="bv-pad" d="${pads}"/>`;
    for (const bus of L.buses || []) shapes += `<line class="bv-bus" style="stroke:${netColor(L, bus.net)}" x1="${X(0)}" x2="${X(L.W - 1)}" y1="${Y(bus.y)}" y2="${Y(bus.y)}"/>`;
    for (const [ti, t] of L.traces.entries()) shapes += `<path class="bv-trace${V.bottom || (V.build && doneT(ti)) ? ' strong' : ''}${V.build && !doneT(ti) ? ' ghost' : ''}${V.net === t.net ? ' hl' : ''}${!V.build && V.rep && V.rep.ok && (V.rep.trace.get(ti) || {}).level ? ' hot-' + V.rep.trace.get(ti).level : ''}" style="stroke-width:${gw(t.awg || 22) + 1.5}" d="M${t.cells.map(([x, y]) => `${X(x)},${Y(y)}`).join('L')}"/>`;
  }
  // current-limit highlights under the parts (strips / rails over their rating)
  if (!V.build && V.rep && V.rep.ok && L.kind === 'bb') {
    const C = L.C;
    for (const [nd, lv] of V.rep.node) {
      const col = lv === 'err' ? '#dc2626' : '#f59e0b';
      if (nd < C) shapes += `<rect class="bv-hotstrip" x="${X(nd) - 5}" y="${Y(0) - 5}" width="10" height="${Y(4) - Y(0) + 10}" rx="4" fill="${col}"/>`;
      else if (nd < 2 * C) shapes += `<rect class="bv-hotstrip" x="${X(nd - C) - 5}" y="${Y(7) - 5}" width="10" height="${Y(11) - Y(7) + 10}" rx="4" fill="${col}"/>`;
      else { const row = [-3, -2, 13, 14][nd - 2 * C]; shapes += `<rect class="bv-hotstrip" x="${X(0) - 5}" y="${Y(row) - 5}" width="${X(C - 1) - X(0) + 10}" height="10" rx="4" fill="${col}"/>`; }
    }
  }
  const stepMap = SI ? SI.m : new Map();
  const doneOf = (t) => { const st = stepMap.get(stepKey(t)); return st ? isDoneStep(st) : false; };
  V.next = V.build ? nextStep() : null;
  // ---- parts
  let partsSvg = '', jumpSvg = '', extSvg = '', hlSvg = '';
  const parts = [], items = [], obstacles = [];
  for (const p of L.parts) {
    if (!p.ok) continue;
    const out = drawPart(p, L, M);
    parts.push({ id: p.id, box: out.box });
    obstacles.push({ id: p.id, box: out.box });
    const pdone = V.build && doneOf({ k: 'part', id: p.id });
    partsSvg += `<g class="bv-part${V.sel === p.id ? ' sel' : ''}${V.board.locks?.[p.id] ? ' locked' : ''}${V.build ? (pdone ? ' done' : ' ghost') : ''}" data-id="${p.id}">${out.svg}</g>`;
    if (pdone) partsSvg += `<g class="bv-check"><circle cx="${r1(out.box[2])}" cy="${r1(out.box[1])}" r="6"/><text x="${r1(out.box[2])}" y="${r1(out.box[1] + 0.5)}">✓</text></g>`;
    if (!V.build && V.rep && V.rep.ok) for (const [pi, q] of p.pins.entries()) { const lv = V.rep.pin.get(p.id + ':' + pi); if (q && lv) { const [x, y] = M(q.x, q.y); hlSvg += `<circle class="bv-hotpin ${lv}" cx="${r1(x)}" cy="${r1(y)}" r="6"/>`; } }
    if (out.label) items.push({ text: p.ref, cls: 'bv-ref', box: out.label, own: p.id });
  }
  // ---- jumpers along their routed paths
  for (const [ji, j] of L.jumpers.entries()) {
    const pts = (j.path || [j.a, j.b]).map(([x, y]) => M(x, y)).map(([x, y]) => [r1(x), r1(y)]);
    const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
    let d;
    if (pts.length === 2) {
      const dx = bx - ax, dy = by - ay, dd = Math.hypot(dx, dy) || 1, bend = Math.min(10, dd * 0.15);
      d = `M${ax},${ay}Q${r1((ax + bx) / 2 - (dy / dd) * bend)},${r1((ay + by) / 2 + (dx / dd) * bend)} ${bx},${by}`;
    } else d = roundedPath(pts);
    const jdone = V.build && doneOf({ k: 'jumper', i: ji }), hot = !V.build && V.rep && V.rep.ok && (V.rep.jumper.get(ji) || {}).level;
    jumpSvg += `<g class="bv-jump${V.net === j.net ? ' hl' : ''}${j.over && j.over.length ? ' over' : ''}${V.build ? (jdone ? ' done' : ' ghost') : ''}${hot ? ' hot-' + hot : ''}"><path d="${d}" style="stroke:${netColor(L, j.net)};stroke-width:${gw(j.awg || 22)}"/><circle cx="${ax}" cy="${ay}" r="2.2"/><circle cx="${bx}" cy="${by}" r="2.2"/></g>`;
    if (jdone) { const mx = (ax + bx) / 2, my = (ay + by) / 2; jumpSvg += `<g class="bv-check"><circle cx="${r1(mx)}" cy="${r1(my)}" r="5.5"/><text x="${r1(mx)}" y="${r1(my + 0.5)}">✓</text></g>`; }
  }
  // ---- off-board connection points
  V.exts = [];
  for (const e of L.externals) {
    const [x, y] = M(e.x, e.y);
    V.exts.push({ net: e.net, x, y });
    const sel = V.ext === e.net;
    const edone = V.build && doneOf({ k: 'ext', net: e.net }), ehot = !V.build && V.rep && V.rep.ok && V.rep.ext.get(e.net);
    extSvg += `<g class="bv-ext${sel ? ' sel' : ''}${V.build ? (edone ? ' done' : ' ghost') : ''}${ehot ? ' hot-' + ehot : ''}" data-net="${e.net}"><circle cx="${r1(x)}" cy="${r1(y)}" r="${sel ? 7.5 : 5.5}" style="stroke:${netColor(L, e.net)}"/></g>`;
    if (edone) extSvg += `<g class="bv-check"><circle cx="${r1(x + 7)}" cy="${r1(y - 7)}" r="5"/><text x="${r1(x + 7)}" y="${r1(y - 6.5)}">✓</text></g>`;
    fixed.push([x - 5.5, y - 5.5, x + 5.5, y + 5.5]);
    items.unshift({ text: `${e.name} ↗`, cls: 'bv-extl', box: [x - 6, y - 6, x + 6, y + 6], own: null });
  }
  for (const bus of L.buses || []) { const [x, y] = M(L.W - 1, bus.y); items.unshift({ text: bus.name, cls: 'bv-lbl bv-busl', box: [x - 3, y - 3, x + 3, y + 3], own: null }); }
  if (V.pin || V.pending) for (const pn of [V.pending, V.pin]) { if (!pn) continue; const part = L.parts.find((q) => q.id === pn.id), q = part && part.pins[pn.pi]; if (q) { const [x, y] = M(q.x, q.y); hlSvg += `<circle class="bv-pinsel${pn === V.pending ? ' pend' : ''}" cx="${r1(x)}" cy="${r1(y)}" r="8"/>`; } }
  if (V.build && V.next && V.next.target) {
    const t = V.next.target;
    if (t.k === 'part') { const pp = parts.find((q) => q.id === t.id); if (pp) hlSvg += `<rect class="bv-next" x="${pp.box[0] - 3}" y="${pp.box[1] - 3}" width="${pp.box[2] - pp.box[0] + 6}" height="${pp.box[3] - pp.box[1] + 6}" rx="6"/>`; }
    else if (t.k === 'jumper') { const j = L.jumpers[t.i]; if (j) hlSvg += `<path class="bv-next line" d="${roundedPath((j.path || [j.a, j.b]).map(([x, y]) => M(x, y)))}"/>`; }
    else if (t.k === 'trace') { const tr = L.traces[t.i]; if (tr) hlSvg += `<path class="bv-next line" d="${roundedPath(tr.cells.map(([x, y]) => M(x, y)), 2)}"/>`; }
    else if (t.k === 'ext') { const ee = V.exts.find((q) => q.net === t.net); if (ee) hlSvg += `<circle class="bv-next" cx="${ee.x}" cy="${ee.y}" r="10"/>`; }
  }
  // pin hole highlight for the selected net
  if (V.net != null) for (const p of L.parts) for (const q of p.pins) if (q && q.net === V.net) { const [x, y] = M(q.x, q.y); hlSvg += `<circle class="bv-hlpin" cx="${r1(x)}" cy="${r1(y)}" r="6.5"/>`; }
  // external labels first (they are tied to a hole), then parts
  items.sort((a, c) => (a.own === null ? 0 : 1) - (c.own === null ? 0 : 1));
  const labelsSvg = placeLabels(items, obstacles, fixed);
  V.parts = parts;
  if (!V.vb) V.vb = { x: 0, y: 0, w: VG.out.w, h: VG.out.h };
  V.svg.setAttribute('viewBox', `${V.vb.x} ${V.vb.y} ${V.vb.w} ${V.vb.h}`);
  V.svg.innerHTML = `<g transform="matrix(${mat.join(',')})">${shapes}</g>${texts}${partsSvg}${jumpSvg}${hlSvg}${extSvg}${labelsSvg}`;
  const ban = V.el.querySelector('.bv-banner');
  const msgs = [];
  if (L.stale) msgs.push('The schematic changed since this layout. <button class="btn small pri" data-bv="update">Update layout</button> <button class="btn small" data-bv="rebuild">Rebuild</button>');
  if (!L.parts.length) msgs.push('Empty board — tap <b>Add part</b>, then tap pins to connect them. Everything you do here is written to the schematic.');
  if (V.bottom) msgs.push('Bottom view (mirrored) — the side you solder.');
  ban.hidden = !msgs.length;
  ban.innerHTML = msgs.join('<br>');
  renderPartbar();
}

function bands(v) {
  const C = ['#111', '#7c4a1e', '#e11d48', '#f97316', '#facc15', '#16a34a', '#2563eb', '#7c3aed', '#9ca3af', '#f8fafc'];
  if (!(v > 0)) return [];
  const e = Math.floor(Math.log10(v)) - 1, d = Math.round(v / Math.pow(10, e));
  const d1 = Math.floor(d / 10) % 10, d2 = d % 10;
  const mult = e < 0 ? (e === -1 ? '#d4a017' : '#c0c0c0') : C[Math.min(9, e)];
  return [C[d1], C[d2], mult, '#d4a017'];
}
function drawPart(p, L, M) {
  const pins = p.pins.map((q) => (q ? M(q.x, q.y).map(r1) : null));
  const all = [...pins.filter(Boolean), ...(p.nc || []).map((q) => M(q.x, q.y).map(r1))];
  const xs = all.map((a) => a[0]), ys = all.map((a) => a[1]);
  const box = [Math.min(...xs) - 7, Math.min(...ys) - 7, Math.max(...xs) + 7, Math.max(...ys) + 7];
  const fp = p.fp;
  let g = '';
  const leg = (a, b) => `<line class="bv-leg" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`;
  const dot = (a) => `<circle class="bv-lead" cx="${a[0]}" cy="${a[1]}" r="2"/>`;
  const label = (x, y, t, cls = 'bv-ref') => `<text class="${cls}" x="${x}" y="${y}">${esc(t)}</text>`;
  if (fp.kind === '2lead') {
    const a = pins[fp.map[0]], b = pins[fp.map[1]];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, d = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    g += leg(a, b) + dot(a) + dot(b);
    const st = fp.style;
    const len = Math.max(10, Math.min(d - 8, 26));
    let body = '';
    if (d < 14 && (st === 'resistor' || st === 'diode' || st === 'inductor')) {
      // standing part
      body = `<circle cx="${a[0]}" cy="${a[1]}" r="5.5" class="bv-b-${st}"/>`;
      g += body;
      return { svg: g, box, label: [a[0] - 6, a[1] - 6, a[0] + 6, a[1] + 6] };
    }
    if (st === 'resistor') { body = `<rect x="${-len / 2}" y="-3.8" width="${len}" height="7.6" rx="3.5" class="bv-b-resistor"/>`; const v = parseEng(p.label); bands(v).forEach((c, i) => { body += `<rect x="${-len / 2 + 3 + i * (len - 8) / 3.4}" y="-3.8" width="2" height="7.6" fill="${c}"/>`; }); }
    else if (st === 'diode') { const kFirst = fp.map[1] === 1; body = `<rect x="${-len / 2}" y="-3.2" width="${len}" height="6.4" rx="1.5" class="bv-b-diode"/><rect x="${kFirst ? len / 2 - 4 : -len / 2 + 1.5}" y="-3.2" width="2.5" height="6.4" fill="#cbd5e1"/>`; }
    else if (st === 'inductor') body = `<rect x="${-len / 2}" y="-4" width="${len}" height="8" rx="3" class="bv-b-inductor"/>`;
    else if (st === 'fuse') body = `<rect x="${-len / 2}" y="-3.5" width="${len}" height="7" rx="1.5" class="bv-b-fuse"/><line x1="${-len / 2}" x2="${len / 2}" y1="0" y2="0" stroke="#94a3b8" stroke-width="1"/>`;
    else if (st === 'ceramic') body = `<circle r="5" class="bv-b-ceramic"/>`;
    else if (st === 'electrolytic') body = `<circle r="6.5" class="bv-b-elco"/><path d="M-3,-5.6A6.5,6.5 0 0 1 -3,5.6" class="bv-b-elcostripe"/>`;
    else if (st === 'led') { const col = { red: '#ef4444', yellow: '#facc15', green: '#22c55e', blue: '#3b82f6', white: '#f1f5f9' }[(p.label || '').toLowerCase()] || '#ef4444'; body = `<circle r="6" fill="${col}" stroke="#0002"/><path d="M-6,-1.5V1.5" stroke="#0005" stroke-width="2"/>`; }
    else if (st === 'ldr') body = `<circle r="6" class="bv-b-ldr"/><path d="M-3.5,-2.5Q0,-5 3.5,-2.5M-3.5,0Q0,-2.5 3.5,0M-3.5,2.5Q0,0 3.5,2.5" stroke="#7c2d12" fill="none" stroke-width="0.8"/>`;
    else if (st === 'photo') body = `<circle r="5.5" class="bv-b-photo"/>`;
    else if (st === 'switch' || st === 'button') body = `<rect x="-6" y="-6" width="12" height="12" rx="2" class="bv-b-switch"/><circle r="3" fill="#475569"/>`;
    g += `<g transform="translate(${mx},${my}) rotate(${ang})">${body}</g>`;
    return { svg: g, box, label: [Math.min(a[0], b[0]) - 4, Math.min(a[1], b[1]) - 5, Math.max(a[0], b[0]) + 4, Math.max(a[1], b[1]) + 5] };
  }
  if (fp.kind === 'inline') {
    const ps = fp.map.map((i) => pins[i]).filter(Boolean);
    const x0 = Math.min(...ps.map((q) => q[0])), x1 = Math.max(...ps.map((q) => q[0])), y0 = Math.min(...ps.map((q) => q[1])), y1 = Math.max(...ps.map((q) => q[1]));
    const horiz = x1 - x0 >= y1 - y0;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    ps.forEach((q) => { g += dot(q); });
    if (fp.style === 'to220') g += horiz ? `<rect x="${x0 - 7}" y="${cy - 5}" width="${x1 - x0 + 14}" height="10" rx="1.5" class="bv-b-ic"/><rect x="${x0 - 7}" y="${cy - 9}" width="${x1 - x0 + 14}" height="4.5" class="bv-b-tab"/>` : `<rect x="${cx - 5}" y="${y0 - 7}" width="10" height="${y1 - y0 + 14}" rx="1.5" class="bv-b-ic"/><rect x="${cx - 9}" y="${y0 - 7}" width="4.5" height="${y1 - y0 + 14}" class="bv-b-tab"/>`;
    else if (fp.style === 'to92') g += horiz ? `<path d="M${x0 - 5},${cy + 2}H${x1 + 5}A${(x1 - x0) / 2 + 5},7 0 0 0 ${x0 - 5},${cy + 2}Z" class="bv-b-ic"/>` : `<path d="M${cx + 2},${y0 - 5}V${y1 + 5}A7,${(y1 - y0) / 2 + 5} 0 0 0 ${cx + 2},${y0 - 5}Z" class="bv-b-ic"/>`;
    else if (fp.style === 'pot') g += `<rect x="${x0 - 6}" y="${y0 - 6}" width="${x1 - x0 + 12}" height="${y1 - y0 + 12}" rx="2" class="bv-b-pot"/><circle cx="${cx}" cy="${cy}" r="3.5" fill="#f8fafc"/>`;
    else if (fp.style === 'module') g += `<rect x="${x0 - 6}" y="${y0 - 6}" width="${x1 - x0 + 12}" height="${y1 - y0 + 12}" rx="2" class="bv-b-module"/>`;
    else g += `<rect x="${x0 - 6}" y="${y0 - 6}" width="${x1 - x0 + 12}" height="${y1 - y0 + 12}" rx="2" class="bv-b-switch"/>`;
    ps.forEach((q) => { g += dot(q); });
    g += label(cx, cy, p.ref, 'bv-ref light');
    return { svg: g, box };
  }
  // DIP & dual-header modules: body spans between the two pin rows
  const ps = all;
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const rowsY = new Set(ps.map((q) => Math.round(q[1]))), rowsX = new Set(ps.map((q) => Math.round(q[0])));
  const horiz = rowsY.size <= rowsX.size;
  const isMod = fp.kind === 'dual';
  const r = horiz ? { x: x0 - 6, y: isMod ? y0 - 6 : y0 + 3, w: x1 - x0 + 12, h: isMod ? y1 - y0 + 12 : y1 - y0 - 6 } : { x: isMod ? x0 - 6 : x0 + 3, y: y0 - 6, w: isMod ? x1 - x0 + 12 : x1 - x0 - 6, h: y1 - y0 + 12 };
  g += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${isMod ? 3 : 2}" class="${isMod ? 'bv-b-module' : 'bv-b-ic'}"/>`;
  ps.forEach((q) => { g += `<rect x="${q[0] - 2.2}" y="${q[1] - 2.2}" width="4.4" height="4.4" class="bv-pin"/>`; });
  if (!isMod) {
    // pin-1 marker
    const p1 = pins[fp.map[0]] || ps[0];
    g += `<circle cx="${p1[0] + (horiz ? 0 : (p1[0] < (x0 + x1) / 2 ? 5 : -5))}" cy="${p1[1] + (horiz ? (p1[1] < (y0 + y1) / 2 ? 5 : -5) : 0)}" r="1.6" fill="#e2e8f0"/>`;
  } else {
    const first = pins[fp.left[0]];
    if (first) g += `<rect x="${horiz ? first[0] - 10 : r.x + r.w / 2 - 5}" y="${horiz ? r.y + r.h / 2 - 5 : first[1] - 10}" width="${horiz ? 6 : 10}" height="${horiz ? 10 : 6}" fill="#cbd5e1" rx="1"/>`;
  }
  g += label(r.x + r.w / 2, r.y + r.h / 2 - 3, p.ref, 'bv-ref light') + label(r.x + r.w / 2, r.y + r.h / 2 + 6, p.name, 'bv-val light');
  return { svg: g, box };
}

function renderStats() {
  const L = V.L, st = L.stats;
  const ok = L.verify.ok && !L.issues.length;
  V.el.querySelector('.bv-stats').innerHTML = `
    <span class="chip">${st.jumpers} jumper${st.jumpers === 1 ? '' : 's'}</span>
    <span class="chip">${L.kind === 'perf' ? 'trails+wires' : 'wire'} ${st.len} holes ≈ ${(st.len * 0.254).toFixed(1)} cm</span>
    <span class="chip">${L.kind === 'bb' ? `${st.used} columns` : `area ${st.used}`}</span>
    ${V.rep && V.rep.ok && V.rep.items.length ? `<span class="chip ${V.rep.items.some((i) => i.level === 'err') ? 'bad' : 'warn'}" data-bv="curtab" title="Some connections carry more current than they are rated for">⚡ ${V.rep.items.length} current warning${V.rep.items.length > 1 ? 's' : ''}</span>` : ''}
    ${(() => { const pr = progress(); return V.build || pr.done ? `<span class="chip ok" title="Parts and connections you have marked as built">✓ built ${pr.done}/${pr.total}</span>` : ''; })()}
    ${st.detours ? `<span class="chip" title="Jumpers are routed in right angles around parts instead of over them">↪ ${st.detours} routed around parts</span>` : ''}
    ${st.crossings ? `<span class="chip bad" title="${esc(L.notes.filter((n) => /cannot avoid/.test(n)).join('\n'))}">⚠ ${st.crossings} over a part</span>` : ''}
    <span class="chip ${ok ? 'ok' : 'bad'}" title="${esc([...L.verify.errors, ...L.issues].join('\n'))}">${ok ? '✓ matches schematic' : '⚠ ' + (L.verify.errors.length + L.issues.length) + ' problem' + (L.verify.errors.length + L.issues.length > 1 ? 's' : '')}</span>`;
}

// ------------------------------------------------------------------ side panel
function renderPanel() {
  const body = V.el.querySelector('.bv-body');
  const b = V.board, L = V.L, T = BOARD_TYPES[b.type];
  let h = '';
  if (V.tab === 'setup') {
    const w = weightsOf(b);
    const nets = L.prob.nets.filter((n) => !n.nc && n.pins.length).map((n) => n.name).sort();
    const presets = T.presets.map(([lbl, a, c], i) => `<option value="${i}" ${(T.kind === 'bb' ? b.cols === a && (b.rails !== false) === c : b.w === a && b.h === c) ? 'selected' : ''}>${esc(lbl)}</option>`).join('');
    h += `${L.verify.ok && !L.issues.length ? '' : `<div class="note">${[...L.issues, ...L.verify.errors].map(esc).join('<br>')}</div>`}`;
    h += `<div class="sec">Board</div>
      <div class="field"><label>Type</label><select class="inp" data-set="type">${Object.entries(BOARD_TYPES).map(([k, t]) => `<option value="${k}" ${k === b.type ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Size preset</label><select class="inp" data-set="preset"><option value="">Custom</option>${presets}</select></div>`;
    if (T.kind === 'bb') {
      h += `<div class="field"><label>Columns</label><div class="valrow"><input class="inp" data-set="cols" value="${b.cols}" inputmode="numeric"><span class="unit">≈ ${(b.cols * 0.254).toFixed(1)} cm</span></div></div>
        <div class="field"><label>Power rails</label><div><button class="toggle ${b.rails !== false ? 'on' : ''}" data-set="rails"></button></div></div>`;
      if (b.rails !== false) h += `<div class="field"><label>Top + rail</label><select class="inp" data-set="railTop"><option value="">Auto</option><option value="-" ${b.opts.railTop === '-' ? 'selected' : ''}>Unused</option>${nets.map((n) => `<option ${b.opts.railTop === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
        <div class="field"><label>Bottom + rail</label><select class="inp" data-set="railBot"><option value="">Auto</option><option value="-" ${b.opts.railBot === '-' ? 'selected' : ''}>Unused</option>${nets.map((n) => `<option ${b.opts.railBot === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
        <div class="hint">− rails carry GND. Now: top + = <b>${esc(L.prob.nets[L.rails.TP]?.name || '—')}</b>, bottom + = <b>${esc(L.prob.nets[L.rails.BP]?.name || '—')}</b>.</div>`;
    } else {
      h += `<div class="field"><label>Size (holes)</label><div class="valrow"><input class="inp" data-set="w" value="${b.w}" inputmode="numeric"><span class="unit">×</span><input class="inp" data-set="h" value="${b.h}" inputmode="numeric"></div></div>
        <div class="field"><label>Size (mm)</label><div class="valrow"><input class="inp" data-set="wmm" value="${Math.round(b.w * 2.54)}" inputmode="decimal"><span class="unit">×</span><input class="inp" data-set="hmm" value="${Math.round(b.h * 2.54)}" inputmode="decimal"></div></div>
        <div class="field"><label>Power buses (top/bottom rows)</label><div><button class="toggle ${b.opts.bus !== false ? 'on' : ''}" data-set="bus"></button></div></div>
        <div class="field"><label>Off-board header edge</label><select class="inp" data-set="edge">${['left', 'right', 'top', 'bottom'].map((e) => `<option ${b.opts.edge === e ? 'selected' : ''}>${e}</option>`).join('')}</select></div>`;
    }
    h += `<div class="sec">What “optimal” means</div>
      <div class="field"><label>Goal</label><select class="inp" data-set="objective">${Object.entries(OBJECTIVES).map(([k, o]) => `<option value="${k}" ${k === b.objective && !b.weights ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}${b.weights ? '<option selected>Custom weights</option>' : ''}</select></div>
      <div class="hint">${esc(b.weights ? 'Your own weighting of the goals below.' : OBJECTIVES[b.objective].desc)}</div>
      <div class="formula">minimise&nbsp; ${w.j}·jumpers + ${w.l}·wire length + ${w.a}·${T.kind === 'bb' ? 'columns used' : 'area (w+h)'} + ${w.f}·schematic-order deviation</div>
      <details class="adv"><summary>Adjust weights</summary>
        ${[['j', 'Jumper wires', 20], ['l', 'Wire length', 3], ['a', 'Space used', 5], ['f', 'Follow schematic order', 50]].map(([k, lbl, max]) => `<div class="field"><label>${lbl}</label><div class="valrow"><input type="range" min="0" max="${max}" step="${max / 100}" value="${w[k]}" data-w="${k}"><span class="unit" data-wv="${k}">${w[k]}</span></div></div>`).join('')}
      </details>
      <div class="hint" style="font-size:12.5px"><b>Always enforced:</b> one net per ${T.kind === 'bb' ? 'strip' : 'hole / trail'} (no shorts)${T.kind === 'bb' ? ', ≤ 5 holes per strip, ICs & modules straddle the channel' : ', trails never cross (insulated jumpers instead)'}, everything on the board. The result is re-traced hole by hole and compared with the schematic.</div>
      <div class="sec">Options</div>
      <div class="field"><label>Standing resistors / diodes</label><div><button class="toggle ${b.opts.allowStanding ? 'on' : ''}" data-set="allowStanding"></button></div></div>
      ${T.kind === 'bb' ? `<div class="field"><label>Leads straight into rails</label><div><button class="toggle ${b.opts.directRails !== false ? 'on' : ''}" data-set="directRails"></button></div></div>` : ''}
      <div class="field"><label>Search effort</label><select class="inp" data-set="effort">${Object.keys(EFFORT).map((e) => `<option ${b.opts.effort === e ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
      <div class="sec">Parts on this board (${b.compIds.length})</div>
      ${b.compIds.length ? `<div class="pchips">${b.compIds.map((id) => V.app.comp(id)).filter(Boolean).map((c) => `<span class="pchip">${esc(c.ref)} <small>${esc(c.props.part || c.type)}</small><button data-rmpart="${c.id}" title="Remove from this board (stays in the schematic)" aria-label="Remove ${esc(c.ref)} from board">×</button></span>`).join('')}</div>` : '<div class="hint">This board is empty. Add parts, then tap their pins to connect them — the schematic is built from what you do here.</div>'}
      ${L.notes.length ? '<div class="hint">' + L.notes.map(esc).join('<br>') + '</div>' : ''}
      <div class="actions"><button class="btn pri" data-bv="add">${icon('plus')}Add new part</button><button class="btn" data-bv="addfrom">Add from schematic…</button></div>
      <div class="hint">Tap a part to rotate / flip / lock it. Tap a pin (the dot at a lead) to connect it to another pin or <b>Disconnect</b> it. Locked parts stay put when you Optimize, so build by hand, lock what you like, then Optimize to tidy the rest.</div>
      <div class="actions"><button class="btn" data-bv="lockall">Lock all</button><button class="btn" data-bv="unlockall">Unlock all</button><button class="btn danger" data-bv="delete">${icon('trash')}Delete board</button></div>`;
  } else if (V.tab === 'steps') {
    const list = steps(L);
    const n = list.filter(isDoneStep).length;
    h += `<div class="sh-head"><h3>Build steps</h3><span class="sub">${n}/${list.length}</span></div><div class="pbar" style="width:100%;height:7px;margin-bottom:6px"><i style="width:${list.length ? (n / list.length) * 100 : 0}%"></i></div>`;
    let g = null;
    for (const s of list) {
      if (s.group !== g) { h += `<div class="sec">${esc(s.group)}</div>`; g = s.group; }
      const dn = isDoneStep(s);
      h += `<div class="li" data-step="${esc(s.id)}" data-net="${s.net ?? ''}" data-ref="${esc(s.ref || '')}"><button class="chk ${dn ? 'on' : ''}" data-done="${esc(s.id)}">${dn ? icon('check') : ''}</button><div class="grow"><div class="t1" style="white-space:normal">${esc(s.text)}</div></div></div>`;
    }
    h += `<div class="actions"><button class="btn danger small" data-bv="resetsteps">Reset checklist</button></div>`;
  } else if (V.tab === 'cur') {
    const rep = V.rep, lim = LIMITS[b.type] || LIMITS.breadboard;
    h += `<div class="hint">Currents come from the circuit simulation (DC / average — PWM and gate-driver peaks are not included). Limits are typical figures for a ${esc(lim.name)}; check your own parts.</div>`;
    if (!rep || !rep.ok) h += `<div class="note">The circuit could not be simulated, so there are no currents yet. Check the schematic for errors.</div>`;
    else {
      const gOpt = (cur) => AWG.map((g) => `<option value="${g}" ${g === cur ? 'selected' : ''}>${g} AWG · ${ampOf(g)} A</option>`).join('');
      h += `<div class="sec">Default wire gauge</div>
        <div class="field"><label>${L.kind === 'perf' ? 'Insulated jumpers' : 'Jumper wires'}</label><select class="inp" data-gdef="gauge">${gOpt(b.opts.gauge ?? 22)}</select></div>
        ${L.kind === 'perf' ? `<div class="field"><label>Solder trails / bus</label><select class="inp" data-gdef="trailGauge">${gOpt(b.opts.trailGauge ?? 22)}</select></div>` : ''}
        ${b.type === 'breadboard' ? '<div class="hint">Solderless breadboard holes take roughly 20–26 AWG solid wire; thicker wire will not fit.</div>' : ''}`;
      const rows = rep.nets.filter((x) => x.I > 0.0005).sort((x, y) => y.I - x.I);
      h += `<div class="sec">Per connection (net)</div>${rows.length ? '' : '<div class="hint">No significant current in this circuit.</div>'}`;
      if (rows.length) {
        h += `<table class="pins-table"><tr><th>Net</th><th>Current</th><th>Wire gauge</th></tr>`;
        for (const n of rows) {
          const lvl = n.I > n.amp ? 'err' : n.I > 0.7 * n.amp ? 'warn' : 'ok';
          h += `<tr><td>${esc(n.name)}</td><td class="mono"><i class="dot ${lvl}"></i> ${esc(fmt(n.I, 'A', 3))}</td><td><select class="inp" data-gnet="${n.net}" style="padding:4px 22px 4px 6px;font-size:12.5px">${gOpt(n.awg)}</select></td></tr>`;
        }
        h += '</table>';
      }
      h += `<div class="actions"><button class="btn pri" data-bv="gsuggest">Suggest gauges</button><button class="btn" data-bv="greset">Reset to default</button></div>`;
      h += `<div class="sec">Warnings (${rep.items.length})</div>` + (rep.items.length ? rep.items.map((i, k) => `<div class="wmsg" data-curitem="${k}"><i class="dot ${i.level}"></i><div>${esc(i.text)}</div></div>`).join('') : '<div class="hint">✓ Nothing is carrying more than about 70 % of its rating.</div>');
    }
  } else {
    h += `<div class="hint">Nets that leave this board. Wire each connection point to the listed destination.</div>`;
    if (!L.externals.length) h += '<div class="hint">This board has no off-board connections.</div>';
    for (const e of L.externals) h += `<div class="li${V.ext === e.net ? ' on' : ''}" data-net="${e.net}" data-ext="${e.net}"><i class="dot" style="background:${netColor(L, e.net)}"></i><div class="grow"><div class="t1">${esc(e.name)} <span class="t2">${esc(e.where || holeName(e.x, e.y))}</span></div><div class="t2" style="white-space:normal">→ ${esc(e.dests.join(', ') || 'external')}</div></div><button class="btn small" data-link="${e.net}">${icon('plus')}Connect…</button></div>`;
    const myIds = new Set(b.compIds);
    const mine = V.app.doc.wires.filter((w) => w.link && (myIds.has(w.a.c) || myIds.has(w.b.c)));
    if (mine.length) h += `<div class="sec">Links made here</div>` + mine.map((w) => `<div class="li"><i class="dot" style="background:#8b5cf6"></i><div class="grow"><div class="t1">${esc(describeEnd(V.app.doc, w.a))} ⟷ ${esc(describeEnd(V.app.doc, w.b))}</div></div><button class="ib" data-unlink="${w.id}" title="Remove link">${icon('x')}</button></div>`).join('');
    const others = (V.app.doc.boards || []).filter((x) => x.id !== b.id);
    if (others.length) {
      h += `<div class="sec">Wiring between boards</div>`;
      const mine = new Map(L.externals.map((e) => [L.prob.nets[e.net].nid, e]));
      let any = false;
      for (const o of others) {
        let OL; try { OL = layout(V.app.doc, o); } catch { continue; }
        for (const e2 of OL.externals) {
          const e = mine.get(OL.prob.nets[e2.net].nid);
          if (!e) continue;
          any = true;
          h += `<div class="li"><i class="dot" style="background:${netColor(L, e.net)}"></i><div class="grow"><div class="t1">${esc(e.name)}</div><div class="t2">${esc(b.name)} ${esc(e.where || holeName(e.x, e.y))} ⟷ ${esc(o.name)} ${esc(e2.where || (OL.kind === 'bb' ? holeName(e2.x, e2.y) : `(${e2.x + 1},${e2.y + 1})`))}</div></div><button class="btn small" data-open="${o.id}">Open</button></div>`;
        }
      }
      if (!any) h += '<div class="hint">No nets shared with the other boards.</div>';
    }
  }
  body.innerHTML = h;
  bindPanel(body);
}

function bindPanel(body) {
  const b0 = V.board; void b0;
  const b = V.board, app = V.app;
  const save = (re = true) => { app.changed('board', { keepSheet: true }); if (re) { relayout(); renderPanel(); } };
  body.querySelectorAll('[data-set]').forEach((el) => {
    const k = el.dataset.set;
    const ev = el.tagName === 'BUTTON' ? 'click' : 'change';
    el.addEventListener(ev, () => {
      const T = BOARD_TYPES[b.type];
      switch (k) {
        case 'type': b.type = el.value; if (BOARD_TYPES[b.type].kind !== T.kind) b.params = {}; b.sig = ''; V.vb = null; save(); fit(); runOptimize(true); return;
        case 'preset': { if (el.value === '') return; const pr = T.presets[+el.value]; if (T.kind === 'bb') { b.cols = pr[1]; b.rails = pr[2]; } else { b.w = pr[1]; b.h = pr[2]; } V.vb = null; save(); fit(); runOptimize(false); return; }
        case 'cols': b.cols = Math.max(5, Math.min(200, Math.round(parseEng(el.value) || b.cols))); V.vb = null; save(); fit(); return;
        case 'w': case 'h': b[k] = Math.max(6, Math.min(120, Math.round(parseEng(el.value) || b[k]))); V.vb = null; save(); fit(); return;
        case 'wmm': case 'hmm': b[k[0]] = Math.max(6, Math.min(120, Math.floor((parseEng(el.value) || 0) / 2.54))); V.vb = null; save(); fit(); return;
        case 'rails': b.rails = b.rails === false; save(); return;
        case 'railTop': case 'railBot': case 'edge': case 'effort': b.opts[k] = el.value; save(); return;
        case 'bus': case 'directRails': b.opts[k] = b.opts[k] === false ? true : false; save(); return;
        case 'allowStanding': b.opts.allowStanding = !b.opts.allowStanding; save(); return;
        case 'objective': if (OBJECTIVES[el.value]) { b.objective = el.value; b.weights = null; save(); } return;
      }
    });
  });
  body.querySelectorAll('[data-w]').forEach((el) => el.addEventListener('input', () => {
    b.weights = { ...weightsOf(b), [el.dataset.w]: +(+el.value).toFixed(2) };
    body.querySelector(`[data-wv="${el.dataset.w}"]`).textContent = b.weights[el.dataset.w];
    const f = body.querySelector('.formula'); const w = b.weights;
    if (f) f.innerHTML = `minimise&nbsp; ${w.j}·jumpers + ${w.l}·wire length + ${w.a}·${BOARD_TYPES[b.type].kind === 'bb' ? 'columns used' : 'area (w+h)'} + ${w.f}·schematic-order deviation`;
    app.changed('board', { keepSheet: true });
  }));
  body.querySelectorAll('[data-done]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const st = steps(V.L).find((x) => x.id === el.dataset.done); if (st) { setDoneStep(st, !isDoneStep(st)); render(); renderStats(); renderPanel(); } }));
  body.querySelectorAll('.li[data-step], .li[data-net]').forEach((el) => el.addEventListener('click', () => {
    if (el.dataset.ref) { const p = V.L.parts.find((q) => q.ref === el.dataset.ref); V.sel = p ? p.id : null; V.net = null; }
    else if (el.dataset.net !== '') { V.net = +el.dataset.net; V.sel = null; }
    render();
  }));
  body.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', () => openBoard(app, el.dataset.open)));
  const regauge = () => { app.changed('board', { keepSheet: true }); relayout(); renderPanel(); };
  body.querySelectorAll('[data-gdef]').forEach((el) => el.addEventListener('change', () => { b.opts[el.dataset.gdef] = +el.value; regauge(); }));
  body.querySelectorAll('[data-gnet]').forEach((el) => el.addEventListener('change', () => { (b.gauges ||= {})[V.L.prob.nets[+el.dataset.gnet].key] = +el.value; regauge(); }));
  body.querySelectorAll('[data-curitem]').forEach((el) => el.addEventListener('click', () => { const it = V.rep.items[+el.dataset.curitem]; V.net = it.net; V.sel = null; render(); }));
  body.querySelectorAll('[data-rmpart]').forEach((el) => el.addEventListener('click', async (e) => {
    e.stopPropagation();
    const id = el.dataset.rmpart;
    app.checkpoint();
    b.compIds = b.compIds.filter((x) => x !== id); delete b.params?.[id]; delete b.locks?.[id];
    if (V.sel === id) V.sel = null;
    app.changed('board', { keepSheet: true });
    await settle();
  }));
  body.querySelectorAll('[data-link]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); openLinkPicker(+el.dataset.link); }));
  body.querySelectorAll('[data-unlink]').forEach((el) => el.addEventListener('click', async (e) => {
    e.stopPropagation();
    app.checkpoint();
    app.doc.wires = app.doc.wires.filter((w) => w.id !== el.dataset.unlink);
    cleanup(app.doc); app.changed('board');
    relayout(); renderPanel(); await runOptimize(false);
  }));
  body.querySelectorAll('.li[data-ext]').forEach((el) => el.addEventListener('click', () => { V.ext = +el.dataset.ext; V.sel = null; render(); }));
}

function pinInfo(pn) {
  const part = V.L.parts.find((q) => q.id === pn.id), c = V.app.comp(pn.id);
  if (!part || !c) return null;
  const q = part.pins[pn.pi], nl = V.L.prob.nl, nid = nl.pinNet(pn.id, pn.pi);
  return { ref: c.ref, name: getPins(c)[pn.pi]?.name || String(pn.pi), net: nid == null ? '' : nl.nets[nid].name, hole: q ? (V.L.kind === 'bb' ? holeName(q.x, q.y) : `(${q.x + 1},${q.y + 1})`) : '' };
}
function renderPartbar() {
  const bar = V.el.querySelector('.bv-partbar');
  if (V.build) {
    const pr = progress(), nxt = V.next;
    bar.hidden = false;
    bar.innerHTML = nxt
      ? `<div class="grow"><div class="t2" style="font-family:var(--font)">Next · ${pr.done}/${pr.total} built — tap parts and wires on the board to tick them off</div><div style="white-space:normal;font-weight:600">${esc(nxt.text)}</div></div><button class="btn small pri" data-bv="ndone">${icon('check')}Done</button><button class="btn small" data-bv="nskip">Skip</button>`
      : `<div class="grow"><b>✓ Everything is built.</b> <span class="t2" style="font-family:var(--font)">${pr.total} of ${pr.total} steps done</span></div><button class="btn small" data-bv="resetsteps">Start over</button>`;
    return;
  }
  if (V.pending) {
    const pi = pinInfo(V.pending);
    bar.hidden = false;
    bar.innerHTML = `<div class="grow">Tap another pin to connect <b>${esc(pi ? `${pi.ref}.${pi.name}` : '')}</b> to it</div><button class="btn small" data-bv="pcancel">Cancel</button>`;
    return;
  }
  if (V.pin && !V.sel && V.ext == null) {
    const pi = pinInfo(V.pin);
    if (pi) {
      bar.hidden = false;
      bar.innerHTML = `<div class="grow"><b>${esc(pi.ref)}.${esc(pi.name)}</b> <span class="t2">${esc(pi.hole)}</span><div class="t2" style="font-family:var(--font)">net ${esc(pi.net)}</div></div>
        <button class="btn small pri" data-bv="pconnect">${icon('plus')}Connect to pin</button><button class="btn small" data-bv="plink">Connect to…</button><button class="btn small danger" data-bv="pdisc">${icon('unlink')}Disconnect</button><button class="ib" data-bv="desel">${icon('x')}</button>`;
      return;
    }
  }
  const ex = V.ext != null && !V.sel ? V.L.externals.find((e) => e.net === V.ext) : null;
  if (ex) {
    bar.hidden = false;
    bar.innerHTML = `<div class="grow"><b>${esc(ex.name)}</b> <span class="t2">${esc(ex.where || holeName(ex.x, ex.y))}</span><div class="t2" style="font-family:var(--font);white-space:normal">→ ${esc(ex.dests.join(', ') || 'external')}</div></div>
      <button class="btn small pri" data-bv="connect">${icon('plus')}Connect to…</button><button class="ib" data-bv="desel">${icon('x')}</button>`;
    return;
  }
  const p = V.sel && V.L.parts.find((q) => q.id === V.sel);
  if (!p) { bar.hidden = true; return; }
  const locked = !!V.board.locks?.[p.id];
  const pins = p.pins.map((q, i) => (q ? (V.L.kind === 'bb' ? holeName(q.x, q.y) : `(${q.x + 1},${q.y + 1})`) : null)).filter(Boolean).join(' · ');
  bar.hidden = false;
  bar.innerHTML = `<div class="grow"><b>${esc(p.ref)}</b> ${esc(p.name || p.label)}<div class="t2">${esc(pins)}</div></div>
    <button class="btn small" data-bv="rot">${icon('rotate')}Rotate</button><button class="btn small" data-bv="flip">${icon('flip')}Flip</button>
    <button class="btn small ${locked ? 'sel' : ''}" data-bv="lock">${locked ? '🔒 Locked' : '🔓 Lock'}</button><button class="ib" data-bv="desel">${icon('x')}</button>`;
}

// ------------------------------------------------------------------ actions
function onClick(e) {
  const t = e.target.closest('[data-bv]');
  if (!t) return;
  const a = t.dataset.bv, b = V.board, app = V.app;
  switch (a) {
    case 'close': closeBoard(); break;
    case 'opt': runOptimize(false); break;
    case 'new': b.seed = (b.seed || 1) + 1; runOptimize(true); break;
    case 'stop': V.stop = true; break;
    case 'zin': zoom(0.8); break;
    case 'zout': zoom(1.25); break;
    case 'fit': fit(!V.fitWhole); break;
    case 'flipview': V.bottom = !V.bottom; V.vb = null; fit(!!V.fitWhole); app.toast(V.bottom ? 'Bottom view (mirrored)' : 'Top view'); break;
    case 'rotview': V.rot = ((V.rot || 0) + 1) % 4; V.vb = null; fit(!!V.fitWhole); app.toast(`View rotated ${(V.rot || 0) * 90}°`); break;
    case 'connect': if (V.ext != null) openLinkPicker(V.ext); break;
    case 'desel': V.sel = null; V.ext = null; V.pin = null; V.pending = null; V.net = null; render(); break;
    case 'mlayout': case 'mbuild': {
      V.build = a === 'mbuild'; b.build = V.build; V.sel = null; V.ext = null; V.pin = null; V.pending = null; V.net = null;
      V.el.classList.toggle('building', V.build);
      V.el.querySelectorAll('.bv-mode button').forEach((x) => x.classList.toggle('on', (x.dataset.bv === 'mbuild') === V.build));
      if (V.build) { V.tab = 'steps'; V.el.querySelectorAll('.bv-tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === 'steps')); app.toast('Build mode: tap each part, wire or connection when it is done'); }
      render(); renderStats(); renderPanel(); break;
    }
    case 'ndone': if (V.next) { setDoneStep(V.next, true); render(); renderStats(); if (V.tab === 'steps') renderPanel(); } break;
    case 'nskip': if (V.next) { V.skip.add(V.next.id); render(); } break;
    case 'curtab': V.tab = 'cur'; V.el.querySelectorAll('.bv-tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === 'cur')); renderPanel(); break;
    case 'gsuggest': {
      b.gauges ||= {}; let over = 0;
      for (const n of V.rep.nets) if (n.I > 0.0005) { b.gauges[V.L.prob.nets[n.net].key] = n.rec; if (ampOf(n.rec) < n.I) over++; }
      app.changed('board', { keepSheet: true }); relayout(); renderPanel();
      app.toast(over ? `Gauges set. ${over} path${over > 1 ? 's' : ''} still exceed what any wire here can carry — move them off the board` : 'Gauges set to the thinnest wire that carries each connection with margin');
      break;
    }
    case 'greset': b.gauges = {}; app.changed('board', { keepSheet: true }); relayout(); renderPanel(); break;
    case 'add': app.openParts(b.id); break;
    case 'update': settle(); break;
    case 'rebuild': runOptimize(true); break;
    case 'pconnect': V.pending = V.pin; V.pin = null; render(); break;
    case 'pcancel': V.pending = null; render(); break;
    case 'plink': if (V.pin) openPickerFrom({ c: V.pin.id, p: V.pin.pi }); break;
    case 'pdisc': disconnectPin(V.pin); break;
    case 'lockall': b.locks ||= {}; for (const id of b.compIds) if (b.params?.[id]) b.locks[id] = b.params[id]; app.changed('board', { keepSheet: true }); render(); app.toast('All parts locked — Optimize will only add wiring'); break;
    case 'addfrom': addFromSchematic(); break;
    case 'lock': { b.locks ||= {}; if (b.locks[V.sel]) delete b.locks[V.sel]; else b.locks[V.sel] = b.params[V.sel]; app.changed('board', { keepSheet: true }); render(); break; }
    case 'unlockall': b.locks = {}; app.changed('board', { keepSheet: true }); render(); app.toast('All parts unlocked'); break;
    case 'rot': case 'flip': transformSel(a); break;
    case 'resetsteps': {
      b.done = {}; V.skip.clear();
      app.checkpoint(); for (const id of b.compIds) if (app.doc.status[id]) app.doc.status[id].b = 0;
      app.changed('board', { keepSheet: true }); render(); renderStats(); renderPanel(); break;
    }
    case 'delete':
      if (!confirm(`Delete “${b.name}”? The schematic is not affected.`)) return;
      app.doc.boards = app.doc.boards.filter((x) => x.id !== b.id);
      app.changed('board');
      closeBoard();
      break;
  }
}

function transformSel(kind) {
  const b = V.board, id = V.sel, P = b.params[id];
  if (!P) return;
  const p = V.L.parts.find((q) => q.id === id), fk = p.fp.kind, bb = V.L.kind === 'bb';
  const cands = [];
  if (bb) {
    if (kind === 'flip') {
      if ('d' in P) cands.push({ ...P, d: -P.d });
      if ('r' in P && fk !== '2lead') cands.push({ ...P, r: 1 - P.r });
      if (P.mode === 'rr') cands.push({ ...P, r0: P.r1, r1: P.r0 });
    } else {
      if (fk === '2lead') {
        const modes = ['h', 'x'];
        cands.push(...(P.mode === 'h' ? [{ mode: 'x', x: P.x, d: P.d || 1 }, { ...P, half: 1 - P.half }] : [{ mode: 'h', half: 0, x: P.x, s: 4, d: 1 }, { mode: 'h', half: 0, x: P.x, s: 3, d: 1 }]));
        void modes;
      } else if (fk === 'inline') cands.push({ ...P, half: 1 - P.half }, { ...P, d: -P.d });
      else if (fk === 'dual') { const S = p.fp.spacing; const yts = [0, 1, 2, 3, 4].filter((y) => y + S >= 7 && y + S <= 11); cands.push({ ...P, yt: yts[(yts.indexOf(P.yt) + 1) % yts.length] }, { ...P, r: 1 - P.r }); }
      else cands.push({ ...P, r: 1 - P.r });
    }
  } else {
    if (kind === 'rot') cands.push({ ...P, r: ((P.r || 0) + 1) % 4 }, { ...P, r: ((P.r || 0) + 1) % 4, x: P.x - 1 }, { ...P, r: ((P.r || 0) + 1) % 4, y: P.y - 1 });
    else cands.push({ ...P, r: ((P.r || 0) + 2) % 4 });
  }
  for (const c of cands) if (tryParams(id, c)) { commitMove(); return; }
  V.app.toast('No room for that orientation here');
}
const problems = (L) => L.issues.length + L.verify.errors.length;
/** Apply new params for one part if the result is not worse (no new shorts / overfull strips). */
function tryParams(id, P, base) {
  const b = V.board, old = b.params[id];
  b.params = { ...b.params, [id]: P };
  const L = layout(V.app.doc, b);
  const p = L.parts.find((q) => q.id === id);
  const limit = base ?? problems(V.L);
  if (!p || !p.ok || problems(L) > limit) { b.params = { ...b.params, [id]: old }; return false; }
  V.L = L;
  return true;
}
function commitMove() {
  const b = V.board;
  if (b.locks?.[V.sel]) b.locks[V.sel] = b.params[V.sel];
  V.app.changed('board', { keepSheet: true });
  render(); renderStats();
  if (V.tab !== 'setup') renderPanel();
}

async function runOptimize(fresh, o = {}) {
  if (V.busy) return;
  const b = V.board;
  V.busy = true; V.stop = false;
  const pr = V.el.querySelector('.bv-progress');
  pr.hidden = false;
  const t0 = performance.now();
  try {
    const r = await optimize(V.app.doc, b, {
      fresh, only: o.only, warm: o.warm,
      onProgress: (f) => { if (!V) return; pr.querySelector('i').style.width = Math.round(f * 100) + '%'; pr.querySelector('span').textContent = `Optimizing… ${Math.round(f * 100)}%`; },
      shouldStop: () => !V || V.stop,
    });
    if (!V) return;
    b.params = r.params; b.sig = r.sig;
    V.app.changed('board', { keepSheet: true });
    relayout(); renderPanel();
    if (!o.keepView) fit();
    const L = V.L;
    if (!o.quiet) V.app.toast(`${L.verify.ok && !L.issues.length ? '✓' : '⚠'} ${L.stats.jumpers} jumper${L.stats.jumpers === 1 ? '' : 's'}, ${L.stats.len} holes of wire — ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  } finally {
    if (V) { V.busy = false; pr.hidden = true; }
  }
}
/** After the circuit changed (connections edited, parts added / removed): re-lay out with as little movement as possible. */
async function settle() {
  if (!V) return;
  const app = V.app, b = V.board;
  relayout();
  if (V.L.parts.length) {
    const missing = V.L.parts.filter((p) => !p.ok).map((p) => p.id);
    const bad = V.L.kind === 'bb' ? conflictParts(app.doc, b) : [];
    const only = new Set([...missing, ...bad]);
    if (only.size) await runOptimize(false, { only, warm: true, quiet: true, keepView: true });
    if (V && (V.L.issues.length || !V.L.verify.ok)) await runOptimize(false, { warm: true, quiet: true, keepView: true });
  }
  if (!V) return;
  if (V.L.verify.ok && !V.L.issues.length) b.sig = V.L.prob.sig;
  app.changed('board', { keepSheet: true });
  relayout(); renderPanel();
  // keep everything in view: re-fit when a part (or connection point) now lies outside the visible area
  const { M } = vgeom(), vb = V.vb;
  const out = !vb || V.L.parts.some((p) => p.ok && p.pins.some((q) => { if (!q) return false; const [x, y] = M(q.x, q.y); return x < vb.x + 5 || x > vb.x + vb.w - 5 || y < vb.y + 5 || y > vb.y + vb.h - 5; }));
  if (out || !V.L.parts.length) fit(V.fitWhole && !!V.L.parts.length);
}

// ------------------------------------------------------------------ editing the circuit from the board
function pruneStubs(doc, start) {
  const cand = [...start];
  while (cand.length) {
    const j = cand.pop();
    const ws = doc.wires.filter((w) => w.a.j === j || w.b.j === j);
    if (ws.length !== 1) continue;
    const w = ws[0], o = w.a.j === j ? w.b : w.a;
    doc.wires = doc.wires.filter((x) => x !== w);
    if (o.j != null) cand.push(o.j);
  }
}
async function disconnectPin(pn) {
  if (!pn) return;
  const app = V.app, doc = app.doc, touched = new Set();
  const had = doc.wires.some((w) => (w.a.c === pn.id && w.a.p === pn.pi) || (w.b.c === pn.id && w.b.p === pn.pi));
  if (!had) { app.toast('Nothing is wired to this pin'); return; }
  const pi = pinInfo(pn);
  app.checkpoint();
  doc.wires = doc.wires.filter((w) => {
    const hit = (w.a.c === pn.id && w.a.p === pn.pi) || (w.b.c === pn.id && w.b.p === pn.pi);
    if (hit) for (const e of [w.a, w.b]) if (e.j != null) touched.add(e.j);
    return !hit;
  });
  pruneStubs(doc, touched);
  cleanup(doc);
  V.pin = null; V.net = null;
  app.changed('board', { keepSheet: true });
  app.toast(`Disconnected ${pi ? `${pi.ref}.${pi.name}` : 'pin'}`);
  await settle();
}
async function connectPins(a, b) {
  const nl = V.L.prob.nl;
  V.pending = null;
  if (nl.pinNet(a.id, a.pi) === nl.pinNet(b.id, b.pi)) { V.app.toast('Those pins are already on the same net'); render(); return; }
  await doLink({ c: a.id, p: a.pi }, { c: b.id, p: b.pi }, { link: false });
}
async function addFromSchematic() {
  const app = V.app, doc = app.doc, b = V.board;
  const owner = new Map();
  for (const o of doc.boards || []) for (const id of o.compIds) owner.set(id, o.name);
  const cands = doc.comps.filter((c) => PHYSICAL(c) && !b.compIds.includes(c.id));
  if (!cands.length) { app.toast('Every part is already on this board'); return; }
  cands.sort((x, y) => (owner.has(x.id) ? 1 : 0) - (owner.has(y.id) ? 1 : 0) || x.ref.localeCompare(y.ref, undefined, { numeric: true }));
  const html = `<div class="hint">Tick the parts to put on <b>${esc(b.name)}</b>. Parts that are on another board move here.</div><div class="list">${cands.map((c, i) => `<label class="li"><input type="checkbox" data-i="${i}" ${owner.has(c.id) ? '' : 'checked'}><div class="grow"><div class="t1">${esc(c.ref)} <span class="t2">${esc(c.props.part || c.type)}</span></div>${owner.has(c.id) ? `<div class="t2">now on ${esc(owner.get(c.id))}</div>` : ''}</div></label>`).join('')}</div><div class="actions"><button class="btn pri" id="afGo">Add selected</button></div>`;
  app.openModal('Add parts from the schematic', html, (body) => {
    body.querySelector('#afGo').addEventListener('click', async () => {
      const ids = [...body.querySelectorAll('input:checked')].map((el) => cands[+el.dataset.i].id);
      app.closeModal();
      if (!ids.length) return;
      app.checkpoint();
      for (const o of doc.boards) if (o !== b) { o.compIds = o.compIds.filter((id) => !ids.includes(id)); for (const id of ids) { delete o.params?.[id]; delete o.locks?.[id]; } }
      b.compIds.push(...ids);
      app.changed('board', { keepSheet: true });
      await settle();
      fit();
    });
  });
}

// ------------------------------------------------------------------ connecting board points to other boards / wires / components
function openLinkPicker(net) {
  const L = V.L, srcPin = L.prob.nets[net].pins[0];
  if (!srcPin) return;
  openPickerFrom({ c: L.prob.comps[srcPin.ci].c.id, p: srcPin.pi });
}
function openPickerFrom(src) {
  const app = V.app, doc = app.doc, L = V.L, nl = L.prob.nl;
  const srcNet = nl.pinNet(src.c, src.p);
  const srcComp = app.comp(src.c);
  const srcLabel = `${srcComp ? srcComp.ref : ''}.${srcComp ? getPins(srcComp)[src.p]?.name : ''} (${nl.nets[srcNet].name})`;
  const mine = new Set(V.board.compIds);
  const netName = (c, p) => { const id = nl.pinNet(c, p); return id == null ? '' : nl.nets[id].name; };
  const rows = []; // {sec, label, sub, target}
  for (const c of doc.comps) {
    if (mine.has(c.id) && c.id !== src.c) getPins(c).forEach((pin, i) => rows.push({ sec: 'Other parts on this board', label: `${c.ref} · ${pin.name}`, sub: netName(c.id, i), target: { c: c.id, p: i } }));
  }
  for (const o of doc.boards || []) {
    if (o.id === V.board.id) continue;
    let OL; try { OL = layout(doc, o); } catch { continue; }
    for (const e2 of OL.externals) {
      const pin = OL.prob.nets[e2.net].pins[0];
      if (!pin) continue;
      rows.push({ sec: 'Other boards', label: `${o.name} · ${e2.name}`, sub: `${e2.where || ''}`, target: { c: OL.prob.comps[pin.ci].c.id, p: pin.pi } });
    }
  }
  for (const c of doc.comps) {
    if (mine.has(c.id)) continue;
    getPins(c).forEach((pin, i) => rows.push({ sec: 'Components & sources outside this board', label: `${c.ref} · ${pin.name}`, sub: netName(c.id, i), target: { c: c.id, p: i } }));
  }
  const seen = new Set();
  for (const n of nl.nets) {
    const key = n.keys.find((k) => k[0] === 'c');
    if (!key || n.id === srcNet) continue;
    const [, cid, p] = key.split(':');
    if (seen.has(n.id)) continue; seen.add(n.id);
    rows.push({ sec: 'Wires / nets (join to an existing wire)', label: /^N\d+$/.test(n.name) ? nl.describe(n.id) : n.name, sub: /^N\d+$/.test(n.name) ? 'unnamed wire' : nl.describe(n.id), target: { c: cid, p: +p } });
  }
  const html = `<div class="hint">Connect <b>${esc(srcLabel)}</b> to…</div>
    <input class="inp" id="lkSearch" placeholder="Search boards, parts, nets…" autocapitalize="off" autocomplete="off" style="margin-bottom:8px">
    <div id="lkList"></div>`;
  app.openModal('Connect…', html, (body) => {
    const draw = () => {
      const q = body.querySelector('#lkSearch').value.trim().toLowerCase();
      let h = '', last = null, n = 0;
      for (const [i, r] of rows.entries()) {
        if (q && !(r.label + ' ' + r.sub + ' ' + r.sec).toLowerCase().includes(q)) continue;
        if (++n > 120) break;
        if (r.sec !== last) { h += `<div class="sec">${esc(r.sec)}</div>`; last = r.sec; }
        h += `<div class="li" data-i="${i}"><div class="grow"><div class="t1">${esc(r.label)}</div>${r.sub ? `<div class="t2">${esc(r.sub)}</div>` : ''}</div>${icon('plus')}</div>`;
      }
      body.querySelector('#lkList').innerHTML = h || '<div class="hint">Nothing matches.</div>';
      body.querySelectorAll('#lkList .li').forEach((el) => el.addEventListener('click', () => { const r = rows[+el.dataset.i]; app.closeModal(); doLink(src, r.target, { link: true }); }));
    };
    body.querySelector('#lkSearch').addEventListener('input', draw);
    draw();
  });
}
async function doLink(src, tgt, o = { link: true }) {
  const app = V.app, doc = app.doc, nl = V.L.prob.nl;
  const a = nl.pinNet(src.c, src.p), b = nl.pinNet(tgt.c, tgt.p);
  if (a === b) { app.toast('Those are already the same net'); return; }
  const gA = nl.nets[a].isGnd, gB = nl.nets[b].isGnd;
  const volts = (nid) => { for (const k of nl.nets[nid].keys) { if (k[0] !== 'c') continue; const c = nl.compById.get(k.split(':')[1]); if (c && (c.type === 'rail')) return +c.props.volts; } return null; };
  const vA = volts(a), vB = volts(b);
  if ((gA !== gB && (gA ? vB : vA) != null) || (vA != null && vB != null && vA !== vB)) {
    if (!confirm(`This joins ${nl.nets[a].name} and ${nl.nets[b].name}, which look like different supplies — a short circuit. Connect anyway?`)) return;
  }
  app.checkpoint();
  const w = addWire(doc, { c: src.c, p: src.p }, { c: tgt.c, p: tgt.p });
  if (!w) { app.cancelCheckpoint(); app.toast('Already connected'); return; }
  if (o.link) w.link = true;
  cleanup(doc);
  app.changed('board', { keepSheet: true });
  app.toast(`Connected ${nl.nets[a].name} ⟷ ${nl.nets[b].name}`);
  V.ext = null; V.pin = null; V.net = null;
  await settle();
}

// ------------------------------------------------------------------ canvas interaction
/** Fit the view: first to the area in use, again (button) to the whole board. */
function fit(whole) {
  if (!V) return;
  const VG = vgeom(), { out, M } = VG;
  V.vb = { x: -10, y: -10, w: out.w + 20, h: out.h + 20 };
  if (!whole && V.L && V.L.parts.some((p) => p.ok)) {
    const pts = [];
    for (const p of V.L.parts) for (const q of p.pins) if (q) pts.push(M(q.x, q.y));
    for (const j of V.L.jumpers) for (const q of j.path || [j.a, j.b]) pts.push(M(q[0], q[1]));
    for (const e of V.L.externals) pts.push(M(e.x, e.y));
    if (V.L.kind === 'bb') { pts.push(M(0, -4), M(0, 14.6)); }
    if (pts.length) {
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const pad = V.L.externals.length ? 95 : 45, bx0 = Math.min(...xs) - pad, bx1 = Math.max(...xs) + pad, by0 = Math.min(...ys) - pad * 0.6, by1 = Math.max(...ys) + pad * 0.6;
      if (bx1 - bx0 < out.w * 0.85 || by1 - by0 < out.h * 0.85) V.vb = { x: Math.max(-10, bx0), y: Math.max(-10, by0), w: Math.min(out.w + 20, bx1 - bx0), h: Math.min(out.h + 20, by1 - by0) };
    }
  }
  const r = V.svg.getBoundingClientRect();
  if (r.width && r.height) {
    const ar = r.width / r.height;
    if (V.vb.w / V.vb.h < ar) { const nw = V.vb.h * ar; V.vb.x -= (nw - V.vb.w) / 2; V.vb.w = nw; } else { const nh = V.vb.w / ar; V.vb.y -= (nh - V.vb.h) / 2; V.vb.h = nh; }
  }
  V.fitWhole = !!whole;
  render();
}
function zoom(f, cx, cy) {
  const vb = V.vb;
  if (cx == null) { cx = vb.x + vb.w / 2; cy = vb.y + vb.h / 2; }
  const nw = Math.max(60, Math.min(6000, vb.w * f)), k = nw / vb.w;
  V.vb = { x: cx - (cx - vb.x) * k, y: cy - (cy - vb.y) * k, w: nw, h: vb.h * k };
  V.svg.setAttribute('viewBox', `${V.vb.x} ${V.vb.y} ${V.vb.w} ${V.vb.h}`);
}
function toWorld(e) {
  const r = V.svg.getBoundingClientRect();
  return [V.vb.x + ((e.clientX - r.left) / r.width) * V.vb.w, V.vb.y + ((e.clientY - r.top) / r.height) * V.vb.h];
}
function bindCanvas() {
  const s = V.svg;
  s.addEventListener('pointerdown', (e) => {
    s.setPointerCapture(e.pointerId);
    V.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (V.ptrs.size === 2) { V.drag = null; const [a, b] = [...V.ptrs.values()]; V.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), vb: { ...V.vb } }; return; }
    const w = toWorld(e);
    const ext = (V.exts || []).find((x) => Math.hypot(x.x - w[0], x.y - w[1]) < 8);
    const hit = ext ? null : V.parts.slice().reverse().find((p) => w[0] >= p.box[0] && w[0] <= p.box[2] && w[1] >= p.box[1] && w[1] <= p.box[3]);
    V.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, w0: w, vb0: { ...V.vb }, part: V.build ? null : hit ? hit.id : null, tapPart: hit ? hit.id : null, ext: ext ? ext.net : null, P0: hit ? { ...V.board.params[hit.id] } : null, moved: false, last: null, base: problems(V.L) };
  });
  s.addEventListener('pointermove', (e) => {
    const pt = V.ptrs.get(e.pointerId);
    if (!pt) return;
    pt.x = e.clientX; pt.y = e.clientY;
    if (V.pinch && V.ptrs.size >= 2) {
      const [a, b] = [...V.ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const k = V.pinch.d / d, vb = V.pinch.vb;
      V.vb = { x: vb.x + (vb.w - vb.w * k) / 2, y: vb.y + (vb.h - vb.h * k) / 2, w: vb.w * k, h: vb.h * k };
      V.svg.setAttribute('viewBox', `${V.vb.x} ${V.vb.y} ${V.vb.w} ${V.vb.h}`);
      return;
    }
    const dr = V.drag;
    if (!dr || dr.id !== e.pointerId) return;
    if (!dr.moved && Math.hypot(e.clientX - dr.sx, e.clientY - dr.sy) < 6) return;
    dr.moved = true;
    if (!dr.part) {
      const r = s.getBoundingClientRect();
      const k = dr.vb0.w / r.width;
      V.vb = { ...dr.vb0, x: dr.vb0.x - (e.clientX - dr.sx) * k, y: dr.vb0.y - (e.clientY - dr.sy) * k };
      V.svg.setAttribute('viewBox', `${V.vb.x} ${V.vb.y} ${V.vb.w} ${V.vb.h}`);
      return;
    }
    // screen delta → hole delta through the inverse of the view transform (rotation / mirror aware)
    const w = toWorld(e), [a, b, c, d] = vgeom().mat, det = a * d - b * c;
    const fx = w[0] - dr.w0[0], fy = w[1] - dr.w0[1];
    const dx = Math.round(((d * fx - c * fy) / det) / PITCH), dy = Math.round(((-b * fx + a * fy) / det) / PITCH);
    const key = dx + ',' + dy;
    if (key === dr.last) return;
    dr.last = key;
    const P = { ...dr.P0, x: dr.P0.x + dx };
    if (V.L.kind === 'perf') P.y = dr.P0.y + dy;
    else if ('half' in P && Math.abs(dy) >= 5) P.half = dy > 0 ? 1 : 0;
    V.sel = dr.part; V.ext = null;
    if (tryParams(dr.part, P, dr.base)) { render(); renderStats(); }
  });
  const up = (e) => {
    V.ptrs.delete(e.pointerId);
    if (V.pinch) { if (V.ptrs.size < 2) V.pinch = null; return; }
    const dr = V.drag;
    V.drag = null;
    if (!dr || dr.id !== e.pointerId) return;
    if (dr.moved) { if (dr.part) commitMove(); return; }
    // tap
    V.net = null;
    if (V.build) {
      if (dr.ext != null) { tapBuild({ k: 'ext', net: dr.ext }); return; }
      const cn = hitConn(toWorld(e));
      if (cn) { tapBuild(cn.k === 'jumper' ? { k: 'jumper', i: cn.i } : cn.k === 'trace' ? { k: 'trace', i: cn.i } : { k: 'bus', y: cn.y }); return; }
      if (dr.tapPart) tapBuild({ k: 'part', id: dr.tapPart });
      return;
    }
    if (dr.ext != null) { V.ext = dr.ext; V.sel = null; V.pin = null; render(); return; }
    {
      const w = toWorld(e), { M } = vgeom();
      let bp = null;
      for (const p of V.L.parts) p.pins.forEach((q, pi) => { if (!q) return; const [px, py] = M(q.x, q.y); const d = Math.hypot(px - w[0], py - w[1]); if (d < 5.5 && (!bp || d < bp.d)) bp = { d, id: p.id, pi, net: q.net }; });
      if (bp) {
        if (V.pending) { const a = V.pending; if (a.id === bp.id && a.pi === bp.pi) { V.pending = null; render(); } else connectPins(a, { id: bp.id, pi: bp.pi }); return; }
        V.pin = { id: bp.id, pi: bp.pi }; V.sel = null; V.ext = null; V.net = bp.net; render(); return;
      }
    }
    V.pin = null;
    V.sel = dr.part; V.ext = null;
    if (!dr.part) {
      const w = toWorld(e), { M } = vgeom();
      let best = null;
      for (const p of V.L.parts) for (const q of p.pins) if (q) { const [px, py] = M(q.x, q.y); const d = Math.hypot(px - w[0], py - w[1]); if (d < 7 && (!best || d < best.d)) best = { d, net: q.net }; }
      if (best) { V.net = best.net; V.app.toast('Net ' + V.L.prob.nets[best.net].name); }
    }
    render();
  };
  s.addEventListener('pointerup', up);
  s.addEventListener('pointercancel', up);
  s.addEventListener('wheel', (e) => { e.preventDefault(); const w = toWorld(e); zoom(Math.exp(e.deltaY * 0.0015), w[0], w[1]); }, { passive: false });
  window.addEventListener('resize', () => { if (V) fit(!!V.fitWhole); });
}

void RAIL_ROW; void RAIL_LABEL; void fmt;
