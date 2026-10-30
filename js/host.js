import { initDB, DEMO, arr } from "./db.js";
import * as G from "./game.js";
import { QUESTIONS, CLUES } from "./questions.js";
import { $, avatar, fmtTime, groupLabel, curveSVG, demoBanner } from "./ui.js";

const { esc, GROUPS, GROUP_KEYS, AGES } = G;
const QMAP = Object.fromEntries(QUESTIONS.map(q => [q.id, q]));
let db, code = null, game = null, busy = false, unsub = null, settingsOpen = false;
const processing = new Set();

const TIPS = [
  "<b>Wave theory:</b> a change spreads outwards from its source group, like ripples. Which group has the most users?",
  "<b>Link-persons</b> (↔) have weak ties to two groups. They carry new forms across network boundaries.",
  "<b>Close-knit networks</b> (Harbour, Hillside) resist forms from outsiders but spread them fast inside.",
  "<b>Change from below:</b> most speakers adopt the variant without noticing. Being a user doesn't make you an Innovator!",
  "<b>Apparent time:</b> comparing age groups hints at change, but watch out for age-grading.",
  "<b>Covert prestige:</b> a form can spread because it signals belonging, not status.",
  "<b>Media vs face-to-face:</b> the chapter argues real interaction, not TV, drives change. Media may just 'soften up' listeners.",
];

// ---------- boot ----------
(async function main() {
  db = await initDB();
  demoBanner(DEMO);
  const saved = localStorage.getItem("innov-host-code");
  let canResume = false;
  if (saved) {
    try { canResume = (await db.get(`games/${saved}/host`)) === db.uid; } catch {}
  }
  renderStart(canResume ? saved : null);
  setInterval(tick, 500);
})();

function renderStart(resumeCode) {
  $("#app").innerHTML = `
  <div class="landing">
    <div class="hero"><h1>Host a game</h1><p>Open this page on the computer connected to the projector. Students join on their phones.</p></div>
    <div class="choice">
      <div class="card stack"><h3>New game</h3><p class="muted">Creates a room code for your class.</p><button class="btn block" id="new">Create new game</button></div>
      ${resumeCode ? `<div class="card stack"><h3>Resume game ${esc(resumeCode)}</h3><p class="muted">Use this if you refreshed or closed the host page.</p><button class="btn ghost block" id="resume">Resume ${esc(resumeCode)}</button></div>` : ""}
    </div>
  </div>`;
  $("#new").onclick = createGame;
  if (resumeCode) $("#resume").onclick = () => attach(resumeCode);
}

async function createGame() {
  let c = null;
  for (let i = 0; i < 15; i++) { const t = G.makeCode(); if (!(await db.get(`games/${t}/host`))) { c = t; break; } }
  if (!c) return alert("Could not create a code, try again.");
  await db.set(`games/${c}/host`, db.uid);
  await db.update(`games/${c}`, { settings: G.DEFAULT_SETTINGS, state: { phase: "lobby", round: 0, createdAt: db.now() } });
  attach(c);
}

function attach(c) {
  code = c;
  localStorage.setItem("innov-host-code", c);
  if (unsub) unsub();
  unsub = db.on(`games/${c}`, v => { game = v; onGame(); });
}

// ---------- helpers ----------
const S = () => ({ ...G.DEFAULT_SETTINGS, ...(game?.settings || {}) });
const st = () => game?.state || {};
const players = () => game?.players || {};
const profiles = () => game?.profiles || {};
const hidden = () => game?.hidden || {};
const allUids = () => Object.keys(profiles()).length ? Object.keys(profiles()) : Object.keys(players());
const activeUids = () => allUids().filter(u => profiles()[u]?.alive !== false);
const roleOf = u => hidden().roles?.[u];
const nameOf = u => players()[u]?.name || "?";
const P = u => ({ name: nameOf(u), color: players()[u]?.color });
const normProfiles = () => { const o = {}; for (const [u, p] of Object.entries(profiles())) o[u] = { ...p, link: p.link || null }; return o; };

function scores() {
  const tokens = {}; let research = 0;
  for (const u of allUids()) {
    const qs = game.secrets?.[u]?.qs || {};
    const ans = game.answers?.[u] || {};
    let correct = 0;
    for (const [round, list] of Object.entries(qs)) {
      for (const qid of arr(list)) {
        const choice = ans?.[round]?.[qid];
        if (choice != null && QMAP[qid] && Number(choice) === QMAP[qid].a) correct++;
      }
    }
    let spent = 0;
    for (const c of Object.values(game.secrets?.[u]?.clues || {})) if (c.ok) spent += CLUES[c.type]?.cost || 0;
    tokens[u] = correct - spent;
    if (roleOf(u) === "sociolinguist") research += correct;
  }
  return { tokens, research };
}

// ---------- reacting to data ----------
async function onGame() {
  if (!game) { render(); return; }
  render();
  runBots();
  const ph = st().phase;
  if (["fieldwork", "meeting", "vote", "reveal"].includes(ph) && !busy) {
    const { tokens, research } = scores();
    const upd = {};
    for (const u of allUids()) if ((game.secrets?.[u]?.tokens ?? 0) !== tokens[u]) upd[`secrets/${u}/tokens`] = tokens[u];
    if ((st().research ?? 0) !== research) upd["state/research"] = research;
    // evidence requests
    if (ph === "fieldwork") {
      for (const [u, reqs] of Object.entries(game.requests || {})) {
        for (const [id, rq] of Object.entries(reqs || {})) {
          if (game.secrets?.[u]?.clues?.[id] || processing.has(id)) continue;
          processing.add(id);
          const clue = answerClue(u, rq, tokens[u]);
          if (clue.ok) tokens[u] -= CLUES[rq.type].cost;
          upd[`secrets/${u}/clues/${id}`] = clue;
        }
      }
    }
    if (Object.keys(upd).length) await db.update(`games/${code}`, upd);
    // everyone voted → close vote early
    if (ph === "vote") {
      const r = st().round, alive = activeUids();
      if (alive.length && alive.every(u => game.votes?.[u]?.[r] != null)) advance();
    }
  }
}

// ---------- test bots (simulated students, run by this host page) ----------
const isBot = u => String(u).startsWith("bot_");
const botJobs = new Set();
function runBots() {
  const s = st(), ph = s.phase, r = s.round;
  for (const b of allUids().filter(isBot)) {
    const key = `${ph}:${r}:${b}`;
    if (botJobs.has(key)) continue;
    if (ph === "fieldwork" && arr(game.secrets?.[b]?.qs?.[r]).length) {
      botJobs.add(key); setTimeout(() => botFieldwork(b, r), 2000 + Math.random() * 8000);
    } else if (ph === "vote" && profiles()[b]?.alive !== false) {
      botJobs.add(key); setTimeout(() => botVote(b, r), 1500 + Math.random() * 6000);
    }
  }
}
async function botFieldwork(b, r) {
  if (!game || st().phase !== "fieldwork" || st().round !== r) return;
  const upd = {};
  for (const qid of arr(game.secrets?.[b]?.qs?.[r])) {
    const q = QMAP[qid];
    if (!q || game.answers?.[b]?.[r]?.[qid] != null) continue;
    upd[`answers/${b}/${r}/${qid}`] = Math.random() < 0.7 ? q.a : (q.a + 1 + Math.floor(Math.random() * (q.o.length - 1))) % q.o.length;
  }
  if (roleOf(b) === "innovator" && profiles()[b]?.alive !== false) {
    const pr = normProfiles(), known = hidden().adopted || {};
    const cands = G.shuffle(activeUids().filter(u => u !== b && !known[u] && roleOf(u) !== "innovator"));
    cands.sort((x, y) => G.spreadChance(pr[b], pr[y]) - G.spreadChance(pr[b], pr[x]));
    upd[`actions/${b}/${r}`] = { targets: cands.slice(0, S().targetsPerInnovator), media: r === 2 };
  }
  if (Object.keys(upd).length) await db.update(`games/${code}`, upd);
}
async function botVote(b, r) {
  if (!game || st().phase !== "vote" || st().round !== r || game.votes?.[b]?.[r] != null) return;
  const opts = activeUids().filter(u => u !== b && !(roleOf(b) === "innovator" && roleOf(u) === "innovator"));
  const v = !opts.length || Math.random() < 0.2 ? "skip" : G.pick(opts);
  await db.set(`games/${code}/votes/${b}/${r}`, v);
}
async function addBots(n) {
  const used = new Set(Object.values(players()).map(p => p.color));
  let k = Object.keys(players()).filter(isBot).length;
  const upd = {};
  for (let i = 0; i < n; i++) {
    const id = "bot_" + Math.random().toString(36).slice(2, 9);
    const color = G.COLORS.find(c => !used.has(c)) || G.pick(G.COLORS); used.add(color);
    upd[`players/${id}`] = { name: `Bot ${++k}`, color, joinedAt: db.now(), bot: true };
  }
  await db.update(`games/${code}`, upd);
}
async function removeBots() {
  const upd = {};
  for (const u of Object.keys(players()).filter(isBot)) upd[`players/${u}`] = null;
  if (Object.keys(upd).length) await db.update(`games/${code}`, upd);
}

function answerClue(u, rq, have) {
  const c = CLUES[rq.type];
  const round = st().round;
  const base = { type: rq.type, target: rq.target || null, round, at: db.now() };
  if (!c) return { ...base, ok: false, result: "Unknown request." };
  if (have < c.cost) return { ...base, ok: false, result: `Not enough tokens (needs ${c.cost}).` };
  const adopted = hidden().adopted || {};
  const active = activeUids();
  const pr = normProfiles();
  if (rq.type === "recording") {
    if (!pr[rq.target]) return { ...base, ok: false, result: "Speaker not found." };
    const uses = !!adopted[rq.target];
    return { ...base, ok: true, result: `${nameOf(rq.target)} ${uses ? "USES the new variant." : "does NOT use the new variant (yet)."}` };
  }
  if (rq.type === "network" || rq.type === "apparent") {
    const bd = G.breakdown(adopted, active, pr, rq.type === "network" ? "group" : "age");
    const lines = Object.entries(bd).map(([k, v]) => `${rq.type === "network" ? groupLabel(k) : k}: ${v.pct}% (${v.users}/${v.n})`);
    return { ...base, ok: true, result: lines.join("\n") };
  }
  if (rq.type === "interview") {
    if (round <= 1) return { ...base, ok: false, result: "No interview data before round 2." };
    if (!pr[rq.target]) return { ...base, ok: false, result: "Speaker not found." };
    const talked = !!hidden().outside?.[round - 1]?.[rq.target];
    return { ...base, ok: true, result: `Last round (R${round - 1}), ${nameOf(rq.target)} ${talked ? "DID pass the variant on to someone OUTSIDE their network." : "did NOT talk to anyone outside their network about it."}` };
  }
  return { ...base, ok: false, result: "?" };
}

// ---------- phase control ----------
function tick() {
  if (!game) return;
  const s = st();
  const left = (s.endsAt || 0) - db.now();
  const el = $("#htimer");
  if (el) { el.textContent = s.endsAt ? fmtTime(left) : ""; el.classList.toggle("low", s.endsAt && left < 15000); }
  if (["fieldwork", "meeting", "vote"].includes(s.phase) && s.endsAt && left <= 0 && !busy) advance();
}

async function advance() {
  if (busy) return; busy = true;
  try {
    const ph = st().phase;
    if (ph === "roles") await startRound();
    else if (ph === "fieldwork") await endFieldwork();
    else if (ph === "meeting") await db.update(`games/${code}/state`, { phase: "vote", endsAt: db.now() + S().voteSec * 1000 });
    else if (ph === "vote") await endVote();
    else if (ph === "reveal") {
      if (st().round >= S().maxRounds) await endGame("innovators", `After ${S().maxRounds} rounds the Innovators were still in the community: the new variant is here to stay.`);
      else await startRound();
    }
  } finally { busy = false; }
}

async function startGame() {
  const uids = Object.keys(players());
  if (uids.length < 4) return alert("You need at least 4 players.");
  const s = S();
  const { profiles: pr, roles } = G.assignRoles(uids, s);
  const inns = uids.filter(u => roles[u] === "innovator");
  const upd = {};
  for (const u of uids) {
    upd[`profiles/${u}`] = { ...pr[u], alive: true };
    upd[`secrets/${u}`] = { role: roles[u], tokens: 0, team: roles[u] === "innovator" ? Object.fromEntries(inns.map(x => [x, true])) : null };
  }
  const adopted = Object.fromEntries(inns.map(u => [u, { round: 0, via: "start" }]));
  const pct = G.adoptionPct(adopted, uids);
  upd.hidden = { roles, adopted, mediaUsed: false };
  upd.state = { phase: "roles", round: 0, pct, pctHistory: [pct], research: 0, researchTarget: uids.length * s.researchPerPlayer, nInnovators: inns.length };
  await db.update(`games/${code}`, upd);
}

async function startRound() {
  const s = S(), round = (st().round || 0) + 1;
  const upd = {};
  const pool = QUESTIONS.map(q => q.id);
  for (const u of allUids()) {
    const seen = new Set(Object.values(game.secrets?.[u]?.qs || {}).flatMap(arr));
    let fresh = G.shuffle(pool.filter(id => !seen.has(id)));
    if (fresh.length < 3) fresh = G.shuffle(pool);
    upd[`secrets/${u}/qs/${round}`] = fresh.slice(0, 3);
    if (roleOf(u) === "innovator") {
      upd[`secrets/${u}/known`] = Object.fromEntries(Object.keys(hidden().adopted || {}).map(k => [k, true]));
      upd[`secrets/${u}/mediaUsed`] = !!hidden().mediaUsed;
    }
  }
  Object.assign(upd, { "state/phase": "fieldwork", "state/round": round, "state/endsAt": db.now() + s.fieldworkSec * 1000, "state/tally": null, "state/ejected": null, "state/media": false, "state/gain": null });
  await db.update(`games/${code}`, upd);
}

async function endFieldwork() {
  const s = S(), round = st().round;
  const { research } = scores();
  if (research >= (st().researchTarget || Infinity)) {
    return endGame("sociolinguists", "The Sociolinguists completed their research and documented the change before it spread through the community.", { "state/research": research });
  }
  const active = activeUids();
  const roles = hidden().roles || {};
  const actions = {};
  let wantMedia = false;
  for (const u of active) {
    if (roles[u] !== "innovator") continue;
    const a = game.actions?.[u]?.[round];
    if (!a) continue;
    actions[u] = { targets: arr(a.targets).slice(0, s.targetsPerInnovator) };
    if (a.media) wantMedia = true;
  }
  const mediaRound = wantMedia && !hidden().mediaUsed;
  const res = G.resolveSpread({ profiles: normProfiles(), roles, adopted: hidden().adopted || {}, actions, active, round, mediaRound });
  const pct = G.adoptionPct(res.adopted, active);
  const hist = arr(st().pctHistory); hist[round] = pct;
  const upd = {
    "hidden/adopted": res.adopted,
    [`hidden/outside/${round}`]: res.outsideTalk,
    [`hidden/events/${round}`]: res.events,
    "state/pct": pct, "state/pctHistory": hist, "state/gain": pct - (st().pct || 0), "state/media": mediaRound,
  };
  if (mediaRound) upd["hidden/mediaUsed"] = true;
  if (pct >= s.tipping) {
    return endGame("innovators", `The new variant reached ${pct}% of the community: the change is complete!`, upd);
  }
  Object.assign(upd, { "state/phase": "meeting", "state/endsAt": db.now() + s.meetingSec * 1000 });
  await db.update(`games/${code}`, upd);
}

async function endVote() {
  const round = st().round, alive = activeUids();
  const tally = {};
  for (const u of alive) {
    const v = game.votes?.[u]?.[round];
    if (v == null) continue;
    if (v !== "skip" && !alive.includes(v)) continue;
    tally[v] = (tally[v] || 0) + 1;
  }
  const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  let ejected = null;
  if (sorted.length && sorted[0][0] !== "skip" && (sorted.length === 1 || sorted[0][1] > sorted[1][1])) ejected = sorted[0][0];
  const upd = { "state/phase": "reveal", "state/endsAt": null, "state/tally": tally };
  const roles = hidden().roles || {};
  if (ejected) {
    upd[`profiles/${ejected}/alive`] = false;
    upd["state/ejected"] = { uid: ejected, role: S().revealOnEject ? roles[ejected] : "hidden" };
  } else upd["state/ejected"] = { uid: "none" };
  const stillAlive = alive.filter(u => u !== ejected);
  const innAlive = stillAlive.filter(u => roles[u] === "innovator").length;
  const socAlive = stillAlive.length - innAlive;
  if (innAlive === 0) return endGame("sociolinguists", "All Innovators were identified! The Sociolinguists traced the change back to its source.", upd);
  if (innAlive >= socAlive) return endGame("innovators", "The Innovators now equal the Sociolinguists: nobody can stop the change.", upd);
  await db.update(`games/${code}`, upd);
}

async function endGame(winner, reason, extra = {}) {
  const h = { ...hidden() };
  // merge pending hidden updates from extra
  for (const [k, v] of Object.entries(extra)) {
    if (k === "hidden/adopted") h.adopted = v;
    if (k.startsWith("hidden/events/")) h.events = { ...(h.events || {}), [k.split("/")[2]]: v };
    if (k.startsWith("hidden/outside/")) h.outside = { ...(h.outside || {}), [k.split("/")[2]]: v };
  }
  const hist = extra["state/pctHistory"] || st().pctHistory;
  const upd = {
    ...extra,
    debrief: { roles: h.roles || {}, adopted: h.adopted || {}, events: h.events || {}, pctHistory: hist || [] },
    "state/phase": "over", "state/winner": winner, "state/reason": reason, "state/endsAt": null,
  };
  await db.update(`games/${code}`, upd);
}

// ---------- rendering ----------
function render() {
  if (!code) return;
  if (!game) { $("#app").innerHTML = `<div class="landing"><h2>Game ${esc(code)} not found.</h2><button class="btn" onclick="location.reload()">Back</button></div>`; return; }
  const s = st();
  if (s.phase === "lobby") return renderLobby();
  const ph = s.phase;
  const ej = s.ejected;
  $("#app").innerHTML = `
  <div class="host">
    <div class="hbar">
      <span class="title">The Innovators</span>
      <span class="pill">Room <b>${esc(code)}</b></span>
      ${s.round ? `<span class="pill">Round ${s.round} / ${S().maxRounds}</span>` : ""}
      <span class="phase">${esc(G.PHASE_LABEL[ph] || ph)}</span>
      <span class="htimer" id="htimer"></span>
    </div>
    <div class="hgrid">
      <div class="stack">${communityMap(ph === "over")}${ph === "over" ? debriefExtra() : ""}</div>
      <div class="stack">
        ${ph === "over" ? winnerBox() : ""}
        <div class="card stack">
          <div class="row spread"><b>🗣️ Change meter</b><span>${s.pct ?? 0}% use the new variant</span></div>
          <div class="meter"><i style="width:${s.pct ?? 0}%"></i><span class="mark" style="left:${S().tipping}%"></span></div>
          <div class="small muted">Innovators win if it reaches ${S().tipping}% (the change is complete).</div>
          <div class="row spread"><b>📚 Research</b><span>${s.research ?? 0} / ${s.researchTarget ?? "?"}</span></div>
          <div class="meter research"><i style="width:${Math.min(100, 100 * (s.research || 0) / (s.researchTarget || 1))}%"></i></div>
          <div class="small muted">Sociolinguists win if research is complete, or if they vote out every Innovator.</div>
        </div>
        ${phaseBox(ph, s, ej)}
        ${ph !== "over" ? controls(ph) : `<div class="row"><button class="btn ghost" id="newgame">New game</button></div>`}
      </div>
    </div>
  </div>`;
  tick();
  const b = $("#next"); if (b) b.onclick = () => advance();
  const p = $("#plus"); if (p) p.onclick = () => db.update(`games/${code}/state`, { endsAt: (st().endsAt || db.now()) + 30000 });
  const e = $("#end"); if (e) e.onclick = () => { if (confirm("End the game now and show the debrief?")) endGame("none", "The teacher ended the game early."); };
  const n = $("#newgame"); if (n) n.onclick = () => { localStorage.removeItem("innov-host-code"); location.reload(); };
}

function controls(ph) {
  const label = { roles: "Start round 1 ▸", fieldwork: "End fieldwork now ▸", meeting: "Start the vote ▸", vote: "Close the vote ▸", reveal: st().round >= S().maxRounds ? "Finish game ▸" : `Start round ${st().round + 1} ▸` }[ph];
  return `<div class="row">
    <button class="btn" id="next">${label}</button>
    ${["fieldwork", "meeting", "vote"].includes(ph) ? `<button class="btn ghost" id="plus">+30 s</button>` : ""}
    <button class="btn ghost sm" id="end" style="margin-left:auto">End game</button>
  </div>`;
}

function phaseBox(ph, s, ej) {
  const tip = TIPS[(s.round || 0) % TIPS.length];
  if (ph === "roles") return `<div class="card stack"><div class="big-msg">Check your phone, secretly.</div>
    <p>Most of you are <b style="color:var(--teal)">Sociolinguists</b> studying this community. But <b style="color:var(--violet)">${s.nInnovators} Innovators</b> are hiding among you. They are spreading a new pronunciation through the community.</p>
    <p class="muted">Look at the map: everyone belongs to a network group and an age group. People marked ↔ are link-persons with ties to a second group.</p></div>`;
  if (ph === "fieldwork") {
    const r = s.round;
    const answered = allUids().filter(u => Object.keys(game.answers?.[u]?.[r] || {}).length >= 3).length;
    return `<div class="card stack"><div class="big-msg">Fieldwork time!</div>
      <p>📱 Answer your 3 fieldwork tasks to earn research tokens. Spend tokens on evidence.</p>
      <p>🤫 Innovators: choose who to talk to on your phone.</p>
      <p class="muted">${answered} / ${allUids().length} players finished their tasks.</p></div>
      <div class="tip">${tip}</div>`;
  }
  if (ph === "meeting") return `<div class="card stack">
      <div class="big-msg">The new variant is now used by <span style="color:#e879f9">${s.pct}%</span> of the community${s.gain ? ` (+${s.gain}% this round)` : ""}.</div>
      ${s.media ? `<p class="pill violet">📺 Media hype this round! The variant was heard on TV.</p>` : ""}
      <p><b>Discuss:</b> Where did the change start? Share your evidence, but remember that Innovators can lie about theirs!</p></div>
      <div class="tip">${tip}</div>`;
  if (ph === "vote") {
    const r = s.round, alive = activeUids();
    const n = alive.filter(u => game.votes?.[u]?.[r] != null).length;
    return `<div class="card stack"><div class="big-msg">Vote on your phone</div><p>Who is an Innovator? You can also skip.</p><p class="muted">${n} / ${alive.length} votes in</p></div>`;
  }
  if (ph === "reveal") {
    const tally = s.tally || {};
    const max = Math.max(1, ...Object.values(tally));
    const rows = Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([u, n]) =>
      `<div class="t"><span>${u === "skip" ? "Skipped" : esc(nameOf(u))}</span><div class="bar" style="width:${100 * n / max}%"></div><b>${n}</b></div>`).join("") || `<p class="muted">No votes.</p>`;
    let msg;
    if (!ej || ej.uid === "none") msg = "Nobody was voted out (tie or skip).";
    else if (ej.role === "hidden") msg = `<b>${esc(nameOf(ej.uid))}</b> was voted out.`;
    else msg = `<b>${esc(nameOf(ej.uid))}</b> was voted out, and was ${ej.role === "innovator" ? '<span style="color:var(--violet)">an INNOVATOR!</span>' : '<span style="color:var(--teal)">NOT an Innovator.</span>'}`;
    return `<div class="card stack"><div class="big-msg">${msg}</div><div class="tally">${rows}</div></div>`;
  }
  return "";
}

function communityMap(showSecrets) {
  const pr = profiles();
  const d = game.debrief || {};
  const cols = GROUP_KEYS.map(g => {
    const members = Object.keys(pr).filter(u => pr[u].group === g);
    const list = members.map(u => {
      const p = pr[u], out = p.alive === false;
      const inn = showSecrets && d.roles?.[u] === "innovator";
      const uses = showSecrets && d.adopted?.[u];
      return `<div class="member${out ? " out" : ""}">${avatar(P(u), { out, dot: !!uses })}
        <div style="min-width:0"><div class="nm">${esc(nameOf(u))}</div>
        <div class="ag">${esc(p.age)} ${p.link ? `<span class="linkbadge">↔ ${esc(GROUPS[p.link].name)}</span>` : ""}${inn ? ' <span class="pill violet" style="padding:0 6px;font-size:.68rem">INNOVATOR</span>' : ""}</div></div></div>`;
    }).join("");
    return `<div class="region"><h3>${GROUPS[g].icon} ${GROUPS[g].name}</h3><div class="kn">${GROUPS[g].closeKnit ? "Close-knit network" : "Loose-knit network"}</div>${list}</div>`;
  }).join("");
  return `<div class="map">${cols}</div>${showSecrets ? `<p class="small muted">● amber dot = uses the new variant at the end</p>` : ""}`;
}

function winnerBox() {
  const s = st();
  const w = s.winner;
  const cls = w === "innovators" ? "inn" : w === "sociolinguists" ? "soc" : "";
  const title = w === "innovators" ? "Innovators win!" : w === "sociolinguists" ? "Sociolinguists win!" : "Game ended";
  return `<div class="winner ${cls}"><div class="big-msg">${title}</div><p>${esc(s.reason || "")}</p></div>`;
}

function debriefExtra() {
  const d = game.debrief || {};
  const pr = normProfiles();
  const all = Object.keys(pr);
  const adopted = d.adopted || {};
  const hist = arr(d.pctHistory);
  const events = Object.entries(d.events || {}).sort((a, b) => a[0] - b[0]).flatMap(([r, ev]) => arr(ev).map(e => ({ ...e, round: r })));
  const viaLabel = { innovator: "from an Innovator", wave: "within the network (wave)", link: "across networks via a link-person", media: "media + contact" };
  const flow = events.map(e => `<div>R${e.round}: ${e.from ? esc(nameOf(e.from)) : "📺"} → <b>${esc(nameOf(e.to))}</b> <span class="via">${viaLabel[e.via] || e.via}</span></div>`).join("") || `<div class="muted">No one adopted the variant.</div>`;
  const byGroup = G.breakdown(adopted, all, pr, "group");
  const byAge = G.breakdown(adopted, all, pr, "age");
  const crossings = events.filter(e => e.from && pr[e.from] && pr[e.to] && pr[e.from].group !== pr[e.to].group).length;
  const t = (bd, lab) => `<table class="bd"><tr><th>${lab}</th><th>Users</th><th>%</th></tr>${Object.entries(bd).map(([k, v]) => `<tr><td>${lab === "Network" ? groupLabel(k) : k}</td><td>${v.users}/${v.n}</td><td>${v.pct}%</td></tr>`).join("")}</table>`;
  return `
  <div class="card stack"><h3>How the change spread</h3>${curveSVG(hist, S().tipping)}
    <p class="small muted">Compare with the S-curve: slow start, fast middle, slow finish. ${crossings} transmissions crossed from one network group into another through link-persons.</p></div>
  <div class="row" style="align-items:flex-start">
    <div class="card" style="flex:1;min-width:240px">${t(byGroup, "Network")}</div>
    <div class="card" style="flex:1;min-width:240px">${t(byAge, "Age group")}</div>
  </div>
  <div class="card stack"><h3>Who passed it to whom</h3><div class="flow">${flow}</div></div>
  <div class="card stack"><h3>Debrief questions (Chapter 9)</h3><ol>
    <li>Look at the curve. Was the change slow, fast, then slow again? Where was it steepest, and why?</li>
    <li>Which network group did the change start in? Which group resisted longest? How do close-knit vs loose-knit networks explain this?</li>
    <li>Who acted as a bridge between groups? Compare them with Sam, the Norwich link-person who brought London forms home.</li>
    <li>Most adopters never noticed they had picked up the variant. Is this a change from above or from below? Why?</li>
    <li>Was the apparent-time (age) survey useful here? What would a real-time study need, and why is it more reliable?</li>
    <li>Did the media hype matter much? What does the chapter conclude about TV vs face-to-face interaction?</li>
  </ol></div>`;
}

function renderLobby() {
  const s = S();
  const url = new URL(`play.html?code=${code}`, location.href).href;
  const ps = players();
  const chips = Object.entries(ps).map(([u, p]) => `<span class="chip">${avatar(p)}${p.bot ? "🤖 " : ""}${esc(p.name)}<button title="Remove" data-kick="${u}">✕</button></span>`).join("") || `<span class="muted">No players yet…</span>`;
  const n = Object.keys(ps).length;
  const field = (k, label, min, max, step = 1) => `<div><label>${label}</label><input type="number" data-set="${k}" value="${s[k]}" min="${min}" max="${max}" step="${step}"></div>`;
  $("#app").innerHTML = `
  <div class="host">
    <div class="hbar"><span class="title">The Innovators</span><span class="pill">Chapter 9 · Language change</span></div>
    <div class="card joinbox">
      <div id="qr"></div>
      <div class="stack">
        <div class="muted">Join on your phone at</div>
        <div style="font-size:1.2rem;word-break:break-all"><b>${esc(url)}</b></div>
        <div class="muted">Room code</div>
        <div class="joincode">${esc(code)}</div>
      </div>
    </div>
    <div class="card stack"><div class="row spread"><h3>Players (${n})</h3>
      <div class="row">
        <button class="btn ghost sm" id="bots" title="Simulated students for testing">🤖 Add 5 test bots</button>
        ${Object.keys(ps).some(isBot) ? `<button class="btn ghost sm" id="nobots">Remove bots</button>` : ""}
        <button class="btn" id="start" ${n < 4 ? "disabled" : ""}>Start game ▸</button></div></div>
      <div class="chips">${chips}</div></div>
    <details class="card" id="setbox" ${settingsOpen ? "open" : ""}><summary><b>Settings</b> <span class="muted small">(defaults suit about 20 students / 60 to 80 minutes)</span></summary>
      <div class="settings" style="margin-top:12px">
        ${field("innovators", "Innovators", 1, 5)}
        ${field("fieldworkSec", "Fieldwork (sec)", 30, 600, 10)}
        ${field("meetingSec", "Meeting (sec)", 30, 600, 10)}
        ${field("voteSec", "Vote (sec)", 15, 300, 5)}
        ${field("maxRounds", "Max rounds", 2, 10)}
        ${field("tipping", "Change complete at (%)", 40, 95, 5)}
        ${field("researchPerPlayer", "Research target per player", 2, 20)}
        <div><label>Reveal role when voted out</label><select data-set="revealOnEject"><option value="true" ${s.revealOnEject ? "selected" : ""}>Yes</option><option value="false" ${!s.revealOnEject ? "selected" : ""}>No</option></select></div>
      </div>
      <p class="small muted">The game automatically uses about 1 Innovator per 6 players (never more than the number above).</p>
    </details>
  </div>`;
  try { if (window.QRCode) new QRCode($("#qr"), { text: url, width: 180, height: 180 }); else $("#qr").style.display = "none"; } catch { $("#qr").style.display = "none"; }
  $("#bots").onclick = () => addBots(5);
  const nb = $("#nobots"); if (nb) nb.onclick = removeBots;
  $("#setbox").ontoggle = () => { settingsOpen = $("#setbox").open; };
  $("#start").onclick = () => { if (!busy) { busy = true; startGame().finally(() => busy = false); } };
  document.querySelectorAll("[data-kick]").forEach(b => b.onclick = () => db.remove(`games/${code}/players/${b.dataset.kick}`));
  document.querySelectorAll("[data-set]").forEach(i => i.onchange = () => {
    const k = i.dataset.set; const v = k === "revealOnEject" ? i.value === "true" : Number(i.value);
    db.update(`games/${code}/settings`, { [k]: v });
  });
}
