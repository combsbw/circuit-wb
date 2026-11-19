// Board designer view: physical layout on breadboard / solderable breadboard / perfboard.
import { BOARD_TYPES, OBJECTIVES, EFFORT, optimize, layout, steps, holeName, RAIL_ROW, RAIL_LABEL, weightsOf } from './boards.js';
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
      <button class="ib" data-bv="close" title="Back to schematic" aria-label="Back">${icon('x')}</button>
      <input class="bv-name inp" aria-label="Board name">
      <div class="bv-stats"></div>
      <div class="bv-actions">
        <button class="btn" data-bv="new" title="Start from a new random layout">${icon('rotate')}New layout</button>
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
        <div class="tabs bv-tabs"><button data-tab="setup" class="on">Setup</button><button data-tab="steps">Build steps</button><button data-tab="links">Connections</button></div>
        <div class="bv-body"></div>
      </aside>
    </div>`;
  document.body.appendChild(el);
  V = { app, board, el, svg: el.querySelector('.bv-svg'), tab: 'setup', sel: null, net: null, ext: null, rot: 0, bottom: false, vb: null, ptrs: new Map(), L: null };
  el.querySelector('.bv-name').value = board.name;
  el.querySelector('.bv-name').addEventListener('input', (e) => { board.name = e.target.value || 'Board'; app.changed('board', { keepSheet: true }); });
  el.addEventListener('click', onClick);
  el.querySelectorAll('.bv-tabs button').forEach((b) => b.addEventListener('click', () => { V.tab = b.dataset.tab; el.querySelectorAll('.bv-tabs button').forEach((x) => x.classList.toggle('on', x === b)); renderPanel(); }));
  bindCanvas();
  relayout();
  fit();
  renderPanel();
  if (!Object.keys(board.params || {}).length) runOptimize(true);
}
export function closeBoard() {
  if (!V) return;
  V.el.remove();
  const app = V.app;
  V = null;
  app.editor.render();
}
export function isBoardOpen() { return !!V; }

// ------------------------------------------------------------------ layout & rendering
function relayout() {
  V.L = layout(V.app.doc, V.board);
  render();
  renderStats();
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
    for (const t of L.traces) shapes += `<path class="bv-trace${V.bottom ? ' strong' : ''}${V.net === t.net ? ' hl' : ''}" d="M${t.cells.map(([x, y]) => `${X(x)},${Y(y)}`).join('L')}"/>`;
  }
  // ---- parts
  let partsSvg = '', jumpSvg = '', extSvg = '', hlSvg = '';
  const parts = [], items = [], obstacles = [];
  for (const p of L.parts) {
    if (!p.ok) continue;
    const out = drawPart(p, L, M);
    parts.push({ id: p.id, box: out.box });
    obstacles.push({ id: p.id, box: out.box });
    partsSvg += `<g class="bv-part${V.sel === p.id ? ' sel' : ''}${V.board.locks?.[p.id] ? ' locked' : ''}" data-id="${p.id}">${out.svg}</g>`;
    if (out.label) items.push({ text: p.ref, cls: 'bv-ref', box: out.label, own: p.id });
  }
  // ---- jumpers along their routed paths
  for (const j of L.jumpers) {
    const pts = (j.path || [j.a, j.b]).map(([x, y]) => M(x, y)).map(([x, y]) => [r1(x), r1(y)]);
    const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
    let d;
    if (pts.length === 2) {
      const dx = bx - ax, dy = by - ay, dd = Math.hypot(dx, dy) || 1, bend = Math.min(10, dd * 0.15);
      d = `M${ax},${ay}Q${r1((ax + bx) / 2 - (dy / dd) * bend)},${r1((ay + by) / 2 + (dx / dd) * bend)} ${bx},${by}`;
    } else d = roundedPath(pts);
    jumpSvg += `<g class="bv-jump${V.net === j.net ? ' hl' : ''}${j.over && j.over.length ? ' over' : ''}"><path d="${d}" style="stroke:${netColor(L, j.net)}"/><circle cx="${ax}" cy="${ay}" r="2.2"/><circle cx="${bx}" cy="${by}" r="2.2"/></g>`;
  }
  // ---- off-board connection points
  V.exts = [];
  for (const e of L.externals) {
    const [x, y] = M(e.x, e.y);
    V.exts.push({ net: e.net, x, y });
    const sel = V.ext === e.net;
    extSvg += `<g class="bv-ext${sel ? ' sel' : ''}" data-net="${e.net}"><circle cx="${r1(x)}" cy="${r1(y)}" r="${sel ? 7.5 : 5.5}" style="stroke:${netColor(L, e.net)}"/></g>`;
    fixed.push([x - 5.5, y - 5.5, x + 5.5, y + 5.5]);
    items.unshift({ text: `${e.name} ↗`, cls: 'bv-extl', box: [x - 6, y - 6, x + 6, y + 6], own: null });
  }
  for (const bus of L.buses || []) { const [x, y] = M(L.W - 1, bus.y); items.unshift({ text: bus.name, cls: 'bv-lbl bv-busl', box: [x - 3, y - 3, x + 3, y + 3], own: null }); }
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
  if (L.stale) msgs.push('The schematic changed since this layout — tap <b>Optimize</b> to update it (locked parts stay).');
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
      <div class="sec">Parts on this board (${L.parts.length})</div>
      <div class="hint">${L.parts.map((p) => esc(p.ref)).join(', ') || '—'}${L.notes.length ? '<br>' + L.notes.map(esc).join('<br>') : ''}</div>
      <div class="hint">Tap a part to rotate / flip / lock it; drag to move. Locked parts stay put when you Optimize.</div>
      <div class="actions"><button class="btn" data-bv="unlockall">Unlock all</button><button class="btn danger" data-bv="delete">${icon('trash')}Delete board</button></div>`;
  } else if (V.tab === 'steps') {
    const list = steps(L);
    const done = b.done || (b.done = {});
    const n = list.filter((s) => done[s.id]).length;
    h += `<div class="sh-head"><h3>Build steps</h3><span class="sub">${n}/${list.length}</span></div><div class="pbar" style="width:100%;height:7px;margin-bottom:6px"><i style="width:${list.length ? (n / list.length) * 100 : 0}%"></i></div>`;
    let g = null;
    for (const s of list) {
      if (s.group !== g) { h += `<div class="sec">${esc(s.group)}</div>`; g = s.group; }
      h += `<div class="li" data-step="${esc(s.id)}" data-net="${s.net ?? ''}" data-ref="${esc(s.ref || '')}"><button class="chk ${done[s.id] ? 'on' : ''}" data-done="${esc(s.id)}">${done[s.id] ? icon('check') : ''}</button><div class="grow"><div class="t1" style="white-space:normal">${esc(s.text)}</div></div></div>`;
    }
    h += `<div class="actions"><button class="btn danger small" data-bv="resetsteps">Reset checklist</button></div>`;
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
  body.querySelectorAll('[data-done]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const id = el.dataset.done; b.done[id] = !b.done[id]; app.changed('board', { keepSheet: true }); renderPanel(); }));
  body.querySelectorAll('.li[data-step], .li[data-net]').forEach((el) => el.addEventListener('click', () => {
    if (el.dataset.ref) { const p = V.L.parts.find((q) => q.ref === el.dataset.ref); V.sel = p ? p.id : null; V.net = null; }
    else if (el.dataset.net !== '') { V.net = +el.dataset.net; V.sel = null; }
    render();
  }));
  body.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', () => openBoard(app, el.dataset.open)));
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

function renderPartbar() {
  const bar = V.el.querySelector('.bv-partbar');
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
    case 'desel': V.sel = null; V.ext = null; render(); break;
    case 'lock': { b.locks ||= {}; if (b.locks[V.sel]) delete b.locks[V.sel]; else b.locks[V.sel] = b.params[V.sel]; app.changed('board', { keepSheet: true }); render(); break; }
    case 'unlockall': b.locks = {}; app.changed('board', { keepSheet: true }); render(); app.toast('All parts unlocked'); break;
    case 'rot': case 'flip': transformSel(a); break;
    case 'resetsteps': b.done = {}; app.changed('board', { keepSheet: true }); renderPanel(); break;
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

async function runOptimize(fresh) {
  if (V.busy) return;
  const b = V.board;
  V.busy = true; V.stop = false;
  const pr = V.el.querySelector('.bv-progress');
  pr.hidden = false;
  const t0 = performance.now();
  try {
    const r = await optimize(V.app.doc, b, {
      fresh,
      onProgress: (f) => { if (!V) return; pr.querySelector('i').style.width = Math.round(f * 100) + '%'; pr.querySelector('span').textContent = `Optimizing… ${Math.round(f * 100)}%`; },
      shouldStop: () => !V || V.stop,
    });
    if (!V) return;
    b.params = r.params; b.sig = r.sig;
    V.app.changed('board', { keepSheet: true });
    relayout(); renderPanel(); fit();
    const L = V.L;
    V.app.toast(`${L.verify.ok && !L.issues.length ? '✓' : '⚠'} ${L.stats.jumpers} jumper${L.stats.jumpers === 1 ? '' : 's'}, ${L.stats.len} holes of wire — ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  } finally {
    if (V) { V.busy = false; pr.hidden = true; }
  }
}

// ------------------------------------------------------------------ connecting board points to other boards / wires / components
function openLinkPicker(net) {
  const app = V.app, doc = app.doc, L = V.L, nl = L.prob.nl;
  const ext = L.externals.find((e) => e.net === net);
  const srcPin = L.prob.nets[net].pins[0];
  if (!ext || !srcPin) return;
  const src = { c: L.prob.comps[srcPin.ci].c.id, p: srcPin.pi };
  const mine = new Set(V.board.compIds);
  const netName = (c, p) => { const id = nl.pinNet(c, p); return id == null ? '' : nl.nets[id].name; };
  const rows = []; // {sec, label, sub, target}
  for (const o of doc.boards || []) {
    if (o.id === V.board.id) continue;
    let OL; try { OL = layout(doc, o); } catch { continue; }
    for (const e2 of OL.externals) {
      const pin = OL.prob.nets[e2.net].pins[0];
      if (!pin) continue;
      rows.push({ sec: `Other boards`, label: `${o.name} · ${e2.name}`, sub: `${e2.where || ''}`, target: { c: OL.prob.comps[pin.ci].c.id, p: pin.pi } });
    }
  }
  for (const c of doc.comps) {
    if (mine.has(c.id)) continue;
    getPins(c).forEach((pin, i) => rows.push({ sec: 'Components & sources outside this board', label: `${c.ref} · ${pin.name}`, sub: netName(c.id, i), target: { c: c.id, p: i } }));
  }
  const seen = new Set();
  for (const n of nl.nets) {
    const key = n.keys.find((k) => k[0] === 'c');
    if (!key || n.id === L.prob.nets[net].nid) continue;
    const [, cid, p] = key.split(':');
    if (seen.has(n.id)) continue; seen.add(n.id);
    rows.push({ sec: 'Wires / nets (join to an existing wire)', label: /^N\d+$/.test(n.name) ? nl.describe(n.id) : n.name, sub: /^N\d+$/.test(n.name) ? 'unnamed wire' : nl.describe(n.id), target: { c: cid, p: +p } });
  }
  const html = `<div class="hint">Connect <b>${esc(ext.name)}</b> (${esc(ext.where || '')}) to…</div>
    <input class="inp" id="lkSearch" placeholder="Search boards, parts, nets…" autocapitalize="off" autocomplete="off" style="margin-bottom:8px">
    <div id="lkList"></div>`;
  app.openModal(`Connect ${ext.name}`, html, (body) => {
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
      body.querySelectorAll('#lkList .li').forEach((el) => el.addEventListener('click', () => { const r = rows[+el.dataset.i]; app.closeModal(); doLink(src, r.target, net); }));
    };
    body.querySelector('#lkSearch').addEventListener('input', draw);
    draw();
  });
}
async function doLink(src, tgt, net) {
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
  w.link = true;
  cleanup(doc);
  app.changed('board');
  app.toast(`Connected ${nl.nets[a].name} ⟷ ${nl.nets[b].name} — updating layout…`);
  V.ext = null;
  relayout(); renderPanel();
  await runOptimize(false);
}

// ------------------------------------------------------------------ canvas interaction
/** Fit the view: first to the area in use, again (button) to the whole board. */
function fit(whole) {
  if (!V) return;
  const VG = vgeom(), { out, M } = VG;
  V.vb = { x: -10, y: -10, w: out.w + 20, h: out.h + 20 };
  if (!whole && V.L) {
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
    V.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, w0: w, vb0: { ...V.vb }, part: hit ? hit.id : null, ext: ext ? ext.net : null, P0: hit ? { ...V.board.params[hit.id] } : null, moved: false, last: null, base: problems(V.L) };
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
    if (dr.ext != null) { V.ext = dr.ext; V.sel = null; render(); return; }
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
