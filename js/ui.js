import { esc, GROUPS } from "./game.js";

export const $ = s => document.querySelector(s);

export function initials(name) {
  const p = String(name || "?").trim().split(/\s+/);
  return ((p[0]?.[0] || "?") + (p[1]?.[0] || "")).toUpperCase();
}

export function avatar(player, { lg = false, out = false, dot = false } = {}) {
  const c = player?.color || "#64748b";
  return `<span class="av${lg ? " lg" : ""}${out ? " out" : ""}" style="--c:${c}">${esc(initials(player?.name))}${dot ? '<span class="dot"></span>' : ""}</span>`;
}

export function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function groupLabel(key) { const g = GROUPS[key]; return g ? `${g.icon} ${g.name}` : key; }

// Small S-curve style chart of adoption % by round
export function curveSVG(history, tipping, { w = 420, h = 200 } = {}) {
  const pts = (history || []).map(Number);
  const pad = 44, iw = w - pad - 10, ih = h - pad - 10;
  const n = Math.max(pts.length - 1, 5);
  const x = i => pad + (i / n) * iw;
  const y = v => 10 + ih - (v / 100) * ih;
  const path = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const ticks = Array.from({ length: n + 1 }, (_, i) => `<text x="${x(i)}" y="${h - 8}" font-size="11" fill="#9fb3c8" text-anchor="middle">${i === 0 ? "Start" : "R" + i}</text>`).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Adoption of the new variant by round">
    <line x1="${pad}" y1="${y(0)}" x2="${w - 10}" y2="${y(0)}" stroke="#2f5276"/>
    <line x1="${pad}" y1="${y(100)}" x2="${w - 10}" y2="${y(100)}" stroke="#2f5276" stroke-dasharray="2 4"/>
    <line x1="${pad}" y1="${y(tipping)}" x2="${w - 10}" y2="${y(tipping)}" stroke="#f6b33d" stroke-dasharray="6 4"/>
    <text x="${w - 12}" y="${y(tipping) - 5}" font-size="11" fill="#f6b33d" text-anchor="end">change complete (${tipping}%)</text>
    <text x="${pad - 6}" y="${y(0) + 4}" font-size="11" fill="#9fb3c8" text-anchor="end">0%</text>
    <text x="${pad - 6}" y="${y(100) + 4}" font-size="11" fill="#9fb3c8" text-anchor="end">100%</text>
    ${ticks}
    <path d="${path}" fill="none" stroke="#d946ef" stroke-width="3" stroke-linejoin="round"/>
    ${pts.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="#d946ef"/><text x="${x(i)}" y="${y(v) - 9}" font-size="11" fill="#eef3f8" text-anchor="middle">${v}%</text>`).join("")}
  </svg>`;
}

export function demoBanner(isDemo) {
  if (!isDemo) return;
  const b = document.createElement("div");
  b.className = "demo-banner";
  b.innerHTML = "Demo mode: Firebase is not set up yet, so this only works in tabs of this one browser. See README to go live.";
  document.body.prepend(b);
}
