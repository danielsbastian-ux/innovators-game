import { initDB, DEMO, arr } from "./db.js";
import * as G from "./game.js";
import { QUESTIONS, CLUES } from "./questions.js";
import { $, avatar, fmtTime, groupLabel, demoBanner } from "./ui.js";
import { VARIANTS, PROMPTS, ISSUES } from "./roleplay.js";
import * as M from "./map.js";

const { esc, GROUPS } = G;
const QMAP = Object.fromEntries(QUESTIONS.map(q => [q.id, q]));
const params = new URLSearchParams(location.search);
let code = (params.get("code") || "").toUpperCase().trim();
let db, uid;
const D = { host: undefined, settings: {}, state: {}, players: {}, profiles: {}, secret: {}, answers: {}, debrief: null };
const ui = { tab: "map", act: null, unlocked: new Set(), seenTalk: null, lastMsg: 0, roleShown: false, clueType: "recording", clueTarget: "", sel: null, joining: false };
const subs = [];

(async function main() {
  db = await initDB();
  uid = db.uid;
  demoBanner(DEMO);
  if (!code) return renderCode();
  connect();
  setInterval(tickTimer, 500);
})();

function renderCode() {
  $("#app").innerHTML = `<div class="phone"><div style="height:30px"></div><div class="card stack">
    <h2>Join a game</h2><label>Room code</label><input id="c" maxlength="4" autocapitalize="characters" placeholder="ABCD">
    <button class="btn block" id="go">Continue</button></div></div>`;
  $("#go").onclick = () => { const c = $("#c").value.toUpperCase().trim(); if (c.length === 4) location.search = "?code=" + c; };
}

function connect() {
  const base = `games/${code}`;
  const on = (p, k) => subs.push(db.on(`${base}/${p}`, v => { D[k] = v ?? (k === "host" ? null : {}); render(); }));
  on("host", "host"); on("settings", "settings"); on("state", "state"); on("players", "players"); on("profiles", "profiles");
  on(`secrets/${uid}`, "secret"); on(`answers/${uid}`, "answers"); on("debrief", "debrief");
  subs.push(db.on(`pos/${code}`, v => { posData = v || {}; }));
  requestAnimationFrame(loop);
  setInterval(slowTick, 300);
}

// ================= movement on the island map =================
let posData = {};
const mv = { x: 0, y: 0, round: -1, dest: null, sent: { x: -1, y: -1, t: 0 }, keys: {} };
const others = {};
let lastT = performance.now(), pmap = null, pjoy = null, joyVec = { x: 0, y: 0 };

function mapCanvas() {
  if (pmap) return pmap;
  pmap = document.createElement("canvas");
  pmap.style.cssText = "width:100%;height:300px;display:block;border-radius:16px;touch-action:none";
  pmap.addEventListener("pointerdown", e => {
    const r = pmap.getBoundingClientRect(), sc = camScale();
    mv.dest = { x: mv.x + (e.clientX - r.left - r.width / 2) / sc, y: mv.y + (e.clientY - r.top - r.height / 2) / sc };
  });
  return pmap;
}
function joystick() {
  if (pjoy) return pjoy;
  pjoy = document.createElement("div");
  pjoy.className = "joywrap";
  pjoy.innerHTML = `<div class="joy"><div class="knob"></div></div><div class="small muted">Drag the circle to walk, or tap the map.<br>On a laptop: arrow keys / WASD.</div>`;
  const pad = pjoy.querySelector(".joy"), knob = pjoy.querySelector(".knob");
  let active = false;
  const set = e => {
    const r = pad.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy), max = r.width / 2 - 18;
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    joyVec = { x: dx / max, y: dy / max }; mv.dest = null;
  };
  pad.addEventListener("pointerdown", e => { active = true; pad.setPointerCapture(e.pointerId); set(e); });
  pad.addEventListener("pointermove", e => { if (active) set(e); });
  const end = () => { active = false; joyVec = { x: 0, y: 0 }; knob.style.transform = ""; };
  pad.addEventListener("pointerup", end); pad.addEventListener("pointercancel", end);
  return pjoy;
}
window.addEventListener("keydown", e => { if (/^(Arrow|[wasd]$)/i.test(e.key) && !/INPUT|SELECT/.test(document.activeElement?.tagName)) { mv.keys[e.key.toLowerCase()] = true; mv.dest = null; e.preventDefault(); } });
window.addEventListener("keyup", e => { mv.keys[e.key.toLowerCase()] = false; });

const camScale = () => (pmap?.clientWidth || 360) / 560;
const canMove = () => D.state?.phase === "fieldwork" && alive() && me();

function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
  const r = D.state?.round;
  if (canMove() && mv.round !== r && posData[uid]) { mv.x = posData[uid].x; mv.y = posData[uid].y; mv.round = r; mv.dest = null; }
  if (canMove() && mv.round === r) {
    let vx = joyVec.x, vy = joyVec.y;
    const k = mv.keys;
    if (k.arrowleft || k.a) vx = -1; if (k.arrowright || k.d) vx = 1; if (k.arrowup || k.w) vy = -1; if (k.arrowdown || k.s) vy = 1;
    if (!vx && !vy && mv.dest) {
      const d = M.dist(mv, mv.dest);
      if (d < 4) mv.dest = null; else { vx = (mv.dest.x - mv.x) / d; vy = (mv.dest.y - mv.y) / d; }
    }
    const len = Math.hypot(vx, vy); if (len > 1) { vx /= len; vy /= len; }
    [mv.x, mv.y] = M.clamp(mv.x + vx * M.SPEED * dt, mv.y + vy * M.SPEED * dt);
    const now = Date.now();
    if (now - mv.sent.t > 250 && (Math.abs(mv.x - mv.sent.x) > 2 || Math.abs(mv.y - mv.sent.y) > 2)) {
      mv.sent = { x: mv.x, y: mv.y, t: now };
      db.set(`pos/${code}/${uid}`, { x: Math.round(mv.x), y: Math.round(mv.y) });
    }
  }
  draw();
}

function nearbyPeople() {
  return activeUids().filter(u => u !== uid && posData[u] && others[u] && M.dist(mv, others[u]) <= M.TALK_RANGE);
}

function draw() {
  const c = pmap; if (!c || !c.isConnected || mv.round !== D.state?.round) return;
  const w = c.clientWidth, h = c.clientHeight, dpr = window.devicePixelRatio || 1;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const ctx = c.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const near = new Set(nearbyPeople());
  const people = activeUids().filter(u => posData[u]).map(u => {
    if (u === uid) return { id: u, x: mv.x, y: mv.y, name: nameOf(u), color: D.players[u]?.color };
    others[u] = others[u] || { x: posData[u].x, y: posData[u].y }; M.lerpTo(others[u], posData[u], 0.2);
    return { id: u, x: others[u].x, y: others[u].y, name: nameOf(u), color: D.players[u]?.color || "#888", near: near.has(u) };
  });
  M.drawMap(ctx, w, h, { cx: mv.x, cy: mv.y, scale: camScale() }, { people, meId: uid, highlight: myStations() });
}

function myStations() {
  const r = D.state?.round, qs = arr(D.secret?.qs?.[r]);
  return M.taskStations(uid, r).map((st, i) => ({ id: st.id, n: i + 1, done: D.answers?.[r]?.[qs[i]] != null }));
}

// every 300 ms: unlock tasks at stations, refresh the nearby list, show chat alerts
function slowTick() {
  if (D.state?.phase !== "fieldwork" || !me()) return;
  const r = D.state.round, qs = arr(D.secret?.qs?.[r]);
  if (canMove() && mv.round === r) {
    M.taskStations(uid, r).forEach((st, i) => {
      const key = r + ":" + qs[i];
      if (qs[i] && !ui.unlocked.has(key) && M.dist(mv, st) <= M.STATION_RANGE) {
        ui.unlocked.add(key); toast(`📍 Task ${i + 1} unlocked at ${st.name}! Open 📝 Tasks.`);
        if (ui.tab === "tasks") render();
      }
    });
  }
  const box = document.getElementById("nearby");
  if (box) {
    const mine = arr(D.secret?.talkIds?.[r]);
    const asked = ui.act?.talk || [];
    const list = nearbyPeople();
    const html = list.length ? list.map(u => {
      const done = mine.includes(u), wait = asked.includes(u) && !done;
      return `<div class="prow">${avatar(D.players[u])}<span class="grow"><b>${esc(nameOf(u))}</b><div class="meta">${esc(D.profiles[u]?.job || "")} · ${groupLabel(D.profiles[u]?.group)}</div></span>
        ${done ? `<span class="pill teal">Chatted ✓</span>` : `<button class="btn sm" data-talk="${u}" ${mine.length >= 2 || wait ? "disabled" : ""}>${wait ? "…" : "💬 Talk"}</button>`}</div>`;
    }).join("") : `<div class="small muted">Nobody close by. Walk up to someone to talk.</div>`;
    if (box.dataset.html !== html) { box.dataset.html = html; box.innerHTML = html; }
  }
  // chat alerts
  const ids = arr(D.secret?.talkIds?.[r]);
  if (!ui.seenTalk || ui.seenTalk.round !== r) ui.seenTalk = { round: r, ids: ids.slice() };
  for (const u of ids) if (!ui.seenTalk.ids.includes(u)) {
    ui.seenTalk.ids.push(u);
    toast(`💬 Chat with <b>${esc(nameOf(u))}</b>! Find them in the room and talk in character for about a minute.${role() === "innovator" ? " Use the variant!" : ""}`, 7000);
    try { navigator.vibrate?.([120, 60, 120]); } catch {}
  }
  const m = D.secret?.talkMsg;
  if (m && m.at !== ui.lastMsg) { if (ui.lastMsg) toast(esc(m.text)); ui.lastMsg = m.at; }
}

function toast(html, ms = 4000) {
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
  t.innerHTML = html; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), ms);
}

document.addEventListener("click", e => {
  const b = e.target.closest?.("[data-talk]"); if (!b || b.disabled) return;
  const r = D.state.round; ensureAct(r);
  if (!ui.act.talk.includes(b.dataset.talk)) ui.act.talk.push(b.dataset.talk);
  b.disabled = true; b.textContent = "…"; saveActions();
});

const S = () => ({ ...G.DEFAULT_SETTINGS, ...(D.settings || {}) });
const me = () => D.players?.[uid];
const myProfile = () => D.profiles?.[uid];
const nameOf = u => D.players?.[u]?.name || "?";
const role = () => D.secret?.role;
const alive = () => myProfile()?.alive !== false;
const activeUids = () => Object.keys(D.profiles || {}).filter(u => D.profiles[u].alive !== false);

// deterministic option order per player & question
function order(qid, n) { let h = 0; for (const ch of uid + qid) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return G.shuffle([...Array(n).keys()], G.rng(h)); }

function tickTimer() {
  const el = $("#ptimer"); if (!el) return;
  const e = D.state?.endsAt; if (!e) { el.textContent = ""; return; }
  const left = e - db.now(); el.textContent = fmtTime(left); el.classList.toggle("low", left < 15000);
}

// ---------- render ----------
function render() {
  const a = document.activeElement;
  if (a && a.classList && a.classList.contains("keep")) { ui.pending = true; return; }
  ui.pending = false;
  if (D.host === undefined) { $("#app").innerHTML = `<div class="phone"><p class="muted center" style="margin-top:40px">Connecting…</p></div>`; return; }
  if (D.host === null) { $("#app").innerHTML = `<div class="phone"><div style="height:30px"></div><div class="card stack"><h2>Room ${esc(code)} not found</h2><p class="muted">Check the code on the projector.</p><a class="btn block" href="play.html" style="text-align:center;text-decoration:none">Try another code</a></div></div>`; return; }
  const ph = D.state?.phase || "lobby";
  if (ui.lastPhase !== ph) { if (ui.lastPhase === "roles") ui.roleShown = false; if (ph === "fieldwork") ui.tab = alive() ? "map" : "tasks"; ui.lastPhase = ph; }
  if (!me()) {
    if (ph !== "lobby") { $("#app").innerHTML = `<div class="phone"><div style="height:30px"></div><div class="card"><h2>This game has already started</h2><p class="muted">Ask your teacher to start a new game.</p></div></div>`; return; }
    if ($("#nm")) return; // keep what the student is typing
    return renderJoin();
  }
  const top = `<div class="ptop">${avatar(me())}<div class="grow"><div class="name">${esc(me().name)}</div>
      <div class="small muted">${esc(G.PHASE_LABEL[ph] || ph)}${D.state.round ? ` · Round ${D.state.round}` : ""}</div></div>
      ${role() && ph !== "lobby" ? `<span class="tokens" title="Research tokens">🪙 ${D.secret.tokens ?? 0}</span>` : ""}
      <span class="timer" id="ptimer"></span></div>`;
  let body = "";
  if (ph === "lobby") body = `<div class="card center stack">${avatar(me(), { lg: true })}<h2>You're in!</h2><p class="muted">Wait for your teacher to start the game. Keep your screen private once roles are given out.</p></div>${howTo()}`;
  else if (ph === "over") body = renderOver();
  else {
    body = (!alive() ? `<div class="note" style="margin-bottom:12px">You were voted out. You can still do fieldwork tasks to learn, but you can't vote${role() === "innovator" ? " or spread the variant" : ""}.</div>` : "") + profileCard();
    if (ph === "roles") body = roleCard(true) + (ui.roleShown ? characterCard(true) + variantCard() : "") + profileCard() + howTo();
    else if (ph === "fieldwork") body += renderFieldwork();
    else if (ph === "meeting") body += renderMeeting();
    else if (ph === "vote") body += renderVote();
    else if (ph === "reveal") body += renderReveal();
  }
  $("#app").innerHTML = `<div class="phone">${top}${body}</div>`;
  bind();
  tickTimer();
}

function renderJoin() {
  $("#app").innerHTML = `<div class="phone"><div style="height:30px"></div><div class="card stack">
    <div class="pill">Room ${esc(code)}</div><h2>What's your name?</h2>
    <input id="nm" maxlength="18" placeholder="First name" autocomplete="off">
    <button class="btn block" id="join">Join game</button></div>${howTo()}</div>`;
  $("#join").onclick = async () => {
    const name = $("#nm").value.trim();
    if (!name || ui.joining) return;
    ui.joining = true;
    const used = new Set(Object.values(D.players || {}).map(p => p.color));
    const color = G.COLORS.find(c => !used.has(c)) || G.pick(G.COLORS);
    try { await db.set(`games/${code}/players/${uid}`, { name, color, joinedAt: db.now() }); } catch (e) { alert("Could not join: " + e.message); }
    ui.joining = false;
  };
}

function howTo() {
  return `<details class="card" style="margin-top:12px"><summary><b>How to play</b></summary><div class="stack small" style="margin-top:10px">
    <p>🏝️ You live on a small island with four network groups. You get a <b>character</b>: play them whenever you speak. Secret <b>Innovators</b> are spreading a new way of speaking (the "variant") from person to person.</p>
    <p>🗺️ In fieldwork, move your character around the island (joystick or tap). Walk to the 📍 spots to unlock your tasks. When you meet someone, tap <b>💬 Talk</b>, then <b>find them in the real room and chat in character</b> for about a minute (max 2 chats per round).</p>
    <p>🔬 <b>Sociolinguists</b>: answer fieldwork tasks (Chapter 9) to earn 🪙 tokens and fill the research bar. Spend tokens on evidence to find out where the change started. Then vote out the Innovators in the meeting.</p>
    <p>🗣️ <b>Innovators</b>: always use the variant when you speak. The people you chat with may pick it up: same network = high chance, link-persons (↔) carry it across groups, close-knit groups resist outsiders. Innovators win when the change reaches the tipping point.</p>
    <p>👂 If your phone says you've picked up the variant, <b>start using it</b> when you speak. Sociolinguists listen for it in the town meeting.</p>
    <p>⚠️ Ordinary people can pick up the variant without noticing (change from below). Using it does not make someone an Innovator!</p></div></details>`;
}

function roleCard(withCover) {
  const r = role();
  if (!r) return `<div class="card">Waiting for your role…</div>`;
  if (withCover && !ui.roleShown) return `<div class="cover" id="reveal"><div style="font-size:2.4rem">🔒</div><h3>Tap to see your secret role</h3><p class="muted small">Make sure nobody is looking at your screen.</p></div>`;
  if (r === "innovator") {
    const team = Object.keys(D.secret.team || {}).filter(u => u !== uid).map(nameOf);
    return `<div class="rolecard innovator" id="hide"><div class="small">YOUR SECRET ROLE</div><div class="big">Innovator</div>
      <p>You already speak the new way and want everyone to pick it up. Use the variant every time you speak, chat with people face to face, and don't get caught!</p>
      <p><b>Your team:</b> ${team.length ? team.map(esc).join(", ") : "only you"}</p><p class="small muted">Tap to hide</p></div>`;
  }
  return `<div class="rolecard sociolinguist" id="hide"><div class="small">YOUR SECRET ROLE</div><div class="big">Sociolinguist</div>
    <p>A language change is spreading on the island. Chat with people, listen carefully, gather evidence, and trace it back to its source before the change is complete.</p><p class="small muted">Tap to hide</p></div>`;
}

function profileCard() {
  const p = myProfile(); if (!p) return "";
  return `<div class="card row" style="margin:12px 0">
    <div class="grow" style="flex:1"><div class="small muted">Your place in the community</div>
    <div><b>${groupLabel(p.group)}</b> · ${esc(p.age)}${p.job ? ` · ${esc(p.job)}` : ""}</div>
    <div class="small muted">${GROUPS[p.group].closeKnit ? "Close-knit network" : "Loose-knit network"}${p.link ? ` · ↔ link-person, ties to ${GROUPS[p.link].icon} ${GROUPS[p.link].name}` : ""}</div></div>
    <button class="btn ghost sm" id="peek">${ui.roleShown ? "Hide role" : "👁 Role"}</button></div>
    ${ui.roleShown && D.state.phase !== "roles" ? roleCard(false) : ""}`;
}

// ---------- fieldwork ----------
function renderFieldwork() {
  const isInn = role() === "innovator" && alive();
  const tabs = alive() ? [["map", "🗺️ Map"], ["tasks", "📝 Tasks"], ["evidence", "🔍 Evidence"]] : [["tasks", "📝 Tasks"], ["evidence", "🔍 Evidence"]];
  if (!tabs.find(t => t[0] === ui.tab)) ui.tab = tabs[0][0];
  const tabHtml = `<div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${ui.tab === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
  let inner = "";
  if (ui.tab === "tasks") inner = renderTasks();
  else if (ui.tab === "evidence") inner = renderEvidence();
  else inner = renderMapTab();
  return tabHtml + inner;
}

function renderTasks() {
  const r = D.state.round;
  const qs = arr(D.secret?.qs?.[r]);
  if (!qs.length) return `<div class="card muted">Loading tasks…</div>`;
  const myAns = D.answers?.[r] || {};
  const stations = M.taskStations(uid, r);
  return qs.map((qid, i) => {
    const q = QMAP[qid]; if (!q) return "";
    const chosen = myAns[qid];
    if (chosen == null && alive() && !ui.unlocked.has(r + ":" + qid))
      return `<div class="card" style="margin-bottom:12px"><div class="small muted">Task ${i + 1} · ${esc(q.topic)}</div><div class="q">🔒 Walk to <b>📍 ${esc(stations[i].name)}</b> on the 🗺️ Map to unlock this task.</div><div class="small muted">Your task spots are marked with numbers on the map.</div></div>`;
    const ord = order(qid, q.o.length);
    const opts = ord.map(oi => {
      let cls = "opt";
      if (chosen != null) { if (oi === q.a) cls += " right"; else if (oi === Number(chosen)) cls += " wrong"; }
      return `<button class="${cls}" data-q="${qid}" data-o="${oi}" ${chosen != null ? "disabled" : ""}>${esc(q.o[oi])}</button>`;
    }).join("");
    const fb = chosen != null ? `<div class="feedback">${Number(chosen) === q.a ? "✅ Correct! +1 🪙" : "❌ Not quite."} ${esc(q.why)}</div>` : "";
    return `<div class="card" style="margin-bottom:12px"><div class="small muted">Task ${i + 1} · 📍 ${esc(stations[i].name)} · ${esc(q.topic)}</div><div class="q">${esc(q.q)}</div><div class="opts">${opts}</div>${fb}</div>`;
  }).join("") + `<p class="small muted center">Done? Open 🔍 Evidence to spend your tokens.</p>`;
}

function renderEvidence() {
  const tokens = D.secret?.tokens ?? 0;
  const r = D.state.round;
  const others = activeUids().filter(u => u !== uid);
  const c = CLUES[ui.clueType];
  const can = tokens >= c.cost && !(ui.clueType === "interview" && r <= 1) && (!c.needsTarget || ui.clueTarget);
  return `<div class="card stack">
    <h3>Buy evidence</h3>
    <div><label>Method</label><select class="keep" id="ctype">${Object.entries(CLUES).map(([k, v]) => `<option value="${k}" ${k === ui.clueType ? "selected" : ""}>${v.name} (${v.cost} 🪙)</option>`).join("")}</select></div>
    <div class="small">${esc(c.desc)}<br><span class="muted">Concept: ${esc(c.concept)}</span></div>
    ${c.needsTarget ? `<div><label>Speaker</label><select class="keep" id="ctarget"><option value="">Choose a speaker…</option>${others.map(u => `<option value="${u}" ${u === ui.clueTarget ? "selected" : ""}>${esc(nameOf(u))}</option>`).join("")}</select></div>` : ""}
    ${ui.clueType === "interview" && r <= 1 ? `<div class="small muted">Interviews are available from round 2.</div>` : ""}
    <button class="btn block" id="buy" ${can ? "" : "disabled"}>Buy for ${c.cost} 🪙 (you have ${tokens})</button>
  </div>${notebook()}`;
}

function notebook() {
  const clues = Object.values(D.secret?.clues || {}).sort((a, b) => (b.at || 0) - (a.at || 0));
  if (!clues.length) return `<div class="card muted small" style="margin-top:12px">📓 Your evidence notebook is empty.</div>`;
  return `<div class="card stack" style="margin-top:12px"><h3>📓 Evidence notebook</h3>${clues.map(c =>
    `<div class="note${c.ok ? "" : " inn"}"><div class="small muted">R${c.round} · ${esc(CLUES[c.type]?.name || c.type)}${c.target ? " · " + esc(nameOf(c.target)) : ""}</div><div style="white-space:pre-line">${esc(c.result)}</div></div>`).join("")}</div>`;
}

function variantCard(compact = false) {
  const v = VARIANTS[D.state?.variant]; if (!v) return "";
  const uses = D.secret?.uses;
  let head, cls = "note";
  if (role() === "innovator") { head = "🗣️ <b>You SAY it. Use it every time you speak:</b>"; cls = "note inn"; }
  else if (uses != null && uses > 0) { head = `🗣️ <b>You've picked it up (round ${uses})!</b> From now on, use it naturally when you speak. No need to announce it.`; cls = "note inn"; }
  else head = "👂 <b>Listen for this variant:</b>";
  return `<div class="${cls}" style="margin:12px 0"><div>${head}</div>
    <div style="margin-top:6px"><b>${esc(v.name)}</b> <span class="muted small">(${esc(v.type)})</span></div>
    ${compact ? "" : `<div class="small">${esc(v.how)}</div>`}
    <div class="small muted" style="margin-top:4px">e.g. “${v.examples.map(esc).join("” · “")}”</div></div>`;
}

function characterCard(full) {
  const p = myProfile(), pe = D.secret?.persona; if (!p || !pe) return "";
  const body = `<div><b>${esc(me().name)}</b>, ${esc(p.job || "")} · ${groupLabel(p.group)} · ${esc(p.age)}</div>
    <div class="small" style="margin-top:6px">${esc(pe.attitude)}</div>
    <div class="small"><b>Goal:</b> ${esc(pe.goal)}</div>
    ${pe.age ? `<div class="small muted">${esc(pe.age)}</div>` : ""}
    ${pe.link ? `<div class="small" style="color:var(--teal)">↔ ${esc(pe.link)}</div>` : ""}`;
  if (full) return `<div class="card stack" style="margin-top:12px"><div class="small muted">🎭 YOUR CHARACTER: play them whenever you speak</div>${body}</div>`;
  return `<details class="card" style="margin:12px 0"><summary><b>🎭 My character</b></summary><div style="margin-top:8px">${body}</div></details>`;
}

function ensureAct(r) {
  if (!ui.act || ui.act.round !== r) {
    ui.act = { round: r, talk: [], media: false };
    db.get(`games/${code}/actions/${uid}/${r}`).then(a => { if (a && ui.act.round === r) { ui.act.talk = [...new Set([...arr(a.talk), ...ui.act.talk])]; ui.act.media = ui.act.media || !!a.media; } }).catch(() => {});
  }
}

function renderMapTab() {
  const r = D.state.round, s = S();
  ensureAct(r);
  const talkedNames = arr(D.secret?.talk?.[r]);
  const isInn = role() === "innovator";
  let guide = "";
  if (isInn) {
    const mine = myProfile(), team = D.secret?.team || {}, known = D.secret?.known || {};
    const rows = activeUids().filter(u => u !== uid && !team[u]).map(u => {
      const p = D.profiles[u];
      const ch = G.spreadChance({ ...mine, link: mine.link || null }, { ...p, link: p.link || null }, ui.act.media);
      const cl = ch >= 0.5 ? "hi" : ch >= 0.3 ? "mid" : "lo";
      return `<div class="prow">${avatar(D.players[u])}<span class="grow"><b>${esc(nameOf(u))}</b>${known[u] ? ' <span class="pill" style="padding:1px 6px">already says it</span>' : ""}
        <div class="meta">${groupLabel(p.group)} · ${esc(p.age)}${p.link ? ` · ↔ ${GROUPS[p.link].name}` : ""}</div></span><span class="chance ${cl}">${Math.round(ch * 100)}%</span></div>`;
    }).join("");
    guide = `<div class="card stack" style="margin-top:12px"><h3>🗣️ Innovator guide</h3>
      <p class="small">The people you chat with (max ${s.targetsPerInnovator}) may pick up the variant. Walk to the ones with the best chance:</p>
      <div class="note inn small">Everyone can see your walk on the projector, and chatting OUTSIDE your network can be detected by a "network interview" next round.</div>
      ${D.secret?.mediaUsed ? `<div class="small muted">📺 Your team has already used the media hype.</div>` :
        `<label style="display:flex;gap:10px;align-items:flex-start;color:var(--ink);font-size:.95rem"><input type="checkbox" id="media" style="width:auto;margin-top:3px" ${ui.act.media ? "checked" : ""}><span>📺 Use the team's one-time <b>media hype</b> this round (+15% chance, extra listeners)</span></label>`}
      <div class="plist">${rows}</div></div>`;
  }
  return `<div id="pmapmount"></div><div id="pjoymount"></div>
    <div class="card stack" style="margin-top:12px">
      <div class="row spread"><h3 style="margin:0">💬 Nearby</h3><span class="small muted">Chats: ${talkedNames.length}/2</span></div>
      <div class="plist" id="nearby"></div>
      ${talkedNames.length ? `<div class="small">✅ This round you chatted with: <b>${talkedNames.map(esc).join(", ")}</b> ${isInn ? "" : "(+1 🪙 each)"}</div>` : ""}
      <div class="note small"><b>Chat topic:</b> ${esc(PROMPTS[D.state.prompt ?? 0])}</div>
    </div>
    ${variantCard(true)}${characterCard(false)}${guide}`;
}

function saveActions() {
  const r = D.state.round; ensureAct(r);
  db.set(`games/${code}/actions/${uid}/${r}`, { talk: ui.act.talk, media: !!ui.act.media });
}

function heard() { try { return JSON.parse(localStorage.getItem("heard-" + code)) || {}; } catch { return {}; } }
function setHeard(h) { try { localStorage.setItem("heard-" + code, JSON.stringify(h)); } catch {} }

function renderMeeting() {
  const iss = ISSUES[D.state.issue ?? 0];
  const h = heard();
  const rows = activeUids().filter(u => u !== uid).map(u => `<button class="prow${h[u] ? " sel" : ""}" data-h="${u}">${avatar(D.players[u])}<span class="grow"><b>${esc(nameOf(u))}</b>
    <div class="meta">${esc(D.profiles[u].job || "")} · ${groupLabel(D.profiles[u].group)}</div></span><span>${h[u] ? `👂 R${h[u]}` : ""}</span></button>`).join("");
  return `<div class="card stack"><div class="small muted">🏛️ TOWN MEETING · speak as your character</div>
      <h3>${esc(iss.title)}</h3><p class="small">${esc(iss.text)}</p>
      <p class="small">Say what <b>your character</b> thinks. ${role() === "innovator" ? "Use the variant! You may also share fake evidence to protect your team." : D.secret?.uses ? "Use the variant naturally." : "Then share your evidence."}</p></div>
    ${variantCard(true)}${characterCard(false)}
    <div class="card stack"><h3>👂 Listening log</h3><p class="small muted">Tap anyone you HEAR using the variant. This is your own fieldwork note (only you can see it).</p><div class="plist">${rows}</div></div>
    ${notebook()}`;
}

// ---------- vote / reveal / over ----------
function renderVote() {
  if (!alive()) return `<div class="card">You were voted out, so you can't vote. Watch the projector!</div>`;
  const r = D.state.round;
  const cur = D.secret?.myVote?.[r] ?? ui.vote?.[r];
  const h = heard();
  const opts = activeUids().filter(u => u !== uid).map(u => `<button class="prow${cur === u ? " sel" : ""}" data-v="${u}">${avatar(D.players[u])}<span class="grow"><b>${esc(nameOf(u))}</b><div class="meta">${groupLabel(D.profiles[u].group)} · ${esc(D.profiles[u].age)}</div></span>${h[u] ? `<span>👂 R${h[u]}</span>` : ""}</button>`).join("");
  return `<div class="card stack"><h3>🗳️ Who is an Innovator?</h3><p class="small muted">You can change your vote until the vote closes.</p>
    <div class="plist">${opts}<button class="prow${cur === "skip" ? " sel" : ""}" data-v="skip"><span class="grow"><b>Skip vote</b></span></button></div></div>${notebook()}`;
}

function renderReveal() {
  const ej = D.state.ejected;
  let msg = "Nobody was voted out.";
  if (ej && ej.uid !== "none") {
    if (ej.uid === uid) msg = "You were voted out!";
    else msg = `${esc(nameOf(ej.uid))} was voted out.`;
    if (ej.role === "innovator") msg += " They were an <b style='color:var(--violet)'>Innovator</b>.";
    else if (ej.role === "sociolinguist") msg += " They were <b style='color:var(--teal)'>not</b> an Innovator.";
  }
  return `<div class="card stack"><h3>${msg}</h3><p class="muted">Look at the projector. The next round starts soon.</p></div>`;
}

function renderOver() {
  const s = D.state, d = D.debrief || {};
  const r = d.roles?.[uid] || role();
  const won = (s.winner === "innovators" && r === "innovator") || (s.winner === "sociolinguists" && r === "sociolinguist");
  const ad = d.adopted?.[uid];
  const events = Object.values(d.events || {}).flatMap(arr);
  const spreadBy = events.filter(e => e.from === uid).length;
  let personal = "";
  if (r === "innovator") personal = `You passed the variant directly to <b>${spreadBy}</b> people.`;
  else if (ad) {
    const how = ad.via === "media" ? "after hearing it on TV and around you" : ad.from ? `from <b>${esc(nameOf(ad.from))}</b>` : "";
    personal = `You picked up the new variant in round ${ad.round} ${how}, In real life this usually happens without the speaker noticing: a <b>change from below</b> (below conscious awareness).${spreadBy ? ` You then passed it on to ${spreadBy} other${spreadBy > 1 ? "s" : ""}.` : ""}`;
  } else personal = "You never picked up the new variant.";
  const innNames = Object.entries(d.roles || {}).filter(([, v]) => v === "innovator").map(([u]) => esc(nameOf(u)));
  return `<div class="winner ${s.winner === "innovators" ? "inn" : "soc"}"><div class="big-msg">${s.winner === "innovators" ? "Innovators win!" : s.winner === "sociolinguists" ? "Sociolinguists win!" : "Game over"}</div><p>${esc(s.reason || "")}</p>
    ${s.winner !== "none" ? `<p><b>${won ? "🎉 Your team won!" : "Your team lost this time."}</b></p>` : ""}</div>
    <div class="card stack" style="margin-top:12px"><div class="small muted">You were</div><h3>${r === "innovator" ? "an Innovator" : "a Sociolinguist"}</h3><p>${personal}</p>
    <p class="small muted">The Innovators were: ${innNames.join(", ")}</p></div>
    <p class="center muted small">Now look at the projector for the class debrief.</p>`;
}

// ---------- events ----------
function bind() {
  const rv = $("#reveal"); if (rv) rv.onclick = () => { ui.roleShown = true; render(); };
  const hd = $("#hide"); if (hd) hd.onclick = () => { ui.roleShown = false; render(); };
  const pk = $("#peek"); if (pk) pk.onclick = () => { ui.roleShown = !ui.roleShown; render(); };
  document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { ui.tab = b.dataset.tab; render(); });
  document.querySelectorAll("[data-q]").forEach(b => b.onclick = async () => {
    const r = D.state.round;
    if (D.answers?.[r]?.[b.dataset.q] != null) return;
    document.querySelectorAll(`[data-q="${b.dataset.q}"]`).forEach(x => x.disabled = true);
    try { await db.set(`games/${code}/answers/${uid}/${r}/${b.dataset.q}`, Number(b.dataset.o)); } catch (e) { console.warn(e); }
  });
  const ct = $("#ctype"); if (ct) ct.onchange = () => { ui.clueType = ct.value; ct.blur(); render(); };
  const tg = $("#ctarget"); if (tg) tg.onchange = () => { ui.clueTarget = tg.value; tg.blur(); render(); };
  const buy = $("#buy"); if (buy) buy.onclick = async () => {
    buy.disabled = true;
    const id = db.pushKey(`games/${code}/requests/${uid}`);
    await db.set(`games/${code}/requests/${uid}/${id}`, { type: ui.clueType, target: CLUES[ui.clueType].needsTarget ? ui.clueTarget : null, round: D.state.round });
  };
  document.querySelectorAll(".keep").forEach(el => el.addEventListener("blur", () => setTimeout(() => { if (ui.pending) render(); }, 50)));
  const pm = $("#pmapmount"); if (pm) pm.appendChild(mapCanvas());
  const pj = $("#pjoymount"); if (pj) pj.appendChild(joystick());
  const nb = $("#nearby"); if (nb) delete nb.dataset.html;
  if (pm) slowTick();
  const md = $("#media"); if (md) md.onchange = () => { ensureAct(D.state.round); ui.act.media = md.checked; saveActions(); render(); };
  document.querySelectorAll("[data-h]").forEach(b => b.onclick = () => { const h = heard(); if (h[b.dataset.h]) delete h[b.dataset.h]; else h[b.dataset.h] = D.state.round; setHeard(h); render(); });
  document.querySelectorAll("[data-v]").forEach(b => b.onclick = async () => {
    const r = D.state.round;
    ui.vote = { ...(ui.vote || {}), [r]: b.dataset.v };
    render();
    await db.set(`games/${code}/votes/${uid}/${r}`, b.dataset.v);
  });
}
