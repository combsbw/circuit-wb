// Circuit solver: Modified nodal analysis (all sources Norton-converted, so the system is purely nodal).
// DC operating point via damped Newton-Raphson with numeric Jacobians for nonlinear devices.
// AC small-signal analysis linearised around the operating point (complex arithmetic).
import { TYPES, getPins } from './library.js';
import { buildNets } from './netlist.js';

const GMIN = 1e-10;      // leak from every node to ground (keeps floating nodes solvable)
const RSRC = 1e-3;       // internal resistance of ideal voltage sources
const H = 1e-6;          // numeric derivative step

// ---------- dense linear solvers ----------
function solveReal(A, b, n) {
  // A: Float64Array n*n (row-major), b: Float64Array n. Returns x or null if singular.
  for (let k = 0; k < n; k++) {
    let p = k, max = Math.abs(A[k * n + k]);
    for (let i = k + 1; i < n; i++) { const v = Math.abs(A[i * n + k]); if (v > max) { max = v; p = i; } }
    if (max < 1e-30) return null;
    if (p !== k) {
      for (let j = 0; j < n; j++) { const t = A[k * n + j]; A[k * n + j] = A[p * n + j]; A[p * n + j] = t; }
      const t = b[k]; b[k] = b[p]; b[p] = t;
    }
    const piv = A[k * n + k];
    for (let i = k + 1; i < n; i++) {
      const f = A[i * n + k] / piv;
      if (f === 0) continue;
      for (let j = k; j < n; j++) A[i * n + j] -= f * A[k * n + j];
      b[i] -= f * b[k];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i * n + j] * x[j];
    x[i] = s / A[i * n + i];
  }
  return x;
}

function solveComplex(Ar, Ai, br, bi, n) {
  for (let k = 0; k < n; k++) {
    let p = k, max = Math.hypot(Ar[k * n + k], Ai[k * n + k]);
    for (let i = k + 1; i < n; i++) { const v = Math.hypot(Ar[i * n + k], Ai[i * n + k]); if (v > max) { max = v; p = i; } }
    if (max < 1e-30) return null;
    if (p !== k) {
      for (let j = 0; j < n; j++) {
        let t = Ar[k * n + j]; Ar[k * n + j] = Ar[p * n + j]; Ar[p * n + j] = t;
        t = Ai[k * n + j]; Ai[k * n + j] = Ai[p * n + j]; Ai[p * n + j] = t;
      }
      let t = br[k]; br[k] = br[p]; br[p] = t; t = bi[k]; bi[k] = bi[p]; bi[p] = t;
    }
    const pr = Ar[k * n + k], pi = Ai[k * n + k], pd = pr * pr + pi * pi;
    for (let i = k + 1; i < n; i++) {
      const ar = Ar[i * n + k], ai = Ai[i * n + k];
      if (ar === 0 && ai === 0) continue;
      const fr = (ar * pr + ai * pi) / pd, fi = (ai * pr - ar * pi) / pd;
      for (let j = k; j < n; j++) {
        const cr = Ar[k * n + j], ci = Ai[k * n + j];
        Ar[i * n + j] -= fr * cr - fi * ci;
        Ai[i * n + j] -= fr * ci + fi * cr;
      }
      br[i] -= fr * br[k] - fi * bi[k];
      bi[i] -= fr * bi[k] + fi * br[k];
    }
  }
  const xr = new Float64Array(n), xi = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sr = br[i], si = bi[i];
    for (let j = i + 1; j < n; j++) {
      const ar = Ar[i * n + j], ai = Ai[i * n + j];
      sr -= ar * xr[j] - ai * xi[j];
      si -= ar * xi[j] + ai * xr[j];
    }
    const pr = Ar[i * n + i], pi = Ai[i * n + i], pd = pr * pr + pi * pi;
    xr[i] = (sr * pr + si * pi) / pd;
    xi[i] = (si * pr - sr * pi) / pd;
  }
  return { re: xr, im: xi };
}

// ---------- Stamper ----------
// mode: 'dc' | 'ac' | 'off'. In 'off' (power-off measurement) sources & active devices are removed.
class Stamper {
  constructor(n, mode, opts) {
    this.n = n; this.mode = mode; this.omega = opts.omega || 0;
    this.srcScale = opts.srcScale ?? 1;
    this.hom = opts.hom ?? 1; // 0..1 continuation parameter (softens high-gain devices)
    this.stim = opts.stim || null; // comp id of the source used as AC stimulus
    this.srcShort = !!opts.srcShort;
    this.x = opts.x; // current DC guess / operating point (node voltages, index 0 = ground)
    this.complex = mode !== 'dc' && this.omega > 0;
    this.trip = [];  // [row, col, re, im, compIdx]
    this.rhs = [];   // [row, re, im, compIdx]
    this.cur = -1;
  }
  _a(r, c, re, im = 0) { if (r > 0 && c > 0) this.trip.push(r, c, re, im, this.cur); }
  _b(r, re, im = 0) { if (r > 0) this.rhs.push(r, re, im, this.cur); }
  Y(a, b, re, im = 0) { // admittance between nodes
    this._a(a, a, re, im); this._a(b, b, re, im); this._a(a, b, -re, -im); this._a(b, a, -re, -im);
  }
  G(a, b, g) { this.Y(a, b, g, 0); }
  R(a, b, r) { this.Y(a, b, 1 / Math.max(r, 1e-6), 0); }
  /** Current source: i flows from node a, through the element, into node b. */
  I(a, b, re, im = 0) { this._b(a, -re, -im); this._b(b, re, im); }
  C(a, b, c) { if (this.mode !== 'dc' && this.omega > 0) this.Y(a, b, 0, this.omega * c); }
  L(a, b, l, dcr = 0) {
    const r = Math.max(dcr, 1e-3);
    if (this.mode === 'dc' || this.omega === 0) { this.G(a, b, 1 / r); return; }
    const zr = r, zi = this.omega * l, d = zr * zr + zi * zi;
    this.Y(a, b, zr / d, -zi / d);
  }
  /** Independent voltage source (a = +, b = −), Norton converted. opts: {ac, rint} */
  V(a, b, v, opts = {}) {
    const r = Math.max(opts.rint || 0, RSRC);
    if (this.mode === 'off') { if (this.srcShort) this.G(a, b, 1 / r); return; }
    this.G(a, b, 1 / r);
    if (this.mode === 'dc') this.I(b, a, (v * this.srcScale) / r);
    else if (this.stim != null && this.stim === this.curId) this.I(b, a, 1 / r); // 1 V AC stimulus
  }
  /** Independent current source: i flows from a through the source to b. */
  Isrc(a, b, i) {
    if (this.mode === 'dc') this.I(a, b, i * this.srcScale);
  }
  /**
   * Nonlinear device. nodes: node index per terminal, fn(v[]) → currents INTO the device at each terminal.
   * opts.acScale(omega) → array of complex column multipliers [[re,im],...] (e.g. op-amp pole).
   */
  nl(nodes, fn, opts = {}) {
    if (this.mode === 'off') return;
    const k = nodes.length;
    const v0 = nodes.map((nd) => (nd > 0 ? this.x[nd] : 0));
    const f0 = fn(v0);
    const J = [];
    for (let j = 0; j < k; j++) {
      if (nodes[j] <= 0) { J.push(null); continue; }
      const v = v0.slice(); v[j] += H;
      const f1 = fn(v);
      J.push(f1.map((f, i) => (f - f0[i]) / H));
    }
    const scale = this.mode === 'ac' && opts.acScale ? opts.acScale(this.omega) : null;
    for (let i = 0; i < k; i++) {
      const r = nodes[i];
      if (r <= 0) continue;
      let lin = 0;
      for (let j = 0; j < k; j++) {
        if (!J[j]) continue;
        const d = J[j][i];
        if (d === 0) continue;
        if (scale && scale[j]) this._a(r, nodes[j], d * scale[j][0], d * scale[j][1]);
        else this._a(r, nodes[j], d);
        lin += d * v0[j];
      }
      if (this.mode === 'dc') this._b(r, -(f0[i] - lin));
    }
  }
}

// ---------- Circuit ----------
export class Circuit {
  /** opts.subset: Set of comp ids to include (isolate a region) */
  constructor(design, opts = {}) {
    this.design = design;
    this.nl = buildNets(design);
    const { nets, gndNet } = this.nl;
    this.nodeOfNet = new Int32Array(nets.length);
    let n = 0;
    for (const net of nets) this.nodeOfNet[net.id] = net.id === gndNet ? 0 : ++n;
    this.N = n + 1; // includes ground at 0
    this.elems = [];
    for (const c of design.comps) {
      if (opts.subset && !opts.subset.has(c.id)) continue;
      const def = TYPES[c.type];
      if (!def || !def.stamp) continue;
      const pins = getPins(c);
      const nodes = pins.map((_, i) => this.nodeOfNet[this.nl.pinNet(c.id, i)]);
      const connected = pins.map((_, i) => this.nl.connected(c.id, i));
      this.elems.push({ c, def, nodes, connected, nets: pins.map((_, i) => this.nl.pinNet(c.id, i)) });
    }
    this.hasNL = this.elems.some((e) => e.def.nonlinear || (e.def.isNL && e.def.isNL(e.c)));
    this.op = null;
  }

  nodeOf(netId) { return netId == null || netId < 0 ? 0 : this.nodeOfNet[netId]; }

  _stamp(mode, opts) {
    const st = new Stamper(this.N, mode, opts);
    for (let i = 0; i < this.elems.length; i++) {
      const e = this.elems[i];
      st.cur = i; st.curId = e.c.id;
      e.def.stamp(st, e.nodes, e.c, e);
    }
    st.cur = -1;
    for (let i = 1; i < this.N; i++) st._a(i, i, GMIN);
    return st;
  }

  _assemble(x, srcScale, hom = 1) {
    const n = this.N - 1;
    const st = this._stamp('dc', { x, srcScale, hom });
    const A = new Float64Array(n * n), b = new Float64Array(n);
    const t = st.trip;
    for (let q = 0; q < t.length; q += 5) A[(t[q] - 1) * n + (t[q + 1] - 1)] += t[q + 2];
    const r = st.rhs;
    for (let q = 0; q < r.length; q += 4) b[r[q] - 1] += r[q + 1];
    // KCL residual at x (companion models are exact at their own linearisation point)
    let res = 0;
    for (let i = 0; i < n; i++) {
      let s = -b[i];
      for (let j = 0; j < n; j++) s += A[i * n + j] * x[j + 1];
      res = Math.max(res, Math.abs(s));
    }
    return { st, A, b, res };
  }

  _solveDC(x, srcScale, maxIt, hom = 1) {
    const n = this.N - 1;
    let cur = this._assemble(x, srcScale, hom);
    for (let it = 0; it < maxIt; it++) {
      const sol = solveReal(cur.A.slice(), cur.b.slice(), n);
      if (!sol) return { ok: false, x, singular: true, it };
      if (!this.hasNL) {
        const xn = new Float64Array(this.N); xn.set(sol, 1);
        return { ok: true, x: xn, it: 1, st: cur.st };
      }
      let maxStep = 0;
      for (let i = 1; i < this.N; i++) {
        const d = sol[i - 1] - x[i];
        if (!Number.isFinite(d)) return { ok: false, x, it };
        maxStep = Math.max(maxStep, Math.abs(d));
      }
      const k = maxStep > 10 ? 10 / maxStep : 1;
      // backtracking line search on the residual
      let alpha = 1, best = null;
      for (let tries = 0; tries < 10; tries++) {
        const xt = new Float64Array(this.N);
        for (let i = 1; i < this.N; i++) xt[i] = x[i] + (sol[i - 1] - x[i]) * k * alpha;
        const trial = this._assemble(xt, srcScale, hom);
        if (!best || trial.res < best.res) best = { ...trial, x: xt, step: maxStep * k * alpha };
        if (trial.res < cur.res * (1 - 1e-4 * alpha) || trial.res < 1e-9) break;
        alpha *= 0.5;
      }
      // if no reduction found take a small step anyway (escapes flat regions)
      x = best.x; cur = best;
      if (cur.step < 1e-9 || (cur.res < 1e-9 && cur.step < 1e-5)) return { ok: true, x, it: it + 1, st: cur.st };
    }
    if (cur.res < 1e-6) return { ok: true, x, it: maxIt, st: cur.st, loose: true };
    return { ok: false, x, res: cur.res };
  }

  /** DC operating point. Returns {ok, V(netId), x, ...}. */
  dcop(prev) {
    let x = new Float64Array(this.N);
    if (prev && prev.length === this.N) x.set(prev);
    let r = this._solveDC(x, 1, 60);
    if (!r.ok && !r.singular) {
      // gain homotopy: soften op-amp gain & logic thresholds, then tighten
      x = new Float64Array(this.N);
      for (let h = 0; h <= 1.0001; h += 0.125) { r = this._solveDC(x, 1, 80, Math.min(h, 1)); x = r.x; }
    }
    if (!r.ok && !r.singular) {
      // source stepping
      x = new Float64Array(this.N);
      for (let s = 1; s <= 10; s++) { r = this._solveDC(x, s / 10, 60, 0); x = r.x; }
      for (let h = 0.125; h <= 1.0001; h += 0.125) { r = this._solveDC(x, 1, 80, Math.min(h, 1)); x = r.x; }
    }
    this.op = r.ok ? r.x : null;
    this.opInfo = r;
    if (r.ok) this._computeCurrents(r.st, r.x);
    return r;
  }

  _computeCurrents(st, x) {
    // currents INTO each element at each node: sum(A_e x) - b_e for rows of that element
    const per = this.elems.map(() => new Map());
    const t = st.trip;
    for (let q = 0; q < t.length; q += 5) {
      const ci = t[q + 4]; if (ci < 0) continue;
      const m = per[ci], row = t[q];
      m.set(row, (m.get(row) || 0) + t[q + 2] * x[t[q + 1]]);
    }
    const r = st.rhs;
    for (let q = 0; q < r.length; q += 4) {
      const ci = r[q + 3]; if (ci < 0) continue;
      const m = per[ci], row = r[q];
      m.set(row, (m.get(row) || 0) - r[q + 1]);
    }
    this.pinI = new Map(); // compId → array of currents into pin
    this.elems.forEach((e, i) => {
      const m = per[i];
      const used = new Set();
      const cur = e.nodes.map((nd) => {
        if (nd === 0 || used.has(nd)) return null;
        used.add(nd);
        return m.get(nd) || 0;
      });
      // ground pins: assign remainder to the first grounded/unresolved pin
      const known = cur.reduce((s, v) => s + (v ?? 0), 0);
      const gi = cur.findIndex((v, k) => v === null && e.nodes[k] === 0);
      for (let k = 0; k < cur.length; k++) if (cur[k] === null) cur[k] = 0;
      if (gi >= 0) cur[gi] = -known;
      this.pinI.set(e.c.id, cur);
    });
  }

  V(netId) { if (!this.op || netId == null || netId >= this.nodeOfNet.length) return NaN; const n = this.nodeOf(netId); return n === 0 ? 0 : this.op[n]; }
  pinV(cid, p) { return this.V(this.nl.pinNet(cid, p)); }

  /**
   * Small-signal / passive solve at a frequency.
   * mode 'ac' uses operating point; 'off' = unpowered network (DMM ohms / LCR).
   * inj: array of [netId, current] injections. Returns {re, im} node arrays (index by node) or null.
   */
  solveAC(freq, { mode = 'ac', stim = null, inj = [], srcShort = false } = {}) {
    const omega = 2 * Math.PI * freq;
    const n = this.N - 1;
    if (n <= 0) return null;
    const x = this.op || new Float64Array(this.N);
    const st = this._stamp(mode, { omega, stim, x, srcShort });
    const Ar = new Float64Array(n * n), Ai = new Float64Array(n * n), br = new Float64Array(n), bi = new Float64Array(n);
    const t = st.trip;
    for (let q = 0; q < t.length; q += 5) { const idx = (t[q] - 1) * n + (t[q + 1] - 1); Ar[idx] += t[q + 2]; Ai[idx] += t[q + 3]; }
    const r = st.rhs;
    for (let q = 0; q < r.length; q += 4) { br[r[q] - 1] += r[q + 1]; bi[r[q] - 1] += r[q + 2]; }
    for (const [net, cur] of inj) { const nd = this.nodeOf(net); if (nd > 0) br[nd - 1] += cur; }
    const s = solveComplex(Ar, Ai, br, bi, n);
    if (!s) return null;
    const re = new Float64Array(this.N), im = new Float64Array(this.N);
    re.set(s.re, 1); im.set(s.im, 1);
    return { re, im };
  }

  acV(sol, netId) { const nd = this.nodeOf(netId); return nd === 0 ? [0, 0] : [sol.re[nd], sol.im[nd]]; }
}

/** Convenience: build & solve. */
export function simulate(design, opts = {}, prev) {
  const ckt = new Circuit(design, opts);
  ckt.dcop(prev);
  return ckt;
}
