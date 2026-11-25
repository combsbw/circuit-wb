// Log-frequency plot with two traces (magnitude + phase) and a touch cursor.
import { fmt } from './units.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';

export function drawPlot(cv, data) {
  cv._data = data;
  if (!cv._bound) {
    cv._bound = true;
    const move = (e) => {
      const r = cv.getBoundingClientRect();
      cv._cursor = Math.max(0, Math.min(1, (e.clientX - r.left - cv._pl) / (r.width - cv._pl - cv._pr)));
      paint(cv);
    };
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); move(e); });
    cv.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'mouse') move(e); });
    cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { cv._cursor = null; paint(cv); } });
  }
  paint(cv);
}

function niceStep(range, target = 5) {
  const raw = range / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

function paint(cv) {
  const d = cv._data;
  if (!d) return;
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, Hh = cv.clientHeight;
  if (!W || !Hh) return;
  cv.width = W * dpr; cv.height = Hh * dpr;
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, Hh);
  const pl = 42, pr = 38, pt = 20, pb = 22;
  cv._pl = pl; cv._pr = pr;
  const w = W - pl - pr, h = Hh - pt - pb;
  const f = d.f, n = f.length;
  const lf0 = Math.log10(f[0]), lf1 = Math.log10(f[n - 1]);
  const X = (fr) => pl + ((Math.log10(fr) - lf0) / (lf1 - lf0)) * w;
  const muted = css('--muted'), line = css('--line'), text = css('--text'), accent = css('--accent'), warn = css('--warn');
  // y1 range
  const v1 = d.y1.filter(Number.isFinite).concat((d.hlines || []).map((h) => h.y));
  let y1min = Math.min(...v1), y1max = Math.max(...v1);
  if (!v1.length) { y1min = -1; y1max = 1; }
  if (y1max - y1min < (d.y1Log ? 1 : 6)) { const m = (y1max + y1min) / 2; y1min = m - (d.y1Log ? 0.5 : 3); y1max = m + (d.y1Log ? 0.5 : 3); }
  const st1 = d.y1Log ? 1 : niceStep(y1max - y1min, 5);
  y1min = Math.floor(y1min / st1) * st1; y1max = Math.ceil(y1max / st1) * st1;
  const Y1 = (v) => pt + h - ((v - y1min) / (y1max - y1min)) * h;
  const v2 = d.y2.filter(Number.isFinite);
  let y2min = Math.min(...v2, 0), y2max = Math.max(...v2, 0);
  const st2 = niceStep(Math.max(y2max - y2min, 90), 4);
  y2min = Math.floor(y2min / st2) * st2; y2max = Math.ceil(y2max / st2) * st2;
  const Y2 = (v) => pt + h - ((v - y2min) / (y2max - y2min || 1)) * h;
  g.font = '10px -apple-system, system-ui, sans-serif';
  g.lineWidth = 1;
  // grid
  g.strokeStyle = line; g.fillStyle = muted;
  for (let e = Math.ceil(lf0); e <= Math.floor(lf1); e++) {
    const x = X(Math.pow(10, e));
    g.beginPath(); g.moveTo(x, pt); g.lineTo(x, pt + h); g.stroke();
    g.textAlign = 'center'; g.fillText(fmt(Math.pow(10, e), d.xUnit || 'Hz', 1).replace(' ', ''), x, Hh - 7);
    g.globalAlpha = 0.35;
    for (let k = 2; k < 10; k++) { const xx = X(k * Math.pow(10, e)); if (xx < pl + w) { g.beginPath(); g.moveTo(xx, pt); g.lineTo(xx, pt + h); g.stroke(); } }
    g.globalAlpha = 1;
  }
  g.textAlign = 'right';
  for (let v = y1min; v <= y1max + 1e-9; v += st1) {
    const y = Y1(v);
    g.beginPath(); g.moveTo(pl, y); g.lineTo(pl + w, y); g.stroke();
    g.fillText(d.y1Log ? fmt(Math.pow(10, v), '', 1).replace(' ', '') : String(Math.round(v * 10) / 10), pl - 5, y + 3);
  }
  g.textAlign = 'left';
  if (!d.noPhase) for (let v = y2min; v <= y2max + 1e-9; v += st2) g.fillText(Math.round(v) + '°', pl + w + 5, Y2(v) + 3);
  // markers
  g.setLineDash([3, 3]); g.strokeStyle = warn;
  for (const m of d.markers || []) { if (m >= f[0] && m <= f[n - 1]) { const x = X(m); g.beginPath(); g.moveTo(x, pt); g.lineTo(x, pt + h); g.stroke(); } }
  g.setLineDash([]);
  // traces
  const trace = (ys, Y, color, width, dash) => {
    g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash || []);
    g.beginPath();
    let pen = false;
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(ys[i])) { pen = false; continue; }
      const x = X(f[i]), y = Y(ys[i]);
      if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y);
    }
    g.stroke(); g.setLineDash([]);
  };
  if (!d.noPhase) trace(d.y2, Y2, muted, 1.4, [4, 3]);
  for (const hl of d.hlines || []) {
    g.strokeStyle = warn; g.lineWidth = 1.4; g.setLineDash([6, 4]);
    g.beginPath(); g.moveTo(pl, Y1(hl.y)); g.lineTo(pl + w, Y1(hl.y)); g.stroke(); g.setLineDash([]);
    g.fillStyle = warn; g.font = '600 10px -apple-system, system-ui, sans-serif'; g.textAlign = 'left'; g.fillText(hl.label || '', pl + 4, Y1(hl.y) - 4);
  }
  trace(d.y1, Y1, accent, 2.2);
  g.font = '600 10px -apple-system, system-ui, sans-serif';
  g.fillStyle = accent; g.textAlign = 'left'; g.fillText((d.y1Label || '') + ' ━', 6, 11);
  if (!d.noPhase) { g.fillStyle = muted; g.textAlign = 'right'; g.fillText('phase ┅', W - 6, 11); }
  // cursor
  if (cv._cursor != null) {
    const fr = Math.pow(10, lf0 + cv._cursor * (lf1 - lf0));
    let i = 0; while (i < n - 1 && f[i] < fr) i++;
    const x = X(f[i]);
    g.strokeStyle = text; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, pt); g.lineTo(x, pt + h); g.stroke();
    const yv = d.y1[i];
    if (Number.isFinite(yv)) { g.fillStyle = accent; g.beginPath(); g.arc(x, Y1(yv), 3.5, 0, 7); g.fill(); }
    const label = `${fmt(f[i], d.xUnit || 'Hz', 3)}  ${d.y1Log ? fmt(Math.pow(10, yv), 'Ω', 3) : (yv ?? 0).toFixed(2) + ' ' + (d.yUnit || 'dB')}  ${!d.noPhase && Number.isFinite(d.y2[i]) ? d.y2[i].toFixed(1) + '°' : ''}`;
    g.font = '600 11px -apple-system, system-ui, sans-serif';
    const tw = g.measureText(label).width + 12;
    const bx = Math.min(Math.max(x - tw / 2, pl), pl + w - tw);
    g.fillStyle = text; g.globalAlpha = 0.88;
    roundRect(g, bx, 1, tw, 17, 6); g.fill();
    g.globalAlpha = 1; g.fillStyle = css('--panel'); g.textAlign = 'left'; g.fillText(label, bx + 6, 13);
  }
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
