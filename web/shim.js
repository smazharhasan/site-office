/* Site Office connector: runs the full Site Office on the live Supabase backend.
 * Provides window.claude.use(name) for db, user, sample (AI), assets, downloads and mcp (weather),
 * plus the sign-in and project screens. Loaded before the app's own script. */
(() => {
  "use strict";
  const URL_ = "https://bctdsetigzdamxjduxgb.supabase.co";
  const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjdGRzZXRpZ3pkYW14amR1eGdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0MDA4ODksImV4cCI6MjEwNzk3Njg4OX0.Rn6AuNwHpVnMdYxJKO06qstvTCOBE-JKh1Dk1Sf01Yg";
  const HOME = location.origin + location.pathname.replace(/[^/]*$/, "");
  // Inside the Android app the phone app owns the sign-in and pushes fresh tokens (one refresher only).
  const NATIVE = window.SO_NATIVE && window.SO_NATIVE.access_token ? window.SO_NATIVE : null;
  const post = m => { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} };
  const sb = window.supabase.createClient(URL_, ANON, { auth: NATIVE ? { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } : { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const nativeReady = NATIVE ? sb.auth.setSession({ access_token: NATIVE.access_token, refresh_token: NATIVE.refresh_token }).catch(() => null) : Promise.resolve();
  window.SO_setSession = s => sb.auth.setSession(s).catch(() => null);
  window.SO = { sb, project: null, role: null, user: null, fieldUrl: HOME + "field/" };

  const ROLE_MAP = { owner: "owner", owner_supervisor: "ownerSup", builder: "sb", site_supervisor: "siteSup", store_keeper: "storeKeeper", supplier: "supplier", consultant: "consultant", labour: "labour" };
  const PORTAL_TO_ROLE = { ownerSup: "owner_supervisor", sb: "builder", siteSup: "site_supervisor", storeKeeper: "store_keeper", supplier: "supplier", consultant: "consultant", labour: "labour" };
  const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- sign-in / project overlay ---------- */
  const css = document.createElement("style");
  css.textContent = `.so-ov{position:fixed;inset:0;z-index:100;background:var(--bg,#f3f2ef);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto}
  .so-card{width:min(440px,100%);background:var(--panel,#fff);border:1px solid var(--line,#d9d6cf);border-radius:12px;padding:22px;display:flex;flex-direction:column;gap:12px;box-shadow:0 10px 40px rgba(0,0,0,.08);font-family:var(--f-body,system-ui)}
  .so-card h1{font-family:var(--f-display,system-ui);font-size:24px;margin:0}.so-card p{margin:0;color:var(--muted,#62655f);font-size:13.5px}
  .so-card label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;color:var(--muted,#62655f)}
  .so-card input,.so-card select,.so-card textarea{font:inherit;font-size:15px;padding:10px 12px;border:1px solid var(--line,#d9d6cf);border-radius:8px;background:var(--bg,#f3f2ef);color:var(--ink,#1d2021)}
  .so-btn{font:inherit;font-weight:600;padding:11px 14px;border-radius:8px;border:1px solid var(--accent,#0f6f5c);background:var(--accent,#0f6f5c);color:var(--accent-ink,#fff);cursor:pointer}
  .so-btn.plain{background:transparent;color:var(--ink,#1d2021);border-color:var(--line,#d9d6cf)}.so-btn[disabled]{opacity:.6}
  .so-err{color:var(--bad,#b3261e);font-size:13px;min-height:1em}.so-ok{color:var(--good,#2f7d32);font-size:13px}
  .so-brand{display:flex;gap:10px;align-items:center}.so-mark{width:40px;height:40px;border-radius:8px;background:var(--accent,#0f6f5c);color:#fff;display:grid;place-items:center;font-weight:800;font-family:var(--f-display,system-ui)}
  .so-row{display:flex;gap:8px;flex-wrap:wrap}.so-row>*{flex:1}.so-link{background:none;border:0;color:var(--accent,#0f6f5c);cursor:pointer;font:inherit;font-size:13px;padding:0;text-align:left}
  .so-plist{display:flex;flex-direction:column;gap:8px}.so-plist button{text-align:left}`;
  document.head.append(css);
  let ov = null;
  const show = html => { if (!ov) { ov = document.createElement("div"); ov.className = "so-ov"; document.body.append(ov); } ov.innerHTML = `<div class="so-card"><div class="so-brand"><div class="so-mark">M</div><div style="flex:1"><b style="font-family:var(--f-display,system-ui);font-size:17px">Mimaar <span style="font-weight:400;font-size:12px;opacity:.7">v__APP_VERSION__</span></b><p>Construction site office · معمار</p></div><button class="so-btn plain" id="soLang" type="button" style="padding:6px 10px">${ls.get("v31.lang") === "ur" ? "English" : "اردو"}</button></div>${html}</div>`; return ov; };
  const hide = () => { if (ov) { ov.remove(); ov = null; } };
  const errText = e => { const m = (e && (e.message || e.error_description || e.error)) || String(e); if (/Invalid login/i.test(m)) return "Wrong email or password."; if (/Email not confirmed/i.test(m)) return "Confirm your email first: open the link we emailed you (check spam)."; return m; };

  function loginScreen(resolve, msg) {
    const o = show(`<h1>Sign in</h1>${msg ? `<p class="so-ok">${esc(msg)}</p>` : ""}
      <label>Email<input id="soE" type="email" autocomplete="username"></label>
      <label>Password<input id="soP" type="password" autocomplete="current-password"></label>
      <div class="so-err" id="soErr"></div>
      <button class="so-btn" id="soIn">Sign in</button>
      <button class="so-link" id="soForgot">Forgot password?</button>
      <hr style="border:0;border-top:1px solid var(--line,#ddd);width:100%">
      <p>New owner starting a project? <button class="so-link" id="soUp">Create an owner account</button></p>
      <p>Staff: your owner creates your login and gives you the password.</p>`);
    const go = async () => {
      const b = o.querySelector("#soIn"); b.disabled = true; o.querySelector("#soErr").textContent = "";
      const { error } = await sb.auth.signInWithPassword({ email: o.querySelector("#soE").value.trim(), password: o.querySelector("#soP").value });
      b.disabled = false; if (error) o.querySelector("#soErr").textContent = errText(error); else start(resolve);
    };
    o.querySelector("#soIn").onclick = go; o.querySelector("#soP").onkeydown = e => { if (e.key === "Enter") go(); };
    o.querySelector("#soUp").onclick = () => signupScreen(resolve);
    o.querySelector("#soForgot").onclick = async () => {
      const email = o.querySelector("#soE").value.trim(); if (!email) { o.querySelector("#soErr").textContent = "Type your email above first."; return; }
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: HOME });
      o.querySelector("#soErr").textContent = error ? errText(error) : "Check your email for the reset link.";
    };
  }
  function signupScreen(resolve) {
    const o = show(`<h1>Create an owner account</h1><p>For the person who owns the project. Staff don't sign up here.</p>
      <label>Your full name<input id="soN"></label><label>Email<input id="soE" type="email"></label><label>Password (8+ characters)<input id="soP" type="password"></label>
      <div class="so-err" id="soErr"></div><button class="so-btn" id="soGo">Create account</button><button class="so-link" id="soBack">Back to sign in</button>`);
    o.querySelector("#soBack").onclick = () => loginScreen(resolve);
    o.querySelector("#soGo").onclick = async () => {
      const { data, error } = await sb.auth.signUp({ email: o.querySelector("#soE").value.trim(), password: o.querySelector("#soP").value, options: { data: { full_name: o.querySelector("#soN").value.trim() }, emailRedirectTo: HOME } });
      if (error) { o.querySelector("#soErr").textContent = errText(error); return; }
      if (data.session) start(resolve); else loginScreen(resolve, "Account created. Open the confirmation link we emailed you (check spam), then sign in.");
    };
  }
  function resetScreen(resolve) {
    const o = show(`<h1>Set a new password</h1><label>New password (8+ characters)<input id="soP" type="password"></label><div class="so-err" id="soErr"></div><button class="so-btn" id="soGo">Save password</button>`);
    o.querySelector("#soGo").onclick = async () => { const { error } = await sb.auth.updateUser({ password: o.querySelector("#soP").value }); if (error) o.querySelector("#soErr").textContent = errText(error); else start(resolve); };
  }
  function setupScreen(resolve) {
    const o = show(`<h1>Set up your project</h1><p>One project per site. You become its owner.</p>
      <label>Your name or company (client)<input id="soOrg"></label><label>Project name<input id="soName" placeholder="e.g. Villa 31"></label>
      <label>Site address<input id="soAddr"></label><div class="so-row"><label>Start date<input id="soStart" type="date"></label><label>Months<input id="soM" type="number" value="18"></label></div>
      <button class="so-btn plain" id="soHere">Use my current location (stand on the plot)</button>
      <div class="so-row"><label>Latitude<input id="soLat"></label><label>Longitude<input id="soLng"></label></div>
      <div class="so-err" id="soErr"></div><button class="so-btn" id="soGo">Create project</button><button class="so-link" id="soOut">Sign out</button>`);
    o.querySelector("#soOut").onclick = async () => { await sb.auth.signOut(); loginScreen(resolve); };
    o.querySelector("#soHere").onclick = () => navigator.geolocation.getCurrentPosition(p => { o.querySelector("#soLat").value = p.coords.latitude.toFixed(6); o.querySelector("#soLng").value = p.coords.longitude.toFixed(6); }, () => { o.querySelector("#soErr").textContent = "Allow location access to use this."; }, { enableHighAccuracy: true });
    o.querySelector("#soGo").onclick = async () => {
      const v = id => o.querySelector(id).value.trim(); const er = o.querySelector("#soErr"); if (!v("#soName")) { er.textContent = "Enter the project name."; return; }
      const og = await sb.from("organizations").insert({ name: v("#soOrg") || v("#soName"), kind: "client" }).select("id").single(); if (og.error) { er.textContent = errText(og.error); return; }
      const p = await sb.from("projects").insert({ org_id: og.data.id, name: v("#soName"), address: v("#soAddr") || null, start_date: v("#soStart") || null, contract_months: Number(v("#soM")) || 18, site_lat: v("#soLat") ? Number(v("#soLat")) : null, site_lng: v("#soLng") ? Number(v("#soLng")) : null, site_radius_m: 300 }).select("id").single();
      if (p.error) { er.textContent = errText(p.error); return; }
      await sb.from("app_records").insert({ project_id: p.data.id, col: "config", id: "project", data: { name: v("#soName"), address: v("#soAddr"), plot: v("#soAddr"), startDate: v("#soStart"), months: Number(v("#soM")) || 18, contractor: "" } });
      ls.set("so.project", p.data.id); start(resolve);
    };
  }
  function pickScreen(list, resolve) {
    const o = show(`<h1>Choose a project</h1><div class="so-plist">${list.map((m, i) => `<button class="so-btn plain" data-i="${i}"><b>${esc(m.projects.name)}</b><br><span style="font-weight:400;font-size:12px">${esc(m.projects.address || "")} · ${esc(m.role.replace("_", " "))}</span></button>`).join("")}</div><button class="so-link" id="soNew">+ Start a new project (owner)</button><button class="so-link" id="soOut">Sign out</button>`);
    o.querySelectorAll("[data-i]").forEach(b => b.onclick = () => { ls.set("so.project", list[+b.dataset.i].project_id); start(resolve); });
    o.querySelector("#soNew").onclick = () => setupScreen(resolve); o.querySelector("#soOut").onclick = async () => { await sb.auth.signOut(); loginScreen(resolve); };
  }

  async function start(resolve) {
    await nativeReady;
    const { data: { session } } = await sb.auth.getSession();
    if (!session && NATIVE) { post({ type: "signout" }); return; }
    if (!session) return loginScreen(resolve);
    if (/type=recovery/.test(location.hash)) { history.replaceState(null, "", location.pathname); return resetScreen(resolve); }
    const { data: ms, error } = await sb.from("project_members").select("project_id, role, active, projects(id, name, address, site_lat, site_lng)").eq("user_id", session.user.id).eq("active", true);
    if (error) { show(`<h1>Can't reach the server</h1><p>${esc(errText(error))}</p><button class="so-btn" onclick="location.reload()">Try again</button>`); return; }
    if (!ms.length) return setupScreen(resolve);
    const want = ls.get("so.project"); const m = ms.find(x => x.project_id === want) || (ms.length === 1 ? ms[0] : null);
    if (!m) return pickScreen(ms, resolve);
    ls.set("so.project", m.project_id);
    SO.user = session.user; SO.project = m.projects; SO.role = m.role; SO.memberships = ms;
    hide(); resolve();
  }
  const ready = new Promise(res => {
    sb.auth.onAuthStateChange((ev) => { if (ev === "PASSWORD_RECOVERY") resetScreen(() => location.reload()); if (ev === "SIGNED_OUT" && SO.project && !NATIVE) location.reload(); });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => start(res)); else start(res);
  });

  /* ---------- db: collection(col).doc(id).set/get/delete, onSnapshot ---------- */
  const cache = {}; const listeners = {}; let loaded = null;
  // Money fields live in separate "…Money" records so the server can hide prices from people who
  // only handle quantities. The app still sees one record: they are merged here and split on save.
  const SPLIT = { pos: ["posMoney", ["unitPrice", "payProof", "paidRef", "payMethod", "paidDate", "listRate", "lineDiscPct"]], grns: ["grnsMoney", ["rate", "amount"]], materials: ["materialsMoney", ["budgetRate", "monthlyBudget"]], water: ["waterMoney", ["cost"]], risks: ["risksMoney", ["costImpact"]], people: ["peopleMoney", ["wage"]], changes: ["changesMoney", ["cost"]], selections: ["selectionsMoney", ["allowance", "chosenPrice", "options"]] };
  const PARENT = Object.fromEntries(Object.entries(SPLIT).map(([c, [m]]) => [m, c]));
  const merged = (col, id, data) => { const sp = SPLIT[col]; const m = sp && cache[sp[0]] && cache[sp[0]][id]; if (!m) return data; const o = Object.assign({}, data); sp[1].forEach(k => { if (m[k] !== undefined) o[k] = m[k]; }); return o; };
  const snap = col => ({ docs: Object.entries(cache[col] || {}).map(([id, data]) => ({ id, data: () => merged(col, id, data) })) });
  const fire = col => (listeners[col] || []).forEach(l => { try { l.cb(snap(col)); } catch (e) { console.error(e); } });
  const emit = col => { fire(col); if (PARENT[col]) fire(PARENT[col]); };
  const mapErr = e => { const x = new Error(errText(e)); x.code = e && (e.code === "42501" || /row-level security|permission/i.test(e.message || "")) ? "invalid_argument" : (/payload|too large/i.test(e && e.message || "") ? "quota_exceeded" : "unknown"); return x; };
  async function loadAll() {
    const P = SO.project.id; let from = 0;
    for (;;) {
      const { data, error } = await sb.from("app_records").select("col,id,data").eq("project_id", P).range(from, from + 499);
      if (error) throw mapErr(error);
      data.forEach(r => { (cache[r.col] = cache[r.col] || {})[r.id] = r.data; });
      if (data.length < 500) break; from += 500;
    }
    sb.channel("rec-" + P).on("postgres_changes", { event: "*", schema: "public", table: "app_records", filter: `project_id=eq.${P}` }, p => {
      const r = p.eventType === "DELETE" ? p.old : p.new; if (!r || !r.col) return;
      cache[r.col] = cache[r.col] || {};
      if (p.eventType === "DELETE") delete cache[r.col][r.id]; else cache[r.col][r.id] = r.data;
      emit(r.col);
    }).subscribe();
    // backstop: refresh when the tab comes back to the front
    document.addEventListener("visibilitychange", async () => { if (document.visibilityState !== "visible") return;
      const { data } = await sb.from("app_records").select("col,id,data").eq("project_id", P).range(0, 4999); if (!data) return;
      const fresh = {}; data.forEach(r => { (fresh[r.col] = fresh[r.col] || {})[r.id] = r.data; });
      Object.keys({ ...fresh, ...cache }).forEach(c => { if (JSON.stringify(fresh[c] || {}) !== JSON.stringify(cache[c] || {})) { cache[c] = fresh[c] || {}; emit(c); } });
    });
  }
  const db = {
    collection: col => ({
      doc: id => ({
        async set(body) {
          const sp = SPLIT[col]; let main = body, money = null;
          if (sp) { main = Object.assign({}, body); const mk = {}; let any = false; sp[1].forEach(k => { if (k in main) { if (main[k] !== undefined && main[k] !== "") any = true; mk[k] = main[k]; delete main[k]; } });
            if (any || (cache[sp[0]] && cache[sp[0]][id])) { money = Object.assign({}, (cache[sp[0]] || {})[id] || {}, mk); ["partyId", "supplierId"].forEach(k => { if (body[k]) money[k] = body[k]; }); } }
          const { error } = await sb.from("app_records").upsert({ project_id: SO.project.id, col, id, data: main }); if (error) throw mapErr(error); (cache[col] = cache[col] || {})[id] = main;
          if (money) { const r = await sb.from("app_records").upsert({ project_id: SO.project.id, col: sp[0], id, data: money }); if (r.error) { emit(col); throw mapErr(r.error); } (cache[sp[0]] = cache[sp[0]] || {})[id] = money; }
          emit(col);
        },
        async get() { const { data, error } = await sb.from("app_records").select("data").eq("project_id", SO.project.id).eq("col", col).eq("id", id).maybeSingle(); if (error) throw mapErr(error); return { exists: !!data, data: () => data ? merged(col, id, data.data) : undefined }; },
        async delete() { const { error } = await sb.from("app_records").delete().eq("project_id", SO.project.id).eq("col", col).eq("id", id); if (error) throw mapErr(error); if (cache[col]) delete cache[col][id];
          const sp = SPLIT[col]; if (sp && cache[sp[0]] && cache[sp[0]][id]) { await sb.from("app_records").delete().eq("project_id", SO.project.id).eq("col", sp[0]).eq("id", id); delete cache[sp[0]][id]; }
          emit(col); },
      }),
      onSnapshot(cb, onErr) { const l = { cb, onErr }; (listeners[col] = listeners[col] || []).push(l); loaded.then(() => cb(snap(col)), e => onErr && onErr(e)); return () => { listeners[col] = listeners[col].filter(x => x !== l); }; },
    }),
  };

  /* ---------- user ---------- */
  let teamCache = null;
  const team = async (body) => { const { data, error } = await sb.functions.invoke("team", { body: Object.assign({ project_id: SO.project.id }, body) }); if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch (e) {} throw new Error(m); } return data; };
  const teamList = async () => { if (teamCache) return teamCache; try { teamCache = (await team({ action: "list" })).members || []; } catch (e) { teamCache = []; } setTimeout(() => { teamCache = null; }, 30000); return teamCache; };
  const avatar = name => "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#dcefe9"/><text x="32" y="41" font-family="Arial" font-size="26" font-weight="700" text-anchor="middle" fill="#0f6f5c">${esc((name || "?").trim().charAt(0).toUpperCase())}</text></svg>`);
  const myName = () => (SO.user.user_metadata && SO.user.user_metadata.full_name) || SO.user.email;
  const user = {
    isOwner: async () => SO.role === "owner",
    id: async () => SO.user.id,
    name: async () => myName(),
    profiles: async ids => { const t = await teamList(); const out = {}; ids.forEach(id => { const m = t.find(x => x.user_id === id); const name = id === SO.user.id ? myName() : m ? (m.name || m.email) : ""; out[id] = { id, name, avatarUrl: avatar(name) }; }); return out; },
    search: async q => { const t = await teamList(); q = (q || "").toLowerCase(); return t.filter(m => !q || (m.name + " " + m.email).toLowerCase().includes(q)).map(m => ({ id: m.user_id, name: (m.name || m.email) + (m.name ? " · " + m.email : ""), isMe: m.user_id === SO.user.id })); },
  };

  /* ---------- AI (sample) ---------- */
  const blobToB64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => { const s = String(r.result); res({ data: s.slice(s.indexOf(",") + 1), type: b.type || "image/jpeg" }); }; r.onerror = rej; r.readAsDataURL(b); });
  async function aiCall(prompt, opts, asJson) {
    const images = await Promise.all((opts && opts.images || []).map(blobToB64));
    const { data, error } = await sb.functions.invoke("ai", { body: { project_id: SO.project.id, prompt, images, json: asJson, tier: opts && opts.modelTier } });
    if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch (e) {} const x = new Error(m); x.code = "unavailable"; throw x; }
    return asJson ? data.json : data.text;
  }
  async function makeSample() {
    const { data } = await sb.functions.invoke("ai", { body: { project_id: SO.project.id, status: true } }).catch(() => ({ data: null }));
    if (!data || !data.enabled) return null;
    const s = async (prompt, opts) => { const text = await aiCall(prompt, opts, false); if (opts && opts.onText) opts.onText({ text }); return text; };
    s.json = (prompt, opts) => aiCall(prompt, opts, true);
    s.limits = async () => ({ images: { maxCount: 5 } });
    return s;
  }

  /* ---------- assets, downloads, weather ---------- */
  const assets = { async upload(file) {
    const path = `${SO.project.id}/${Date.now().toString(36)}-${(file.name || "file").replace(/[^A-Za-z0-9._-]/g, "_")}`;
    const { error } = await sb.storage.from("contracts").upload(path, file, { contentType: file.type || undefined });
    if (error) throw mapErr(error);
    const { data } = await sb.storage.from("contracts").createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
    return { id: path, url: data.signedUrl };
  } };
  const downloads = { async save({ filename, data }) {
    let blob = data instanceof Blob ? data : typeof data === "string" && data.startsWith("data:") ? await (await fetch(data)).blob() : new Blob([data]);
    if (NATIVE) { const b = await blobToB64(blob); post({ type: "download", filename, base64: b.data, mime: blob.type || "application/octet-stream" }); return; }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename || "download"; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  } };
  const mcp = { async callTool() {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(`${URL_}/functions/v1/weather?project_id=${SO.project.id}`, { headers: { Authorization: "Bearer " + session.access_token, apikey: ANON } });
    const w = await r.json(); if (!r.ok) throw new Error(w.error || "weather");
    return { payload: { location: { localizedName: "site (Open-Meteo)" }, currentConditions: { temperatureValue: w.temp_c, realFeelValue: w.feels_c, phrase: w.phrase, extended: { humidityValue: w.humidity, wind: Math.round(w.wind_kmh) + " km/h", precipSummary: { past24Hours: (w.rain_mm ?? 0) + " mm" }, uv: {} } }, currentAirQuality: {} } };
  } };

  /* ---------- the runtime the app expects ---------- */
  let samplePromise = null;
  window.claude = { use: async name => {
    await ready;
    if (!loaded) loaded = loadAll();
    if (name === "db") { await loaded; return db; }
    if (name === "user") return user;
    if (name === "sample") return samplePromise || (samplePromise = makeSample());
    if (name === "assets") return assets;
    if (name === "downloads") return downloads;
    if (name === "mcp") return mcp;
    return null;
  } };

  /* ---------- extras: account menu, field app link, staff logins ---------- */
  window.SO.signOut = async () => { if (NATIVE) return post({ type: "signout" }); await sb.auth.signOut(); location.reload(); };
  window.SO.switchProject = () => { ls.set("so.project", ""); location.reload(); };
  window.SO.createLogin = async ({ email, password, full_name, portal }) => {
    const r = await team({ action: "add", email, password, full_name, role: PORTAL_TO_ROLE[portal] || (window.SO_BASE && SO_BASE(portal)) || "site_supervisor" }); teamCache = null; return r.user_id;
  };
  window.SO.setLoginRole = (user_id, portal, base) => (base = base || PORTAL_TO_ROLE[portal] || (window.SO_BASE && SO_BASE(portal))) ? team({ action: "set", user_id, role: base }).then(() => { teamCache = null; }).catch(e => soToast(e.message)) : null;
  window.SO.setLoginActive = (user_id, active) => team({ action: "set", user_id, active }).catch(() => {});
  window.SO.resetPassword = (user_id, password) => team({ action: "reset", user_id, password });
  window.SO.portalFor = role => ROLE_MAP[role] || null;
  function soToast(text) { const d = document.createElement("div"); d.className = "toast"; d.style.maxWidth = "min(560px,92vw)"; d.textContent = text; document.body.append(d); setTimeout(() => d.remove(), 9000); }
  window.SO.brand = c => {
    const name = (c && c.name) || (SO.project && SO.project.name) || "Site Office"; const sub = (c && (c.plot || c.address)) || (SO.project && SO.project.address) || "";
    const b = document.querySelector(".brand b"), sm = document.querySelector(".brand small"), mk = document.querySelector(".brand .mark");
    if (b) b.innerHTML = 'Mimaar <span class="ver">v__APP_VERSION__</span>'.replace("v__APP_VERSION__", "v" + ("__APP_VERSION__".startsWith("__") ? "1.3.0" : "__APP_VERSION__")); if (sm) sm.textContent = name + (sub ? " · " + sub : ""); if (mk) mk.textContent = "M";
    document.title = name + " · Mimaar";
  };
  document.addEventListener("click", e => { if (e.target.closest("#soLang")){ ls.set("v31.lang", ls.get("v31.lang") === "ur" ? "en" : "ur"); location.reload(); } });
  document.addEventListener("click", async e => {
    const t = e.target.closest("[data-so]"); if (!t) return;
    const a = t.dataset.so;
    if (a === "out") return SO.signOut();
    if (a === "switch") return SO.switchProject();
    if (a === "field") { if (NATIVE) post({ type: "field" }); else location.href = SO.fieldUrl; return; }
    if (a === "newlogin") {
      const v = id => (document.getElementById(id) || {}).value || ""; const msg = document.getElementById("soLMsg");
      const email = v("soLE").trim(), password = v("soLP"), full_name = v("soLN").trim(), portal = v("soLR");
      if (!full_name || !email || password.length < 8) { msg.textContent = "Enter the name, email and a password of 8+ characters."; return; }
      t.disabled = true; msg.textContent = "Creating…";
      try {
        const uid = await SO.createLogin({ email, password, full_name, portal });
        const now = new Date().toISOString();
        await db.collection("members").doc(uid).set({ role: portal, name: full_name, email, createdAt: now, updatedAt: now, createdBy: SO.user.id });
        soToast(`Login created. ${full_name} signs in at ${HOME} with ${email} and the password you set.`);
        ["soLN", "soLE", "soLP"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
      } catch (err) { msg.textContent = err.message || "Couldn't create the login."; }
      t.disabled = false;
    }
  });
})();
