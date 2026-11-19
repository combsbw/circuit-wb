// Board designer: turns a group of schematic parts into a physical layout on a breadboard,
// a solderable (ElectroCookie-style) breadboard or a perfboard.
//
// What is optimised (stated explicitly to the user):
//   HARD constraints (never violated in an accepted layout):
//     • one net per breadboard strip / per perfboard hole (no shorts)
//     • ≤ 5 holes used per breadboard strip (incl. jumper ends and external wires)
//     • every part inside the board; DIP ICs & dual-header modules straddle the channel
//   SOFT objective (minimised):
//     cost = wJ·jumpers + wL·wire length (holes) + wA·space used + wF·deviation from schematic order
//   Search: simulated annealing over part placements (several restarts), perfboard nets then routed on a
//   hole grid (bottom-side solder trails) with insulated jumpers where a trail cannot get through.
import { getPins, PARTS, ICS, icGeom, compLabel } from './library.js';
import { buildNets } from './netlist.js';

// ---------------------------------------------------------------- board types & objectives
export const BOARD_TYPES = {
  breadboard: { name: 'Solderless breadboard', kind: 'bb', presets: [['Full · 830 points (63 columns)', 63, true], ['Half · 400 points (30 columns)', 30, true], ['Mini · 170 points (17 columns, no rails)', 17, false]] },
  solderable: { name: 'Solderable breadboard (ElectroCookie-style)', kind: 'bb', presets: [['Full (63 columns)', 63, true], ['Half (30 columns)', 30, true], ['Mini (17 columns, no rails)', 17, false]] },
  perfboard: { name: 'Perfboard (isolated pads)', kind: 'perf', presets: [['4 × 6 cm ≈ 20 × 14 holes', 20, 14], ['5 × 7 cm ≈ 24 × 18 holes', 24, 18], ['7 × 9 cm ≈ 30 × 24 holes', 30, 24], ['9 × 15 cm ≈ 56 × 34 holes', 56, 34]] },
};
export const OBJECTIVES = {
  jumpers: { name: 'Fewest jumper wires', w: { j: 10, l: 0.25, a: 0.2, f: 0 }, desc: 'Puts connected leads in the same strip / next to each other so you need as few added wires as possible.' },
  length: { name: 'Shortest total wiring', w: { j: 3, l: 1.5, a: 0.1, f: 0 }, desc: 'Minimises the total length of jumpers and trails (more, but shorter, wires are OK).' },
  compact: { name: 'Smallest footprint', w: { j: 4, l: 0.4, a: 3, f: 0 }, desc: 'Packs the parts into as few columns / as small an area as possible.' },
  schematic: { name: 'Mirror the schematic', w: { j: 4, l: 0.4, a: 0.2, f: 30 }, desc: 'Keeps parts in the same left-to-right order as the schematic so it is easy to follow while building.' },
  balanced: { name: 'Balanced', w: { j: 6, l: 0.6, a: 0.6, f: 6 }, desc: 'A mix of all goals.' },
};
export const EFFORT = { quick: { it: 15000, restarts: 2 }, normal: { it: 45000, restarts: 3 }, thorough: { it: 120000, restarts: 5 } };

export function newBoard(doc, compIds, name) {
  const n = (doc.boards || []).length + 1;
  return {
    id: 'b' + Math.random().toString(36).slice(2, 9), name: name || `Board ${n}`, type: 'breadboard', cols: 63, rails: true, w: 24, h: 18,
    objective: 'jumpers', weights: null, opts: { allowStanding: true, directRails: true, effort: 'normal', edge: 'left', bus: true, railTop: '', railBot: '' },
    compIds: [...compIds], params: {}, locks: {}, sig: '', seed: 1, done: {},
  };
}

// ---------------------------------------------------------------- footprints
const SPACING = { 'ESP32-S3 SuperMini': 6, 'ESP32-C3 SuperMini': 6, 'ESP32-S3-DevKitC-1': 9, 'ESP32 DevKit V1 (30p)': 10, 'Arduino Nano': 6, 'Si5351 module': 6, 'Custom board': 6 };
const range = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; };

/** Physical footprint of a part. map: physical pin order → schematic pin index (-1 = no connection). */
export function footprint(c) {
  const pins = getPins(c);
  const idx = (name) => pins.findIndex((p) => p.name === name);
  const two = (spans, style, extra = {}) => ({ kind: '2lead', map: [0, 1], spans, style, ...extra });
  const m = PARTS[c.props.part] || {};
  switch (c.type) {
    case 'resistor': return two(range(3, 6), 'resistor', { standing: true });
    case 'capacitor': return two([1, 2, 3], 'ceramic');
    case 'cap_pol': return two([1, 2, 3], 'electrolytic');
    case 'inductor': return two(range(2, 6), 'inductor', { standing: true });
    case 'fuse': return two(range(3, 6), 'fuse');
    case 'switch': return two([2, 3, 4], 'switch');
    case 'button': return two([2, 3], 'button');
    case 'diode': case 'schottky': case 'zener': case 'tvs': return two(range(3, 6), 'diode', { standing: true });
    case 'led': return two([1, 2, 3], 'led');
    case 'ldr': return two([1, 2, 3], 'ldr');
    case 'photodiode': case 'phototransistor': return two([1, 2, 3], 'photo');
    case 'pot': return { kind: 'inline', map: [0, 2, 1], style: 'pot' };
    case 'spdt': return { kind: 'inline', map: [1, 0, 2], style: 'switch' };
    case 'npn': case 'pnp': case 'nmos': case 'pmos': {
      const order = (m.pinout || (c.type === 'npn' || c.type === 'pnp' ? [['1', 'E'], ['2', 'B'], ['3', 'C']] : [['1', 'G'], ['2', 'D'], ['3', 'S']])).map(([, n]) => idx(n.trim()[0]));
      return { kind: 'inline', map: order, style: /TO-220|TO-247/.test(m.pkg || '') ? 'to220' : 'to92', note: /SOT/.test(m.pkg || '') ? 'SMD part — use a SOT-23 breakout' : '' };
    }
    case 'reg': {
      const pk = m.pinout || [['1', 'IN'], ['2', 'GND'], ['3', 'OUT']];
      const order = pk.map(([, n]) => (/^IN/.test(n) ? 0 : /^OUT/.test(n) ? 1 : 2));
      return { kind: 'inline', map: order, style: /TO-92/.test(m.pkg || '') ? 'to92' : 'to220', note: /SOT/.test(m.pkg || '') ? 'SMD part — use a breakout' : '' };
    }
    case 'opamp': return { kind: 'dip', map: [-1, idx('−'), idx('+'), idx('V−'), -1, idx('OUT'), idx('V+'), -1], style: 'dip', label: (c.props.part || 'op-amp') + ' (single, DIP-8)' };
    case 'ic': {
      const g = icGeom(c);
      if (g.def.layout === 'dip') return { kind: 'dip', map: g.pins.map((_, i) => i), style: 'dip', label: g.title, note: /SOT|SSOP|TSSOP|MSOP|SOIC/.test(g.def.pkg || '') ? 'SMD package — use a DIP adapter' : '' };
      const L = [], R = [];
      g.pins.forEach((p, i) => (p.side === 'L' ? L : R).push(i));
      if (!R.length) return { kind: 'inline', map: L, style: 'module', label: g.title };
      return { kind: 'dual', left: L, right: R, spacing: g.def.rowSpacing || SPACING[c.props.part] || 6, style: 'module', label: g.title };
    }
    default: return { kind: 'offboard' };
  }
}
export const PHYSICAL = (c) => footprint(c).kind !== 'offboard';

// ---------------------------------------------------------------- problem model
/** Collect the parts of a board, their nets, and which nets leave the board. */
export function buildProblem(doc, board) {
  const nl = buildNets(doc);
  const members = new Set(board.compIds);
  const owner = new Map(); // comp id → board name (other boards)
  for (const b of doc.boards || []) if (b.id !== board.id) for (const id of b.compIds) owner.set(id, b.name);
  const xs = doc.comps.filter((c) => members.has(c.id)).map((c) => c.x);
  const sx0 = Math.min(...xs), sx1 = Math.max(...xs);
  const comps = [], skipped = [];
  for (const c of doc.comps) {
    if (!members.has(c.id)) continue;
    const fp = footprint(c);
    if (fp.kind === 'offboard') { skipped.push(c); continue; }
    comps.push({ c, fp, sx: sx1 > sx0 ? (c.x - sx0) / (sx1 - sx0) : 0.5, pinNets: [] });
  }
  const inBoard = new Set(comps.map((x) => x.c.id));
  const nets = [], byNet = new Map();
  const netOf = (nid) => {
    if (byNet.has(nid)) return byNet.get(nid);
    const net = nl.nets[nid];
    let name = net.name;
    if (/^N\d+$/.test(name)) { const d = nl.describe(nid).split(', ').slice(0, 2).join('/'); if (d) name = d; }
    const info = { idx: nets.length, nid, name, pins: [], external: false, dests: [], raw: [], isGnd: !!net.isGnd, supply: false };
    for (const k of net.keys) {
      if (k[0] !== 'c') continue;
      const [, cid, p] = k.split(':');
      if (inBoard.has(cid)) continue;
      const o = nl.compById.get(cid);
      if (!o || o.type === 'netlabel') continue;
      info.external = true;
      const pin = getPins(o)[+p];
      if (o.type === 'ground') info.raw.push(['', 'ground']);
      else if (o.type === 'rail') { info.raw.push(['', `supply ${o.props.name}`]); info.supply = true; }
      else info.raw.push([owner.has(o.id) ? owner.get(o.id) : 'off-board', `${o.ref}.${pin ? pin.name : p}`]);
      if (o.type === 'vdc' && +p === 0) info.supply = true;
      if (o.type === 'reg' && +p === 1) info.supply = true;
    }
    if (/^(\+|VCC|VDD|VIN|VBAT|5V|3V3|12V)|^\+?\d+(\.\d+)?V$/i.test(net.name)) info.supply = true;
    // summarise destinations per board: "Driver: U3.GND, R2.2 +3 more"
    const groups = new Map();
    for (const [g, t] of info.raw) { if (!groups.has(g)) groups.set(g, []); if (!groups.get(g).includes(t)) groups.get(g).push(t); }
    for (const [g, ts] of groups) info.dests.push(g ? `${g}: ${ts.slice(0, 2).join(', ')}${ts.length > 2 ? ` +${ts.length - 2} more` : ''}` : ts.join(', '));
    nets.push(info); byNet.set(nid, info);
    return info;
  };
  for (const [ci, x] of comps.entries()) {
    getPins(x.c).forEach((_, pi) => {
      const nid = nl.pinNet(x.c.id, pi);
      const info = netOf(nid);
      info.pins.push({ ci, pi });
      x.pinNets[pi] = info.idx;
    });
  }
  // regulator outputs inside the board are supplies too
  for (const x of comps) if (x.c.type === 'reg') nets[x.pinNets[1]].supply = true;
  // pins alone on an internal net get a private "no-connect" net (their strip must stay unshared)
  for (const info of nets) info.nc = info.pins.length === 1 && !info.external;
  // signature of connectivity (to detect schematic changes)
  const sig = comps.map((x) => x.c.id + ':' + x.c.type + ':' + (x.c.props.part || '') + ':' + x.pinNets.join(',')).join('|') + '#' + nets.map((n) => +n.external).join('');
  return { comps, nets, skipped, sig, nl };
}

// ---------------------------------------------------------------- breadboard geometry
// rows: top rails -3 (+), -2 (−); strips a..e = 0..4, f..j = 7..11; bottom rails 13 (−), 14 (+)
export const ROW_NAME = (y) => (y >= 0 && y <= 4 ? 'abcde'[y] : y >= 7 && y <= 11 ? 'fghij'[y - 7] : '');
export const RAIL_ROW = { TP: -3, TN: -2, BN: 13, BP: 14 };
export const RAIL_LABEL = { TP: 'top +', TN: 'top −', BN: 'bottom −', BP: 'bottom +' };

function bbCtx(prob, board) {
  const C = Math.max(5, Math.min(200, Math.round(board.cols || 63)));
  const rails = board.rails !== false;
  const N = 2 * C + 4;
  const node = { TP: 2 * C, TN: 2 * C + 1, BN: 2 * C + 2, BP: 2 * C + 3 };
  // rail net assignment
  const railNet = { TP: -1, TN: -1, BN: -1, BP: -1 };
  if (rails) {
    const gnd = prob.nets.find((n) => n.isGnd && n.pins.length);
    if (gnd) { railNet.TN = gnd.idx; railNet.BN = gnd.idx; }
    const sup = prob.nets.filter((n) => n.supply && !n.isGnd && n.pins.length >= 2).sort((a, b) => b.pins.length - a.pins.length);
    const byName = (nm) => prob.nets.find((n) => n.name === nm && n.pins.length);
    const t = board.opts.railTop ? byName(board.opts.railTop) : sup[0];
    const b = board.opts.railBot ? byName(board.opts.railBot) : sup[1] || sup[0];
    if (board.opts.railTop === '-') railNet.TP = -1; else if (t) railNet.TP = t.idx;
    if (board.opts.railBot === '-') railNet.BP = -1; else if (b) railNet.BP = b.idx;
  }
  const netRails = prob.nets.map((n) => ({ top: ['TP', 'TN'].find((r) => railNet[r] === n.idx) || null, bot: ['BN', 'BP'].find((r) => railNet[r] === n.idx) || null }));
  // per-component move metadata
  const meta = prob.comps.map((x) => {
    const fp = x.fp, m = { ok: true };
    if (fp.kind === '2lead') {
      const spans = [...fp.spans];
      if (fp.standing && board.opts.allowStanding) spans.unshift(1);
      m.spans = spans;
      m.modes = ['h'];
      if (Math.max(...spans) >= 3) m.modes.push('x');
      m.railOpts = []; m.rrOpts = [];
      if (rails && board.opts.directRails !== false) {
        for (const k of [0, 1]) {
          const nr = netRails[x.pinNets[k]];
          if (Math.max(...spans) >= 2) { if (nr.top) m.railOpts.push({ k, rail: nr.top }); if (nr.bot) m.railOpts.push({ k, rail: nr.bot }); }
        }
        for (const [side, A, B] of [['T', 'TP', 'TN'], ['B', 'BP', 'BN']]) {
          const n0 = x.pinNets[0], n1 = x.pinNets[1];
          if (railNet[A] < 0 || railNet[B] < 0 || railNet[A] === railNet[B]) continue;
          if (Math.min(...spans) > 2) continue;
          if (n0 === railNet[A] && n1 === railNet[B]) m.rrOpts.push({ side, r0: A, r1: B });
          if (n0 === railNet[B] && n1 === railNet[A]) m.rrOpts.push({ side, r0: B, r1: A });
        }
        if (m.railOpts.length) m.modes.push('r');
        if (m.rrOpts.length) m.modes.push('rr');
      }
    } else if (fp.kind === 'dual') {
      m.yts = range(0, 4).filter((yt) => yt + fp.spacing >= 7 && yt + fp.spacing <= 11);
      if (!m.yts.length) { m.ok = false; m.why = `header spacing ${fp.spacing} holes cannot straddle a breadboard channel`; }
      m.len = Math.max(fp.left.length, fp.right.length);
    } else if (fp.kind === 'dip') m.len = Math.ceil(fp.map.length / 2);
    else if (fp.kind === 'inline') m.len = fp.map.length;
    if (m.len && m.len > C) { m.ok = false; m.why = 'longer than the board'; }
    return m;
  });
  return { C, N, node, railNet, netRails, meta, rails };
}

const strip = (C, half, x) => (half ? C + x : x);

/** Turn placement parameters into board nodes for each schematic pin. */
function realizeBB(x, P, ctx) {
  const { C, node } = ctx, fp = x.fp, nPins = x.pinNets.length;
  const nodes = new Array(nPins).fill(-1), fy = new Array(nPins).fill(null);
  const inb = (v) => v >= 0 && v < C;
  let cols, straddle = false, cover = null;
  if (fp.kind === '2lead') {
    const [p0, p1] = fp.map;
    if (P.mode === 'h') {
      const x1 = P.x + P.d * P.s;
      if (!inb(P.x) || !inb(x1)) return null;
      nodes[p0] = strip(C, P.half, P.x); nodes[p1] = strip(C, P.half, x1);
      cols = [Math.min(P.x, x1), Math.max(P.x, x1)];
    } else if (P.mode === 'x') {
      if (!inb(P.x)) return null;
      nodes[P.d > 0 ? p0 : p1] = P.x; nodes[P.d > 0 ? p1 : p0] = C + P.x;
      cols = [P.x, P.x];
    } else if (P.mode === 'r') {
      if (!inb(P.x)) return null;
      const top = P.rail === 'TP' || P.rail === 'TN';
      const k = fp.map[P.k], o = fp.map[1 - P.k];
      if (ctx.railNet[P.rail] !== x.pinNets[k]) return null;
      nodes[k] = node[P.rail]; nodes[o] = top ? P.x : C + P.x;
      fy[k] = RAIL_ROW[P.rail]; // the strip lead is placed later in the outermost free hole
      cols = [P.x, P.x];
    } else if (P.mode === 'rr') {
      if (!inb(P.x)) return null;
      if (ctx.railNet[P.r0] !== x.pinNets[p0] || ctx.railNet[P.r1] !== x.pinNets[p1]) return null;
      nodes[p0] = node[P.r0]; nodes[p1] = node[P.r1]; fy[p0] = RAIL_ROW[P.r0]; fy[p1] = RAIL_ROW[P.r1];
      cols = [P.x, P.x];
    } else return null;
  } else if (fp.kind === 'inline') {
    const n = fp.map.length, xe = P.x + P.d * (n - 1);
    if (!inb(P.x) || !inb(xe)) return null;
    fp.map.forEach((pi, i) => { if (pi >= 0) nodes[pi] = strip(C, P.half, P.x + P.d * i); });
    cols = [Math.min(P.x, xe), Math.max(P.x, xe)];
  } else if (fp.kind === 'dip') {
    const n = fp.map.length, h = Math.ceil(n / 2);
    if (!inb(P.x) || !inb(P.x + h - 1)) return null;
    fp.map.forEach((pi, k) => {
      let col, top;
      if (P.r === 0) { if (k < h) { col = P.x + k; top = false; } else { col = P.x + (n - 1 - k); top = true; } }
      else { if (k < h) { col = P.x + h - 1 - k; top = true; } else { col = P.x + k - h; top = false; } }
      if (pi >= 0) { nodes[pi] = top ? col : C + col; fy[pi] = top ? 4 : 7; }
    });
    cols = [P.x, P.x + h - 1]; straddle = true;
  } else if (fp.kind === 'dual') {
    const M = Math.max(fp.left.length, fp.right.length), yb = P.yt + fp.spacing;
    if (!inb(P.x) || !inb(P.x + M - 1) || P.yt < 0 || P.yt > 4 || yb < 7 || yb > 11) return null;
    const put = (list, row) => list.forEach((pi, i) => { const col = P.r === 0 ? P.x + i : P.x + M - 1 - i; nodes[pi] = row < 5 ? col : C + col; fy[pi] = row; });
    if (P.r === 0) { put(fp.left, yb); put(fp.right, P.yt); } else { put(fp.left, P.yt); put(fp.right, yb); }
    cols = [P.x, P.x + M - 1]; straddle = true;
    cover = [];
    for (let col = P.x; col < P.x + M; col++) { if (4 - P.yt) cover.push([col, 4 - P.yt]); if (yb - 7) cover.push([C + col, yb - 7]); }
  } else return null;
  return { nodes, fy, cols, straddle, cover };
}

function randBB(x, m, ctx, rnd) {
  const C = ctx.C, ri = (n) => Math.floor(rnd() * n), pick = (a) => a[ri(a.length)], sg = () => (rnd() < 0.5 ? 1 : -1);
  const fp = x.fp;
  if (fp.kind === '2lead') {
    const mode = pick(m.modes);
    if (mode === 'h') return { mode, half: ri(2), x: ri(C), s: pick(m.spans), d: sg() };
    if (mode === 'x') return { mode, x: ri(C), d: sg() };
    if (mode === 'r') { const o = pick(m.railOpts); return { mode, x: ri(C), k: o.k, rail: o.rail }; }
    const o = pick(m.rrOpts); return { mode, x: ri(C), r0: o.r0, r1: o.r1 };
  }
  if (fp.kind === 'inline') return { half: ri(2), x: ri(C), d: sg() };
  if (fp.kind === 'dip') return { x: ri(Math.max(1, C - m.len + 1)), r: ri(2) };
  return { x: ri(Math.max(1, C - m.len + 1)), r: ri(2), yt: pick(m.yts) };
}
function mutateBB(x, m, P, ctx, rnd) {
  const ri = (n) => Math.floor(rnd() * n), q = { ...P }, r = rnd();
  const shift = 1 + ri(3) * (rnd() < 0.3 ? 2 : 1);
  if (r < 0.12) return randBB(x, m, ctx, rnd);
  if (r < 0.62) { q.x += rnd() < 0.5 ? -shift : shift; return q; }
  const fp = x.fp;
  if (fp.kind === '2lead') {
    if (q.mode === 'h') { const o = ri(3); if (o === 0) q.s = m.spans[ri(m.spans.length)]; else if (o === 1) q.d = -q.d; else q.half = 1 - q.half; }
    else if (q.mode === 'x') q.d = -q.d;
    else return randBB(x, m, ctx, rnd);
  } else if (fp.kind === 'inline') { if (rnd() < 0.5) q.d = -q.d; else q.half = 1 - q.half; }
  else if (fp.kind === 'dip') q.r = 1 - q.r;
  else if (rnd() < 0.5) q.r = 1 - q.r; else q.yt = m.yts[ri(m.yts.length)];
  return q;
}

function makeEvalBB(prob, ctx, W) {
  const { C, N } = ctx;
  const stripNet = new Int32Array(N), use = new Int16Array(N), cap = new Int16Array(N);
  const netNodes = prob.nets.map(() => []);
  const pos = (nd) => (nd < C ? [nd, 2] : [nd - C, 9]);
  return (pl) => {
    stripNet.fill(-1); use.fill(0);
    for (let i = 0; i < 2 * C; i++) cap[i] = 5;
    for (let i = 2 * C; i < N; i++) cap[i] = 9999;
    for (const a of netNodes) a.length = 0;
    let conflicts = 0, overlap = 0, minC = 1e9, maxC = -1e9, flow = 0, missing = 0;
    const ivs = [];
    for (let ci = 0; ci < pl.length; ci++) {
      const p = pl[ci];
      if (!p) { missing++; continue; }
      const pn = prob.comps[ci].pinNets;
      for (let k = 0; k < p.nodes.length; k++) {
        const nd = p.nodes[k];
        if (nd < 0) continue;
        const net = pn[k];
        if (stripNet[nd] === -1) stripNet[nd] = net; else if (stripNet[nd] !== net) conflicts++;
        use[nd]++;
        const arr = netNodes[net];
        if (!arr.includes(nd)) arr.push(nd);
      }
      if (p.cover) for (const [nd, n] of p.cover) cap[nd] -= n;
      if (p.straddle) ivs.push(p.cols);
      if (p.cols[0] < minC) minC = p.cols[0];
      if (p.cols[1] > maxC) maxC = p.cols[1];
      const d = (p.cols[0] + p.cols[1]) / 2 / Math.max(1, C - 1) - prob.comps[ci].sx;
      flow += d * d;
    }
    ivs.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ivs.length; i++) if (ivs[i][0] <= ivs[i - 1][1]) overlap += ivs[i - 1][1] - ivs[i][0] + 1;
    let jumpers = 0, len = 0;
    for (let n = 0; n < netNodes.length; n++) {
      const nodes = netNodes[n];
      if (!nodes.length) continue;
      const rr = ctx.netRails[n];
      if (rr.top || rr.bot) {
        let top = false, bot = false;
        for (const nd of nodes) {
          if (nd >= 2 * C) { if (nd === ctx.node.TP || nd === ctx.node.TN) top = true; else bot = true; continue; }
          const isTop = nd < C;
          jumpers++; use[nd]++;
          if (isTop ? rr.top : rr.bot) { len += 3; if (isTop) top = true; else bot = true; } else { len += 13; if (isTop) bot = true; else top = true; }
        }
        if (top && bot && rr.top && rr.bot) { jumpers++; len += 16; }
      } else {
        if (nodes.length > 1) {
          // Prim MST over strip positions; each edge = one jumper (uses a hole at both ends)
          const k = nodes.length, inT = new Array(k).fill(false), best = new Array(k).fill(1e9), from = new Array(k).fill(-1);
          best[0] = 0;
          for (let it = 0; it < k; it++) {
            let u = -1;
            for (let i = 0; i < k; i++) if (!inT[i] && (u < 0 || best[i] < best[u])) u = i;
            inT[u] = true;
            if (from[u] >= 0) { len += best[u]; jumpers++; use[nodes[u]]++; use[nodes[from[u]]]++; }
            const [ux, uy] = pos(nodes[u]);
            for (let i = 0; i < k; i++) if (!inT[i]) { const [vx, vy] = pos(nodes[i]); const dd = Math.abs(ux - vx) + Math.abs(uy - vy); if (dd < best[i]) { best[i] = dd; from[i] = u; } }
          }
        }
        if (prob.nets[n].external) { let bn = -1, bf = -1e9; for (const nd of nodes) { const f = cap[nd] - use[nd]; if (f > bf) { bf = f; bn = nd; } } if (bn >= 0 && bn < 2 * C) use[bn]++; }
      }
    }
    let overflow = 0;
    for (let i = 0; i < 2 * C; i++) if (use[i] > cap[i]) overflow += use[i] - cap[i];
    const span = maxC >= minC ? maxC - minC + 1 : 0;
    const cost = W.j * jumpers + W.l * len + W.a * span + W.f * flow + 1e4 * conflicts + 500 * overflow + 1e4 * overlap + 1e5 * missing;
    return { cost, jumpers, len, span, conflicts, overflow, overlap, missing };
  };
}

// ---------------------------------------------------------------- perfboard geometry
function perfCtx(prob, board) {
  const W = Math.max(6, Math.min(120, Math.round(board.w || 24))), H = Math.max(6, Math.min(120, Math.round(board.h || 18)));
  const edge = board.opts.edge || 'left';
  const ext = prob.nets.filter((n) => n.external && n.pins.length);
  const bus = board.opts.bus !== false;
  let busTop = -1, busBot = -1;
  if (bus) {
    const gnd = prob.nets.find((n) => n.isGnd && n.pins.length);
    const sup = prob.nets.filter((n) => n.supply && !n.isGnd && n.pins.length >= 2).sort((a, b) => b.pins.length - a.pins.length);
    const byName = (nm) => prob.nets.find((n) => n.name === nm && n.pins.length);
    const t = board.opts.railTop === '-' ? null : board.opts.railTop ? byName(board.opts.railTop) : sup[0];
    if (t) busTop = t.idx;
    if (gnd && board.opts.railBot !== '-') busBot = gnd.idx;
  }
  // usable area for part pins
  const area = { x0: 0, x1: W - 1, y0: 0, y1: H - 1 };
  if (busTop >= 0) area.y0 = 1;
  if (busBot >= 0) area.y1 = H - 2;
  if (ext.length) { if (edge === 'left') area.x0 = 2; else if (edge === 'right') area.x1 = W - 3; else if (edge === 'top') area.y0 = Math.max(area.y0, 2); else area.y1 = Math.min(area.y1, H - 3); }
  const meta = prob.comps.map((x) => {
    const fp = x.fp, m = { ok: true };
    if (fp.kind === '2lead') m.spans = fp.standing && board.opts.allowStanding ? [1, ...fp.spans] : fp.spans;
    return m;
  });
  return { W, H, edge, ext, busTop, busBot, area, meta };
}

/** Local footprint (rotation 0) → pins & keep-out cells. */
function localFP(x, P) {
  const fp = x.fp, pins = [], keep = [];
  if (fp.kind === '2lead') { pins.push([fp.map[0], 0, 0], [fp.map[1], P.s, 0]); for (let i = 1; i < P.s; i++) keep.push([i, 0]); }
  else if (fp.kind === 'inline') fp.map.forEach((pi, i) => pins.push([pi, i, 0]));
  else if (fp.kind === 'dip') {
    const n = fp.map.length, h = Math.ceil(n / 2);
    fp.map.forEach((pi, k) => pins.push([pi, k < h ? k : n - 1 - k, k < h ? 3 : 0]));
    for (let i = 0; i < h; i++) keep.push([i, 1], [i, 2]);
  } else if (fp.kind === 'dual') {
    const S = fp.spacing, M = Math.max(fp.left.length, fp.right.length);
    fp.left.forEach((pi, i) => pins.push([pi, i, S]));
    fp.right.forEach((pi, i) => pins.push([pi, i, 0]));
    for (let i = 0; i < M; i++) for (let j = 1; j < S; j++) keep.push([i, j]);
  }
  return { pins, keep };
}
function realizePerf(x, P, ctx) {
  const { pins, keep } = localFP(x, P);
  const rot = (u, v) => (P.r === 1 ? [-v, u] : P.r === 2 ? [-u, -v] : P.r === 3 ? [v, -u] : [u, v]);
  const all = [...pins.map(([, u, v]) => rot(u, v)), ...keep.map(([u, v]) => rot(u, v))];
  const mu = Math.min(...all.map((p) => p[0])), mv = Math.min(...all.map((p) => p[1]));
  const T = ([u, v]) => [u - mu + P.x, v - mv + P.y];
  const pp = pins.map(([pi, u, v]) => [pi, ...T(rot(u, v))]);
  const kk = keep.map(([u, v]) => T(rot(u, v)));
  const a = ctx.area;
  for (const [, px, py] of pp) if (px < a.x0 || px > a.x1 || py < a.y0 || py > a.y1) return null;
  const n = x.pinNets.length, holes = new Array(n).fill(null);
  for (const [pi, px, py] of pp) if (pi >= 0) holes[pi] = [px, py];
  const xs = pp.map((p) => p[1]), ys = pp.map((p) => p[2]);
  return { holes, keep: kk, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], nc: pp.filter((p) => p[0] < 0).map((p) => [p[1], p[2]]) };
}
function randPerf(x, m, ctx, rnd) {
  const ri = (n) => Math.floor(rnd() * n), a = ctx.area;
  const P = { x: a.x0 + ri(a.x1 - a.x0 + 1), y: a.y0 + ri(a.y1 - a.y0 + 1), r: ri(4) };
  if (x.fp.kind === '2lead') P.s = m.spans[ri(m.spans.length)];
  return P;
}
function mutatePerf(x, m, P, ctx, rnd) {
  const ri = (n) => Math.floor(rnd() * n), q = { ...P }, r = rnd();
  if (r < 0.1) return randPerf(x, m, ctx, rnd);
  if (r < 0.75) { const d = (1 + ri(3)) * (rnd() < 0.5 ? -1 : 1); if (rnd() < 0.5) q.x += d; else q.y += d; return q; }
  if (r < 0.9 || x.fp.kind !== '2lead') { q.r = (q.r + 1 + ri(3)) % 4; return q; }
  q.s = m.spans[ri(m.spans.length)];
  return q;
}
function segCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
function makeEvalPerf(prob, ctx, Wt) {
  const { W, H } = ctx;
  const occ = new Int32Array(W * H), keepo = new Int32Array(W * H);
  const extEdge = (net, pts) => {
    const my = pts.reduce((s, p) => s + p[1], 0) / pts.length, mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    return ctx.edge === 'left' ? [0, my] : ctx.edge === 'right' ? [W - 1, my] : ctx.edge === 'top' ? [mx, 0] : [mx, H - 1];
  };
  return (pl) => {
    occ.fill(-1); keepo.fill(-1);
    let conflicts = 0, flow = 0, missing = 0, bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1;
    const netPts = prob.nets.map(() => []);
    for (let ci = 0; ci < pl.length; ci++) {
      const p = pl[ci];
      if (!p) { missing++; continue; }
      for (const [kx, ky] of p.keep) { const i = ky * W + kx; if (keepo[i] >= 0 && keepo[i] !== ci) conflicts++; keepo[i] = ci; }
      p.holes.forEach((h, pi) => {
        if (!h) return;
        const i = h[1] * W + h[0];
        if (occ[i] >= 0) conflicts++;
        occ[i] = ci;
        netPts[prob.comps[ci].pinNets[pi]].push(h);
      });
      for (const h of p.nc) { const i = h[1] * W + h[0]; if (occ[i] >= 0) conflicts++; occ[i] = ci; }
      bx0 = Math.min(bx0, p.bbox[0]); by0 = Math.min(by0, p.bbox[1]); bx1 = Math.max(bx1, p.bbox[2]); by1 = Math.max(by1, p.bbox[3]);
      const d = (p.bbox[0] + p.bbox[2]) / 2 / Math.max(1, W - 1) - prob.comps[ci].sx;
      flow += d * d;
    }
    for (let ci = 0; ci < pl.length; ci++) { const p = pl[ci]; if (!p) continue; for (const h of p.holes) if (h && keepo[h[1] * W + h[0]] >= 0 && keepo[h[1] * W + h[0]] !== ci) conflicts++; }
    let len = 0;
    const edges = [];
    for (let n = 0; n < netPts.length; n++) {
      const pts = netPts[n].slice();
      if (!pts.length) continue;
      if (prob.nets[n].external && !(n === ctx.busTop || n === ctx.busBot)) pts.push(extEdge(n, pts));
      if (n === ctx.busTop || n === ctx.busBot) { const by = n === ctx.busTop ? 0 : H - 1; for (const p of netPts[n]) len += Math.abs(p[1] - by) * 0.9; continue; }
      const k = pts.length;
      if (k < 2) continue;
      const inT = new Array(k).fill(false), best = new Array(k).fill(1e9), from = new Array(k).fill(-1);
      best[0] = 0;
      for (let it = 0; it < k; it++) {
        let u = -1;
        for (let i = 0; i < k; i++) if (!inT[i] && (u < 0 || best[i] < best[u])) u = i;
        inT[u] = true;
        if (from[u] >= 0) { len += best[u]; edges.push([pts[u], pts[from[u]], n]); }
        for (let i = 0; i < k; i++) if (!inT[i]) { const dd = Math.abs(pts[u][0] - pts[i][0]) + Math.abs(pts[u][1] - pts[i][1]); if (dd < best[i]) { best[i] = dd; from[i] = u; } }
      }
    }
    let cross = 0;
    for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) if (edges[i][2] !== edges[j][2] && segCross(edges[i][0], edges[i][1], edges[j][0], edges[j][1])) cross++;
    const area = bx1 >= 0 ? bx1 - bx0 + by1 - by0 + 2 : 0;
    const cost = Wt.j * cross * 0.6 + Wt.l * len + Wt.a * area + Wt.f * flow + 1e4 * conflicts + 1e5 * missing;
    return { cost, jumpers: cross, len, span: area, conflicts, overflow: 0, overlap: 0, missing };
  };
}

// ---------------------------------------------------------------- optimiser
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e9) / 1e9; }; }
export function weightsOf(board) { return board.weights || OBJECTIVES[board.objective || 'jumpers'].w; }

export function setup(doc, board) {
  const prob = buildProblem(doc, board);
  const kind = BOARD_TYPES[board.type]?.kind || 'bb';
  const ctx = kind === 'bb' ? bbCtx(prob, board) : perfCtx(prob, board);
  return { prob, ctx, kind };
}

/** Optimise placements. Returns new params map {compId: params}. Locked parts keep their params. */
export async function optimize(doc, board, { onProgress, shouldStop, fresh } = {}) {
  const { prob, ctx, kind } = setup(doc, board);
  const W = weightsOf(board);
  const bb = kind === 'bb';
  const evalFn = bb ? makeEvalBB(prob, ctx, W) : makeEvalPerf(prob, ctx, W);
  const real = (i, P) => (P ? (bb ? realizeBB(prob.comps[i], P, ctx) : realizePerf(prob.comps[i], P, ctx)) : null);
  const randP = (i, rnd) => (bb ? randBB(prob.comps[i], ctx.meta[i], ctx, rnd) : randPerf(prob.comps[i], ctx.meta[i], ctx, rnd));
  const mut = (i, P, rnd) => (bb ? mutateBB(prob.comps[i], ctx.meta[i], P, ctx, rnd) : mutatePerf(prob.comps[i], ctx.meta[i], P, ctx, rnd));
  const ids = prob.comps.map((x) => x.c.id);
  const usable = prob.comps.map((x, i) => ctx.meta[i].ok);
  const locked = ids.map((id) => !!board.locks?.[id]);
  const E = EFFORT[board.opts.effort || 'normal'];
  const rnd0 = rng((board.seed || 1) * 7919 + 13);
  let best = null;
  const totalIt = E.it * E.restarts;
  let done = 0;
  for (let rs = 0; rs < E.restarts; rs++) {
    const rnd = rng(Math.floor(rnd0() * 1e9) + rs);
    const P = ids.map((id, i) => {
      if (!usable[i]) return null;
      if (locked[i] && board.locks[id]) return board.locks[id];
      if (!fresh && rs === 0 && board.params?.[id]) return board.params[id];
      return null;
    });
    // initial placement: straddling parts in schematic order, the rest random
    const order = ids.map((_, i) => i).sort((a, b) => prob.comps[a].sx - prob.comps[b].sx);
    let cursor = 0;
    for (const i of order) {
      if (!usable[i] || P[i]) continue;
      const k = prob.comps[i].fp.kind;
      if (bb && (k === 'dip' || k === 'dual')) { const p = randBB(prob.comps[i], ctx.meta[i], ctx, rnd); p.x = Math.min(cursor, ctx.C - ctx.meta[i].len); cursor = p.x + ctx.meta[i].len + 3; P[i] = p; }
      else for (let t = 0; t < 50 && !real(i, P[i]); t++) P[i] = randP(i, rnd);
    }
    for (let i = 0; i < P.length; i++) if (usable[i]) for (let t = 0; t < 200 && !real(i, P[i]); t++) P[i] = randP(i, rnd);
    const R = P.map((p, i) => real(i, p));
    let cur = evalFn(R);
    let bestLocal = { P: P.slice(), m: cur };
    const N = E.it, T0 = 25, T1 = 0.08;
    const free = ids.map((_, i) => i).filter((i) => usable[i] && !locked[i]);
    if (!free.length) { best = !best || cur.cost < best.m.cost ? bestLocal : best; continue; }
    for (let it = 0; it < N; it++) {
      const T = T0 * Math.pow(T1 / T0, it / N);
      let i = free[Math.floor(rnd() * free.length)], j = -1;
      const oldI = P[i], oldRI = R[i];
      let oldJ, oldRJ;
      if (rnd() < 0.08 && free.length > 1) {
        // swap the positions of two parts
        j = free[Math.floor(rnd() * free.length)];
        if (j === i) j = -1;
      }
      if (j >= 0) {
        oldJ = P[j]; oldRJ = R[j];
        const a = { ...P[i], x: P[j].x, ...(bb ? {} : { y: P[j].y }) }, b = { ...P[j], x: P[i].x, ...(bb ? {} : { y: P[i].y }) };
        const ra = real(i, a), rb = real(j, b);
        if (!ra || !rb) continue;
        P[i] = a; R[i] = ra; P[j] = b; R[j] = rb;
      } else {
        const q = mut(i, P[i], rnd);
        const rq = real(i, q);
        if (!rq) continue;
        P[i] = q; R[i] = rq;
      }
      const nx = evalFn(R);
      if (nx.cost <= cur.cost || rnd() < Math.exp((cur.cost - nx.cost) / T)) {
        cur = nx;
        if (cur.cost < bestLocal.m.cost) bestLocal = { P: P.slice(), m: cur };
      } else {
        P[i] = oldI; R[i] = oldRI;
        if (j >= 0) { P[j] = oldJ; R[j] = oldRJ; }
      }
      if ((++done & 2047) === 0) {
        if (onProgress) onProgress(done / totalIt, best ? Math.min(best.m.cost, bestLocal.m.cost) : bestLocal.m.cost);
        await new Promise((r) => setTimeout(r, 0));
        if (shouldStop && shouldStop()) break;
      }
    }
    // perfboard: judge restarts by the real routed result
    if (!bb) {
      const lay = finalizePerf(prob, ctx, bestLocal.P, W);
      bestLocal.m = { ...bestLocal.m, cost: lay.stats.cost };
    }
    if (!best || bestLocal.m.cost < best.m.cost) best = bestLocal;
    if (shouldStop && shouldStop()) break;
  }
  const params = {};
  ids.forEach((id, i) => { if (best.P[i]) params[id] = best.P[i]; });
  return { params, metrics: best.m, sig: prob.sig };
}

// ---------------------------------------------------------------- final layouts
/** Build the full physical layout (holes, jumpers, traces, externals, issues, verification). */
export function layout(doc, board) {
  const { prob, ctx, kind } = setup(doc, board);
  const W = weightsOf(board);
  const P = prob.comps.map((x) => board.params?.[x.c.id] || null);
  const L = kind === 'bb' ? finalizeBB(prob, ctx, P, W) : finalizePerf(prob, ctx, P, W);
  L.kind = kind; L.prob = prob; L.ctx = ctx;
  L.stale = !!board.sig && board.sig !== prob.sig;
  for (const s of prob.skipped) if (!['ground', 'rail', 'netlabel'].includes(s.type)) L.notes.push(`${s.ref} (${s.type}) stays off the board — wire it to the connection points`);
  prob.comps.forEach((x, i) => { if (!ctx.meta[i].ok) L.issues.push(`${x.c.ref} cannot be placed: ${ctx.meta[i].why}`); if (x.fp.note) L.notes.push(`${x.c.ref}: ${x.fp.note}`); });
  return L;
}

const outerFirst = (half) => (half ? [11, 10, 9, 8, 7] : [0, 1, 2, 3, 4]);
const innerFirst = (half) => (half ? [7, 8, 9, 10, 11] : [4, 3, 2, 1, 0]);

function finalizeBB(prob, ctx, P, Wt) {
  const { C, node } = ctx;
  const R = P.map((p, i) => (p ? realizeBB(prob.comps[i], p, ctx) : null));
  const metrics = makeEvalBB(prob, ctx, Wt)(R);
  const issues = [], notes = [];
  // hole occupancy: key "x,y" → owner
  const taken = new Map();
  const holeFree = (x, y) => !taken.has(x + ',' + y);
  const take = (x, y, what) => taken.set(x + ',' + y, what);
  // covered holes (module bodies)
  R.forEach((r, i) => { if (!r) return; const fp = prob.comps[i].fp; if (fp.kind === 'dual') { const p = P[i]; const M = Math.max(fp.left.length, fp.right.length), yb = p.yt + fp.spacing; for (let col = p.x; col < p.x + M; col++) { for (let y = p.yt + 1; y <= 4; y++) take(col, y, 'body'); for (let y = 7; y < yb; y++) take(col, y, 'body'); } } });
  const parts = prob.comps.map((x, i) => ({ id: x.c.id, ref: x.c.ref, label: compLabel(x.c), name: x.fp.label || x.c.props.part || '', type: x.c.type, fp: x.fp, params: P[i], pins: [], ok: !!R[i] }));
  const nodeXY = (nd) => (nd < C ? [nd, 0] : nd < 2 * C ? [nd - C, 1] : null);
  const railCols = { TP: new Set(), TN: new Set(), BN: new Set(), BP: new Set() };
  const railOf = (nd) => Object.keys(node).find((k) => node[k] === nd);
  const takeRail = (rail, x) => { const s = railCols[rail]; for (let d = 0; d < C; d++) for (const xx of [x + d, x - d]) if (xx >= 0 && xx < C && !s.has(xx)) { s.add(xx); return xx; } return x; };
  const freeRow = (col, half, order) => order(half).find((y) => holeFree(col, y));
  // 1) fixed pins (DIP / modules / rail leads)
  R.forEach((r, i) => {
    if (!r) return;
    r.nodes.forEach((nd, pi) => {
      if (nd < 0 || r.fy[pi] == null) return;
      if (nd >= 2 * C) { const rail = railOf(nd); const col = takeRail(rail, r.cols[0]); parts[i].pins[pi] = { x: col, y: RAIL_ROW[rail], net: prob.comps[i].pinNets[pi] }; return; }
      const [col] = nodeXY(nd);
      take(col, r.fy[pi], parts[i].ref);
      parts[i].pins[pi] = { x: col, y: r.fy[pi], net: prob.comps[i].pinNets[pi] };
    });
    // NC pins of DIPs (map -1) still occupy holes physically
    const fp = prob.comps[i].fp, p = P[i];
    if (fp.kind === 'dip') {
      const n = fp.map.length, h = Math.ceil(n / 2);
      fp.map.forEach((pi, k) => { if (pi >= 0) return; let col, top; if (p.r === 0) { if (k < h) { col = p.x + k; top = false; } else { col = p.x + (n - 1 - k); top = true; } } else { if (k < h) { col = p.x + h - 1 - k; top = true; } else { col = p.x + k - h; top = false; } } take(col, top ? 4 : 7, parts[i].ref); (parts[i].nc ||= []).push({ x: col, y: top ? 4 : 7 }); });
    }
  });
  // 2) inline parts & 2-lead parts: try a common row
  R.forEach((r, i) => {
    if (!r) return;
    const flex = r.nodes.map((nd, pi) => (nd >= 0 && nd < 2 * C && r.fy[pi] == null ? pi : -1)).filter((pi) => pi >= 0);
    if (!flex.length) return;
    const halves = new Set(flex.map((pi) => (r.nodes[pi] < C ? 0 : 1)));
    const pref = P[i] && P[i].mode === 'r' ? outerFirst : innerFirst;
    if (halves.size === 1) {
      const half = [...halves][0];
      const row = pref(half).find((y) => flex.every((pi) => holeFree(nodeXY(r.nodes[pi])[0], y)));
      if (row != null) { for (const pi of flex) { const col = nodeXY(r.nodes[pi])[0]; take(col, row, parts[i].ref); parts[i].pins[pi] = { x: col, y: row, net: prob.comps[i].pinNets[pi] }; } return; }
    }
    for (const pi of flex) {
      const [col, half] = nodeXY(r.nodes[pi]);
      const y = freeRow(col, half, pref);
      if (y == null) { issues.push(`${parts[i].ref}: no free hole left in column ${col + 1}${half ? ' f–j' : ' a–e'}`); parts[i].pins[pi] = { x: col, y: half ? 7 : 4, net: prob.comps[i].pinNets[pi], bad: true }; continue; }
      take(col, y, parts[i].ref);
      parts[i].pins[pi] = { x: col, y, net: prob.comps[i].pinNets[pi] };
    }
  });
  // 3) jumpers
  const jumpers = [], externals = [];
  const netStrips = prob.nets.map(() => new Set()), netRailsUsed = prob.nets.map(() => new Set());
  R.forEach((r, i) => { if (!r) return; r.nodes.forEach((nd, pi) => { if (nd < 0) return; const net = prob.comps[i].pinNets[pi]; if (nd >= 2 * C) netRailsUsed[net].add(railOf(nd)); else netStrips[net].add(nd); }); });
  const stripHole = (nd, order) => { const [col, half] = nodeXY(nd); const y = order(half).find((yy) => holeFree(col, yy)); if (y == null) return null; return [col, y]; };
  const addJ = (a, b, net, kindJ) => jumpers.push({ a, b, net, kind: kindJ, len: Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) });
  prob.nets.forEach((info, n) => {
    const strips = [...netStrips[n]];
    const rr = ctx.netRails[n];
    if (rr.top || rr.bot) {
      for (const nd of strips) {
        const isTop = nd < C;
        const rail = isTop ? rr.top || rr.bot : rr.bot || rr.top;
        const h = stripHole(nd, outerFirst);
        if (!h) { issues.push(`${info.name}: strip ${nodeXY(nd)[0] + 1}${isTop ? ' a–e' : ' f–j'} is full — no hole for the rail jumper`); continue; }
        take(h[0], h[1], 'jumper');
        const col = takeRail(rail, h[0]);
        addJ(h, [col, RAIL_ROW[rail]], n, 'rail');
        netRailsUsed[n].add(rail);
      }
      const used = netRailsUsed[n];
      const topR = [...used].find((r) => r === 'TP' || r === 'TN'), botR = [...used].find((r) => r === 'BN' || r === 'BP');
      if (topR && botR) { const usedCols = parts.flatMap((pp) => pp.pins.filter(Boolean).map((q) => q.x)); const mx = usedCols.length ? Math.max(...usedCols) : C - 1; const col = Math.min(C - 1, mx + 1); addJ([takeRail(topR, col), RAIL_ROW[topR]], [takeRail(botR, col), RAIL_ROW[botR]], n, 'link'); }
      if (info.external) { const rail = topR || botR || rr.top || rr.bot; const col = takeRail(rail, 0); externals.push({ x: col, y: RAIL_ROW[rail], net: n, name: info.name, dests: info.dests, where: `${RAIL_LABEL[rail]} rail` }); }
      return;
    }
    if (strips.length > 1) {
      const pos = (nd) => { const [c2, h2] = nodeXY(nd); return [c2, h2 ? 9 : 2]; };
      const k = strips.length, inT = new Array(k).fill(false), best = new Array(k).fill(1e9), from = new Array(k).fill(-1);
      best[0] = 0;
      for (let it = 0; it < k; it++) {
        let u = -1;
        for (let i = 0; i < k; i++) if (!inT[i] && (u < 0 || best[i] < best[u])) u = i;
        inT[u] = true;
        if (from[u] >= 0) {
          const a = stripHole(strips[from[u]], outerFirst); if (a) take(a[0], a[1], 'jumper');
          const b = stripHole(strips[u], outerFirst); if (b) take(b[0], b[1], 'jumper');
          if (a && b) addJ(a, b, n, 'wire'); else issues.push(`${info.name}: strip full — no hole for a jumper`);
        }
        const pu = pos(strips[u]);
        for (let i = 0; i < k; i++) if (!inT[i]) { const pv = pos(strips[i]); const dd = Math.abs(pu[0] - pv[0]) + Math.abs(pu[1] - pv[1]); if (dd < best[i]) { best[i] = dd; from[i] = u; } }
      }
    }
    if (info.external && strips.length) {
      let h = null;
      for (const nd of strips) { h = stripHole(nd, outerFirst); if (h) break; }
      if (h) { take(h[0], h[1], 'external'); externals.push({ x: h[0], y: h[1], net: n, name: info.name, dests: info.dests, where: holeName(h[0], h[1]) }); }
      else issues.push(`${info.name}: no free hole for the off-board connection`);
    }
  });
  if (metrics.conflicts) issues.unshift(`${metrics.conflicts} strip conflict${metrics.conflicts > 1 ? 's' : ''} (two nets in one strip) — try a larger board or Optimize again`);
  if (metrics.overlap) issues.unshift('ICs / modules overlap — Optimize again or use a longer board');
  if (metrics.missing) issues.unshift(`${metrics.missing} part${metrics.missing > 1 ? 's' : ''} not placed`);
  const len = jumpers.reduce((s, j) => s + j.len, 0);
  const cols = parts.flatMap((p) => p.pins.filter(Boolean).map((q) => q.x));
  const used = cols.length ? Math.max(...cols) - Math.min(...cols) + 1 : 0;
  const L = { parts, jumpers, externals, traces: [], issues, notes, rails: ctx.railNet, C, stats: { jumpers: jumpers.length, len, used, cost: metrics.cost, holes: taken.size } };
  L.verify = verifyBB(L, prob, ctx);
  return L;
}

export const holeName = (x, y) => (y in { '-3': 1, '-2': 1, 13: 1, 14: 1 } ? `${RAIL_LABEL[Object.keys(RAIL_ROW).find((k) => RAIL_ROW[k] === y)]} rail col ${x + 1}` : `${ROW_NAME(y)}${x + 1}`);

function uf(n) { const p = new Int32Array(n).map((_, i) => i); const f = (a) => { while (p[a] !== a) { p[a] = p[p[a]]; a = p[a]; } return a; }; return { f, u: (a, b) => { a = f(a); b = f(b); if (a !== b) p[a] = b; } }; }

function verifyBB(L, prob, ctx) {
  const { C } = ctx;
  // physical node of a hole
  const nodeOfHole = (x, y) => (y >= 0 && y <= 4 ? x : y >= 7 && y <= 11 ? C + x : y === -3 ? 2 * C : y === -2 ? 2 * C + 1 : y === 13 ? 2 * C + 2 : 2 * C + 3);
  const U = uf(2 * C + 4);
  for (const j of L.jumpers) U.u(nodeOfHole(...j.a), nodeOfHole(...j.b));
  const errors = [];
  const rootOfNet = new Map();
  L.parts.forEach((p) => p.pins.forEach((q) => {
    if (!q) return;
    const r = U.f(nodeOfHole(q.x, q.y));
    const info = prob.nets[q.net];
    if (!rootOfNet.has(q.net)) rootOfNet.set(q.net, new Set());
    rootOfNet.get(q.net).add(r);
  }));
  const owner = new Map();
  for (const [net, roots] of rootOfNet) {
    if (roots.size > 1) errors.push(`${prob.nets[net].name} is split into ${roots.size} unconnected pieces`);
    for (const r of roots) { if (owner.has(r) && owner.get(r) !== net) errors.push(`short: ${prob.nets[owner.get(r)].name} ↔ ${prob.nets[net].name}`); owner.set(r, net); }
  }
  const missing = L.parts.filter((p) => !p.ok).length;
  if (missing) errors.push(`${missing} part(s) not placed`);
  return { ok: !errors.length, errors: [...new Set(errors)] };
}

// ---------------------------------------------------------------- perfboard routing & final layout
function finalizePerf(prob, ctx, P, Wt) {
  const { W, H } = ctx;
  const R = P.map((p, i) => (p ? realizePerf(prob.comps[i], p, ctx) : null));
  const m = makeEvalPerf(prob, ctx, Wt)(R);
  const issues = [], notes = [];
  const parts = prob.comps.map((x, i) => ({ id: x.c.id, ref: x.c.ref, label: compLabel(x.c), name: x.fp.label || x.c.props.part || '', type: x.c.type, fp: x.fp, params: P[i], ok: !!R[i], pins: R[i] ? R[i].holes.map((h, pi) => (h ? { x: h[0], y: h[1], net: x.pinNets[pi] } : null)) : [], nc: R[i] ? R[i].nc.map(([x2, y2]) => ({ x: x2, y: y2 })) : [] }));
  // terminals per net
  const term = prob.nets.map(() => []);
  parts.forEach((p) => p.pins.forEach((q) => q && term[q.net].push([q.x, q.y])));
  // off-board connectors along the chosen edge, ordered to match the nets' positions
  const externals = [];
  const extNets = prob.nets.filter((n) => n.external && term[n.idx].length && n.idx !== ctx.busTop && n.idx !== ctx.busBot);
  const along = ctx.edge === 'left' || ctx.edge === 'right';
  const mean = (n, k) => term[n.idx].reduce((s, p) => s + p[k], 0) / term[n.idx].length;
  extNets.sort((a, b) => mean(a, along ? 1 : 0) - mean(b, along ? 1 : 0));
  const span = along ? H : W, start = Math.max(along ? (ctx.busTop >= 0 ? 1 : 0) : 0, Math.round(span / 2 - extNets.length / 2));
  extNets.forEach((n, k) => {
    const t = Math.min(span - 1, start + k);
    const [x, y] = ctx.edge === 'left' ? [0, t] : ctx.edge === 'right' ? [W - 1, t] : ctx.edge === 'top' ? [t, 0] : [t, H - 1];
    externals.push({ x, y, net: n.idx, name: n.name, dests: n.dests, where: `J1 pin ${k + 1}`, pin: k + 1 });
    term[n.idx].push([x, y]);
  });
  // bus rows
  const buses = [];
  if (ctx.busTop >= 0) buses.push({ y: 0, net: ctx.busTop, name: prob.nets[ctx.busTop].name });
  if (ctx.busBot >= 0) buses.push({ y: H - 1, net: ctx.busBot, name: prob.nets[ctx.busBot].name });
  for (const b of buses) if (prob.nets[b.net].external) externals.push({ x: 0, y: b.y, net: b.net, name: b.name, dests: prob.nets[b.net].dests, where: `${b.y === 0 ? 'top' : 'bottom'} bus` });
  // grid ownership: pins / NC pins block other nets
  const base = new Int32Array(W * H).fill(-1);
  parts.forEach((p) => { p.pins.forEach((q) => { if (q) base[q.y * W + q.x] = q.net; }); (p.nc || []).forEach((q) => { base[q.y * W + q.x] = -2; }); });
  for (const e of externals) if (e.y > 0 && e.y < H - 1 || !buses.length) base[e.y * W + e.x] = e.net;
  for (const b of buses) for (let x = 0; x < W; x++) base[b.y * W + x] = b.net;
  const nets = prob.nets.map((n) => n.idx).filter((n) => term[n].length > 1 || (buses.some((b) => b.net === n) && term[n].length));
  const hp = (n) => { const t = term[n]; const xs = t.map((p) => p[0]), ys = t.map((p) => p[1]); return Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys); };
  const orders = [nets.slice().sort((a, b) => hp(a) - hp(b)), nets.slice().sort((a, b) => hp(b) - hp(a)), nets.slice().sort((a, b) => term[b].length - term[a].length)];
  let best = null;
  for (const order of orders) {
    const r = routeAll(order, term, base, buses, W, H);
    const score = Wt.j * r.jumpers.length + Wt.l * r.len;
    if (!best || score < best.score) best = { ...r, score };
  }
  if (m.conflicts) issues.unshift(`${m.conflicts} overlapping hole${m.conflicts > 1 ? 's' : ''} — Optimize again or use a bigger board`);
  if (m.missing) issues.unshift(`${m.missing} part(s) not placed`);
  const xs = parts.flatMap((p) => p.pins.filter(Boolean).map((q) => q.x)), ys = parts.flatMap((p) => p.pins.filter(Boolean).map((q) => q.y));
  const used = xs.length ? `${Math.max(...xs) - Math.min(...xs) + 1} × ${Math.max(...ys) - Math.min(...ys) + 1}` : '0';
  const cost = Wt.j * best.jumpers.length + Wt.l * best.len + Wt.a * (xs.length ? Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys) : 0) + 1e4 * m.conflicts;
  const L = { parts, jumpers: best.jumpers, traces: best.traces, externals, buses, issues, notes, W, H, stats: { jumpers: best.jumpers.length, len: best.len, used, cost } };
  L.verify = verifyPerf(L, prob, W, H);
  return L;
}

function routeAll(order, term, base, buses, W, H) {
  const own = base.slice();
  const traces = [], jumpers = [];
  let len = 0;
  const prev = new Int32Array(W * H), seen = new Int32Array(W * H);
  let stamp = 0;
  for (const n of order) {
    const pts = term[n].map(([x, y]) => y * W + x);
    const bus = buses.find((b) => b.net === n);
    const tree = new Set(bus ? Array.from({ length: W }, (_, x) => bus.y * W + x) : [pts[0]]);
    const todo = new Set(pts.filter((p) => !tree.has(p)));
    while (todo.size) {
      stamp++;
      const q = [];
      for (const c of tree) { seen[c] = stamp; prev[c] = -1; q.push(c); }
      let hit = -1;
      for (let h = 0; h < q.length && hit < 0; h++) {
        const c = q[h], cx = c % W, cy = (c / W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const k = ny * W + nx;
          if (seen[k] === stamp) continue;
          if (own[k] !== -1 && own[k] !== n) continue;
          seen[k] = stamp; prev[k] = c;
          if (todo.has(k)) { hit = k; break; }
          if (own[k] === n && !pts.includes(k)) { /* same-net trail cell */ }
          q.push(k);
        }
      }
      if (hit < 0) {
        // no free path on the bottom side → insulated jumper from the nearest tree cell
        let target = -1, from = -1, bd = 1e9;
        for (const t of todo) for (const c of tree) { const d = Math.abs((t % W) - (c % W)) + Math.abs(((t / W) | 0) - ((c / W) | 0)); if (d < bd) { bd = d; target = t; from = c; } }
        jumpers.push({ a: [from % W, (from / W) | 0], b: [target % W, (target / W) | 0], net: n, kind: 'wire', len: bd });
        len += bd;
        tree.add(target); todo.delete(target);
        continue;
      }
      const path = [];
      for (let c = hit; c !== -1; c = prev[c]) path.push(c);
      for (const c of path) { own[c] = n; tree.add(c); }
      len += path.length - 1;
      traces.push({ net: n, cells: path.reverse().map((c) => [c % W, (c / W) | 0]) });
      todo.delete(hit);
      for (const c of path) todo.delete(c);
    }
  }
  return { traces, jumpers, len };
}

function verifyPerf(L, prob, W, H) {
  const U = uf(W * H);
  for (const t of L.traces) for (let i = 1; i < t.cells.length; i++) U.u(t.cells[i - 1][1] * W + t.cells[i - 1][0], t.cells[i][1] * W + t.cells[i][0]);
  for (const j of L.jumpers) U.u(j.a[1] * W + j.a[0], j.b[1] * W + j.b[0]);
  for (const b of L.buses || []) for (let x = 1; x < W; x++) U.u(b.y * W, b.y * W + x);
  const errors = [], roots = new Map(), owner = new Map();
  const add = (net, x, y) => { const r = U.f(y * W + x); if (!roots.has(net)) roots.set(net, new Set()); roots.get(net).add(r); };
  L.parts.forEach((p) => p.pins.forEach((q) => q && add(q.net, q.x, q.y)));
  for (const e of L.externals) add(e.net, e.x, e.y);
  for (const [net, rs] of roots) {
    if (rs.size > 1) errors.push(`${prob.nets[net].name} is split into ${rs.size} unconnected pieces`);
    for (const r of rs) { if (owner.has(r) && owner.get(r) !== net) errors.push(`short: ${prob.nets[owner.get(r)].name} ↔ ${prob.nets[net].name}`); owner.set(r, net); }
  }
  // two nets' copper touching (adjacent trail cells are separate; same cell owned twice is impossible by construction)
  const missing = L.parts.filter((p) => !p.ok).length;
  if (missing) errors.push(`${missing} part(s) not placed`);
  return { ok: !errors.length, errors: [...new Set(errors)] };
}

// ---------------------------------------------------------------- build instructions
const ccw = (cells) => {
  // compress a cell path to its corner points
  const out = [cells[0]];
  for (let i = 1; i < cells.length - 1; i++) {
    const a = cells[i - 1], b = cells[i], c = cells[i + 1];
    if ((b[0] - a[0]) !== (c[0] - b[0]) || (b[1] - a[1]) !== (c[1] - b[1])) out.push(b);
  }
  if (cells.length > 1) out.push(cells[cells.length - 1]);
  return out;
};
export function steps(L) {
  const P = L.prob, out = [];
  const nm = (n) => P.nets[n].name;
  const hole = L.kind === 'bb' ? (x, y) => holeName(x, y) : (x, y) => `(${x + 1},${y + 1})`;
  const pinStr = (p) => p.pins.map((q, i) => (q ? `${(p.fp.kind === '2lead' ? '' : (getPinName(P, p, i) + ' '))}${hole(q.x, q.y)}` : null)).filter(Boolean).join(' · ');
  if (L.kind === 'bb') {
    for (const j of L.jumpers.filter((j) => j.kind === 'link')) out.push({ id: 'j' + j.a + j.b, group: 'Rails', text: `Link the ${railName(j.a[1])} and ${railName(j.b[1])} rails (${nm(j.net)}) with a jumper at column ${j.a[0] + 1}` });
  } else {
    for (const b of L.buses || []) out.push({ id: 'bus' + b.y, group: 'Power buses', text: `Solder a bare wire along the ${b.y === 0 ? 'top' : 'bottom'} row (row ${b.y + 1}) as the ${b.name} bus` });
  }
  const order = (p) => ({ dip: 0, dual: 0, inline: 1, '2lead': 2 }[p.fp.kind] ?? 3);
  const flat = L.kind === 'bb' ? L.jumpers.filter((j) => j.kind !== 'link').sort((a, b) => a.len - b.len) : [];
  for (const j of flat) out.push({ id: 'j' + j.a + j.b, group: 'Jumper wires (lay flat first)', text: `${nm(j.net)}: ${hole(...j.a)} → ${hole(...j.b)} (${j.len} holes)` , net: j.net });
  for (const p of L.parts.slice().sort((a, b) => order(a) - order(b) || a.ref.localeCompare(b.ref, undefined, { numeric: true }))) {
    if (!p.ok) continue;
    out.push({ id: 'p' + p.id, group: p.fp.kind === '2lead' ? 'Small parts' : 'ICs, modules & transistors', text: `${p.ref} ${p.name || p.label}: ${pinStr(p)}${p.fp.kind === 'dip' ? ' (check the notch / pin-1 dot)' : ''}`, ref: p.ref });
  }
  if (L.kind === 'perf') {
    for (const t of L.traces) out.push({ id: 't' + t.cells[0] + t.cells.length, group: 'Bottom side: solder trails', text: `${nm(t.net)}: ${ccw(t.cells).map((c) => hole(...c)).join(' → ')}`, net: t.net });
    for (const j of L.jumpers) out.push({ id: 'pj' + j.a + j.b, group: 'Insulated jumpers (where trails would cross)', text: `${nm(j.net)}: ${hole(...j.a)} → ${hole(...j.b)}`, net: j.net });
  }
  for (const e of L.externals) out.push({ id: 'e' + e.net, group: 'Off-board connections', text: `${e.name} at ${e.where || hole(e.x, e.y)} → ${e.dests.join(', ') || 'external'}`, net: e.net });
  return out;
}
const railName = (y) => RAIL_LABEL[Object.keys(RAIL_ROW).find((k) => RAIL_ROW[k] === y)];
function getPinName(P, p, i) { const c = P.comps.find((x) => x.c.id === p.id)?.c; return c ? getPins(c)[i]?.name || '' : ''; }
export { ICS };
