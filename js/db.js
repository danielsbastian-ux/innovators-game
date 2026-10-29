// Tiny database layer: Firebase Realtime Database when configured, otherwise a local demo store
// (localStorage, shared between tabs of the same browser).
import { firebaseConfig } from "./config.js";

export const DEMO = !(firebaseConfig.apiKey && firebaseConfig.databaseURL);
const FB_VER = "10.12.2";

let impl = null;

export async function initDB() {
  if (impl) return impl;
  impl = DEMO ? makeLocal() : await makeFirebase();
  await impl.ready;
  return impl;
}

// ---------------- Firebase ----------------
async function makeFirebase() {
  const appMod = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-app.js`);
  const dbMod = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-database.js`);
  const authMod = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-auth.js`);
  const app = appMod.initializeApp(firebaseConfig);
  const db = dbMod.getDatabase(app);
  const auth = authMod.getAuth(app);
  let offset = 0;
  dbMod.onValue(dbMod.ref(db, ".info/serverTimeOffset"), s => { offset = s.val() || 0; });
  const ready = new Promise((resolve, reject) => {
    authMod.onAuthStateChanged(auth, u => { if (u) { api.uid = u.uid; resolve(); } });
    authMod.signInAnonymously(auth).catch(e => {
      alert("Could not sign in to Firebase. Did you enable Anonymous sign-in? (README step 2)\n\n" + e.message);
      reject(e);
    });
  });
  const r = p => dbMod.ref(db, p);
  const api = {
    demo: false, uid: null, ready,
    now: () => Date.now() + offset,
    get: async p => (await dbMod.get(r(p))).val(),
    set: (p, v) => dbMod.set(r(p), v),
    update: (p, obj) => dbMod.update(r(p), obj),
    remove: p => dbMod.remove(r(p)),
    pushKey: p => dbMod.push(r(p)).key,
    on: (p, cb) => dbMod.onValue(r(p), s => cb(s.val()), e => console.warn("listen error", p, e.message)),
  };
  return api;
}

// ---------------- Local demo store ----------------
function makeLocal() {
  const KEY = "innovators-demo-db";
  let uid = sessionStorage.getItem("innovators-demo-uid");
  if (!uid) { uid = "u" + Math.random().toString(36).slice(2, 10); sessionStorage.setItem("innovators-demo-uid", uid); }
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const save = d => localStorage.setItem(KEY, JSON.stringify(d));
  const parts = p => p.split("/").filter(Boolean);
  const getAt = (d, p) => parts(p).reduce((o, k) => (o == null ? undefined : o[k]), d);
  const prune = v => { // mimic Firebase: drop null / empty objects
    if (v === null || v === undefined) return undefined;
    if (Array.isArray(v)) v = Object.assign({}, v);
    if (typeof v === "object") {
      const o = {}; for (const [k, x] of Object.entries(v)) { const y = prune(x); if (y !== undefined) o[k] = y; }
      return Object.keys(o).length ? o : undefined;
    }
    return v;
  };
  const setAt = (d, p, v) => {
    const ks = parts(p); let o = d;
    for (let i = 0; i < ks.length - 1; i++) { if (typeof o[ks[i]] !== "object" || o[ks[i]] === null) o[ks[i]] = {}; o = o[ks[i]]; }
    const pv = prune(v);
    if (pv === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = pv;
  };
  const listeners = new Set();
  const fire = () => {
    const d = load();
    for (const l of listeners) {
      const v = getAt(d, l.path); const s = JSON.stringify(v ?? null);
      if (s !== l.last) { l.last = s; try { l.cb(v == null ? null : JSON.parse(s)); } catch (e) { console.error(e); } }
    }
  };
  window.addEventListener("storage", e => { if (e.key === KEY) fire(); });
  const toArr = v => v; // keep objects
  const api = {
    demo: true, uid, ready: Promise.resolve(),
    now: () => Date.now(),
    get: async p => { const v = getAt(load(), p); return v == null ? null : JSON.parse(JSON.stringify(toArr(v))); },
    set: async (p, v) => { const d = load(); setAt(d, p, v); save(d); queueMicrotask(fire); },
    update: async (p, obj) => { const d = load(); for (const [k, v] of Object.entries(obj)) setAt(d, p + "/" + k, v); save(d); queueMicrotask(fire); },
    remove: async p => { const d = load(); setAt(d, p, null); save(d); queueMicrotask(fire); },
    pushKey: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    on: (p, cb) => {
      const l = { path: p, cb, last: undefined }; listeners.add(l);
      setTimeout(() => { const v = getAt(load(), p); l.last = JSON.stringify(v ?? null); cb(v == null ? null : JSON.parse(l.last)); }, 0);
      return () => listeners.delete(l);
    },
  };
  return api;
}

// Firebase stores arrays as objects sometimes; normalise.
export const arr = v => Array.isArray(v) ? v.filter(x => x != null) : v && typeof v === "object" ? Object.values(v) : [];
