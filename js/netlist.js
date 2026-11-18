// Connectivity: union-find over pins & junctions joined by wires, net labels, rails and IC internal bridges.
import { getPins, getBridges, TYPES } from './library.js';

export const pinKey = (cid, p) => `c:${cid}:${p}`;
export const juncKey = (jid) => `j:${jid}`;
export const endKey = (e) => (e.j != null ? juncKey(e.j) : pinKey(e.c, e.p));

export function buildNets(design) {
  const parent = new Map();
  const find = (k) => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r);
    let c = k;
    while (parent.get(c) !== r) { const n = parent.get(c); parent.set(c, r); c = n; }
    return r;
  };
  const add = (k) => { if (!parent.has(k)) parent.set(k, k); };
  const union = (a, b) => { add(a); add(b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  const compById = new Map();
  for (const c of design.comps) {
    compById.set(c.id, c);
    const n = getPins(c).length;
    for (let i = 0; i < n; i++) add(pinKey(c.id, i));
    for (const grp of getBridges(c)) for (let i = 1; i < grp.length; i++) union(pinKey(c.id, grp[0]), pinKey(c.id, grp[i]));
  }
  for (const j of design.juncs) add(juncKey(j.id));
  // degree count of each endpoint (number of wires touching it)
  const degree = new Map();
  for (const w of design.wires) {
    const ka = endKey(w.a), kb = endKey(w.b);
    if (!parent.has(ka) || !parent.has(kb)) continue; // dangling reference
    union(ka, kb);
    degree.set(ka, (degree.get(ka) || 0) + 1);
    degree.set(kb, (degree.get(kb) || 0) + 1);
  }
  // Net labels & rails with the same name are the same net. Grounds (and labels named GND) are one net.
  const byName = new Map();
  let gndKey = null;
  const joinGnd = (k) => { if (gndKey) union(gndKey, k); else gndKey = k; };
  for (const c of design.comps) if (c.type === 'ground') joinGnd(pinKey(c.id, 0));
  for (const c of design.comps) {
    const t = c.type;
    if (t !== 'netlabel' && t !== 'rail') continue;
    const name = String(c.props.name || '').trim();
    if (!name) continue;
    const k = pinKey(c.id, 0);
    if (t === 'netlabel' && /^(gnd|0v|ground)$/i.test(name)) { joinGnd(k); continue; }
    const key = name.toUpperCase();
    if (byName.has(key)) union(byName.get(key), k); else byName.set(key, k);
  }
  // Collect nets
  const rootToNet = new Map();
  const nets = [];
  const netOfKey = new Map();
  for (const k of parent.keys()) {
    const r = find(k);
    let id = rootToNet.get(r);
    if (id == null) { id = nets.length; rootToNet.set(r, id); nets.push({ id, keys: [], name: null, isGnd: false }); }
    nets[id].keys.push(k);
    netOfKey.set(k, id);
  }
  // Ground net
  let gndNet = gndKey ? netOfKey.get(gndKey) : -1;
  let implicitGnd = false;
  if (gndNet < 0) {
    // Use negative terminal of the first DC/AC source as reference
    const src = design.comps.find((c) => c.type === 'vdc' || c.type === 'vac');
    if (src) { gndNet = netOfKey.get(pinKey(src.id, 1)); implicitGnd = true; }
  }
  if (gndNet >= 0) nets[gndNet].isGnd = true;
  // Names
  for (const c of design.comps) {
    if (c.type === 'netlabel' || c.type === 'rail') {
      const id = netOfKey.get(pinKey(c.id, 0));
      if (id != null && !nets[id].name) nets[id].name = c.props.name;
    }
  }
  if (gndNet >= 0) nets[gndNet].name = nets[gndNet].name || 'GND';
  // A pin is "connected" if its net contains anything besides itself
  const connected = (cid, p) => {
    const k = pinKey(cid, p);
    if ((degree.get(k) || 0) > 0) return true;
    const id = netOfKey.get(k);
    return id != null && nets[id].keys.length > 1;
  };
  // Auto names for unnamed nets: N1, N2...
  let n = 1;
  for (const net of nets) if (!net.name) net.name = 'N' + n++;
  // Describe a net by its member pins (for UI)
  const describe = (id) => {
    const net = nets[id];
    if (!net) return '';
    const parts = [];
    for (const k of net.keys) {
      if (k[0] !== 'c') continue;
      const [, cid, p] = k.split(':');
      const c = compById.get(cid);
      if (!c) continue;
      const def = TYPES[c.type];
      if (!def || def.noRef) continue;
      const pin = getPins(c)[+p];
      parts.push(`${c.ref}.${pin?.name ?? p}`);
    }
    return parts.slice(0, 6).join(', ') + (parts.length > 6 ? ` +${parts.length - 6}` : '');
  };
  return {
    nets, netOfKey, gndNet, implicitGnd, degree, compById,
    pinNet: (cid, p) => netOfKey.get(pinKey(cid, p)),
    juncNet: (jid) => netOfKey.get(juncKey(jid)),
    endNet: (e) => netOfKey.get(endKey(e)),
    connected, describe,
  };
}
