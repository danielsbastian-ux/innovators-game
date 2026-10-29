// Shared game rules — used by the host (who runs the game logic) and by players (for display).

export const GROUPS = {
  harbour: { name: "Harbour", icon: "⚓", closeKnit: true,  desc: "Fishing families. Close-knit: everyone knows everyone." },
  hillside:{ name: "Hillside Farms", icon: "🌾", closeKnit: true,  desc: "Old farming families. Close-knit and loyal to local ways." },
  market:  { name: "Market Town", icon: "🛒", closeKnit: false, desc: "Shopkeepers and traders. Loose-knit: lots of outside contacts." },
  campus:  { name: "Campus", icon: "🎓", closeKnit: false, desc: "Students and staff. Loose-knit and mobile." },
};
export const GROUP_KEYS = Object.keys(GROUPS);

export const AGES = ["Teens", "20s–30s", "40s–50s", "60+"];

export const COLORS = ["#ef4444","#f97316","#f59e0b","#eab308","#84cc16","#22c55e","#14b8a6","#06b6d4","#0ea5e9","#3b82f6","#6366f1","#8b5cf6","#a855f7","#d946ef","#ec4899","#f43f5e","#78716c","#64748b","#0d9488","#b45309","#4d7c0f","#be123c","#1d4ed8","#7e22ce","#c2410c","#15803d","#0369a1","#a16207","#9f1239","#334155"];

export const DEFAULT_SETTINGS = {
  innovators: 3,        // 2 for small classes (< 12)
  fieldworkSec: 150,
  meetingSec: 150,
  voteSec: 45,
  maxRounds: 5,
  tipping: 70,          // % of active speakers using the variant = change complete → Innovators win
  researchPerPlayer: 6, // research target = players × this (correct answers by Sociolinguists)
  targetsPerInnovator: 2,
  revealOnEject: true,
};

export const PHASE_LABEL = {
  lobby: "Waiting for players",
  roles: "Read your role card",
  fieldwork: "Fieldwork",
  meeting: "Community meeting",
  vote: "Vote",
  reveal: "Vote result",
  over: "Game over",
};

// ---------- random helpers ----------
export function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function shuffle(arr, r = Math.random) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
export function pick(arr, r = Math.random) { return arr[Math.floor(r() * arr.length)]; }

// ---------- setup ----------
// Returns { profiles: {uid:{group, age, link}}, roles: {uid:'innovator'|'sociolinguist'} }
export function assignRoles(uids, settings, r = Math.random) {
  const order = shuffle(uids, r);
  const profiles = {};
  order.forEach((uid, i) => {
    profiles[uid] = { group: GROUP_KEYS[i % GROUP_KEYS.length], age: AGES[Math.floor(r() * AGES.length)], link: null };
  });
  // ~20% are link-persons with weak ties to a second group
  const nLinks = Math.max(1, Math.round(uids.length * 0.2));
  shuffle(uids, r).slice(0, nLinks).forEach(uid => {
    const others = GROUP_KEYS.filter(g => g !== profiles[uid].group);
    profiles[uid].link = pick(others, r);
  });
  const nInn = Math.min(settings.innovators, Math.max(1, Math.floor(uids.length / 3)));
  const innovators = new Set(shuffle(uids, r).slice(0, nInn));
  const roles = {};
  uids.forEach(u => roles[u] = innovators.has(u) ? "innovator" : "sociolinguist");
  return { profiles, roles };
}

export function groupsOf(p) { return p.link ? [p.group, p.link] : [p.group]; }
export function sameNetwork(a, b) { return groupsOf(a).some(g => groupsOf(b).includes(g)); }
export function isOutside(from, to) { return !sameNetwork(from, to); }

// Chance that a conversation passes on the variant (shown to Innovators so they can plan).
export function spreadChance(fromP, toP, media = false) {
  let p;
  if (sameNetwork(fromP, toP)) p = 0.55;                      // same network: easy
  else if (fromP.link || toP.link) p = 0.45;                  // a link-person bridges the gap
  else if (GROUPS[toP.group].closeKnit) p = 0.15;             // close-knit groups resist outsiders
  else p = 0.3;
  if (media) p = Math.min(0.95, p + 0.15);                    // media "softens up" listeners
  return p;
}

// ---------- one round of spread ----------
// adopted: {uid: {round, from, via}}  (innovators are in here from round 0)
// actions: {innovatorUid: {targets:[uid], media:bool}}
// active: array of uids still in the community (not voted out)
// Returns { adopted (new object), events: [{to, from, via, round}], outsideTalk: {uid:true} }
export function resolveSpread({ profiles, roles, adopted, actions, active, round, mediaRound }, r = Math.random) {
  const out = { ...adopted };
  const events = [];
  const outsideTalk = {};
  const activeSet = new Set(active);
  const tryAdopt = (from, to, via, media) => {
    if (!activeSet.has(to) || out[to]) return false;
    if (r() < spreadChance(profiles[from], profiles[to], media)) {
      out[to] = { round, from, via };
      events.push({ to, from, via, round });
      return true;
    }
    return false;
  };
  // 1) Innovators' deliberate conversations
  for (const [uid, act] of Object.entries(actions || {})) {
    if (roles[uid] !== "innovator" || !activeSet.has(uid)) continue;
    for (const t of (act.targets || [])) {
      if (!profiles[t]) continue;
      if (isOutside(profiles[uid], profiles[t])) outsideTalk[uid] = true;
      tryAdopt(uid, t, "innovator", !!mediaRound);
    }
  }
  // 2) Media hype: a few extra random listeners hear it "on TV" — but only adopt if they already know an adopter (soften-up idea)
  if (mediaRound) {
    const pool = shuffle(active.filter(u => !out[u]), r).slice(0, 3);
    for (const u of pool) {
      const knowsAdopter = active.some(a => out[a] && a !== u && sameNetwork(profiles[a], profiles[u]));
      if (knowsAdopter && r() < 0.5) { out[u] = { round, from: null, via: "media" }; events.push({ to: u, from: null, via: "media", round }); }
    }
  }
  // 3) Wave: speakers who adopted in EARLIER rounds pass it on naturally (unconsciously)
  for (const [uid, info] of Object.entries(adopted)) {
    if (roles[uid] === "innovator" || !activeSet.has(uid) || info.round >= round) continue;
    const p = profiles[uid];
    const contacts = active.filter(u => u !== uid && sameNetwork(p, profiles[u]) && !out[u]);
    if (!contacts.length) continue;
    const t = pick(contacts, r);
    const crossing = isOutside({ group: p.group, link: null }, profiles[t]);
    if (r() < 0.2) {
      out[t] = { round, from: uid, via: crossing ? "link" : "wave" };
      events.push({ to: t, from: uid, via: crossing ? "link" : "wave", round });
      if (crossing) outsideTalk[uid] = true;
    }
  }
  return { adopted: out, events, outsideTalk };
}

export function adoptionPct(adopted, active) {
  if (!active.length) return 0;
  return Math.round(100 * active.filter(u => adopted[u]).length / active.length);
}

export function breakdown(adopted, active, profiles, key) {
  const res = {};
  const keys = key === "group" ? GROUP_KEYS : AGES;
  keys.forEach(k => {
    const members = active.filter(u => key === "group" ? profiles[u].group === k : profiles[u].age === k);
    const users = members.filter(u => adopted[u]).length;
    res[k] = { n: members.length, users, pct: members.length ? Math.round(100 * users / members.length) : 0 };
  });
  return res;
}

export function makeCode(r = Math.random) {
  const L = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from({ length: 4 }, () => L[Math.floor(r() * L.length)]).join("");
}

export function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
