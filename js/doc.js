// Pure operations on a design document: geometry, wiring edits, cleanup, refs.
import { getPins, getBBox, TYPES, defaultProps, GRID } from './library.js';

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
export const snap = (v, g = GRID) => Math.round(v / g) * g;

export function newDesign(name = 'Untitled circuit') {
  return { v: 1, id: uid('d'), name, created: Date.now(), updated: Date.now(), comps: [], wires: [], juncs: [], status: {}, readings: [], notes: '' };
}

// ---------- geometry ----------
export function xf(c, x, y) {
  if (c.flip) x = -x;
  switch (c.rot & 3) {
    case 1: return [c.x - y, c.y + x];
    case 2: return [c.x - x, c.y - y];
    case 3: return [c.x + y, c.y - x];
    default: return [c.x + x, c.y + y];
  }
}
export function pinPos(c, i) { const p = getPins(c)[i]; return p ? xf(c, p.x, p.y) : [c.x, c.y]; }
export function compBBox(c) {
  const b = getBBox(c);
  const pts = [xf(c, b.x, b.y), xf(c, b.x + b.w, b.y), xf(c, b.x, b.y + b.h), xf(c, b.x + b.w, b.y + b.h)];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
export function makeIndex(d) {
  const comps = new Map(d.comps.map((c) => [c.id, c]));
  const juncs = new Map(d.juncs.map((j) => [j.id, j]));
  return { comps, juncs };
}
export function endPos(d, e, idx = makeIndex(d)) {
  if (e.j != null) { const j = idx.juncs.get(e.j); return j ? [j.x, j.y] : null; }
  const c = idx.comps.get(e.c);
  return c ? pinPos(c, e.p) : null;
}
/** Outward direction of a pin (unit vector from component centre). */
function pinDir(c, i) {
  const p = getPins(c)[i];
  if (!p) return [1, 0];
  const b = getBBox(c);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  let dx = p.x - cx, dy = p.y - cy;
  if (Math.abs(p.x - b.x) < 1 || Math.abs(p.x - (b.x + b.w)) < 1) dy = 0;
  else if (Math.abs(p.y - b.y) < 1 || Math.abs(p.y - (b.y + b.h)) < 1) dx = 0;
  const [ax, ay] = xf(c, 0, 0), [bx, by] = xf(c, dx, dy);
  return [bx - ax, by - ay];
}
/** Polyline points of a wire (orthogonal routing with one bend unless straight). */
export function wirePoints(d, w, idx = makeIndex(d)) {
  const a = endPos(d, w.a, idx), b = endPos(d, w.b, idx);
  if (!a || !b) return null;
  if (a[0] === b[0] || a[1] === b[1] || w.bend === 's') return [a, b];
  let mode = w.bend;
  if (!mode) {
    mode = 'h';
    if (w.a.c != null) { const c = idx.comps.get(w.a.c); if (c) { const [dx, dy] = pinDir(c, w.a.p); mode = Math.abs(dy) > Math.abs(dx) ? 'v' : 'h'; } }
    else if (w.b.c != null) { const c = idx.comps.get(w.b.c); if (c) { const [dx, dy] = pinDir(c, w.b.p); mode = Math.abs(dy) > Math.abs(dx) ? 'h' : 'v'; } }
  }
  return mode === 'v' ? [a, [a[0], b[1]], b] : [a, [b[0], a[1]], b];
}
export function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = [a[0] + t * dx, a[1] + t * dy];
  return { d: Math.hypot(p[0] - q[0], p[1] - q[1]), q, t };
}
export function nearestOnWire(pts, p) {
  let best = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const r = distToSeg(p, pts[i], pts[i + 1]);
    if (!best || r.d < best.d) best = { ...r, seg: i };
  }
  return best;
}
export function designBBox(d) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of d.comps) { const b = compBBox(c); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  for (const j of d.juncs) { x0 = Math.min(x0, j.x); y0 = Math.min(y0, j.y); x1 = Math.max(x1, j.x); y1 = Math.max(y1, j.y); }
  if (!Number.isFinite(x0)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---------- edits ----------
const sameEnd = (a, b) => (a.j != null ? a.j === b.j : b.j == null && a.c === b.c && a.p === b.p);

export function addWire(d, a, b) {
  if (sameEnd(a, b)) return null;
  if (d.wires.some((w) => (sameEnd(w.a, a) && sameEnd(w.b, b)) || (sameEnd(w.a, b) && sameEnd(w.b, a)))) return null;
  const w = { id: uid('w'), a: { ...a }, b: { ...b } };
  d.wires.push(w);
  return w;
}
export function addJunc(d, x, y) { const j = { id: uid('j'), x: snap(x), y: snap(y) }; d.juncs.push(j); return j; }

/** Split a wire at a point (snapped onto the wire) and return the new junction. */
export function splitWire(d, wid, pt) {
  const w = d.wires.find((x) => x.id === wid);
  if (!w) return null;
  const pts = wirePoints(d, w);
  const near = nearestOnWire(pts, pt);
  let q = near.q;
  // snap along the segment while staying on it
  const a = pts[near.seg], b = pts[near.seg + 1];
  if (a[0] === b[0]) q = [a[0], clampBetween(snap(q[1]), a[1], b[1])];
  else if (a[1] === b[1]) q = [clampBetween(snap(q[0]), a[0], b[0]), a[1]];
  const j = { id: uid('j'), x: q[0], y: q[1] };
  d.juncs.push(j);
  const bend = w.bend || (pts.length === 3 ? (pts[1][0] === pts[0][0] ? 'v' : 'h') : undefined);
  const w2 = { id: uid('w'), a: { j: j.id }, b: { ...w.b }, bend };
  w.b = { j: j.id };
  w.bend = bend;
  d.wires.push(w2);
  // keep build/debug status of the original wire on both halves
  if (d.status[w.id]) d.status[w2.id] = { ...d.status[w.id] };
  return j;
}
const clampBetween = (v, a, b) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), v));

/** Replace every reference to junction jid by `target` end, then remove the junction. */
export function mergeJunc(d, jid, target) {
  for (const w of d.wires) {
    if (w.a.j === jid) w.a = { ...target };
    if (w.b.j === jid) w.b = { ...target };
  }
  d.juncs = d.juncs.filter((j) => j.id !== jid);
  cleanup(d);
}

export function removeComps(d, ids, keepWires = false) {
  const set = new Set(ids);
  if (keepWires) {
    // detach: convert ends on these comps to dangling junctions
    for (const c of d.comps) if (set.has(c.id)) detachComp(d, c.id);
  }
  d.wires = d.wires.filter((w) => !set.has(w.a.c) && !set.has(w.b.c));
  d.comps = d.comps.filter((c) => !set.has(c.id));
  for (const id of ids) delete d.status[id];
  cleanup(d);
}

/** Disconnect all wires from a component; their ends become loose junctions at the pin position. */
export function detachComp(d, cid) {
  const c = d.comps.find((x) => x.id === cid);
  if (!c) return;
  const made = new Map();
  for (const w of d.wires) {
    for (const k of ['a', 'b']) {
      const e = w[k];
      if (e.c === cid) {
        let j = made.get(e.p);
        if (!j) {
          const [x, y] = pinPos(c, e.p);
          // nudge loose ends away from the pin so they are visibly detached
          const p = getPins(c)[e.p];
          const b = getBBox(c);
          const out = [p.x < b.x + b.w / 2 ? -20 : p.x > b.x + b.w / 2 ? 20 : 0, p.y < b.y + b.h / 2 ? -20 : p.y > b.y + b.h / 2 ? 20 : 0];
          const [ox, oy] = xf({ ...c, x: 0, y: 0 }, out[0], out[1]);
          j = { id: uid('j'), x: snap(x + (Math.abs(ox) > Math.abs(oy) ? ox : 0)), y: snap(y + (Math.abs(oy) >= Math.abs(ox) ? oy : 0)) };
          d.juncs.push(j); made.set(e.p, j);
        }
        w[k] = { j: j.id };
      }
    }
  }
  cleanup(d);
}

export function cleanup(d) {
  const cids = new Set(d.comps.map((c) => c.id));
  const jids = new Set(d.juncs.map((j) => j.id));
  const ok = (e) => (e.j != null ? jids.has(e.j) : cids.has(e.c));
  d.wires = d.wires.filter((w) => ok(w.a) && ok(w.b) && !sameEnd(w.a, w.b));
  // dedupe
  const seen = new Set();
  d.wires = d.wires.filter((w) => {
    const ka = w.a.j != null ? 'j' + w.a.j : 'c' + w.a.c + ':' + w.a.p, kb = w.b.j != null ? 'j' + w.b.j : 'c' + w.b.c + ':' + w.b.p;
    const k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  const deg = new Map();
  for (const w of d.wires) for (const e of [w.a, w.b]) if (e.j != null) deg.set(e.j, (deg.get(e.j) || 0) + 1);
  d.juncs = d.juncs.filter((j) => deg.get(j.id) > 0);
  // a junction with exactly 2 wires that is collinear and redundant is kept (it's a deliberate bend point)
  const live = new Set([...d.comps.map((c) => c.id), ...d.wires.map((w) => w.id)]);
  for (const k of Object.keys(d.status)) if (!live.has(k)) delete d.status[k];
}

export function nextRef(d, type) {
  const pre = TYPES[type].prefix;
  let n = 1;
  const used = new Set(d.comps.map((c) => c.ref));
  while (used.has(pre + n)) n++;
  return pre + n;
}

export function makeComp(d, type, part, x, y) {
  const c = { id: uid('c'), type, ref: nextRef(d, type), x: snap(x), y: snap(y), rot: 0, flip: false, props: defaultProps(type, part) };
  if (type === 'rail' && part) Object.assign(c.props, part);
  return c;
}

/** Duplicate comps (and wires/junctions fully inside the selection). Returns new comp ids. */
export function duplicate(d, ids, dx = 40, dy = 40) {
  const set = new Set(ids);
  const map = new Map();
  const out = [];
  for (const c of d.comps) {
    if (!set.has(c.id)) continue;
    const n = JSON.parse(JSON.stringify(c));
    n.id = uid('c'); n.x += dx; n.y += dy;
    n.ref = nextRef({ comps: [...d.comps, ...out] }, c.type);
    map.set(c.id, n.id);
    out.push(n);
  }
  d.comps.push(...out);
  const jmap = new Map();
  for (const w of d.wires) {
    const inA = w.a.c != null && map.has(w.a.c), inB = w.b.c != null && map.has(w.b.c);
    if (inA && inB) d.wires.push({ id: uid('w'), a: { c: map.get(w.a.c), p: w.a.p }, b: { c: map.get(w.b.c), p: w.b.p }, bend: w.bend });
  }
  void jmap;
  return out.map((c) => c.id);
}

/** Human description of a wire for checklists: "R1.2 → C1.1" */
export function describeEnd(d, e, idx = makeIndex(d)) {
  if (e.j != null) return '•';
  const c = idx.comps.get(e.c);
  if (!c) return '?';
  const pin = getPins(c)[e.p];
  if (c.type === 'ground') return 'GND';
  if (c.type === 'rail' || c.type === 'netlabel') return c.props.name;
  return `${c.ref}.${pin ? pin.name : e.p}`;
}

