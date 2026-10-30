import { initDB, DEMO, arr } from "./db.js";
import * as G from "./game.js";
import { QUESTIONS, CLUES, NOTES, GLOSSARY } from "./questions.js";
import { $, avatar, fmtTime, groupLabel, demoBanner } from "./ui.js";
import { VARIANTS, PROMPTS, ISSUES } from "./roleplay.js";
import * as M from "./map.js";

const { esc, GROUPS } = G;
const QMAP = Object.fromEntries(QUESTIONS.map(q => [q.id, q]));
const params = new URLSearchParams(location.search);
let code = (params.get("code") || "").toUpperCase().trim();
let db, uid;
const D = { host: undefined, settings: {}, state: {}, players: {}, profiles: {}, secret: {}, answers: {}, debrief: null, vidx: {} };
const ui = { sheet: null, sheetTask: null, act: null, unlocked: new Set(), seenTalk: null, lastMsg: 0, roleShown: false, clueType: "recording", clueTarget: "", joining: false, pending: false, gsKey: null };
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
  subs.push(db.on(`voiceIdx/${code}`, v => { D.vidx = v || {}; if (D.state?.phase !== "fieldwork") render(); }));
  requestAnimationFrame(loop);
  setInterval(slowTick, 300);
}

// ---------- helpers ----------
const S = () => ({ ...G.DEFAULT_SETTINGS, ...(D.settings || {}) });
const me = () => D.players?.[uid];
const myProfile = () => D.profiles?.[uid];
const nameOf = u => D.players?.[u]?.name || "?";
const role = () => D.secret?.role;
const alive = () => myProfile()?.alive !== false;
const activeUids = () => Object.keys(D.profiles || {}).filter(u => D.profiles[u].alive !== false);
const isBotId = u => String(u).startsWith("bot_");
function order(qid, n) { let h = 0; for (const ch of uid + qid) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return G.shuffle([...Array(n).keys()], G.rng(h)); }

function tickTimer() {
  const e = D.state?.endsAt;
  document.querySelectorAll(".ptimer").forEach(el => {
    if (!e) { el.textContent = ""; return; }
    const left = e - db.now(); el.textContent = fmtTime(left); el.classList.toggle("low", left < 15000);
  });
}

function toast(html, ms = 4000) {
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
  t.innerHTML = html; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), ms);
}

// ================= movement on the island map =================
let posData = {};
const mv = { x: 0, y: 0, round: -1, dest: null, sent: { x: -1, y: -1, t: 0 }, keys: {} };
const others = {};
let lastT = performance.now(), pmap = null, pjoy = null, joyVec = { x: 0, y: 0 };

function mapCanvas() {
  if (pmap) return pmap;
  pmap = document.createElement("canvas");
  pmap.style.cssText = "width:100%;height:100%;display:block;touch-action:none";
  pmap.addEventListener("pointerdown", e => {
    const r = pmap.getBoundingClientRect(), cm = camera(r.width, r.height);
    mv.dest = { x: cm.cx + (e.clientX - r.left - r.width / 2) / cm.scale, y: cm.cy + (e.clientY - r.top - r.height / 2) / cm.scale };
  });
  return pmap;
}
function joystick() {
  if (pjoy) return pjoy;
  pjoy = document.createElement("div");
  pjoy.className = "joy";
  pjoy.innerHTML = `<div class="knob"></div>`;
  const knob = pjoy.querySelector(".knob");
  let active = false;
  const set = e => {
    const r = pjoy.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy), max = r.width / 2 - 16;
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    joyVec = { x: dx / max, y: dy / max }; mv.dest = null;
  };
  pjoy.addEventListener("pointerdown", e => { active = true; try { pjoy.setPointerCapture(e.pointerId); } catch {} set(e); e.preventDefault(); });
  pjoy.addEventListener("pointermove", e => { if (active) set(e); });
  const end = () => { active = false; joyVec = { x: 0, y: 0 }; knob.style.transform = ""; };
  pjoy.addEventListener("pointerup", end); pjoy.addEventListener("pointercancel", end); pjoy.addEventListener("lostpointercapture", end);
  return pjoy;
}
window.addEventListener("keydown", e => { if (/^(Arrow|[wasd]$)/i.test(e.key) && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) { mv.keys[e.key.toLowerCase()] = true; mv.dest = null; e.preventDefault(); } });
window.addEventListener("keyup", e => { mv.keys[e.key.toLowerCase()] = false; });

const CAM_SHIFT = 0.18;
// Camera: follows you (shown a bit above centre, clear of the controls) but never shows empty sea beyond the island
function camera(w, h) {
  const sc = camScale(), CTRL = 150;               // px covered by joystick/buttons at the bottom
  const halfW = w / 2 / sc, halfH = h / 2 / sc;
  let cx = mv.x, cy = mv.y + h * CAM_SHIFT / sc;
  cx = M.W > 2 * halfW ? Math.max(halfW, Math.min(M.W - halfW, cx)) : M.W / 2;
  const minY = halfH, maxY = M.H - halfH + CTRL / sc;
  cy = maxY > minY ? Math.max(minY, Math.min(maxY, cy)) : M.H / 2 + CTRL / sc / 2;
  return { cx, cy, scale: sc };
}
const camScale = () => Math.max(0.45, Math.min(0.9, (pmap?.clientWidth || 360) / 600));
const canMove = () => D.state?.phase === "fieldwork" && alive() && me();

function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
  const r = D.state?.round;
  if (canMove() && mv.round !== r && posData[uid]) { mv.x = posData[uid].x; mv.y = posData[uid].y; mv.round = r; mv.dest = null; }
  if (canMove() && mv.round === r && !ui.sheet) {
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
  return activeUids().filter(u => u !== uid && posData[u] && others[u] && M.dist(mv, others[u]) <= M.TALK_RANGE)
    .sort((a, b) => M.dist(mv, others[a]) - M.dist(mv, others[b]));
}

function draw() {
  const c = pmap; if (!c || !c.isConnected || mv.round !== D.state?.round) return;
  const w = c.clientWidth, h = c.clientHeight, dpr = window.devicePixelRatio || 1;
  if (!w || !h) return;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const ctx = c.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const near = new Set(nearbyPeople());
  const people = activeUids().filter(u => posData[u]).map(u => {
    if (u === uid) return { id: u, x: mv.x, y: mv.y, name: nameOf(u), color: D.players[u]?.color };
    others[u] = others[u] || { x: posData[u].x, y: posData[u].y }; M.lerpTo(others[u], posData[u], 0.2);
    return { id: u, x: others[u].x, y: others[u].y, name: nameOf(u), color: D.players[u]?.color || "#888", near: near.has(u) };
  });
  // camera follows you, shifted up a little so the controls don't cover you
  M.drawMap(ctx, w, h, camera(w, h), { people, meId: uid, highlight: myStations() });
}

function myStations() {
  const r = D.state?.round, qs = arr(D.secret?.qs?.[r]);
  return M.taskStations(uid, r).map((st, i) => ({ id: st.id, n: i + 1, done: D.answers?.[r]?.[qs[i]] != null }));
}

// task waiting at the spot where I'm standing (unlocked & unanswered)
function taskHere() {
  const r = D.state?.round, qs = arr(D.secret?.qs?.[r]);
  const st = M.taskStations(uid, r);
  for (let i = 0; i < qs.length; i++) if (D.answers?.[r]?.[qs[i]] == null && M.dist(mv, st[i]) <= M.STATION_RANGE) return { i, qid: qs[i], st: st[i] };
  return null;
}

// ================= voice notes =================
const VOICE_MAX = 12;
const rec = { on: false, mr: null, chunks: [], start: 0, timer: null };
const clipCache = {};
function latestClipRound(u) {
  const rs = Object.keys(D.vidx?.[u] || {}).map(Number).filter(n => !isNaN(n) && D.vidx[u][n]);
  return rs.length ? Math.max(...rs) : null;
}
const voiceOn = () => S().voice !== false;
const hasClip = u => voiceOn() && latestClipRound(u) != null;
const recordedThisRound = () => !!D.vidx?.[uid]?.[D.state?.round];

async function toggleRecord() {
  if (rec.on) { rec.mr?.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast("This phone/browser can't record audio. Try Chrome or Safari."); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { toast("🎙️ Microphone blocked. Allow microphone access for this site in your browser settings, then try again."); return; }
  const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find(t => MediaRecorder.isTypeSupported?.(t)) || "";
  rec.mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 });
  rec.chunks = []; rec.on = true; rec.start = Date.now();
  rec.mr.ondataavailable = e => { if (e.data.size) rec.chunks.push(e.data); };
  rec.mr.onstop = () => {
    clearInterval(rec.timer); rec.on = false; stream.getTracks().forEach(t => t.stop());
    const blob = new Blob(rec.chunks, { type: rec.mr.mimeType || mime || "audio/webm" });
    const fr = new FileReader();
    fr.onload = async () => {
      const r = D.state.round, first = !recordedThisRound();
      try {
        await db.set(`voice/${code}/${uid}/${r}`, { d: fr.result, at: db.now() });
        await db.set(`voiceIdx/${code}/${uid}/${r}`, db.now());
        clipCache[uid + ":" + r] = fr.result;
        toast(`🎙️ Voice note saved!${first ? " +1 🪙" : ""} Others nearby can now tap ▶ Listen to hear you.`);
      } catch (e) { toast("Could not save the voice note: " + esc(e.message)); }
      updateActions();
    };
    fr.readAsDataURL(blob);
  };
  rec.mr.start();
  rec.timer = setInterval(() => { if ((Date.now() - rec.start) / 1000 >= VOICE_MAX) rec.mr.stop(); updateActions(); }, 250);
  toast(`🔴 Recording… speak in character${role() === "innovator" || D.secret?.uses ? " and use the variant" : ""}. Tap Stop when done (max ${VOICE_MAX} s).`, 5000);
  updateActions();
}

async function playClip(u) {
  const r = latestClipRound(u); if (r == null) { toast(`${esc(nameOf(u))} hasn't recorded a voice note yet.`); return; }
  const key = u + ":" + r;
  try {
    if (!clipCache[key]) { const v = await db.get(`voice/${code}/${u}/${r}`); clipCache[key] = v?.d; }
    if (!clipCache[key]) throw new Error("not found");
    const a = new Audio(clipCache[key]);
    toast(`▶ Playing <b>${esc(nameOf(u))}</b>'s voice note (round ${r}). Listen for the variant!`, 6000);
    await a.play();
  } catch (e) { toast("Could not play this voice note on this phone (" + esc(e.message || "error") + ")."); }
}

// ================= every 300 ms: unlocks, chat alerts, action buttons =================
function slowTick() {
  if (D.state?.phase !== "fieldwork" || !me()) return;
  const r = D.state.round, qs = arr(D.secret?.qs?.[r]);
  if (canMove() && mv.round === r) {
    M.taskStations(uid, r).forEach((st, i) => {
      const key = r + ":" + qs[i];
      if (qs[i] && !ui.unlocked.has(key) && M.dist(mv, st) <= M.STATION_RANGE) {
        ui.unlocked.add(key);
        toast(`📍 Task ${i + 1} unlocked at ${st.name}! Tap <b>📝 Task</b>.`);
        try { navigator.vibrate?.(60); } catch {}
      }
    });
  }
  const ids = arr(D.secret?.talkIds?.[r]);
  if (!ui.seenTalk || ui.seenTalk.round !== r) ui.seenTalk = { round: r, ids: ids.slice() };
  for (const u of ids) if (!ui.seenTalk.ids.includes(u)) {
    ui.seenTalk.ids.push(u);
    toast(`💬 Chat with <b>${esc(nameOf(u))}</b>! Find them in the room and talk in character for about a minute.<br><span class="small">Topic: ${esc(PROMPTS[D.state.prompt ?? 0])}</span>${role() === "innovator" ? "<br><b>Use the variant!</b>" : ""}`, 8000);
    try { navigator.vibrate?.([120, 60, 120]); } catch {}
  }
  const m = D.secret?.talkMsg;
  if (m && m.at !== ui.lastMsg) { if (ui.lastMsg) toast(esc(m.text)); ui.lastMsg = m.at; }
  updateActions();
}

function updateActions() {
  const t = $("#actTalk"); if (!t) return;
  const r = D.state.round;
  const mine = arr(D.secret?.talkIds?.[r]);
  ensureAct(r);
  const near = nearbyPeople();
  const target = near.find(u => !mine.includes(u));
  const waiting = target && ui.act.talk.includes(target);
  setAct(t, "💬", mine.length >= 2 ? "2/2 chats" : target ? (waiting ? "…" : "Talk · " + nameOf(target)) : "Talk", !target || mine.length >= 2 || waiting, target || "");
  const here = taskHere();
  setAct($("#actTask"), "📝", here ? `Task ${here.i + 1}` : "Task", !here, here ? here.qid : "", !!here);
  const secs = rec.on ? Math.floor((Date.now() - rec.start) / 1000) : 0;
  setAct($("#actRec"), rec.on ? "⏹" : "🎙️", rec.on ? `Stop 0:${String(secs).padStart(2, "0")}` : recordedThisRound() ? "Re-record" : "Record", false, "", rec.on);
  const listenTo = near.find(u => hasClip(u));
  setAct($("#actPlay"), "▶", listenTo ? "Listen · " + nameOf(listenTo) : "Listen", !listenTo, listenTo || "");
  const hud = $("#hudChats"); if (hud) hud.textContent = `💬 ${mine.length}/2`;
}
function setAct(el, icon, label, disabled, data, hot = false) {
  if (!el) return;
  const html = `<span class="ai">${icon}</span><span class="al">${esc(label)}</span>`;
  if (el._h !== html) { el._h = html; el.innerHTML = html; }
  el.disabled = disabled; el.dataset.u = data; el.classList.toggle("hot", hot && !disabled);
}

// ================= render =================
function render() {
  const a = document.activeElement;
  if (a && a.classList && a.classList.contains("keep")) { ui.pending = true; return; }
  ui.pending = false;
  if (D.host === undefined) { $("#app").innerHTML = `<div class="phone"><p class="muted center" style="margin-top:40px">Connecting…</p></div>`; return; }
  if (D.host === null) { $("#app").innerHTML = `<div class="phone"><div style="height:30px"></div><div class="card stack"><h2>Room ${esc(code)} not found</h2><p class="muted">Check the code on the projector.</p><a class="btn block" href="play.html" style="text-align:center;text-decoration:none">Try another code</a></div></div>`; return; }
  const ph = D.state?.phase || "lobby";
  if (ui.lastPhase !== ph) { if (ui.lastPhase === "roles") ui.roleShown = false; ui.sheet = null; ui.lastPhase = ph; }
  if (!me()) {
    if (ph !== "lobby") { $("#app").innerHTML = `<div class="phone"><div style="height:30px"></div><div class="card"><h2>This game has already started</h2><p class="muted">Ask your teacher to start a new game.</p></div></div>`; return; }
    if ($("#nm")) return;
    return renderJoin();
  }
  document.body.classList.toggle("gamemode", ph === "fieldwork" && alive());
  if (ph === "fieldwork" && alive()) return renderGameScreen();
  ui.gsKey = null;
  const scroll = window.scrollY;
  const top = `<div class="ptop">${avatar(me())}<div class="grow"><div class="name">${esc(me().name)}</div>
      <div class="small muted">${esc(G.PHASE_LABEL[ph] || ph)}${D.state.round ? ` · Round ${D.state.round}` : ""}</div></div>
      ${role() && ph !== "lobby" ? `<span class="tokens">🪙 ${D.secret.tokens ?? 0}</span>` : ""}
      <span class="timer ptimer"></span></div>`;
  let body = "";
  if (ph === "lobby") body = `<div class="card center stack">${avatar(me(), { lg: true })}<h2>You're in!</h2><p class="muted">Wait for your teacher to start the game. Keep your screen private once roles are given out.</p></div>${howTo()}`;
  else if (ph === "over") body = renderOver();
  else {
    body = (!alive() ? `<div class="note" style="margin-bottom:12px">You were voted out. You can still do fieldwork tasks to learn, but you can't vote${role() === "innovator" ? " or spread the variant" : ""}.</div>` : "") + profileCard();
    if (ph === "roles") body = roleCard(true) + (ui.roleShown ? characterCard(true) + variantCard() : "") + profileCard() + howTo();
    else if (ph === "fieldwork") body += renderGhostFieldwork();
    else if (ph === "meeting") body += renderMeeting();
    else if (ph === "vote") body += renderVote();
    else if (ph === "reveal") body += renderReveal();
  }
  $("#app").innerHTML = `<div class="phone">${top}${body}</div>`;
  if (ph === ui.scrollPhase) window.scrollTo(0, scroll); ui.scrollPhase = ph;
  bind();
  tickTimer();
}

// ---------- full-screen game layout (fieldwork) ----------
function renderGameScreen() {
  const r = D.state.round;
  const key = r + ":" + (ui.sheet || "");
  if (ui.gsKey === key && $(".gs")) { updateGameScreen(); return; }
  ui.gsKey = key;
  ensureAct(r);
  const v = VARIANTS[D.state.variant];
  const speaks = role() === "innovator" || (D.secret?.uses > 0);
  $("#app").innerHTML = `
  <div class="gs">
    <div class="gs-hud">
      ${avatar(me())}
      <div class="grow"><div class="name">${esc(me().name)}</div><div class="small muted">Fieldwork · R${r}</div></div>
      <span class="tokens" id="hudTokens">🪙 ${D.secret.tokens ?? 0}</span>
      <span class="hudpill" id="hudChats">💬 0/2</span>
      <span class="timer ptimer"></span>
    </div>
    <div class="gs-map">
      <div id="pmapmount" class="gs-canvas"></div>
      <button class="varchip ${speaks ? "say" : ""}" data-sheet="me">${speaks ? "🗣️ Say" : "👂 Listen for"}: <b>${esc(v ? v.name.replace(/^.*?: /, "") : "")}</b></button>
      <div class="gs-controls">
        <div id="pjoymount"></div>
        <div class="gs-actions">
          <button class="act" id="actTalk"></button>
          <button class="act" id="actTask"></button>
          ${voiceOn() ? `<button class="act" id="actRec"></button>
          <button class="act" id="actPlay"></button>` : ""}
        </div>
      </div>
      ${ui.sheet ? `<div class="sheet"><div class="sheet-head"><b>${{ tasks: "📝 Fieldwork tasks", evidence: "🔍 Evidence", me: "🎭 Me & my character", terms: "📖 Key terms" }[ui.sheet]}</b><button class="btn ghost sm" data-close>✕ Map</button></div><div class="sheet-body" id="sheetBody"></div></div>` : ""}
    </div>
    <nav class="gs-nav">
      <button data-sheet="tasks" class="${ui.sheet === "tasks" ? "on" : ""}">📝<span>Tasks</span></button>
      <button data-sheet="evidence" class="${ui.sheet === "evidence" ? "on" : ""}">🔍<span>Evidence</span></button>
      <button data-sheet="me" class="${ui.sheet === "me" ? "on" : ""}">🎭<span>Me</span></button>
      <button data-sheet="terms" class="${ui.sheet === "terms" ? "on" : ""}">📖<span>Terms</span></button>
    </nav>
  </div>`;
  $("#pmapmount").appendChild(mapCanvas());
  $("#pjoymount").appendChild(joystick());
  bindGame();
  updateGameScreen();
  tickTimer();
}

function updateGameScreen() {
  const t = $("#hudTokens"); if (t) t.textContent = `🪙 ${D.secret.tokens ?? 0}`;
  const body = $("#sheetBody");
  if (body) {
    const html = ui.sheet === "tasks" ? renderTasks() : ui.sheet === "evidence" ? renderEvidence() : ui.sheet === "me" ? renderMe() : renderTerms();
    if (body._h !== html) { const st = body.scrollTop; body._h = html; body.innerHTML = html; body.scrollTop = st; bind(); }
  }
  updateActions();
}

function bindGame() {
  document.querySelectorAll("[data-sheet]").forEach(b => b.onclick = () => { ui.sheet = ui.sheet === b.dataset.sheet ? null : b.dataset.sheet; ui.sheetTask = null; render(); });
  const c = $("[data-close]"); if (c) c.onclick = () => { ui.sheet = null; render(); };
  $("#actTalk").onclick = e => {
    const u = e.currentTarget.dataset.u; if (!u) return;
    const r = D.state.round; ensureAct(r);
    if (!ui.act.talk.includes(u)) ui.act.talk.push(u);
    saveActions(); updateActions();
  };
  $("#actTask").onclick = e => { const q = e.currentTarget.dataset.u; if (!q) return; ui.sheet = "tasks"; ui.sheetTask = q; render(); };
  if ($("#actRec")) $("#actRec").onclick = () => toggleRecord();
  if ($("#actPlay")) $("#actPlay").onclick = e => { const u = e.currentTarget.dataset.u; if (u) playClip(u); };
}

// ---------- sheets ----------
function renderTasks() {
  const r = D.state.round;
  const qs = arr(D.secret?.qs?.[r]);
  if (!qs.length) return `<div class="card muted">Loading tasks…</div>`;
  const myAns = D.answers?.[r] || {};
  const stations = M.taskStations(uid, r);
  const list = ui.sheetTask ? [ui.sheetTask, ...qs.filter(q => q !== ui.sheetTask)] : qs;
  return list.map(qid => {
    const i = qs.indexOf(qid), q = QMAP[qid]; if (!q) return "";
    const chosen = myAns[qid];
    if (chosen == null && alive() && !ui.unlocked.has(r + ":" + qid))
      return `<div class="card" style="margin-bottom:12px"><div class="small muted">Task ${i + 1} · ${esc(q.topic)}</div><div class="q">🔒 Walk to <b>📍 ${esc(stations[i].name)}</b> (marked <b>${i + 1}</b> on the map) to unlock this task.</div></div>`;
    const ord = order(qid, q.o.length);
    const opts = ord.map(oi => {
      let cls = "opt";
      if (chosen != null) { if (oi === q.a) cls += " right"; else if (oi === Number(chosen)) cls += " wrong"; }
      return `<button class="${cls}" data-q="${qid}" data-o="${oi}" ${chosen != null ? "disabled" : ""}>${esc(q.o[oi])}</button>`;
    }).join("");
    const note = NOTES[q.topic];
    const fb = chosen != null ? `<div class="feedback">${Number(chosen) === q.a ? "✅ Correct! +1 🪙" : "❌ Not quite."} ${esc(q.why)}</div>` : "";
    return `<div class="card" style="margin-bottom:12px"><div class="small muted">Task ${i + 1} · 📍 ${esc(stations[i].name)}</div>
      ${note ? `<details class="fieldnote" ${chosen == null ? "open" : ""}><summary>📖 Field note: <b>${esc(q.topic)}</b> (read first)</summary><p>${esc(note)}</p></details>` : ""}
      <div class="q">${esc(q.q)}</div><div class="opts">${opts}</div>${fb}</div>`;
  }).join("") + `<p class="small muted center">Unlock tasks by walking to the numbered 📍 spots on the map.</p>`;
}

function renderEvidence() {
  const tokens = D.secret?.tokens ?? 0;
  const r = D.state.round;
  const others = activeUids().filter(u => u !== uid);
  const c = CLUES[ui.clueType];
  const can = tokens >= c.cost && !(ui.clueType === "interview" && r <= 1) && (!c.needsTarget || ui.clueTarget);
  return `<div class="card stack">
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
    `<div class="note${c.ok ? "" : " inn"}"><div class="small muted">R${c.round} · ${esc(CLUES[c.type]?.name || c.type)}${c.target ? " · " + esc(nameOf(c.target)) : ""}</div><div style="white-space:pre-line">${esc(c.result)}</div>
      ${c.ok && c.type === "recording" && c.target && hasClip(c.target) ? `<button class="btn sm teal" data-play="${c.target}" style="margin-top:6px">▶ Play ${esc(nameOf(c.target))}'s voice note</button>` : ""}</div>`).join("")}</div>`;
}

function renderMe() {
  return `${roleCard(false)}${characterCard(true)}${variantCard()}
    <div class="note small" style="margin:12px 0"><b>Chat topic this round:</b> ${esc(PROMPTS[D.state.prompt ?? 0])}</div>
    <div class="card small stack"><b>How fieldwork works</b>
      <div>🕹️ Move with the joystick, or tap the map.</div>
      <div>📍 Walk to your numbered spots → <b>📝 Task</b> lights up.</div>
      <div>💬 Next to someone → <b>Talk</b> → find them in the room and chat in character (max 2).</div>
      ${voiceOn() ? `<div>🎙️ <b>Record</b> a short voice note in character (max ${VOICE_MAX} s, +1 🪙 once per round). People near you can tap <b>▶ Listen</b> to hear it, and your teacher may play it to the class.</div>` : ""}</div>
    ${innovatorGuide()}`;
}

function renderTerms() {
  return `<div class="stack">${GLOSSARY.map(([t, d]) => `<div class="card"><b>${esc(t)}</b><div class="small">${esc(d)}</div></div>`).join("")}</div>`;
}

function innovatorGuide() {
  if (role() !== "innovator" || !alive()) return "";
  const s = S(), r = D.state.round; ensureAct(r);
  const mine = myProfile(), team = D.secret?.team || {}, known = D.secret?.known || {};
  const rows = activeUids().filter(u => u !== uid && !team[u]).map(u => {
    const p = D.profiles[u];
    const ch = G.spreadChance({ ...mine, link: mine.link || null }, { ...p, link: p.link || null }, ui.act.media);
    const cl = ch >= 0.5 ? "hi" : ch >= 0.3 ? "mid" : "lo";
    return `<div class="prow">${avatar(D.players[u])}<span class="grow"><b>${esc(nameOf(u))}</b>${known[u] ? ' <span class="pill" style="padding:1px 6px">already says it</span>' : ""}
      <div class="meta">${groupLabel(p.group)} · ${esc(p.age)}${p.link ? ` · ↔ ${GROUPS[p.link].name}` : ""}</div></span><span class="chance ${cl}">${Math.round(ch * 100)}%</span></div>`;
  }).join("");
  return `<div class="card stack" style="margin-top:12px"><h3>🗣️ Innovator guide</h3>
    <p class="small">The people you chat with (max ${s.targetsPerInnovator}) may pick up the variant. Walk to the ones with the best chance:</p>
    <div class="note inn small">Everyone can see your walk on the projector, and chatting OUTSIDE your network can be detected by a "network interview" next round.</div>
    ${D.secret?.mediaUsed ? `<div class="small muted">📺 Your team has already used the media hype.</div>` :
      `<label style="display:flex;gap:10px;align-items:flex-start;color:var(--ink);font-size:.95rem"><input type="checkbox" id="media" style="width:auto;margin-top:3px" ${ui.act.media ? "checked" : ""}><span>📺 Use the team's one-time <b>media hype</b> this round (+15% chance, extra listeners)</span></label>`}
    <div class="plist">${rows}</div></div>`;
}

// ---------- normal (scrolling) screens ----------
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
    <p>🗺️ In fieldwork, move your character with the joystick. Walk to your numbered 📍 spots to unlock tasks (each has a short field note to read first). Next to someone? Tap <b>💬 Talk</b>, then <b>find them in the real room and chat in character</b> (max 2 chats per round).${voiceOn() ? " You can also <b>🎙️ record</b> a short voice note in character (+1 🪙 per round) that others can <b>▶ listen</b> to." : ""}</p>
    <p>🔬 <b>Sociolinguists</b>: answer tasks to earn 🪙 tokens and fill the research bar. Spend tokens on evidence. Then vote out the Innovators in the meeting.</p>
    <p>🗣️ <b>Innovators</b>: always use the variant. The people you chat with may pick it up. Innovators win when the change reaches the tipping point.</p>
    <p>👂 If your phone says you've picked up the variant, <b>start using it</b>. Using it does not make someone an Innovator!</p></div></details>`;
}

function roleCard(withCover) {
  const r = role();
  if (!r) return `<div class="card">Waiting for your role…</div>`;
  if (withCover && !ui.roleShown) return `<div class="cover" id="reveal"><div style="font-size:2.4rem">🔒</div><h3>Tap to see your secret role</h3><p class="muted small">Make sure nobody is looking at your screen.</p></div>`;
  if (r === "innovator") {
    const team = Object.keys(D.secret.team || {}).filter(u => u !== uid).map(nameOf);
    return `<div class="rolecard innovator" ${withCover ? 'id="hide"' : ""}><div class="small">YOUR SECRET ROLE</div><div class="big">Innovator</div>
      <p>You already speak the new way and want everyone to pick it up. Use the variant every time you speak, chat with people face to face, and don't get caught!</p>
      <p><b>Your team:</b> ${team.length ? team.map(esc).join(", ") : "only you"}</p>${withCover ? '<p class="small muted">Tap to hide</p>' : ""}</div>`;
  }
  return `<div class="rolecard sociolinguist" ${withCover ? 'id="hide"' : ""}><div class="small">YOUR SECRET ROLE</div><div class="big">Sociolinguist</div>
    <p>A language change is spreading on the island. Chat with people, listen carefully, gather evidence, and trace it back to its source before the change is complete.</p>${withCover ? '<p class="small muted">Tap to hide</p>' : ""}</div>`;
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

function renderGhostFieldwork() {
  const tabs = [["tasks", "📝 Tasks"], ["evidence", "🔍 Evidence"], ["terms", "📖 Terms"]];
  if (!ui.ghostTab) ui.ghostTab = "tasks";
  return `<div class="tabs">${tabs.map(([k, l]) => `<button data-gtab="${k}" class="${ui.ghostTab === k ? "on" : ""}">${l}</button>`).join("")}</div>` +
    (ui.ghostTab === "tasks" ? renderTasks() : ui.ghostTab === "evidence" ? renderEvidence() : renderTerms());
}

function ensureAct(r) {
  if (!ui.act || ui.act.round !== r) {
    ui.act = { round: r, talk: [], media: false };
    db.get(`games/${code}/actions/${uid}/${r}`).then(a => { if (a && ui.act.round === r) { ui.act.talk = [...new Set([...arr(a.talk), ...ui.act.talk])]; ui.act.media = ui.act.media || !!a.media; } }).catch(() => {});
  }
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
  const rows = activeUids().filter(u => u !== uid).map(u => `<div class="prow${h[u] ? " sel" : ""}">${avatar(D.players[u])}<span class="grow"><b>${esc(nameOf(u))}</b>
    <div class="meta">${esc(D.profiles[u].job || "")} · ${groupLabel(D.profiles[u].group)}</div></span>
    ${hasClip(u) ? `<button class="btn sm teal" data-play="${u}" title="Play voice note">▶</button>` : ""}
    <button class="btn sm ${h[u] ? "" : "ghost"}" data-h="${u}">${h[u] ? "👂 Heard ✓" : "👂 Heard it"}</button></div>`).join("");
  return `<div class="card stack"><div class="small muted">🏛️ TOWN MEETING · speak as your character</div>
      <h3>${esc(iss.title)}</h3><p class="small">${esc(iss.text)}</p>
      <p class="small">Say what <b>your character</b> thinks. ${role() === "innovator" ? "Use the variant! You may also share fake evidence to protect your team." : D.secret?.uses ? "Use the variant naturally." : "Then share your evidence."}</p></div>
    ${variantCard(true)}
    <div class="card stack"><h3>👂 Listening log</h3>
      <p class="small muted">Listen to people as they speak in the meeting${voiceOn() ? " (or tap <b>▶</b> to play their voice note)" : ""}. If you hear the variant, tap <b>👂 Heard it</b>. This is your private fieldwork note.</p>
      <div class="plist">${rows}</div></div>
    ${characterCard(false)}${notebook()}`;
}

function renderVote() {
  if (!alive()) return `<div class="card">You were voted out, so you can't vote. Watch the projector!</div>`;
  const r = D.state.round;
  const cur = ui.vote?.[r];
  const h = heard();
  const opts = activeUids().filter(u => u !== uid).map(u => `<button class="prow${cur === u ? " sel" : ""}" data-v="${u}">${avatar(D.players[u])}<span class="grow"><b>${esc(nameOf(u))}</b><div class="meta">${groupLabel(D.profiles[u].group)} · ${esc(D.profiles[u].age)}</div></span>${h[u] ? `<span>👂 R${h[u]}</span>` : ""}</button>`).join("");
  return `<div class="card stack"><h3>🗳️ Who is an Innovator?</h3><p class="small muted">You can change your vote until the vote closes. 👂 = you marked that you heard them use the variant.</p>
    <div class="plist">${opts}<button class="prow${cur === "skip" ? " sel" : ""}" data-v="skip"><span class="grow"><b>Skip vote</b></span></button></div></div>${notebook()}`;
}

function renderReveal() {
  const ej = D.state.ejected;
  let msg = "Nobody was voted out.";
  if (ej && ej.uid !== "none") {
    msg = ej.uid === uid ? "You were voted out!" : `${esc(nameOf(ej.uid))} was voted out.`;
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
    personal = `You picked up the new variant in round ${ad.round} ${how}. In real life this usually happens without the speaker noticing: a <b>change from below</b> (below conscious awareness).${spreadBy ? ` You then passed it on to ${spreadBy} other${spreadBy > 1 ? "s" : ""}.` : ""}`;
  } else personal = "You never picked up the new variant.";
  const innNames = Object.entries(d.roles || {}).filter(([, v]) => v === "innovator").map(([u]) => esc(nameOf(u)));
  return `<div class="winner ${s.winner === "innovators" ? "inn" : "soc"}"><div class="big-msg">${s.winner === "innovators" ? "Innovators win!" : s.winner === "sociolinguists" ? "Sociolinguists win!" : "Game over"}</div><p>${esc(s.reason || "")}</p>
    ${s.winner !== "none" ? `<p><b>${won ? "🎉 Your team won!" : "Your team lost this time."}</b></p>` : ""}</div>
    <div class="card stack" style="margin-top:12px"><div class="small muted">You were</div><h3>${r === "innovator" ? "an Innovator" : "a Sociolinguist"}</h3><p>${personal}</p>
    <p class="small muted">The Innovators were: ${innNames.join(", ")}</p></div>
    <p class="center muted small">Now look at the projector for the class debrief.</p>`;
}

// ---------- events for normal screens and sheets ----------
function bind() {
  const rv = $("#reveal"); if (rv) rv.onclick = () => { ui.roleShown = true; render(); };
  const hd = $("#hide"); if (hd) hd.onclick = () => { ui.roleShown = false; render(); };
  const pk = $("#peek"); if (pk) pk.onclick = () => { ui.roleShown = !ui.roleShown; render(); };
  document.querySelectorAll("[data-gtab]").forEach(b => b.onclick = () => { ui.ghostTab = b.dataset.gtab; render(); });
  document.querySelectorAll("[data-q]").forEach(b => b.onclick = async () => {
    const r = D.state.round;
    if (D.answers?.[r]?.[b.dataset.q] != null) return;
    document.querySelectorAll(`[data-q="${b.dataset.q}"]`).forEach(x => x.disabled = true);
    try { await db.set(`games/${code}/answers/${uid}/${r}/${b.dataset.q}`, Number(b.dataset.o)); } catch (e) { console.warn(e); }
  });
  const ct = $("#ctype"); if (ct) ct.onchange = () => { ui.clueType = ct.value; ct.blur(); refresh(); };
  const tg = $("#ctarget"); if (tg) tg.onchange = () => { ui.clueTarget = tg.value; tg.blur(); refresh(); };
  const buy = $("#buy"); if (buy) buy.onclick = async () => {
    buy.disabled = true;
    const id = db.pushKey(`games/${code}/requests/${uid}`);
    await db.set(`games/${code}/requests/${uid}/${id}`, { type: ui.clueType, target: CLUES[ui.clueType].needsTarget ? ui.clueTarget : null, round: D.state.round });
  };
  document.querySelectorAll(".keep").forEach(el => el.addEventListener("blur", () => setTimeout(() => { if (ui.pending) render(); }, 50)));
  const md = $("#media"); if (md) md.onchange = () => { ensureAct(D.state.round); ui.act.media = md.checked; saveActions(); refresh(); };
  document.querySelectorAll("[data-play]").forEach(b => b.onclick = () => playClip(b.dataset.play));
  document.querySelectorAll("[data-h]").forEach(b => b.onclick = () => { const h = heard(); if (h[b.dataset.h]) delete h[b.dataset.h]; else h[b.dataset.h] = D.state.round; setHeard(h); render(); });
  document.querySelectorAll("[data-v]").forEach(b => b.onclick = async () => {
    const r = D.state.round;
    ui.vote = { ...(ui.vote || {}), [r]: b.dataset.v };
    render();
    await db.set(`games/${code}/votes/${uid}/${r}`, b.dataset.v);
  });
}
function refresh() { if ($(".gs")) updateGameScreen(); else render(); }
