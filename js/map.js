// The island map: layout, task stations, and drawing (shared by host and phones).
import { initials } from "./ui.js";

export const W = 1000, H = 640;
export const SPEED = 170;        // map units per second
export const TALK_RANGE = 75;    // how close two characters must be to start a chat
export const STATION_RANGE = 60; // how close to a station to unlock its task

export const AREAS = {
  hillside: { x: 210, y: 165, rx: 165, ry: 115, fill: "#2f6b3a", label: "🌾 Hillside Farms" },
  campus:   { x: 790, y: 160, rx: 165, ry: 110, fill: "#3b3f7a", label: "🎓 Campus" },
  harbour:  { x: 215, y: 480, rx: 170, ry: 110, fill: "#245a73", label: "⚓ Harbour" },
  market:   { x: 785, y: 475, rx: 170, ry: 110, fill: "#7a4a22", label: "🛒 Market Town" },
};
export const HALL = { x: 500, y: 320, label: "🏛️ Town hall" };

export const STATIONS = [
  { id: "dock",    x: 120, y: 545, name: "Harbour dock" },
  { id: "barn",    x: 140, y: 120, name: "Hillside barn" },
  { id: "square",  x: 830, y: 520, name: "Market square" },
  { id: "library", x: 860, y: 115, name: "Campus library" },
  { id: "hall",    x: 500, y: 320, name: "Town hall" },
  { id: "pier",    x: 500, y: 585, name: "Ferry pier" },
];

export const clamp = (x, y) => [Math.max(30, Math.min(W - 30, x)), Math.max(30, Math.min(H - 30, y))];
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function homeSpot(group, r = Math.random) {
  const a = AREAS[group] || HALL;
  const t = r() * Math.PI * 2, d = 0.25 + r() * 0.45;
  return clamp(a.x + Math.cos(t) * (a.rx || 60) * d, a.y + Math.sin(t) * (a.ry || 60) * d);
}

// Which 3 stations hold a player's 3 tasks this round (deterministic, different each round)
export function taskStations(uid, round) {
  let h = 7; for (const ch of uid + ":" + round) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const ids = STATIONS.map((_, i) => i);
  for (let i = ids.length - 1; i > 0; i--) { h = (h * 1103515245 + 12345) >>> 0; const j = h % (i + 1); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return ids.slice(0, 3).map(i => STATIONS[i]);
}

// ---------- drawing ----------
// cam = { cx, cy, scale } : map point (cx,cy) is drawn at the canvas centre
export function drawMap(ctx, cw, ch, cam, { people = [], meId = null, trails = null, highlight = [], bubbles = {} } = {}) {
  const s = cam.scale;
  const tx = x => (x - cam.cx) * s + cw / 2, ty = y => (y - cam.cy) * s + ch / 2;
  ctx.save();
  ctx.fillStyle = "#0b3350"; ctx.fillRect(0, 0, cw, ch);
  // waves
  ctx.strokeStyle = "rgba(255,255,255,.05)"; ctx.lineWidth = 1;
  for (let y = -40; y < H + 40; y += 36) { ctx.beginPath(); for (let x = -40; x < W + 40; x += 20) ctx.lineTo(tx(x), ty(y + Math.sin(x / 30) * 4)); ctx.stroke(); }
  // island
  ctx.fillStyle = "#c9b27c";
  roundRect(ctx, tx(15), ty(15), (W - 30) * s, (H - 30) * s, 90 * s); ctx.fill();
  ctx.fillStyle = "#6f8f4e";
  roundRect(ctx, tx(32), ty(32), (W - 64) * s, (H - 64) * s, 80 * s); ctx.fill();
  // paths
  ctx.strokeStyle = "#d9c48f"; ctx.lineCap = "round"; ctx.lineWidth = 22 * s;
  for (const a of Object.values(AREAS)) { ctx.beginPath(); ctx.moveTo(tx(HALL.x), ty(HALL.y)); ctx.lineTo(tx(a.x), ty(a.y)); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(tx(HALL.x), ty(HALL.y)); ctx.lineTo(tx(500), ty(600)); ctx.stroke();
  // areas
  for (const a of Object.values(AREAS)) {
    ctx.fillStyle = a.fill; ctx.globalAlpha = .85;
    ctx.beginPath(); ctx.ellipse(tx(a.x), ty(a.y), a.rx * s, a.ry * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.font = `700 ${Math.max(11, 22 * s)}px "Space Grotesk", system-ui, sans-serif`; ctx.textAlign = "center";
    ctx.fillText(a.label, tx(a.x), ty(a.y - a.ry + 28));
  }
  // town hall
  ctx.fillStyle = "#e8dcc0"; roundRect(ctx, tx(HALL.x - 45), ty(HALL.y - 32), 90 * s, 64 * s, 10 * s); ctx.fill();
  ctx.fillStyle = "#5b4a2a"; ctx.font = `700 ${Math.max(10, 16 * s)}px "Space Grotesk", system-ui, sans-serif`; ctx.fillText(HALL.label, tx(HALL.x), ty(HALL.y + 6));
  // stations
  for (const st of STATIONS) {
    const hi = highlight.find(h => h.id === st.id);
    ctx.beginPath(); ctx.arc(tx(st.x), ty(st.y), (hi ? 18 : 12) * s + 2, 0, Math.PI * 2);
    ctx.fillStyle = hi ? (hi.done ? "#5ee08f" : "#f6b33d") : "rgba(255,255,255,.35)"; ctx.fill();
    ctx.fillStyle = "#0d1b2a"; ctx.font = `700 ${Math.max(9, 14 * s)}px system-ui`; ctx.fillText(hi ? (hi.done ? "✓" : String(hi.n)) : "📍", tx(st.x), ty(st.y + 5 * s));
    ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.font = `600 ${Math.max(9, 12 * s)}px "Space Grotesk", system-ui`; ctx.fillText(st.name, tx(st.x), ty(st.y + 34));
  }
  // trails
  if (trails) {
    for (const p of people) {
      const tr = trails[p.id]; if (!tr || tr.length < 2) continue;
      ctx.strokeStyle = p.color; ctx.globalAlpha = .4; ctx.lineWidth = 2.5; ctx.setLineDash([6, 6]);
      ctx.beginPath(); tr.forEach((pt, i) => i ? ctx.lineTo(tx(pt.x), ty(pt.y)) : ctx.moveTo(tx(pt.x), ty(pt.y))); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
  }
  // people (original speech-bubble characters)
  const r = Math.max(11, 17 * s);
  for (const p of people) {
    const x = tx(p.x), y = ty(p.y);
    if (p.id === meId) { ctx.beginPath(); ctx.arc(x, y, r + 7, 0, Math.PI * 2); ctx.strokeStyle = "#f6b33d"; ctx.lineWidth = 3; ctx.stroke(); }
    if (p.near) { ctx.beginPath(); ctx.arc(x, y, r + 6, 0, Math.PI * 2); ctx.strokeStyle = "#3fd0c9"; ctx.lineWidth = 3; ctx.stroke(); }
    bubbleShape(ctx, x, y, r, p.color);
    ctx.fillStyle = "#fff"; ctx.font = `700 ${Math.max(9, r * .8)}px "Space Grotesk", system-ui`; ctx.textAlign = "center";
    ctx.fillText(initials(p.name), x, y + r * .3);
    ctx.font = `600 ${Math.max(10, 13 * s + 2)}px "Space Grotesk", system-ui`;
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.strokeText(p.name, x, y - r - 8); ctx.fillText(p.name, x, y - r - 8);
    if (bubbles[p.id]) { ctx.font = `${Math.max(14, 22 * s)}px system-ui`; ctx.fillText("💬", x + r + 8, y - r); }
  }
  ctx.restore();
}

function bubbleShape(ctx, x, y, r, color) {
  // rounded speech bubble with a small tail at bottom-left
  ctx.fillStyle = color; ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = 2;
  ctx.beginPath();
  roundRect(ctx, x - r, y - r * .85, r * 2, r * 1.7, r * .7);
  ctx.moveTo(x - r * .55, y + r * .8); ctx.lineTo(x - r * .9, y + r * 1.25); ctx.lineTo(x - r * .1, y + r * .82);
  ctx.fill(); ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// Smoothly follow network positions
export function lerpTo(cur, target, k) { cur.x += (target.x - cur.x) * k; cur.y += (target.y - cur.y) * k; }
