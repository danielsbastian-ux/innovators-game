import { initDB, DEMO, arr } from "./db.js";
import * as G from "./game.js";
import { QUESTIONS, CLUES } from "./questions.js";
import { $, avatar, fmtTime, groupLabel, demoBanner } from "./ui.js";

const { esc, GROUPS } = G;
const QMAP = Object.fromEntries(QUESTIONS.map(q => [q.id, q]));
const params = new URLSearchParams(location.search);
let code = (params.get("code") || "").toUpperCase().trim();
let db, uid;
const D = { host: undefined, settings: {}, state: {}, players: {}, profiles: {}, secret: {}, answers: {}, debrief: null };
const ui = { tab: "tasks", roleShown: false, clueType: "recording", clueTarget: "", sel: null, joining: false };
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
}

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
  if (D.host === undefined) { $("#app").innerHTML = `<div class="phone"><p class="muted center" style="margin-top:40px">Connecting…</p></div>`; return; }
  if (D.host === null) { $("#app").innerHTML = `<div class="phone"><div style="height:30px"></div><div class="card stack"><h2>Room ${esc(code)} not found</h2><p class="muted">Check the code on the projector.</p><a class="btn block" href="play.html" style="text-align:center;text-decoration:none">Try another code</a></div></div>`; return; }
  const ph = D.state?.phase || "lobby";
  if (ui.lastPhase !== ph) { if (ui.lastPhase === "roles") ui.roleShown = false; ui.lastPhase = ph; }
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
    if (ph === "roles") body = roleCard(true) + profileCard() + howTo();
    else if (ph === "fieldwork") body += renderFieldwork();
    else if (ph === "meeting") body += `<div class="card stack"><h3>🗣️ Community meeting</h3><p>Look at the projector: the variant is used by <b>${D.state.pct}%</b> of the community. Discuss your evidence with the class.</p>${role() === "innovator" ? `<div class="note inn">Blend in! You may share fake "evidence" to protect your team.</div>` : ""}</div>${notebook()}`;
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
    <p>🏝️ You live in a small community with four network groups. Secret <b>Innovators</b> are spreading a new pronunciation (a "variant") from person to person.</p>
    <p>🔬 <b>Sociolinguists</b>: answer fieldwork tasks (Chapter 9) to earn 🪙 tokens and fill the research bar. Spend tokens on evidence to find out where the change started. Then vote out the Innovators in the meeting.</p>
    <p>🗣️ <b>Innovators</b>: choose two people to talk to each round. Same network = high chance. Link-persons (↔) carry it across groups. Close-knit groups resist outsiders. Innovators win when the change reaches the tipping point.</p>
    <p>⚠️ Ordinary people can pick up the variant without noticing (change from below). Using it does not make someone an Innovator!</p></div></details>`;
}

function roleCard(withCover) {
  const r = role();
  if (!r) return `<div class="card">Waiting for your role…</div>`;
  if (withCover && !ui.roleShown) return `<div class="cover" id="reveal"><div style="font-size:2.4rem">🔒</div><h3>Tap to see your secret role</h3><p class="muted small">Make sure nobody is looking at your screen.</p></div>`;
  if (r === "innovator") {
    const team = Object.keys(D.secret.team || {}).filter(u => u !== uid).map(nameOf);
    return `<div class="rolecard innovator" id="hide"><div class="small">YOUR SECRET ROLE</div><div class="big">Innovator</div>
      <p>You speak a new variant and want everyone to pick it up. Each fieldwork phase, choose people to talk to. Don't get caught!</p>
      <p><b>Your team:</b> ${team.length ? team.map(esc).join(", ") : "only you"}</p><p class="small muted">Tap to hide</p></div>`;
  }
  return `<div class="rolecard sociolinguist" id="hide"><div class="small">YOUR SECRET ROLE</div><div class="big">Sociolinguist</div>
    <p>A sound change is spreading. Do fieldwork, gather evidence, and trace it back to its source before the change is complete.</p><p class="small muted">Tap to hide</p></div>`;
}

function profileCard() {
  const p = myProfile(); if (!p) return "";
  return `<div class="card row" style="margin:12px 0">
    <div class="grow" style="flex:1"><div class="small muted">Your place in the community</div>
    <div><b>${groupLabel(p.group)}</b> · ${esc(p.age)}</div>
    <div class="small muted">${GROUPS[p.group].closeKnit ? "Close-knit network" : "Loose-knit network"}${p.link ? ` · ↔ link-person, ties to ${GROUPS[p.link].icon} ${GROUPS[p.link].name}` : ""}</div></div>
    <button class="btn ghost sm" id="peek">${ui.roleShown ? "Hide role" : "👁 Role"}</button></div>
    ${ui.roleShown && D.state.phase !== "roles" ? roleCard(false) : ""}`;
}

// ---------- fieldwork ----------
function renderFieldwork() {
  const isInn = role() === "innovator" && alive();
  const tabs = [["tasks", "📝 Tasks"], ["evidence", "🔍 Evidence"]];
  if (isInn) tabs.push(["spread", "🗣️ Spread"]);
  if (!tabs.find(t => t[0] === ui.tab)) ui.tab = "tasks";
  const tabHtml = `<div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${ui.tab === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
  let inner = "";
  if (ui.tab === "tasks") inner = renderTasks();
  else if (ui.tab === "evidence") inner = renderEvidence();
  else inner = renderSpread();
  return tabHtml + inner;
}

function renderTasks() {
  const r = D.state.round;
  const qs = arr(D.secret?.qs?.[r]);
  if (!qs.length) return `<div class="card muted">Loading tasks…</div>`;
  const myAns = D.answers?.[r] || {};
  return qs.map((qid, i) => {
    const q = QMAP[qid]; if (!q) return "";
    const chosen = myAns[qid];
    const ord = order(qid, q.o.length);
    const opts = ord.map(oi => {
      let cls = "opt";
      if (chosen != null) { if (oi === q.a) cls += " right"; else if (oi === Number(chosen)) cls += " wrong"; }
      return `<button class="${cls}" data-q="${qid}" data-o="${oi}" ${chosen != null ? "disabled" : ""}>${esc(q.o[oi])}</button>`;
    }).join("");
    const fb = chosen != null ? `<div class="feedback">${Number(chosen) === q.a ? "✅ Correct! +1 🪙" : "❌ Not quite."} ${esc(q.why)}</div>` : "";
    return `<div class="card" style="margin-bottom:12px"><div class="small muted">Task ${i + 1} · ${esc(q.topic)}</div><div class="q">${esc(q.q)}</div><div class="opts">${opts}</div>${fb}</div>`;
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
    <div><label>Method</label><select id="ctype">${Object.entries(CLUES).map(([k, v]) => `<option value="${k}" ${k === ui.clueType ? "selected" : ""}>${v.name} (${v.cost} 🪙)</option>`).join("")}</select></div>
    <div class="small">${esc(c.desc)}<br><span class="muted">Concept: ${esc(c.concept)}</span></div>
    ${c.needsTarget ? `<div><label>Speaker</label><select id="ctarget"><option value="">Choose a speaker…</option>${others.map(u => `<option value="${u}" ${u === ui.clueTarget ? "selected" : ""}>${esc(nameOf(u))}</option>`).join("")}</select></div>` : ""}
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

function renderSpread() {
  const r = D.state.round, s = S();
  const known = D.secret?.known || {};
  const team = D.secret?.team || {};
  const mine = myProfile();
  if (!ui.sel || ui.sel.round !== r) ui.sel = { round: r, targets: [], media: false, loaded: false };
  if (!ui.sel.loaded) { ui.sel.loaded = true; db.get(`games/${code}/actions/${uid}/${r}`).then(a => { if (a) { ui.sel.targets = arr(a.targets); ui.sel.media = !!a.media; render(); } }).catch(() => {}); }
  const cands = activeUids().filter(u => u !== uid && !team[u]);
  const rows = cands.map(u => {
    const p = D.profiles[u];
    const ch = G.spreadChance({ ...mine, link: mine.link || null }, { ...p, link: p.link || null }, ui.sel.media);
    const cl = ch >= 0.5 ? "hi" : ch >= 0.3 ? "mid" : "lo";
    const sel = ui.sel.targets.includes(u);
    return `<button class="prow${sel ? " sel" : ""}" data-t="${u}">${avatar(D.players[u])}<span class="grow"><b>${esc(nameOf(u))}</b>${known[u] ? ' <span class="pill" style="padding:1px 6px">already uses it</span>' : ""}
      <div class="meta">${groupLabel(p.group)} · ${esc(p.age)}${p.link ? ` · ↔ ${GROUPS[p.link].name}` : ""}</div></span>
      <span class="chance ${cl}">${Math.round(ch * 100)}%</span></button>`;
  }).join("");
  return `<div class="card stack"><h3>🗣️ Who will you talk to?</h3>
    <p class="small">Pick up to <b>${s.targetsPerInnovator}</b> people. Your choice is saved automatically and resolved when fieldwork ends.</p>
    <div class="note inn small">Talking to someone OUTSIDE your network can be detected by a "network interview" next round. Same network is safer and stronger.</div>
    <div class="small muted">Selected: ${ui.sel.targets.map(nameOf).map(esc).join(", ") || "nobody yet"}</div>
    ${D.secret?.mediaUsed ? `<div class="small muted">📺 Your team has already used the media hype.</div>` :
      `<label style="display:flex;gap:10px;align-items:flex-start;color:var(--ink);font-size:.95rem"><input type="checkbox" id="media" style="width:auto;margin-top:3px" ${ui.sel.media ? "checked" : ""}><span>📺 Use the team's one-time <b>media hype</b> this round (+15% chance, extra listeners)</span></label>`}
    <div class="plist">${rows}</div></div>`;
}

function saveActions() {
  db.set(`games/${code}/actions/${uid}/${D.state.round}`, { targets: ui.sel.targets, media: !!ui.sel.media });
}

// ---------- vote / reveal / over ----------
function renderVote() {
  if (!alive()) return `<div class="card">You were voted out, so you can't vote. Watch the projector!</div>`;
  const r = D.state.round;
  const cur = D.secret?.myVote?.[r] ?? ui.vote?.[r];
  const opts = activeUids().filter(u => u !== uid).map(u => `<button class="prow${cur === u ? " sel" : ""}" data-v="${u}">${avatar(D.players[u])}<span class="grow"><b>${esc(nameOf(u))}</b><div class="meta">${groupLabel(D.profiles[u].group)} · ${esc(D.profiles[u].age)}</div></span></button>`).join("");
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
    personal = `You picked up the new variant in round ${ad.round} ${how}, probably without noticing. That's a <b>change from below</b> (below conscious awareness).${spreadBy ? ` You then passed it on to ${spreadBy} other${spreadBy > 1 ? "s" : ""}.` : ""}`;
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
  const ct = $("#ctype"); if (ct) ct.onchange = () => { ui.clueType = ct.value; render(); };
  const tg = $("#ctarget"); if (tg) tg.onchange = () => { ui.clueTarget = tg.value; render(); };
  const buy = $("#buy"); if (buy) buy.onclick = async () => {
    buy.disabled = true;
    const id = db.pushKey(`games/${code}/requests/${uid}`);
    await db.set(`games/${code}/requests/${uid}/${id}`, { type: ui.clueType, target: CLUES[ui.clueType].needsTarget ? ui.clueTarget : null, round: D.state.round });
  };
  document.querySelectorAll("[data-t]").forEach(b => b.onclick = () => {
    const t = b.dataset.t, sel = ui.sel.targets;
    if (sel.includes(t)) sel.splice(sel.indexOf(t), 1);
    else { if (sel.length >= S().targetsPerInnovator) sel.shift(); sel.push(t); }
    saveActions(); render();
  });
  const md = $("#media"); if (md) md.onchange = () => { ui.sel.media = md.checked; saveActions(); render(); };
  document.querySelectorAll("[data-v]").forEach(b => b.onclick = async () => {
    const r = D.state.round;
    ui.vote = { ...(ui.vote || {}), [r]: b.dataset.v };
    render();
    await db.set(`games/${code}/votes/${uid}/${r}`, b.dataset.v);
  });
}
