// Part datasheet card: package / pinout drawing + spec table.
import { partInfo, drawSymbol, getBBox, TYPES } from './library.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FN_CLASS = { power: 'pwr', ground: 'gnd', input: 'in', output: 'out', 'I/O': 'io' };

function legs(n, x0, dx, y0, len, labels, nums) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const x = x0 + i * dx;
    s += `<rect x="${x - 3}" y="${y0}" width="6" height="${len}" rx="1.5" fill="#b8bfc8" stroke="#6b7280"/>`;
    s += `<text x="${x}" y="${y0 + len + 13}" text-anchor="middle" class="tic" style="font-size:13px">${esc(labels[i] || '')}</text>`;
    s += `<text x="${x}" y="${y0 + len + 27}" text-anchor="middle" class="tnum" style="font-size:10px">${esc(nums[i] || i + 1)}</text>`;
  }
  return s;
}

function packageSvg(pkg, pinout) {
  const p = (pkg || '').toUpperCase();
  const labels = (pinout || []).map((r) => r[1].replace(/\s*\(.*\)/, ''));
  const nums = (pinout || []).map((r) => r[0]);
  let body = '', vb = '0 0 200 150';
  if (p.includes('TO-220') || p.includes('TO-247')) {
    const big = p.includes('TO-247');
    const w = big ? 110 : 90;
    const x0 = 100 - w / 2;
    body = `<rect x="${x0}" y="6" width="${w}" height="34" rx="3" fill="#c9ced6" stroke="#6b7280"/><circle cx="100" cy="22" r="8" fill="var(--panel)" stroke="#6b7280"/>
      <rect x="${x0}" y="38" width="${w}" height="${big ? 62 : 50}" rx="3" fill="#2b2f36" stroke="#111"/><text x="100" y="${big ? 70 : 64}" text-anchor="middle" style="fill:#e5e7eb;font-size:11px;font-weight:700">front</text>`;
    body += legs(3, 100 - (big ? 34 : 26), big ? 34 : 26, big ? 100 : 88, 26, labels, nums);
    vb = `0 0 200 ${big ? 168 : 156}`;
  } else if (p.includes('TO-92')) {
    body = `<path d="M70,70 V30 A30,30 0 0 1 130,30 V70 Z" fill="#2b2f36" stroke="#111"/><text x="100" y="52" text-anchor="middle" style="fill:#e5e7eb;font-size:10px;font-weight:700">flat face</text>`;
    body += legs(3, 82, 18, 70, 30, labels, nums);
    vb = '0 0 200 135';
  } else if (p.includes('SOT-223')) {
    body = `<rect x="66" y="8" width="68" height="18" rx="2" fill="#b8bfc8" stroke="#6b7280"/><rect x="58" y="24" width="84" height="48" rx="3" fill="#2b2f36" stroke="#111"/>`;
    body += legs(3, 76, 24, 72, 20, labels, nums);
    vb = '0 0 200 125';
  } else if (p.includes('SOT-23')) {
    // pin 3 on top, 1 & 2 at bottom
    body = `<rect x="70" y="40" width="60" height="34" rx="3" fill="#2b2f36" stroke="#111"/><text x="100" y="57" text-anchor="middle" style="fill:#e5e7eb;font-size:10px">top</text>
      <rect x="97" y="24" width="6" height="16" fill="#b8bfc8" stroke="#6b7280"/><text x="100" y="12" text-anchor="middle" class="tic" style="font-size:13px">${esc(labels[2] || '')} <tspan class="tnum">3</tspan></text>`;
    body += legs(2, 82, 36, 74, 16, labels.slice(0, 2), nums.slice(0, 2));
    vb = '0 0 200 125';
  } else if (/DO-|SMA|DO-2/.test(p)) {
    body = `<line x1="20" y1="45" x2="180" y2="45" stroke="#9ca3af" stroke-width="4"/><rect x="60" y="28" width="80" height="34" rx="8" fill="#2b2f36"/><rect x="122" y="28" width="10" height="34" fill="#d1d5db"/>
      <text x="30" y="80" text-anchor="middle" class="tic">A</text><text x="170" y="80" text-anchor="middle" class="tic">K</text><text x="127" y="20" text-anchor="middle" class="tnum">band = cathode</text>`;
    vb = '0 0 200 95';
  } else return '';
  return `<svg class="pinout-svg" viewBox="${vb}" style="max-height:170px">${body}</svg>`;
}

function blockSvg(c) {
  const sym = drawSymbol({ ...c, rot: 0, flip: false });
  const b = getBBox(c);
  let t = '';
  for (const [x, y, s, cls, a] of sym.t || []) t += `<text class="${cls}" x="${x}" y="${y}" text-anchor="${a}">${esc(s)}</text>`;
  const pad = 14;
  return `<svg class="pinout-svg" viewBox="${b.x - pad} ${b.y - pad} ${b.w + 2 * pad} ${b.h + 2 * pad}" style="max-height:${Math.min(520, b.h * 1.6 + 40)}px">${sym.s}${t}</svg>`;
}

export function infoHtml(c, autoInfo) {
  const info = partInfo(c);
  let h = `<div class="hint" style="font-size:15px;color:var(--text)">${esc(info.desc || TYPES[c.type].name)}</div>`;
  if (info.pkg) h += `<div class="hint">Package: <b>${esc(info.pkg)}</b></div>`;
  if (c.type === 'ic' || c.type === 'reg' || c.type === 'opamp') {
    h += `<div class="card" style="padding:6px">${blockSvg(c)}<div class="hint" style="text-align:center;padding:0">${c.type === 'ic' ? (info.ic?.def.layout === 'header' ? 'Board pin header (as oriented in notes)' : 'Top view · pin 1 at the notch, counter-clockwise') : 'Schematic symbol pins'}</div></div>`;
    if (c.type === 'reg' && info.pinout) h += `<div class="card" style="padding:6px">${packageSvg(info.pkg, info.pinout)}<div class="hint" style="text-align:center;padding:0">Physical package, front view</div></div>`;
  } else if (info.pinout) {
    const svg = packageSvg(info.pkg, info.pinout);
    if (svg) h += `<div class="card" style="padding:6px">${svg}<div class="hint" style="text-align:center;padding:0">Physical package, legs down</div></div>`;
  }
  if (info.pinout && info.pinout.length) {
    h += `<div class="sec">Pinout</div><table class="pins-table"><tr><th>#</th><th>Name</th>${info.pinout[0][2] ? '<th>Function</th>' : ''}</tr>`;
    h += info.pinout.map((r) => `<tr><td class="mono">${esc(r[0])}</td><td class="mono"><b>${esc(r[1])}</b></td>${r[2] ? `<td><span class="pf ${FN_CLASS[r[2]] || ''}">${esc(r[2])}</span></td>` : ''}</tr>`).join('');
    h += '</table>';
  }
  if (info.specs && info.specs.length) h += `<div class="sec">Specifications (typical)</div><table class="specs">${info.specs.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;
  if (info.notes) h += `<div class="note">${esc(info.notes)}</div>`;
  h += `<div class="hint" style="margin-top:10px;font-size:12.5px">Values are typical figures for quick reference — confirm critical limits against the manufacturer datasheet.</div>`;
  h += `<label class="row" style="margin-top:8px;font-size:14px;color:var(--muted)"><input type="checkbox" id="autoInfo" ${autoInfo ? 'checked' : ''}> Show this card when adding parts</label>`;
  return h;
}
