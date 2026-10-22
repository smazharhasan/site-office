/* Mimaar field app on ERPNext.
 * The phone screens of the earlier Mimaar app (colour theme, big buttons, Urdu/English),
 * talking to ERPNext through mimaar.field. Every rule is checked by ERPNext on the server;
 * this file only collects what the person sees and enters. */
(() => {
"use strict";
const BOOT = window.MIMAAR_BOOT || {};
const UR = window.MIMAAR_UR || {};
const CSRF = () => (window.frappe && window.frappe.csrf_token) || BOOT.csrf || "";
const NATIVE = !!window.ReactNativeWebView;
const S = { b: BOOT.boot || null, lang: (BOOT.boot && BOOT.boot.lang) || BOOT.lang || "en", acts: {}, att: null, rel: null, cache: {} };

/* ---------- small helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = (n, cls = "") => `<svg class="i ${cls}"><use href="#i-${n}"/></svg>`;
function t(s, ...a) { let x = (S.lang === "ur" && UR[s]) || s; a.forEach((v, i) => { x = x.split(`{${i}}`).join(v); }); return x; }
const num = (n) => (+n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
function money(n, short) {
  n = +n || 0; const a = Math.abs(n);
  if (short && a >= 1e7) return `${(n / 1e7).toFixed(2).replace(/\.?0+$/, "")} ${t("crore")}`;
  if (short && a >= 1e5) return `${(n / 1e5).toFixed(1).replace(/\.0$/, "")} ${t("lac")}`;
  return `Rs ${Math.round(n).toLocaleString("en-US")}`;
}
function fdate(d) {
  if (!d) return "";
  const x = new Date(String(d).length === 10 ? `${d}T00:00:00` : String(d).replace(" ", "T"));
  if (isNaN(x)) return String(d);
  return x.toLocaleDateString(S.lang === "ur" ? "ur-PK" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
}
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const nowTime = () => new Date().toTimeString().slice(0, 5);
const C = () => (S.b && S.b.caps) || {};
class UserError extends Error {}
/** A status word (Open, Draft ...) where Urdu needs the adjective, not the verb. */
const ST = (x) => { const k = `status:${x}`; const v = t(k); return v === k ? t(x) : v; };

/* ---------- talking to ERPNext ---------- */
function serverMessage(j) {
  const strip = (h) => { const d = document.createElement("div"); d.innerHTML = String(h || ""); return (d.textContent || "").trim(); };
  try {
    const m = JSON.parse(j._server_messages || "[]").map((x) => { try { return JSON.parse(x); } catch (e) { return { message: x }; } });
    const txt = m.map((x) => strip(x.message)).filter(Boolean).join("\n");
    if (txt) return txt;
  } catch (e) { /* ignore */ }
  if (j.exception) return strip(String(j.exception).replace(/^[\w.]+(Error|Exception):\s*/, ""));
  return "";
}
async function api(method, args = {}) {
  const path = method.includes(".") ? method : `mimaar.field.${method}`;
  let r;
  try {
    r = await fetch(`/api/method/${path}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json", "X-Frappe-CSRF-Token": CSRF() }, body: JSON.stringify(args) });
  } catch (e) { throw new UserError(t("No connection to Mimaar. Check the internet (or Wi-Fi) and try again.")); }
  let j = {}; try { j = await r.json(); } catch (e) { /* not json */ }
  if (r.status === 401 || r.status === 403) {
    const who = await fetch("/api/method/frappe.auth.get_logged_user", { credentials: "same-origin", headers: { Accept: "application/json" } }).catch(() => null);
    if (who && !who.ok) { location.reload(); throw new UserError(t("Please sign in again.")); }
  }
  if (!r.ok || j.exc_type) throw new UserError(serverMessage(j) || t("Something went wrong. Try again."));
  return j.message;
}
async function shrink(file) {
  if (!/^image\//.test(file.type) || file.size < 350000) return file;
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = URL.createObjectURL(file); });
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.8));
    return blob ? new File([blob], (file.name || "photo").replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch (e) { return file; }
}
async function upload(file) {
  const fd = new FormData(); fd.append("file", await shrink(file), file.name || "photo.jpg"); fd.append("is_private", "1"); fd.append("folder", "Home/Attachments");
  const r = await fetch("/api/method/upload_file", { method: "POST", credentials: "same-origin", headers: { Accept: "application/json", "X-Frappe-CSRF-Token": CSRF() }, body: fd });
  let j = {}; try { j = await r.json(); } catch (e) { /* */ }
  if (!r.ok || !j.message) throw new UserError(serverMessage(j) || t("The photo couldn't be saved. Try again."));
  return j.message.file_url;
}

/* ---------- the phone app (live camera, GPS, card scanner) ---------- */
const pending = {}; let seq = 0;
window.MimaarNative = window.MimaarNative || {};
window.MimaarNative.resolve = (id, res) => { const p = pending[id]; if (!p) return; delete pending[id]; if (res && res.error) p.reject(new UserError(res.error)); else p.resolve(res || {}); };
function native(type, data = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending[id] = { resolve, reject }; window.ReactNativeWebView.postMessage(JSON.stringify({ id, type, csrf: CSRF(), ...data })); });
}
function pickFile(capture) {
  return new Promise((resolve) => {
    const i = document.createElement("input"); i.type = "file"; i.accept = "image/*,application/pdf"; if (capture) i.capture = "environment";
    i.onchange = () => resolve(i.files && i.files[0]); i.click();
  });
}
/** A live photo (in the phone app: camera only, stamped with GPS). Returns {url, loc}. */
async function takePhoto(title, opts = {}) {
  if (NATIVE) {
    const r = await native("photo", { title: t(title), facing: opts.facing || "back", lang: S.lang });
    if (!r || r.cancelled || !r.data) return null;
    const bin = atob(r.data); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
    return { url: await busy(upload(file), t("Saving the photo…")), loc: r.lat ? `${(+r.lat).toFixed(6)}, ${(+r.lng).toFixed(6)} (±${Math.round(r.accuracy || 0)} m)` : "" };
  }
  const f = await pickFile(true); if (!f) return null;
  return { url: await busy(upload(f), t("Saving the photo…")), loc: "" };
}
async function getLocation() {
  if (NATIVE) { const r = await native("location", { lang: S.lang }); return r && r.lat ? `${(+r.lat).toFixed(6)}, ${(+r.lng).toFixed(6)} (±${Math.round(r.accuracy || 0)} m)` : ""; }
  if (!navigator.geolocation) return "";
  return new Promise((ok) => navigator.geolocation.getCurrentPosition((p) => ok(`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)} (±${Math.round(p.coords.accuracy)} m)`), () => ok(""), { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }));
}
async function scanCode(title) {
  if (NATIVE) { const r = await native("scan", { title: t(title), lang: S.lang }); return r && r.text ? r.text : ""; }
  return ask(title, t("Type the number on the site card (or the CNIC)."), "");
}
/** Open a link: the site's own pages stay in the app; WhatsApp, phone calls and other sites go to the phone. */
function openOut(url) {
  if (NATIVE) { if (url.startsWith(location.origin)) location.href = url; else native("open", { url }).catch((e) => toast(e.message, "bad")); }
  else window.open(url, "_blank", "noopener");
}

/* ---------- toasts, busy, sheets ---------- */
function toast(msg, kind = "", img = "") {
  let root = $("#toast"); if (!root) { root = document.createElement("div"); root.id = "toast"; document.body.appendChild(root); }
  const d = document.createElement("div"); d.className = kind; d.innerHTML = `${img ? `<img src="${esc(img)}" alt="">` : ""}<span>${esc(msg)}</span>`;
  root.appendChild(d); setTimeout(() => d.remove(), kind === "bad" ? 6500 : 3800);
}
async function busy(p, msg) {
  const d = document.createElement("div"); d.className = "busy"; d.innerHTML = `<div class="stack" style="align-items:center"><div class="spin" style="margin:0"></div>${msg ? `<b>${esc(msg)}</b>` : ""}</div>`;
  document.body.appendChild(d);
  try { return await p; } finally { d.remove(); }
}
/** Sheets rise from the bottom and can stack (a picker or a question opens over a form). */
function sheet(title, body, opts = {}) {
  const root = $("#sheetRoot");
  const sc = document.createElement("div"); sc.className = "sh-scrim";
  sc.innerHTML = `<div class="sh ${opts.full ? "full" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sh-grab"></div>
    <header><h2>${esc(title)}</h2><button class="sh-x" data-x="1" aria-label="${esc(t("Close"))}">${icon("x")}</button></header>
    <div class="sh-body"><div class="sh-err"></div>${body}</div>${opts.footer ? `<footer>${opts.footer}</footer>` : ""}</div>`;
  root.appendChild(sc);
  const sh = sc.firstElementChild;
  sc.addEventListener("click", (e) => { if (e.target === sc || (e.target.closest("[data-x]") && e.target.closest(".sh-scrim") === sc)) closeSheet(sc); });
  let y0 = null;
  sh.addEventListener("touchstart", (e) => { if (!e.target.closest(".sh-body") || sh.querySelector(".sh-body").scrollTop <= 0) y0 = e.touches[0].clientY; }, { passive: true });
  sh.addEventListener("touchmove", (e) => { if (y0 == null) return; const dy = e.touches[0].clientY - y0; if (dy > 0) sh.style.transform = `translateY(${dy}px)`; }, { passive: true });
  sh.addEventListener("touchend", (e) => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; y0 = null; if (dy > 110) closeSheet(sc); else sh.style.transform = ""; });
  requestAnimationFrame(() => sc.classList.add("on"));
  if (opts.wire) opts.wire(sh);
  return sh;
}
/** Close one sheet (the given one, or the top one). */
function closeSheet(which) {
  const all = $$("#sheetRoot > .sh-scrim:not(.closing)");
  const sc = which ? (which.classList.contains("sh-scrim") ? which : which.closest(".sh-scrim")) : all[all.length - 1];
  if (!sc || sc.classList.contains("closing")) return;
  sc.classList.add("closing"); sc.classList.remove("on"); setTimeout(() => sc.remove(), 180);
}
function closeAll() { $$("#sheetRoot > .sh-scrim").forEach((sc) => sc.remove()); }
function sheetError(sh, msg) {
  const box = sh.querySelector(".sh-err"); box.innerHTML = msg ? `<div class="banner bad" style="margin-bottom:12px"><b>${esc(t("Not saved"))}</b>${esc(msg).replace(/\n/g, "<br>")}</div>` : "";
  if (msg) sh.querySelector(".sh-body").scrollTop = 0;
}
/** Runs a save from a sheet: shows the server's refusal inside the sheet (in the person's language). */
async function run(sh, fn, okMsg) {
  sheetError(sh, "");
  try { const r = await busy(fn(), t("Saving…")); if (okMsg) toast(okMsg, "good"); return r; } catch (e) { sheetError(sh, e.message); return undefined; }
}
function ask(title, prompt, value, opts = {}) {
  return new Promise((resolve) => {
    let done = false;
    const sh = sheet(title, `<div class="form"><p style="margin:0">${esc(prompt)}</p><div class="fld">${opts.area ? `<textarea name="v">${esc(value)}</textarea>` : `<input name="v" value="${esc(value)}" ${opts.type ? `type="${opts.type}"` : ""}>`}</div></div>`,
      { footer: `<button class="btn" data-x="1">${esc(t("Cancel"))}</button><button class="btn pri" data-ok="1">${esc(opts.ok || t("OK"))}</button>` });
    const inp = sh.querySelector("[name=v]"); setTimeout(() => inp.focus(), 250);
    sh.querySelector("[data-ok]").onclick = () => { done = true; const v = inp.value.trim(); closeSheet(sh); resolve(v); };
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && !opts.area) sh.querySelector("[data-ok]").click(); });
    const obs = new MutationObserver(() => { if (!document.body.contains(sh) || sh.parentElement.classList.contains("closing")) { obs.disconnect(); if (!done) { done = true; resolve(""); } } }); obs.observe($("#sheetRoot"), { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  });
}
function confirmBox(title, text, okLabel, kind = "pri") {
  return new Promise((resolve) => {
    let done = false;
    const sh = sheet(title, `<p style="margin:0">${esc(text)}</p>`, { footer: `<button class="btn" data-x="1">${esc(t("Cancel"))}</button><button class="btn ${kind}" data-ok="1">${esc(okLabel)}</button>` });
    sh.querySelector("[data-ok]").onclick = () => { done = true; closeSheet(sh); resolve(true); };
    const obs = new MutationObserver(() => { if (!document.body.contains(sh) || sh.parentElement.classList.contains("closing")) { obs.disconnect(); if (!done) { done = true; resolve(false); } } }); obs.observe($("#sheetRoot"), { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  });
}
function zoom(src) { const z = document.createElement("div"); z.className = "zoom"; z.innerHTML = `<img src="${esc(src)}" alt="">`; z.onclick = () => z.remove(); document.body.appendChild(z); }

/* ---------- building blocks ---------- */
const panel = (title, body, extra = "", cls = "") => `<section class="panel ${cls}"><header><h2>${esc(title)}</h2>${extra}</header>${body}</section>`;
const empty = (title, text = "") => `<div class="empty"><b>${esc(title)}</b>${esc(text)}</div>`;
const pill = (txt, kind = "") => `<span class="pill ${kind}">${esc(txt)}</span>`;
const bar = (pct, cls = "") => `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, +pct || 0))}%"></i></div>`;
function lrow({ go, act, data, title, sub, end = "", dot, img, ic, chev = true }) {
  const lead = img ? `<img class="lth" src="${esc(img)}" alt="" loading="lazy">` : ic ? `<span class="lth">${icon(ic)}</span>` : dot ? `<span class="ldot ${dot}"></span>` : "";
  const attrs = go ? `data-go="${esc(go)}"` : act ? `data-act="${esc(act)}" ${data != null ? `data-v="${esc(data)}"` : ""}` : "";
  return `<button class="lrow ${attrs ? "" : "static"}" ${attrs}>${lead}<span class="lmain"><b>${esc(title)}</b>${sub ? `<span class="lsub">${sub}</span>` : ""}</span>${end ? `<span class="lend">${end}</span>` : ""}${(go || act) && chev ? icon("chev", "lch") : ""}</button>`;
}
function tile(lbl, val, sub, go, tc) { return `<button class="ctile" style="--tc:var(--${tc})" ${go ? `data-go="${go}"` : ""}><span class="lbl">${esc(lbl)}</span><span class="val">${esc(val)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ""}</button>`; }
function qa(label, ic, act, tc) { return `<button class="qa" data-act="${act}"><span class="qa-i" style="--tc:var(--${tc})">${icon(ic)}</span><span>${esc(label)}</span></button>`; }
const req = (on) => (on ? ` <span class="req">*</span>` : "");
function fld(label, input, opts = {}) { return `<div class="fld" ${opts.name ? `data-f="${opts.name}"` : ""}><label>${esc(label)}${req(opts.req)}</label>${input}${opts.hint ? `<span class="hint">${esc(opts.hint)}</span>` : ""}</div>`; }
const inp = (name, value = "", type = "text", extra = "") => `<input name="${name}" type="${type}" value="${esc(value)}" ${type === "number" ? 'inputmode="decimal" step="any"' : ""} ${extra}>`;
const area = (name, value = "", extra = "") => `<textarea name="${name}" ${extra}>${esc(value)}</textarea>`;
const sel = (name, options, value = "", blank = true) => `<select name="${name}">${blank ? `<option value=""></option>` : ""}${options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, t(o)]; return `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(l)}</option>`; }).join("")}</select>`;
function chips(name, options, value = "", cls = "") {
  return `<div class="chips ${cls}" data-chips="${name}">${options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, t(o)]; return `<button type="button" data-cv="${esc(v)}" aria-pressed="${String(v) === String(value)}">${esc(l)}</button>`; }).join("")}<input type="hidden" name="${name}" value="${esc(value)}"></div>`;
}
/** A photo slot: tap to take the photo; the file's address is kept in a hidden input. */
function shot(name, label, url = "", opts = {}) {
  return `<button type="button" class="shot ${url ? "has" : ""} ${opts.wide ? "wide" : ""}" data-shot="${name}" data-title="${esc(label)}" ${opts.facing ? `data-facing="${opts.facing}"` : ""}>${url ? `<img src="${esc(url)}" alt="">` : `${icon("cam")}<span>${esc(label)}${opts.req ? " *" : ""}</span>`}</button><input type="hidden" name="${name}" value="${esc(url)}">`;
}
function wireForm(root) {
  if (root._wired) return; root._wired = true;
  root.addEventListener("click", async (e) => {
    const c = e.target.closest("[data-chips] button");
    if (c) {
      const g = c.closest("[data-chips]"); $$("button", g).forEach((b) => b.setAttribute("aria-pressed", String(b === c)));
      g.querySelector("input[type=hidden]").value = c.dataset.cv; g.dispatchEvent(new CustomEvent("chip", { bubbles: true, detail: c.dataset.cv })); return;
    }
    const s = e.target.closest("[data-shot]");
    if (s) {
      e.preventDefault();
      try {
        const r = await takePhoto(s.dataset.title, { facing: s.dataset.facing });
        if (!r) return;
        const h = s.nextElementSibling; h.value = r.url; s.classList.add("has"); s.innerHTML = `<img src="${esc(r.url)}" alt="">`;
        if (r.loc) { const l = root.querySelector("[name=location]"); if (l && !l.value) { l.value = r.loc; const lt = root.querySelector("[data-loc]"); if (lt) lt.textContent = r.loc; } }
        s.dispatchEvent(new CustomEvent("photo", { bubbles: true, detail: r }));
      } catch (err) { toast(err.message, "bad"); }
    }
  });
}
function vals(root) {
  const o = {};
  $$("[name]", root).forEach((el) => { if (el.closest("[data-skip]")) return; o[el.name] = el.type === "checkbox" ? el.checked : el.value.trim(); });
  return o;
}
function need(root, names) {
  let first = null;
  $$(".fld.bad", root).forEach((f) => f.classList.remove("bad"));
  for (const n of names) {
    const el = root.querySelector(`[name="${n}"]`);
    if (el && !String(el.value || "").trim()) { const f = el.closest(".fld") || el.parentElement; f && f.classList.add("bad"); first = first || f; }
  }
  if (first) { first.scrollIntoView({ block: "center", behavior: "smooth" }); toast(t("Fill in the marked fields."), "bad"); return false; }
  return true;
}
const qtyBox = (name, value, step = 1) => `<div class="qty"><button type="button" data-step="-${step}">−</button><input name="${name}" type="number" inputmode="decimal" step="any" value="${value}"><button type="button" data-step="${step}">+</button></div>`;
document.addEventListener("click", (e) => {
  const b = e.target.closest(".qty [data-step]"); if (!b) return;
  const i = b.parentElement.querySelector("input"); i.value = Math.max(0, (+i.value || 0) + +b.dataset.step); i.dispatchEvent(new Event("input", { bubbles: true }));
});

/** Pickers: search a list and choose one. */
function picker(title, load, render, opts = {}) {
  return new Promise((resolve) => {
    let done = false;
    const sh = sheet(title, `<div class="stack"><div class="fld search">${icon("search")}<input name="q" placeholder="${esc(t("Search"))}" autocomplete="off"></div>${opts.top || ""}<div class="lst panel plain" data-res><div class="spin"></div></div></div>`, { full: true });
    const q = sh.querySelector("[name=q]"), res = sh.querySelector("[data-res]");
    let timer = null, rows = [];
    const show = async () => {
      try { rows = await load(q.value.trim()); res.innerHTML = rows.length ? rows.map((r, i) => render(r, i)).join("") : empty(t("Nothing found")); } catch (e) { res.innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; }
    };
    q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(show, 250); });
    sh.addEventListener("click", (e) => {
      const r = e.target.closest("[data-pick]"); if (r) { done = true; closeSheet(sh); resolve(rows[+r.dataset.pick]); return; }
      const n = e.target.closest("[data-new]"); if (n) { done = true; closeSheet(sh); resolve({ __new: q.value.trim() }); }
    });
    const obs = new MutationObserver(() => { if (!document.body.contains(sh) || sh.parentElement.classList.contains("closing")) { obs.disconnect(); if (!done) { done = true; resolve(null); } } }); obs.observe($("#sheetRoot"), { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    show();
  });
}
const pickRow = (i, title, sub, img, end = "") => `<button class="lrow" data-pick="${i}">${img ? `<img class="lth" src="${esc(img)}" alt="">` : ""}<span class="lmain"><b>${esc(title)}</b>${sub ? `<span class="lsub">${esc(sub)}</span>` : ""}</span>${end ? `<span class="lend">${end}</span>` : ""}</button>`;
const pickSupplier = (title = t("Choose the supplier")) => picker(title, (q) => api("suppliers", { q }), (r, i) => pickRow(i, r.supplier_name, t(r.mimaar_work_area || "")));
const pickItem = (title = t("Choose the item"), opts = {}) => picker(title, (q) => (opts.stock ? api("stock", { q }).then((d) => d.rows.filter((r) => +r.qty > 0)) : api("item_search", { q })), (r, i) => pickRow(i, r.item_name, r.item_code, "", opts.stock ? `<b>${num(r.qty)}</b><span class="small muted">${esc(r.uom)}</span>` : esc(r.stock_uom || "")), { top: opts.allowNew ? `<button class="btn sm" data-new="1">${icon("plus")}${esc(t("Not in the list: add as a new item"))}</button>` : "" });
const pickWorker = () => picker(t("Choose the worker"), (q) => api("workers", { q }), (r, i) => pickRow(i, r.full_name, [t(r.trade || ""), r.name].filter(Boolean).join(" · "), r.photo));

/* ---------- layout ---------- */
const TABS = [["dash", "Dashboard", "dash"], ["build", "Construction", "house"], ["+", "", "plus"], ["store", "Stores", "box"], ["more", "More", "menu"]];
const TOP_OF = { dash: "dash", build: "build", store: "store", receive: "store" };
function layout() {
  document.documentElement.lang = S.lang; document.documentElement.dir = S.lang === "ur" ? "rtl" : "ltr";
  $("#app").innerHTML = `<header class="top" id="top"></header><main class="content" id="content"></main>
    <nav class="bottombar" id="bar">${TABS.map(([id, l, ic]) => id === "+" ? `<button class="bb-plus" data-act="quick" aria-label="${esc(t("Quick actions"))}"><span>${icon("plus")}</span></button>` : `<button data-go="${id}" data-tab="${id}">${icon(ic)}<span>${esc(t(l))}</span></button>`).join("")}</nav>`;
}
function setTop(title, back) {
  const b = S.b || {}; const ini = (b.full_name || "?").trim().charAt(0).toUpperCase();
  $("#top").innerHTML = `${back ? `<button class="back" data-back="1" aria-label="${esc(t("Back"))}">${icon("chev", "flip")}</button>` : ""}<h1>${esc(title)}</h1>
    <div class="who"><button class="iconbtn" data-act="search" aria-label="${esc(t("Search"))}">${icon("search")}</button><button class="av" data-act="me" aria-label="${esc(b.full_name || "")}">${b.image ? `<img src="${esc(b.image)}" alt="">` : esc(ini)}</button></div>`;
  const back_ = $("#top [data-back]"); if (back_) { back_.querySelector(".i").style.transform = S.lang === "ur" ? "" : "scaleX(-1)"; }
}
function setTab(id) { $$("#bar [data-tab]").forEach((b) => b.toggleAttribute("aria-current", b.dataset.tab === id) || (b.dataset.tab === id && b.setAttribute("aria-current", "page"))); $$("#bar [data-tab]").forEach((b) => { if (b.dataset.tab === id) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); }); }
function hubtabs(base, tabs, cur) { return `<nav class="hubtabs">${tabs.map(([id, l]) => `<button data-go="${base}/${id}" ${id === cur ? 'aria-current="page"' : ""}>${esc(t(l))}</button>`).join("")}</nav>`; }
function go(path) { if (location.hash === `#/${path}`) render(); else location.hash = `#/${path}`; }

/* ---------- router ---------- */
const VIEWS = {};
async function render() {
  const parts = decodeURIComponent((location.hash || "").replace(/^#\/?/, "")).split("?")[0].split("/").filter(Boolean);
  const v = parts[0] || "dash";
  const fn = VIEWS[v] || VIEWS.dash;
  setTab(TOP_OF[v] || (v === "dash" ? "dash" : "more"));
  S.acts = {};
  const content = $("#content"); content.innerHTML = `<div class="spin"></div>`;
  window.scrollTo(0, 0);
  try { await fn(content, parts.slice(1)); } catch (e) { content.innerHTML = `<div class="banner bad"><b>${esc(t("Couldn't load this"))}</b>${esc(e.message)}</div><button class="btn" data-act="reload">${icon("refresh")}${esc(t("Try again"))}</button>`; S.acts.reload = () => render(); }
}
document.addEventListener("click", (e) => {
  if (e.target.closest("#sheetRoot") && !e.target.closest("[data-go],[data-act]")) return;
  const g = e.target.closest("[data-go]"); if (g) { e.preventDefault(); closeAll(); go(g.dataset.go); return; }
  const bk = e.target.closest("[data-back]"); if (bk) { history.length > 1 ? history.back() : go("dash"); return; }
  const a = e.target.closest("[data-act]"); if (a) { e.preventDefault(); const f = S.acts[a.dataset.act] || GLOBAL[a.dataset.act]; if (f) f(a.dataset.v, a); }
  const im = e.target.closest(".thumbs img, img.zoomable"); if (im) zoom(im.src);
});
window.addEventListener("hashchange", () => { closeAll(); render(); });

/* ---------- global actions: + menu, me, search ---------- */
const GLOBAL = {
  quick() {
    const c = C(); const A = [];
    if (c.store) A.push(["Receive goods", "truck", "store/receive", "k2"], ["Release to work", "box", "release", "k3"]);
    if (c.people) A.push(["Mark attendance", "users", "att", "k1"]);
    if (c.site) A.push(["Site diary", "log", "diary", "k7"], ["Report a snag", "alert", "snag", "k4"], ["Progress photo", "cam", "build/schedule", "k5"]);
    if (c.buy) A.push(["Scan a quotation", "ai", "scanquote", "k6"]);
    if (c.money) A.push(["Pay a supplier", "pay", "bills", "k8"]);
    const sh = sheet(t("Quick actions"), `<div class="qa-grid">${A.map(([l, ic, to, tc], i) => `<button class="qa" data-q="${i}"><span class="qa-i" style="--tc:var(--${tc})">${icon(ic)}</span><span>${esc(t(l))}</span></button>`).join("")}</div>`);
    sh.addEventListener("click", (e) => {
      const b = e.target.closest("[data-q]"); if (!b) return; const to = A[+b.dataset.q][2]; closeSheet();
      if (to === "release") return releaseSheet();
      if (to === "diary") return diarySheet();
      if (to === "snag") return snagNewSheet();
      if (to === "scanquote") return scanQuote();
      go(to);
    });
  },
  me() {
    const b = S.b || {}; const c = C();
    const role = c.owner ? t("Owner") : c.money ? t("Accounts") : c.buy ? t("Site supervisor") : c.store ? t("Store keeper") : t("Site staff");
    const sh = sheet(t("My account"), `<div class="stack">
      <div class="mo-me"><span class="av">${b.image ? `<img src="${esc(b.image)}" alt="">` : esc((b.full_name || "?").charAt(0))}</span><span><b>${esc(b.full_name)}</b><span class="small muted">${esc(b.user)} · ${esc(role)}</span></span></div>
      <div class="fld"><label>${esc(t("Language"))}</label><div class="seg"><button data-lang="en" aria-pressed="${S.lang === "en"}">English</button><button data-lang="ur" aria-pressed="${S.lang === "ur"}">اردو</button></div></div>
      ${c.owner || c.money ? `<button class="btn wide" data-desk="1">${icon("dash")}${esc(t("Open the full ERPNext (office)"))}</button>` : ""}
      ${NATIVE ? `<button class="btn wide" data-site="1">${icon("globe")}${esc(t("Change site address"))}</button>` : ""}
      <button class="btn wide bad" data-out="1">${icon("out")}${esc(t("Sign out"))}</button></div>`);
    sh.addEventListener("click", async (e) => {
      const l = e.target.closest("[data-lang]"); if (l) { await busy(api("set_language", { lang: l.dataset.lang })); location.reload(); }
      if (e.target.closest("[data-desk]")) { location.href = "/desk/mimaar"; }
      if (e.target.closest("[data-site]") && (await confirmBox(t("Change site address"), t("The app will ask for the site address again."), t("Change")))) native("forget").catch(() => {});
      if (e.target.closest("[data-out]")) { await fetch("/api/method/logout", { credentials: "same-origin" }); if (NATIVE) native("signout").catch(() => {}); location.reload(); }
    });
  },
  search() {
    const sh = sheet(t("Search"), `<div class="stack"><div class="fld search">${icon("search")}<input name="q" placeholder="${esc(t("Workers, suppliers, items, orders…"))}" autocomplete="off"></div><div data-res class="stack"></div></div>`, { full: true });
    const q = sh.querySelector("[name=q]"), res = sh.querySelector("[data-res]"); let tm = null;
    setTimeout(() => q.focus(), 250);
    q.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(async () => {
      const v = q.value.trim(); if (v.length < 2) { res.innerHTML = ""; return; }
      try {
        const r = await api("search", { q: v });
        const grp = (title, rows) => rows.length ? panel(title, `<div class="lst">${rows.join("")}</div>`, "", "plain") : "";
        res.innerHTML = [
          grp(t("Workers"), (r.workers || []).map((w) => lrow({ go: `worker/${w.name}`, title: w.full_name, sub: esc(t(w.trade || "")), img: w.photo }))),
          grp(t("Suppliers"), (r.suppliers || []).map((s) => lrow({ go: `supplier/${s.name}`, title: s.supplier_name, sub: esc(t(s.mimaar_work_area || "")) }))),
          grp(t("Items in store"), (r.items || []).map((s) => lrow({ go: `store/stock?${s.item_name}`, title: s.item_name, end: `<b>${num(s.qty)}</b><span class="small muted">${esc(s.uom)}</span>` }))),
          grp(t("Purchase orders"), (r.orders || []).map((o) => lrow({ go: `order/${o.name}`, title: `${o.supplier_name}`, sub: esc(o.name) }))),
          grp(t("Quotations"), (r.quotes || []).map((o) => lrow({ go: `quote/${o.name}`, title: `${o.supplier_name}`, sub: esc(o.name) }))),
        ].join("") || empty(t("Nothing found"));
      } catch (e) { res.innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; }
    }, 300); });
  },
};

/* ================================================================== dashboard */
VIEWS.dash = async (el) => {
  const b = S.b; setTop(t("Dashboard"));
  const d = await api("dashboard"); const k = d.kpi; const c = C();
  const tiles = [];
  if (c.site) tiles.push(tile(t("Work done"), `${num(k.progress)}%`, k.late_tasks ? t("{0} running late", k.late_tasks) : t("On schedule"), "build/schedule", "k1"));
  if (c.people) tiles.push(tile(t("On site today"), String(k.on_site), t("{0} workers registered", k.workers), "att", "k7"));
  if (c.store || c.buy) tiles.push(tile(t("Deliveries expected"), String(k.to_receive), t("purchase orders"), "store/receive", "k2"));
  if (c.store) tiles.push(tile(t("Items in store"), String(k.stock_items), t("in {0}", b.store || ""), "store/stock", "k3"));
  if (c.site) tiles.push(tile(t("Open snags"), String(k.snags_open), t("to fix"), "build/snags", "k4"));
  if (c.money) {
    tiles.push(tile(t("Budget"), money(k.budget, 1), t("{0} ordered", money(k.committed, 1)), "budget", "k5"));
    tiles.push(tile(t("Paid to suppliers"), money(k.paid, 1), t("{0} still to pay", money(k.due, 1)), "bills", "k6"));
    tiles.push(tile(t("Bills due now"), money(k.due_now, 1), t("pay these first"), "bills", "k4"));
  }
  if (tiles.length % 2) tiles.push(`<span class="ctile" style="cursor:default"></span>`);
  const A = [];
  if (c.store) A.push(qa(t("Receive goods"), "truck", "go_receive", "k2"), qa(t("Release to work"), "box", "release", "k3"));
  if (c.people) A.push(qa(t("Mark attendance"), "users", "go_att", "k1"));
  if (c.site) A.push(qa(t("Site diary"), "log", "diary", "k7"), qa(t("Report a snag"), "alert", "snag", "k4"));
  if (c.buy) A.push(qa(t("Scan a quotation"), "ai", "scanquote", "k6"));
  if (c.money) A.push(qa(t("Pay a supplier"), "pay", "go_bills", "k8"));
  Object.assign(S.acts, { go_receive: () => go("store/receive"), go_att: () => go("att"), go_bills: () => go("bills"), release: () => releaseSheet(), diary: () => diarySheet(), snag: () => snagNewSheet(), scanquote: () => scanQuote() });
  const acts = d.acts || [];
  el.innerHTML = `<div class="hero"><span class="muted small">${esc(fdate(b.today))}</span><b>${esc(t("Salaam, {0}", (b.full_name || "").split(" ")[0]))}</b><span class="small muted">${esc(b.project_name || "")}</span></div>
    ${tiles.length ? `<div class="ctiles">${tiles.join("")}</div>` : ""}
    ${A.length ? panel(t("Quick actions"), `<div class="body"><div class="qa-grid">${A.slice(0, 6).join("")}</div></div>`) : ""}
    ${panel(t("Needs your attention"), acts.length ? `<div class="lst">${acts.slice(0, 25).map((a) => lrow({ act: "open", data: a.go.join("|"), title: a.t, dot: a.k })).join("")}</div>` : empty(t("All clear"), t("Nothing is waiting for you right now.")), acts.length ? `<span class="cnt">${acts.length}</span>` : "")}`;
  S.acts.open = (v) => {
    const [kind, name] = v.split("|");
    const map = { quote: `quote/${name}`, order: `order/${name}`, receive: `receive/${name}`, bill: "bills", billnew: "bills", snag: "build/snags", task: "build/schedule", worker: `worker/${name}` };
    go(map[kind] || "dash");
  };
};

/* ================================================================== construction */
VIEWS.build = async (el, [tab = "schedule"]) => {
  setTop(t("Construction"));
  const tabs = [["schedule", "Schedule"], ["diary", "Diary"], ["inspect", "Inspections"], ["snags", "Snags"]];
  el.innerHTML = hubtabs("build", tabs, tab) + `<div id="pane" class="stack"><div class="spin"></div></div>`;
  const pane = $("#pane");
  if (tab === "schedule") {
    const rows = await api("tasks");
    S.cache.tasks = rows;
    const done = rows.filter((r) => r.status === "Completed").length;
    pane.innerHTML = panel(t("Schedule"), rows.length ? `<div class="lst">${rows.map((r, i) => lrow({ act: "task", data: i, title: r.subject,
      sub: `${esc(fdate(r.exp_start_date))} – ${esc(fdate(r.exp_end_date))}<span style="display:block;margin-top:6px">${bar(r.progress, r.late ? "late" : r.progress >= 100 ? "" : "mid")}</span>`,
      end: `<b>${num(r.progress)}%</b>${r.late ? pill(t("Late"), "bad") : r.status === "Completed" ? pill(t("Done"), "good") : ""}` })).join("")}</div>` : empty(t("No schedule yet"), t("The project's tasks appear here.")), `<span class="cnt">${done}/${rows.length}</span>`);
    S.acts.task = (i) => taskSheet(S.cache.tasks[+i]);
  } else if (tab === "diary") {
    const rows = await api("diary");
    pane.innerHTML = `<button class="btn pri big wide" data-act="new">${icon("plus")}${esc(t("New diary entry"))}</button>` + panel(t("Site diary"), rows.length ? `<div class="lst">${rows.map((r) => `<div class="lrow static" style="flex-direction:column;align-items:stretch;gap:6px">
      <div class="row"><b>${esc(fdate(r.date))}</b><span class="spacer" style="flex:1"></span>${r.weather ? pill(t(r.weather), "info") : ""}${r.workers ? pill(t("{0} workers", r.workers)) : ""}</div>
      <div>${esc(r.work_done)}</div>${r.issues ? `<div class="small" style="color:var(--bad)">${esc(r.issues)}</div>` : ""}
      ${[r.photo_1, r.photo_2].filter(Boolean).length ? `<div class="thumbs">${[r.photo_1, r.photo_2].filter(Boolean).map((p) => `<img src="${esc(p)}" alt="">`).join("")}</div>` : ""}</div>`).join("")}</div>` : empty(t("No entries yet"), t("Write what happened on site today.")));
    S.acts.new = () => diarySheet();
  } else if (tab === "inspect") {
    const d = await api("inspections");
    S.cache.inspTypes = d.types;
    pane.innerHTML = `<button class="btn pri big wide" data-act="new">${icon("plus")}${esc(t("New inspection"))}</button>` + panel(t("Inspections"), d.rows.length ? `<div class="lst">${d.rows.map((r) => lrow({ title: t(r.inspection_type), sub: esc([r.location, fdate(r.date), r.name].filter(Boolean).join(" · ")),
      end: r.result ? pill(t(r.result), r.result === "Fail" ? "bad" : r.result === "Pass" ? "good" : "warn") : r.docstatus === 0 ? pill(t("Draft"), "warn") : "", chev: false })).join("")}</div>` : empty(t("No inspections yet")));
    S.acts.new = () => inspectionSheet(d.types);
  } else if (tab === "snags") {
    const state = (location.hash.split("?")[1] || "open");
    const rows = await api("snags", { status: state });
    S.cache.snags = rows;
    pane.innerHTML = `<div class="seg"><button data-go="build/snags?open" aria-pressed="${state === "open"}">${esc(t("Still open"))}</button><button data-go="build/snags?done" aria-pressed="${state === "done"}">${esc(t("Fixed and closed"))}</button></div>
      <button class="btn pri big wide" data-act="new">${icon("alert")}${esc(t("Report a snag"))}</button>` +
      panel(t("Snags"), rows.length ? `<div class="lst">${rows.map((r, i) => lrow({ act: "snag", data: i, title: r.description, img: r.photo, sub: esc([r.location, r.responsible_person || r.supplier, r.target_date ? t("by {0}", fdate(r.target_date)) : ""].filter(Boolean).join(" · ")),
        end: pill(ST(r.status), r.late ? "bad" : r.status === "Closed" ? "good" : r.status === "Fixed" ? "info" : "warn") })).join("")}</div>` : empty(state === "open" ? t("No open snags") : t("Nothing here yet")));
    S.acts.new = () => snagNewSheet();
    S.acts.snag = (i) => snagSheet(S.cache.snags[+i]);
  }
};

function taskSheet(task) {
  const sh = sheet(task.subject, `<div class="form">
    <div class="kv"><span>${esc(t("Planned"))}</span><b>${esc(fdate(task.exp_start_date))} – ${esc(fdate(task.exp_end_date))}</b><span>${esc(t("Status"))}</span><b>${esc(t(task.status))}</b></div>
    ${bar(task.progress, task.late ? "late" : "mid")}
    ${fld(t("Work done now (%)"), `${chips("p", ["0", "25", "50", "75", "100"].map((x) => [x, `${x}%`]), "")}${inp("progress", task.progress, "number", 'min="0" max="100"')}`, { req: true })}
    ${fld(t("What was done"), area("note"))}
    ${fld(t("Progress photo"), `<div class="shots">${shot("photo", t("Take photo"))}</div>`)}
    <div data-hist class="small muted"></div></div>`, { footer: `<button class="btn" data-x="1">${esc(t("Cancel"))}</button><button class="btn pri" data-save="1">${esc(t("Save progress"))}</button>` });
  wireForm(sh);
  sh.addEventListener("chip", (e) => { sh.querySelector("[name=progress]").value = e.detail; });
  api("task_history", { name: task.name }).then((h) => {
    if (h && h.length) sh.querySelector("[data-hist]").innerHTML = `<div class="b" style="margin-bottom:4px">${esc(t("Earlier updates"))}</div>` + h.slice(0, 6).map((c) => `<div style="padding:4px 0;border-bottom:1px solid var(--line)">${esc(fdate(String(c.creation).slice(0, 10)))}: ${c.content.replace(/<img[^>]*>/g, "📷").replace(/<br>/g, " ")}</div>`).join("");
  }).catch(() => {});
  sh.querySelector("[data-save]").onclick = async () => {
    if (!need(sh, ["progress"])) return;
    const v = vals(sh);
    const r = await run(sh, () => api("task_progress", { name: task.name, progress: v.progress, note: v.note, photo: v.photo }), t("Progress saved"));
    if (r) { closeSheet(sh); render(); }
  };
}

function diarySheet() {
  const sh = sheet(t("Site diary"), `<div class="form">
    <div class="two">${fld(t("Date"), inp("date", today(), "date"))}${fld(t("Workers on site"), inp("workers", "", "number"))}</div>
    ${fld(t("Weather"), chips("weather", ["Sunny", "Cloudy", "Rain", "Very hot", "Dust storm", "Cold"]))}
    ${fld(t("Work done today"), area("work_done"), { req: true })}
    ${fld(t("Materials used"), area("materials_used"))}
    ${fld(t("Problems, delays, instructions"), area("issues"))}
    ${fld(t("Visitors (consultant, engineer, client)"), inp("visitors"))}
    ${fld(t("Photos"), `<div class="shots">${shot("p1", t("Photo 1"))}${shot("p2", t("Photo 2"))}${shot("p3", t("Photo 3"))}${shot("p4", t("Photo 4"))}</div>`)}
  </div>`, { full: true, footer: `<button class="btn" data-x="1">${esc(t("Cancel"))}</button><button class="btn pri" data-save="1">${esc(t("Save diary"))}</button>` });
  wireForm(sh);
  sh.querySelector("[data-save]").onclick = async () => {
    if (!need(sh, ["work_done"])) return;
    const v = vals(sh);
    const r = await run(sh, () => api("diary_save", { data: { ...v, photos: [v.p1, v.p2, v.p3, v.p4].filter(Boolean) } }), t("Diary saved"));
    if (r) { closeSheet(sh); if (location.hash.includes("build/diary")) render(); }
  };
}

function inspectionSheet(types) {
  types = types || S.cache.inspTypes || [];
  const sh = sheet(t("New inspection"), `<div class="form">
    ${fld(t("Inspection"), sel("inspection_type", types), { req: true })}
    <div class="two">${fld(t("Location / area"), inp("location"))}${fld(t("Date"), inp("date", today(), "date"))}</div>
    ${fld(t("Supplier whose work is inspected"), `<button type="button" class="btn wide" data-sup="1">${esc(t("Choose (optional)"))}</button><input type="hidden" name="supplier">`)}
    <div class="fld"><label>${esc(t("Checklist"))}</label><div data-checks class="stack"></div><button type="button" class="btn sm" data-addcheck="1">${icon("plus")}${esc(t("Add a check"))}</button></div>
    ${fld(t("Result"), chips("result", [["Pass", t("Pass")], ["Pass with remarks", t("Pass with remarks")], ["Fail", t("Fail")]]), { req: true })}
    <div data-capbox hidden class="fld"><label>${esc(t("Corrective actions (each becomes a snag)"))}</label><div data-actions class="stack"></div><button type="button" class="btn sm" data-addact="1">${icon("plus")}${esc(t("Add a problem"))}</button></div>
    ${fld(t("Photos"), `<div class="shots">${shot("photo_1", t("Photo 1"))}${shot("photo_2", t("Photo 2"))}</div>`)}
    ${fld(t("Remarks"), area("remarks"))}
  </div>`, { full: true, footer: `<button class="btn" data-draft="1">${esc(t("Save draft"))}</button><button class="btn pri" data-submit="1">${esc(t("Submit inspection"))}</button>` });
  wireForm(sh);
  const checks = sh.querySelector("[data-checks]"), acts = sh.querySelector("[data-actions]");
  let n = 0;
  const addCheck = (txt = "") => { const i = n++; checks.insertAdjacentHTML("beforeend", `<div class="line" data-check="${i}" data-skip="1"><div class="fld"><input name="c_${i}" value="${esc(txt)}" placeholder="${esc(t("What was checked"))}"></div>${chips(`cr_${i}`, [["OK", t("OK")], ["Not OK", t("Not OK")], ["N/A", t("N/A")]], "OK")}</div>`); };
  const addAct = () => { const i = n++; acts.insertAdjacentHTML("beforeend", `<div class="line" data-act-row="${i}" data-skip="1">
      <div class="fld"><label>${esc(t("Problem found"))}</label><input name="ai_${i}"></div><div class="fld"><label>${esc(t("What must be done"))}</label><input name="aa_${i}"></div>
      <div class="two"><div class="fld"><label>${esc(t("Who will fix it"))}</label><input name="ap_${i}"></div><div class="fld"><label>${esc(t("Fix by"))}</label><input type="date" name="ad_${i}"></div></div>
      <div class="shots">${shot(`aph_${i}`, t("Photo of the problem"))}</div></div>`); };
  ["Work matches the drawing", "Levels and lines are correct", "Material quality is right", "Site is clean and safe"].forEach((x) => addCheck(t(x)));
  sh.querySelector("[data-addcheck]").onclick = () => addCheck();
  sh.querySelector("[data-addact]").onclick = () => addAct();
  sh.addEventListener("chip", (e) => { if (e.target.closest("[data-chips=result]")) { const fail = e.detail === "Fail"; sh.querySelector("[data-capbox]").hidden = !fail; if (fail && !acts.children.length) addAct(); } });
  sh.querySelector("[data-sup]").onclick = async (e) => { const s = await pickSupplier(); if (s && !s.__new) { sh.querySelector("[name=supplier]").value = s.name; e.target.closest("button").textContent = s.supplier_name; } };
  const collect = () => {
    const v = vals(sh);
    const data = { inspection_type: v.inspection_type, location: v.location, date: v.date, supplier: v.supplier, result: v.result, remarks: v.remarks, photo_1: v.photo_1, photo_2: v.photo_2, checks: [], actions: [] };
    $$("[data-check]", sh).forEach((r) => { const i = r.dataset.check; const c = r.querySelector(`[name=c_${i}]`).value.trim(); if (c) data.checks.push({ check: c, result: r.querySelector(`[name=cr_${i}]`).value }); });
    if (v.result === "Fail") $$("[data-act-row]", sh).forEach((r) => { const i = r.dataset.actRow; const g = (k) => (r.querySelector(`[name=${k}_${i}]`) || {}).value || ""; if (g("ai").trim()) data.actions.push({ issue: g("ai"), action: g("aa"), responsible_person: g("ap"), target_date: g("ad"), photo: g("aph") }); });
    return data;
  };
  const save = async (submit) => {
    if (!need(sh, submit ? ["inspection_type", "result"] : ["inspection_type"])) return;
    const r = await run(sh, () => api("inspection_save", { data: collect(), submit: submit ? 1 : 0 }), submit ? t("Inspection submitted") : t("Draft saved"));
    if (r) { closeSheet(sh); render(); }
  };
  sh.querySelector("[data-draft]").onclick = () => save(false);
  sh.querySelector("[data-submit]").onclick = () => save(true);
}

function snagNewSheet() {
  const sh = sheet(t("Report a snag"), `<div class="form">
    ${fld(t("Photo of the problem"), `<div class="shots">${shot("photo", t("Take photo"), "", { wide: true })}</div>`, { req: true, name: "photo" })}
    ${fld(t("What is wrong"), area("description"), { req: true })}
    ${fld(t("Where"), inp("location", "", "text", `placeholder="${esc(t("e.g. ground floor kitchen"))}"`))}
    <div class="two">${fld(t("Who will fix it"), inp("responsible_person"))}${fld(t("Fix by"), inp("target_date", "", "date"))}</div>
  </div>`, { full: true, footer: `<button class="btn" data-x="1">${esc(t("Cancel"))}</button><button class="btn pri" data-save="1">${esc(t("Save snag"))}</button>` });
  wireForm(sh);
  sh.querySelector("[data-save]").onclick = async () => {
    if (!need(sh, ["photo", "description"])) return;
    const r = await run(sh, () => api("snag_save", { data: vals(sh) }), t("Snag reported"));
    if (r) { closeSheet(sh); if (location.hash.includes("snags")) render(); }
  };
}
function snagSheet(s) {
  const done = s.status === "Closed";
  const sh = sheet(t("Snag"), `<div class="form">
    ${s.photo ? `<img class="zoomable" src="${esc(s.photo)}" style="width:100%;max-height:260px;object-fit:cover;border-radius:14px" alt="">` : ""}
    <b style="font-size:16px">${esc(s.description)}</b>
    <div class="kv"><span>${esc(t("Where"))}</span><b>${esc(s.location || "—")}</b><span>${esc(t("Who will fix it"))}</span><b>${esc(s.responsible_person || s.supplier || "—")}</b><span>${esc(t("Fix by"))}</span><b>${esc(fdate(s.target_date) || "—")}</b><span>${esc(t("Status"))}</span><b>${esc(ST(s.status))}</b></div>
    ${done ? "" : fld(t("Photo after fixing"), `<div class="shots">${shot("fixed_photo", t("Take photo"), s.fixed_photo || "", { wide: true })}</div>`)}
    ${done ? "" : fld(t("Note"), area("note"))}
  </div>`, { footer: done ? `<button class="btn" data-x="1">${esc(t("Close"))}</button>` : `${s.status === "Open" ? `<button class="btn" data-st="In progress">${esc(t("Work started"))}</button>` : ""}<button class="btn" data-st="Fixed">${esc(t("Fixed"))}</button><button class="btn pri" data-st="Closed">${esc(t("Checked and closed"))}</button>` });
  wireForm(sh);
  sh.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-st]"); if (!b) return;
    const v = vals(sh);
    const r = await run(sh, () => api("snag_save", { data: { name: s.name, status: b.dataset.st, fixed_photo: v.fixed_photo || undefined, note: v.note } }), t("Snag updated"));
    if (r) { closeSheet(sh); render(); }
  });
}

/* ================================================================== stores */
VIEWS.store = async (el, [tab = "stock"]) => {
  setTop(t("Stores"));
  const tabs = [["stock", "Stock"], ["receive", "Receive"], ["release", "Release"], ["moves", "Movements"]];
  el.innerHTML = hubtabs("store", tabs, tab.split("?")[0]) + `<div id="pane" class="stack"><div class="spin"></div></div>`;
  const pane = $("#pane");
  tab = tab.split("?")[0];
  if (tab === "stock") {
    const q0 = decodeURIComponent((location.hash.split("?")[1] || ""));
    pane.innerHTML = `<div class="fld search">${icon("search")}<input name="q" value="${esc(q0)}" placeholder="${esc(t("Search items"))}" autocomplete="off"></div><div data-list></div>`;
    const list = pane.querySelector("[data-list]"), q = pane.querySelector("[name=q]"); let tm = null;
    const show = async () => {
      const d = await api("stock", { q: q.value.trim() });
      const groups = {}; d.rows.forEach((r) => { (groups[r.item_group] = groups[r.item_group] || []).push(r); });
      list.innerHTML = d.rows.length ? Object.entries(groups).map(([g, rows]) => panel(t(g), `<div class="lst">${rows.map((r) => lrow({ title: r.item_name, sub: esc(r.item_code), end: `<b>${num(r.qty)}</b><span class="small muted">${esc(t(r.uom))}</span>${r.low ? pill(t("Low"), "bad") : ""}`, chev: false })).join("")}</div>`, `<span class="cnt">${rows.length}</span>`)).join("") : empty(t("Nothing in the store yet"), t("Goods received against purchase orders show here."));
    };
    q.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(show, 300); });
    await show();
  } else if (tab === "receive") {
    const rows = await api("to_receive");
    pane.innerHTML = panel(t("Deliveries expected"), rows.length ? `<div class="lst">${rows.map((r) => lrow({ go: `receive/${r.name}`, ic: "truck", title: r.supplier_name, sub: `${esc(r.name)} · ${esc(t("needed by {0}", fdate(r.schedule_date)))}<span style="display:block;margin-top:6px">${bar(r.per_received, "mid")}</span>`, end: `<b>${num(r.per_received)}%</b><span class="small muted">${esc(t("received"))}</span>` })).join("")}</div>` : empty(t("Nothing to receive"), t("Locked purchase orders waiting for delivery appear here.")), `<span class="cnt">${rows.length}</span>`);
  } else if (tab === "release") {
    pane.innerHTML = `<div class="banner">${esc(t("Material leaves the store only against a name: the mistri or group head who takes it."))}</div><button class="btn pri big wide" data-act="rel">${icon("box")}${esc(t("Release material"))}</button><div data-moves></div>`;
    S.acts.rel = () => releaseSheet();
    const m = (await api("movements")).filter((x) => x.kind === "out");
    pane.querySelector("[data-moves]").innerHTML = panel(t("Released recently"), m.length ? `<div class="lst">${m.map(moveRow).join("")}</div>` : empty(t("Nothing released yet")));
  } else if (tab === "moves") {
    const m = await api("movements");
    pane.innerHTML = panel(t("Movements"), m.length ? `<div class="lst">${m.map(moveRow).join("")}</div>` : empty(t("No movements yet")));
  }
};
const moveRow = (x) => lrow({ ic: x.kind === "in" ? "truck" : "box", title: `${x.kind === "in" ? t("Received from {0}", x.who || "") : t("Released to {0}", x.who || "")}`,
  sub: esc(x.items.map((i) => `${i.item_name} ${num(i.qty)} ${t(i.uom)}`).join(", ")) + `<span style="display:block">${esc([fdate(x.date), x.ref, x.name].filter(Boolean).join(" · "))}</span>`, chev: false });

function releaseSheet() {
  S.rel = [];
  const sh = sheet(t("Release to work"), `<div class="form">
    ${fld(t("Released to (mistri or group head)"), inp("issued_to"), { req: true })}
    ${fld(t("Area / activity"), inp("work_area", "", "text", `placeholder="${esc(t("e.g. first floor slab"))}"`))}
    <div class="fld"><label>${esc(t("Items"))}${req(true)}</label><div data-items class="stack"></div><button type="button" class="btn wide" data-add="1">${icon("plus")}${esc(t("Add item from the store"))}</button></div>
    ${fld(t("Photo of the material going out"), `<div class="shots">${shot("photo", t("Take photo"))}</div>`)}
  </div>`, { full: true, footer: `<button class="btn" data-x="1">${esc(t("Cancel"))}</button><button class="btn pri" data-save="1">${esc(t("Release"))}</button>` });
  wireForm(sh);
  const box = sh.querySelector("[data-items]");
  const draw = () => { box.innerHTML = S.rel.map((r, i) => `<div class="line" data-skip="1"><div class="lt"><b>${esc(r.item_name)}</b><span class="small muted">${esc(t("in store: {0} {1}", num(r.stock), t(r.uom)))}</span><button type="button" class="sh-x" data-rm="${i}">${icon("x")}</button></div>${qtyBox(`q_${i}`, r.qty || "")}</div>`).join(""); };
  sh.querySelector("[data-add]").onclick = async () => { const it = await pickItem(t("Item from the store"), { stock: true }); if (it && !it.__new) { S.rel.push({ item_code: it.item_code, item_name: it.item_name, uom: it.uom, stock: it.qty, qty: "" }); draw(); } };
  box.addEventListener("click", (e) => { const r = e.target.closest("[data-rm]"); if (r) { S.rel.splice(+r.dataset.rm, 1); draw(); } });
  box.addEventListener("input", (e) => { const m = e.target.name && e.target.name.match(/^q_(\d+)$/); if (m) S.rel[+m[1]].qty = e.target.value; });
  sh.querySelector("[data-save]").onclick = async () => {
    if (!need(sh, ["issued_to"])) return;
    const items = S.rel.filter((r) => +r.qty > 0).map((r) => ({ item_code: r.item_code, qty: +r.qty }));
    if (!items.length) { sheetError(sh, t("Add at least one item and its quantity.")); return; }
    const v = vals(sh);
    const r = await run(sh, () => api("release", { items, issued_to: v.issued_to, work_area: v.work_area, photo: v.photo }), t("Released"));
    if (r) { closeSheet(sh); if (location.hash.includes("store")) render(); }
  };
}

/* receiving goods against a purchase order */
VIEWS.receive = async (el, [po]) => {
  setTop(t("Receive goods"), true); setTab("store");
  const d = await api("order_lines", { po });
  const R = S.b.rules || {};
  const pend = d.lines.filter((l) => l.pending > 0);
  el.innerHTML = `<div class="hero"><b>${esc(d.supplier_name)}</b><span class="small muted">${esc(d.name)} · ${esc(t("{0}% received so far", num(d.per_received)))}</span></div>
    ${panel(t("1. Supplier's delivery note (challan)"), `<div class="body form">
      ${fld(t("Photo of the delivery note"), `<div class="shots">${shot("dn_scan", t("Take photo"), "", { wide: true })}</div>`, { req: !!R.require_dn_scan, name: "dn_scan" })}
      ${S.b.ai ? `<button class="btn wide" data-act="ai">${icon("ai")}${esc(t("Read the quantities with AI"))}</button>` : ""}
      <div class="two">${fld(t("Delivery note no."), inp("dn_no"), { req: true })}${fld(t("Vehicle no."), inp("vehicle"))}</div></div>`)}
    ${panel(t("2. What arrived"), `<div class="body stack">${pend.length ? `<button class="btn sm" data-act="all">${esc(t("Everything still due arrived"))}</button>` : ""}${d.lines.map((l, i) => `<div class="line">
      <div class="lt"><b>${esc(l.item_name)}</b><span class="small muted">${esc(t("ordered {0} · received {1}", num(l.qty), num(l.received)))}</span></div>
      ${l.pending > 0 ? `<span class="small">${esc(t("Still due: {0} {1}", num(l.pending), t(l.uom)))}</span>${qtyBox(`q_${i}`, "")}` : `<span class="pill good">${esc(t("All received"))}</span>`}</div>`).join("")}</div>`)}
    ${panel(t("3. Who received it"), `<div class="body form">
      <div class="shots">${shot("receiver_photo", t("Photo of the person receiving") + (R.require_receiver_photo ? " *" : ""), "", { facing: "front" })}${shot("goods_photo", t("Photo of the material"))}</div>
      ${fld(t("Received by"), inp("received_by", S.b.full_name))}<input type="hidden" name="location"></div>`)}
    <button class="btn pri big wide" data-act="save">${icon("check")}${esc(t("Receive goods"))}</button><div data-err></div>`;
  wireForm(el);
  S.acts.all = () => { d.lines.forEach((l, i) => { const x = el.querySelector(`[name=q_${i}]`); if (x) x.value = l.pending; }); };
  S.acts.ai = async () => {
    const url = el.querySelector("[name=dn_scan]").value; if (!url) { toast(t("Take the photo of the delivery note first."), "bad"); return; }
    try {
      const r = await busy(api("read_challan", { po, file_url: url }), t("Reading the delivery note…"));
      if (r.docNo && !el.querySelector("[name=dn_no]").value) el.querySelector("[name=dn_no]").value = r.docNo;
      if (r.vehicle && !el.querySelector("[name=vehicle]").value) el.querySelector("[name=vehicle]").value = r.vehicle;
      let n = 0; (r.lines || []).forEach((x) => { if (x.index != null && x.qty) { const q = el.querySelector(`[name=q_${x.index}]`); if (q) { q.value = x.qty; n++; } } });
      toast(t("AI filled {0} lines. Check them against what you see.", n), "good");
    } catch (e) { toast(e.message, "bad"); }
  };
  S.acts.save = async () => {
    const need_ = ["dn_no"]; if (R.require_dn_scan) need_.push("dn_scan"); if (R.require_receiver_photo) need_.push("receiver_photo");
    if (!need(el, need_)) return;
    const v = vals(el);
    const lines = d.lines.map((l, i) => ({ po_detail: l.po_detail, qty: +(v[`q_${i}`] || 0) })).filter((x) => x.qty > 0);
    if (!lines.length) { toast(t("Enter the quantity received for at least one item."), "bad"); return; }
    if (!v.location) v.location = await getLocation().catch(() => "");
    try {
      const r = await busy(api("receive", { po, lines, dn_no: v.dn_no, dn_scan: v.dn_scan, receiver_photo: v.receiver_photo, goods_photo: v.goods_photo, vehicle: v.vehicle, received_by: v.received_by, location: v.location }), t("Saving…"));
      sheet(t("Goods received"), `<div class="stack" style="align-items:center;text-align:center"><span class="qa-i" style="--tc:var(--k1);width:64px;height:64px">${icon("check")}</span><b style="font-size:18px">${esc(r.name)}</b><span>${esc(t("The purchase order is now {0}% received.", num(r.po_status.per_received)))}</span></div>`,
        { footer: `<button class="btn pri" data-go="store/receive">${esc(t("Done"))}</button>` });
    } catch (e) { el.querySelector("[data-err]").innerHTML = `<div class="banner bad"><b>${esc(t("Not saved"))}</b>${esc(e.message)}</div>`; el.querySelector("[data-err]").scrollIntoView({ block: "center" }); }
  };
};

/* ================================================================== more */
VIEWS.more = async (el) => {
  setTop(t("More"));
  const c = C(); const b = S.b;
  const T = [];
  if (c.people) T.push(["Attendance", "users", "att", "k1"], ["Workers and site cards", "card", "workers", "k7"]);
  if (c.suppliers) T.push(["Suppliers", "truck", "suppliers", "k2"]);
  if (c.buy) T.push(["Quotations", "log", "quotes", "k6"], ["Purchase orders", "cart", "orders", "k5"]);
  if (c.money) T.push(["Bills and payments", "pay", "bills", "k8"], ["Budget", "budget", "budget", "k3"]);
  if (c.site) T.push(["Snags", "alert", "build/snags", "k4"], ["Site diary", "log", "build/diary", "k7"]);
  if (c.store) T.push(["Stock", "box", "store/stock", "k3"]);
  if (c.owner && !NATIVE && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) T.push(["Connect a phone", "globe", "connect", "k2"]);
  el.innerHTML = `<button class="mo-me" data-act="me"><span class="av">${b.image ? `<img src="${esc(b.image)}" alt="">` : esc((b.full_name || "?").charAt(0))}</span><span><b>${esc(b.full_name)}</b><span class="small muted">${esc(b.project_name || "")}</span></span>${icon("chev", "lch")}</button>
    <div class="qa-grid">${T.map(([l, ic, to, tc]) => `<button class="qa" data-go="${to}"><span class="qa-i" style="--tc:var(--${tc})">${icon(ic)}</span><span>${esc(t(l))}</span></button>`).join("")}</div>`;
};

/* ---------------- attendance ---------------- */
VIEWS.att = async (el) => {
  setTop(t("Attendance"), true);
  const d = await api("attendance_today");
  const A = S.att = { name: d && d.name, docstatus: d ? d.docstatus : 0, rows: (d && d.rows) || [], group_photo: d && d.group_photo, location: (d && d.location) || "" };
  const locked = A.docstatus === 1;
  const draw = () => {
    const p = A.rows.filter((r) => r.status === "Present").length, h = A.rows.filter((r) => r.status === "Half day").length;
    el.innerHTML = `<div class="hero"><span class="muted small">${esc(fdate(today()))}</span><b>${esc(t("{0} present · {1} half day", p, h))}</b></div>
      ${locked ? `<div class="banner good">${esc(t("Today's attendance is submitted."))}</div>` : `<div class="row"><button class="btn pri big" data-act="scan">${icon("card")}${esc(t("Scan site card"))}</button><button class="btn big" data-act="add">${icon("plus")}${esc(t("Add by name"))}</button></div>`}
      ${panel(t("Workers on site"), A.rows.length ? `<div class="lst">${A.rows.map((r, i) => `<div class="lrow static" style="flex-wrap:wrap">${r.worker_photo || r.photo ? `<img class="lth round zoomable" src="${esc(r.photo || r.worker_photo)}" alt="">` : `<span class="lth round">${icon("users")}</span>`}
        <span class="lmain"><b>${esc(r.worker_name || r.worker)}</b><span class="lsub">${esc([t(r.trade || ""), r.time_in].filter(Boolean).join(" · "))}</span></span>
        ${locked ? pill(t(r.status), r.status === "Present" ? "good" : r.status === "Absent" ? "bad" : "warn") : `<button class="sh-x" data-act="rm" data-v="${i}">${icon("x")}</button>
        <div class="seg" style="width:100%">${["Present", "Half day", "Absent"].map((s) => `<button data-act="st" data-v="${i}|${s}" aria-pressed="${r.status === s}">${esc(t(s))}</button>`).join("")}</div>`}</div>`).join("")}</div>` : empty(t("No one marked yet"), t("Scan each worker's site card.")), `<span class="cnt">${A.rows.length}</span>`)}
      ${panel(t("Team photo and location"), `<div class="body form">
        <div class="shots">${shot("group_photo", t("Team photo") + (S.b.rules.require_attendance_photo ? " *" : ""), A.group_photo || "", { wide: true })}</div>
        <div class="row"><span class="small" data-loc style="flex:1">${esc(A.location || t("Location not taken yet"))}</span>${locked ? "" : `<button class="btn sm" data-act="loc">${icon("globe")}${esc(t("Update location"))}</button>`}</div><input type="hidden" name="location" value="${esc(A.location)}"></div>`)}
      ${locked ? "" : `<div class="row"><button class="btn big" data-act="save">${esc(t("Save"))}</button><button class="btn pri big" data-act="submit">${icon("check")}${esc(t("Submit attendance"))}</button></div><div data-err></div>`}`;
    if (!locked) wireForm(el);
  };
  const persist = async (quiet) => {
    const v = vals(el); A.group_photo = v.group_photo || A.group_photo; A.location = v.location || A.location;
    try { const r = await api("attendance_save", { rows: A.rows, group_photo: A.group_photo, location: A.location }); A.name = r.name; if (!quiet) toast(t("Saved"), "good"); return true; } catch (e) { toast(e.message, "bad"); return false; }
  };
  const addWorker = async (w, scanned) => {
    if (!w) return;
    if (w.status !== "Active") { toast(t("{0} is {1} in the worker register: not allowed on site.", w.full_name, t(w.status)), "bad", w.photo); return; }
    if (A.rows.some((r) => r.worker === w.name)) { toast(t("{0} is already marked.", w.full_name), "", w.photo); return; }
    A.rows.unshift({ worker: w.name, worker_name: w.full_name, trade: w.trade, status: "Present", time_in: nowTime(), scanned: scanned ? 1 : 0, worker_photo: w.photo });
    toast(t("{0}: present. Check the face matches.", w.full_name), "good", w.photo);
    draw(); persist(true);
  };
  draw();
  if (!A.location && !locked) getLocation().then((l) => { if (l) { A.location = l; const x = el.querySelector("[data-loc]"); if (x) x.textContent = l; const h = el.querySelector("[name=location]"); if (h) h.value = l; } }).catch(() => {});
  Object.assign(S.acts, {
    async scan() { const code = await scanCode(t("Scan the worker's site card")); if (!code) return; try { const w = await api("mimaar.api.find_worker", { code }); if (!w) { toast(t("Card not recognised: {0}", code), "bad"); return; } addWorker(w, true); } catch (e) { toast(e.message, "bad"); } },
    async add() { const w = await pickWorker(); if (w) addWorker(w, false); },
    rm(i) { A.rows.splice(+i, 1); draw(); persist(true); },
    st(v) { const [i, s] = v.split("|"); A.rows[+i].status = s; draw(); persist(true); },
    async loc() { const l = await busy(getLocation(), t("Getting the location…")); if (!l) { toast(t("Location not available: allow location for Mimaar, then try again."), "bad"); return; } A.location = l; el.querySelector("[data-loc]").textContent = l; el.querySelector("[name=location]").value = l; },
    save() { persist(false); },
    async submit() {
      const v = vals(el); A.group_photo = v.group_photo || A.group_photo; A.location = v.location || A.location;
      try { await busy(api("attendance_save", { rows: A.rows, group_photo: A.group_photo, location: A.location, submit: 1 }), t("Saving…")); toast(t("Attendance submitted"), "good"); render(); }
      catch (e) { el.querySelector("[data-err]").innerHTML = `<div class="banner bad"><b>${esc(t("Not saved"))}</b>${esc(e.message)}</div>`; }
    },
  });
};

/* ---------------- workers ---------------- */
VIEWS.workers = async (el) => {
  setTop(t("Workers"), true);
  el.innerHTML = `<button class="btn pri big wide" data-act="new">${icon("plus")}${esc(t("Register a worker"))}</button><div class="fld search">${icon("search")}<input name="q" placeholder="${esc(t("Search by name or CNIC"))}"></div><div data-list><div class="spin"></div></div>`;
  const list = el.querySelector("[data-list]"), q = el.querySelector("[name=q]"); let tm = null;
  const show = async () => {
    const rows = await api("workers", { q: q.value.trim(), status: "" });
    const now = today();
    list.innerHTML = panel(t("Workers"), rows.length ? `<div class="lst">${rows.map((w) => { const exp = [w.cnic_expiry, w.entry_card_expiry].some((x) => x && x < now);
      return lrow({ go: `worker/${w.name}`, img: w.photo, title: w.full_name, sub: esc([t(w.trade || w.worker_type || ""), w.name].filter(Boolean).join(" · ")), end: `${w.status !== "Active" ? pill(t(w.status), "bad") : exp ? pill(t("Expired card"), "bad") : w.police_verification === "Verified" ? pill(t("Verified"), "good") : pill(t(w.police_verification || "Not done"), "warn")}` }); }).join("")}</div>` : empty(t("No workers yet"), t("Register each worker to print their site card.")), `<span class="cnt">${rows.length}</span>`);
  };
  q.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(show, 300); });
  S.acts.new = () => workerSheet();
  await show();
};
VIEWS.worker = async (el, [name]) => {
  setTop(t("Worker"), true); setTab("more");
  const rows = await api("workers", { q: name, status: "" });
  const w = rows.find((x) => x.name === name); if (!w) { el.innerHTML = empty(t("Not found")); return; }
  const now = today(); const warn = [];
  if (w.cnic_expiry && w.cnic_expiry < now) warn.push(t("CNIC expired on {0}", fdate(w.cnic_expiry)));
  if (w.entry_card_expiry && w.entry_card_expiry < now) warn.push(t("Entry card expired on {0}", fdate(w.entry_card_expiry)));
  if (w.police_verification !== "Verified") warn.push(t("Police verification: {0}", t(w.police_verification || "Not done")));
  el.innerHTML = `<div class="panel plain"><div class="body" style="display:flex;gap:14px;align-items:center">${w.photo ? `<img src="${esc(w.photo)}" class="zoomable" style="width:96px;height:112px;border-radius:14px;object-fit:cover" alt="">` : `<span class="lth" style="width:96px;height:112px">${icon("users")}</span>`}
    <div class="stack" style="gap:2px"><b style="font-size:19px">${esc(w.full_name)}</b><span class="muted">${esc(t(w.worker_type || ""))}${w.trade ? " · " + esc(t(w.trade)) : ""}</span><span class="small muted">${esc(w.name)}</span>${pill(t(w.status), w.status === "Active" ? "good" : "bad")}</div></div></div>
    ${warn.length ? `<div class="banner warn">${warn.map(esc).join("<br>")}</div>` : ""}
    ${panel(t("Details"), `<div class="body kv"><span>${esc(t("Father's name"))}</span><b>${esc(w.father_name || "—")}</b><span>${esc(t("Contractor / supplier"))}</span><b>${esc(w.contractor || "—")}</b><span>${esc(t("Mobile"))}</span><b class="ltr">${esc(w.phone || "—")}</b><span>${esc(t("CNIC"))}</span><b class="ltr">${esc(w.cnic || "—")}</b><span>${esc(t("Entry card"))}</span><b class="ltr">${esc(w.entry_card_no || "—")}</b>${C().money ? `<span>${esc(t("Daily wage"))}</span><b>${esc(w.daily_wage ? money(w.daily_wage) : "—")}</b>` : ""}</div>`)}
    <div class="row"><button class="btn big" data-act="edit">${icon("pencil")}${esc(t("Edit"))}</button><button class="btn pri big" data-act="card">${icon("card")}${esc(t("Print site card"))}</button></div>
    ${w.phone ? `<button class="btn wide" data-act="call">${icon("phone")}${esc(t("Call {0}", w.phone))}</button>` : ""}`;
  Object.assign(S.acts, {
    edit: () => workerSheet(w),
    // on the phone the card comes as a PDF (into Downloads, to print or send); on a computer the print window opens
    card: () => openOut(NATIVE ? `${location.origin}/api/method/frappe.utils.print_format.download_pdf?doctype=Site%20Worker&name=${encodeURIComponent(w.name)}&format=Site%20Worker%20Card&no_letterhead=1`
      : `${location.origin}/printview?doctype=Site%20Worker&name=${encodeURIComponent(w.name)}&format=Site%20Worker%20Card&no_letterhead=1&trigger_print=1`),
    call: () => openOut(`tel:${w.phone}`),
  });
};
function workerSheet(w = {}) {
  const trades = ["Mason", "Steel fixer", "Carpenter", "Shuttering", "Electrician", "Plumber", "Painter", "Tile and marble", "Welder", "Helper", "Other"];
  const sh = sheet(w.name ? t("Edit worker") : t("Register a worker"), `<div class="form">
    <div class="shots">${shot("photo", t("Face photo"), w.photo || "", { facing: "front" })}${shot("cnic_front", t("CNIC front"), w.cnic_front || "")}${shot("cnic_back", t("CNIC back"), w.cnic_back || "")}</div>
    ${fld(t("Name"), inp("full_name", w.full_name || ""), { req: true })}
    ${fld(t("Father's name"), inp("father_name", w.father_name || ""))}
    ${fld(t("Type"), chips("worker_type", ["Labour", "Mistri", "Group head", "Supervisor", "Supplier staff", "Other"], w.worker_type || "Labour"))}
    ${fld(t("Trade"), sel("trade", trades, w.trade || ""))}
    ${fld(t("Contractor / supplier"), `<button type="button" class="btn wide" data-sup="1">${esc(w.contractor || t("Choose (optional)"))}</button><input type="hidden" name="contractor" value="${esc(w.contractor || "")}">`)}
    <div class="two">${fld(t("Mobile"), inp("phone", w.phone || "", "tel"))}${C().money || C().owner ? fld(t("Daily wage"), inp("daily_wage", w.daily_wage || "", "number")) : ""}</div>
    <div class="two">${fld(t("CNIC"), inp("cnic", w.cnic || "", "text", 'inputmode="numeric" placeholder="42101-1234567-1"'))}${fld(t("CNIC expiry"), inp("cnic_expiry", w.cnic_expiry || "", "date"))}</div>
    <div class="two">${fld(t("Society entry card no. (e.g. Bahria Town)"), inp("entry_card_no", w.entry_card_no || ""))}${fld(t("Entry card expiry"), inp("entry_card_expiry", w.entry_card_expiry || "", "date"))}</div>
    ${fld(t("Police verification"), chips("police_verification", ["Not done", "Applied", "Verified"], w.police_verification || "Not done"))}
    ${w.name ? fld(t("Status"), chips("status", ["Active", "Left the site", "Blocked"], w.status || "Active")) : ""}
  </div>`, { full: true, footer: `<button class="btn" data-x="1">${esc(t("Cancel"))}</button><button class="btn pri" data-save="1">${esc(t("Save worker"))}</button>` });
  wireForm(sh);
  sh.querySelector("[data-sup]").onclick = async (e) => { const s = await pickSupplier(); if (s && !s.__new) { sh.querySelector("[name=contractor]").value = s.name; e.target.closest("button").textContent = s.supplier_name; } };
  sh.querySelector("[data-save]").onclick = async () => {
    if (!need(sh, ["full_name"])) return;
    const v = vals(sh); if (w.name) v.name = w.name;
    const r = await run(sh, () => api("worker_save", { data: v }), t("Worker saved"));
    if (r) { closeAll(); if (r.warnings && r.warnings.length) toast(r.warnings.join(" · "), "warn"); go(`worker/${r.name}`); }
  };
}

/* ---------------- suppliers ---------------- */
VIEWS.suppliers = async (el) => {
  setTop(t("Suppliers"), true);
  el.innerHTML = `${C().new_supplier ? `<button class="btn pri big wide" data-act="new">${icon("plus")}${esc(t("New supplier"))}</button>` : ""}<div class="fld search">${icon("search")}<input name="q" placeholder="${esc(t("Search suppliers"))}"></div><div data-list><div class="spin"></div></div>`;
  const list = el.querySelector("[data-list]"), q = el.querySelector("[name=q]"); let tm = null;
  const show = async () => {
    const rows = await api("suppliers", { q: q.value.trim() });
    list.innerHTML = panel(t("Suppliers"), rows.length ? `<div class="lst">${rows.map((s) => lrow({ go: `supplier/${s.name}`, ic: "truck", title: s.supplier_name, sub: esc(t(s.mimaar_work_area || s.supplier_group || "")), end: s.due ? `<b>${money(s.due, 1)}</b><span class="small muted">${esc(t("to pay"))}</span>` : "" })).join("")}</div>` : empty(t("No suppliers yet")), `<span class="cnt">${rows.length}</span>`);
  };
  q.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(show, 300); });
  S.acts.new = () => supplierSheet();
  await show();
};
function supplierSheet(prefill = {}) {
  return new Promise((resolve) => {
    const areas = ["Materials", "Grey structure", "Finishing", "Design", "Testing & verification", "Services"];
    const sh = sheet(t("New supplier"), `<div class="form">
      ${fld(t("Supplier name"), inp("name", prefill.name || ""), { req: true })}
      <div class="two">${fld(t("Mobile"), inp("phone", prefill.phone || "", "tel"))}${fld(t("Contact person"), inp("contact", prefill.contact || ""))}</div>
      ${fld(t("Work area"), chips("work_area", areas, prefill.work_area || "Materials"))}
      ${fld(t("Payment terms"), area("payment_terms", prefill.payment_terms || ""))}
      ${fld(t("Delivery time"), inp("delivery_time", prefill.delivery_time || ""))}
      ${fld(t("Address"), area("address", prefill.address || ""))}</div>`, { full: true, footer: `<button class="btn" data-x="1">${esc(t("Cancel"))}</button><button class="btn pri" data-save="1">${esc(t("Save supplier"))}</button>` });
    wireForm(sh);
    sh.querySelector("[data-save]").onclick = async () => {
      if (!need(sh, ["name"])) return;
      const r = await run(sh, () => api("supplier_new", { data: vals(sh) }), t("Supplier saved"));
      if (r) { closeSheet(sh); resolve(r); if (location.hash.includes("suppliers")) render(); }
    };
  });
}
VIEWS.supplier = async (el, [name]) => {
  setTop(t("Supplier"), true); setTab("more");
  const s = await api("supplier", { name });
  const sm = s.summary;
  el.innerHTML = `<div class="hero"><b>${esc(s.supplier_name)}</b><span class="small muted">${esc(t(s.work_area || ""))}</span></div>
    ${s.phone ? `<div class="row"><button class="btn big" data-act="call">${icon("phone")}${esc(t("Call"))}</button><button class="btn big good" data-act="wa">${icon("chat")}WhatsApp</button></div>` : ""}
    ${sm ? `<div class="ctiles">${tile(t("Ordered"), money(sm.ordered, 1), "", "", "k2")}${tile(t("Received"), money(sm.received, 1), "", "", "k1")}${tile(t("Billed"), money(sm.billed, 1), "", "", "k3")}${tile(t("Paid"), money(sm.paid, 1), "", "", "k5")}${tile(t("Balance"), money(sm.balance, 1), sm.advance ? t("{0} advance", money(sm.advance, 1)) : "", "", "k4")}${tile(t("Due now"), money(sm.due, 1), "", "", "k6")}</div>
      <button class="btn pri big wide" data-act="stmt">${icon("file")}${esc(t("Send account statement"))}</button>` : ""}
    ${panel(t("Purchase orders"), s.orders.length ? `<div class="lst">${s.orders.map((o) => lrow({ go: `order/${o.name}`, title: o.name, sub: esc(fdate(o.transaction_date)), end: `<b>${money(o.grand_total, 1)}</b>${pill(ST(o.status), "info")}` })).join("")}</div>` : empty(t("No orders yet")))}
    ${panel(t("Quotations"), s.quotes.length ? `<div class="lst">${s.quotes.map((q) => lrow({ go: `quote/${q.name}`, title: q.name, sub: esc(fdate(q.transaction_date)), end: `<b>${money(q.grand_total, 1)}</b>${q.mimaar_final ? pill(t("Final"), "good") : q.docstatus ? pill(t("Confirmed"), "info") : pill(t("Draft"), "warn")}` })).join("")}</div>` : empty(t("No quotations yet")))}
    ${s.rows && s.rows.length ? panel(t("Account"), `<div class="body" style="overflow-x:auto"><table class="tbl"><tr><th>${esc(t("Date"))}</th><th>${esc(t("Document"))}</th><th class="r">${esc(t("Billed"))}</th><th class="r">${esc(t("Paid"))}</th><th class="r">${esc(t("Balance"))}</th></tr>${s.rows.map((r) => `<tr><td>${esc(fdate(r.date))}</td><td class="small">${esc(t(r.voucher_type || ""))}<br>${esc(r.ref || r.voucher_no || "")}</td><td class="r num">${r.billed ? num(r.billed) : ""}</td><td class="r num">${r.paid ? num(r.paid) : ""}</td><td class="r num">${num(r.balance)}</td></tr>`).join("")}</table></div>`) : ""}`;
  Object.assign(S.acts, {
    call: () => openOut(`tel:${s.phone}`),
    wa: () => openOut(`https://wa.me/${s.phone}`),
    async stmt() { try { const r = await busy(api("statement_share", { supplier: s.name }), t("Making the PDF…")); shareSheet(t("Account statement"), r); } catch (e) { toast(e.message, "bad"); } },
  });
};
function shareSheet(title, r) {
  const sh = sheet(title, `<div class="stack"><p style="margin:0">${esc(t("Send it to the supplier on WhatsApp, or open the PDF."))}</p>
    <button class="btn good big" data-wa="1">${icon("chat")}WhatsApp</button><button class="btn big" data-pdf="1">${icon("file")}${esc(t("Open PDF"))}</button></div>`);
  sh.querySelector("[data-wa]").onclick = () => openOut(r.whatsapp);
  sh.querySelector("[data-pdf]").onclick = () => openOut(r.pdf || r.url);
}

/* ---------------- quotations ---------------- */
const qstate = (s) => pill(ST(s), s === "Final" ? "good" : s === "Confirmed" ? "info" : s === "Draft" ? "warn" : "");
VIEWS.quotes = async (el) => {
  setTop(t("Quotations"), true);
  const st = (location.hash.split("?")[1] || "");
  const rows = await api("quotations", { state: st || null });
  el.innerHTML = `<div class="row">${S.b.ai ? `<button class="btn pri big" data-act="scan">${icon("ai")}${esc(t("Scan a quotation"))}</button>` : ""}<button class="btn big" data-act="type">${icon("plus")}${esc(t("Type a quotation"))}</button></div>
    <div class="seg">${[["", "All"], ["Draft", "Draft"], ["Confirmed", "Confirmed"], ["Final", "Final"]].map(([v, l]) => `<button data-go="quotes${v ? "?" + v : ""}" aria-pressed="${st === v}">${esc(t(l))}</button>`).join("")}</div>
    ${panel(t("Quotations"), rows.length ? `<div class="lst">${rows.map((q) => lrow({ go: `quote/${q.name}`, title: q.supplier_name, sub: esc([q.name, q.quotation_number, fdate(q.transaction_date), q.mimaar_revision ? t("revision {0}", q.mimaar_revision) : ""].filter(Boolean).join(" · ")), end: `<b>${money(q.grand_total, 1)}</b>${qstate(q.state)}` })).join("")}</div>` : empty(t("No quotations yet"), t("Scan the supplier's quotation to start.")), `<span class="cnt">${rows.length}</span>`)}`;
  Object.assign(S.acts, { scan: () => scanQuote(), type: () => quoteEditor({}) });
};
async function scanQuote() {
  if (!S.b.ai) { toast(t("AI reading is off. The owner can turn it on in Mimaar Settings."), "bad"); return quoteEditor({}); }
  const p = await takePhoto(t("Supplier's quotation")); if (!p) return;
  try {
    const d = await busy(api("quotation_read", { file_url: p.url }), t("Reading the quotation…"));
    quoteEditor({ ai: d, document: p.url });
  } catch (e) { toast(e.message, "bad"); quoteEditor({ document: p.url }); }
}
/** Draft quotation editor: supplier, lines, terms. From an AI reading, typed, or editing a draft. */
function quoteEditor({ ai, document, q }) {
  const L = (q ? q.lines.map((l) => ({ item_code: l.item_code, item_name: l.item_name, uom: l.uom, qty: l.qty, rate: l.rate })) : ai ? ai.lines.map((l) => ({ item_code: l.item_code, item_name: l.item_name || "", text: l.text, uom: l.uom, qty: l.qty, rate: l.rate, discount_percentage: l.discount_percentage })) : [{ qty: 1 }]);
  const sup = { name: q ? q.supplier : ai ? ai.supplier : "", label: q ? q.supplier_name : ai && ai.supplier ? ai.supplier_name || ai.supplier : "", details: ai ? ai.supplier_details : null };
  const terms = q || (ai ? { payment_terms: ai.payment_terms, advance_percent: ai.advance_percent, delivery_time: ai.delivery_time, number: ai.quotation_number, date: ai.transaction_date } : {});
  const sh = sheet(q ? t("Edit quotation {0}", q.name) : t("New quotation"), `<div class="form">
    ${ai ? `<div class="banner">${esc(t("Read by AI. Check every line against the paper before saving."))}</div>` : ""}
    ${fld(t("Supplier"), `<button type="button" class="btn wide" data-sup="1">${esc(sup.label || (sup.details && sup.details.name ? t("New: {0}", sup.details.name) : t("Choose the supplier")))}</button>`, { req: true })}
    <div class="two">${fld(t("Their quotation no."), inp("number", terms.number || ""))}${fld(t("Date"), inp("date", terms.date || today(), "date"))}</div>
    <div class="fld"><label>${esc(t("Lines"))}${req(true)}</label><div data-lines class="stack"></div><button type="button" class="btn sm" data-addl="1">${icon("plus")}${esc(t("Add line"))}</button></div>
    <div class="tot"><span>${esc(t("Total"))}</span><span data-total class="num"></span></div>
    ${fld(t("Payment terms"), area("payment_terms", terms.payment_terms || "", `placeholder="${esc(t("e.g. 30% advance, 60% on delivery, 10% after testing"))}"`), { req: true })}
    <div class="two">${fld(t("Advance (%)"), inp("advance_percent", terms.advance_percent || "", "number"))}${fld(t("Delivery / completion time"), inp("delivery_time", terms.delivery_time || ""), { req: true })}</div>
    ${q && q.amended_from ? fld(t("What changed in this revision"), area("revision_note", q.revision_note || ""), { req: true }) : ""}
    ${document || (q && q.document) ? `<div class="thumbs"><img src="${esc(document || q.document)}" alt=""></div>` : ""}
  </div>`, { full: true, footer: `<button class="btn" data-x="1">${esc(t("Cancel"))}</button><button class="btn pri" data-save="1">${esc(t("Save draft"))}</button>` });
  wireForm(sh);
  const box = sh.querySelector("[data-lines]");
  const total = () => { sh.querySelector("[data-total]").textContent = money(L.reduce((a, l) => a + (+l.qty || 0) * (+l.rate || 0) * (1 - (+l.discount_percentage || 0) / 100), 0)); };
  const draw = () => {
    box.innerHTML = L.map((l, i) => `<div class="line" data-skip="1"><div class="lt"><button type="button" class="btn sm" style="flex:1;justify-content:flex-start;white-space:normal;text-align:start" data-item="${i}">${esc(l.item_name || l.item_code || (l.new_item ? t("New item: {0}", l.new_item) : t("Choose the item")))}</button><button type="button" class="sh-x" data-rml="${i}">${icon("x")}</button></div>
      ${l.text && !l.item_code && !l.new_item ? `<span class="small" style="color:var(--bad)">${esc(t("On the paper: {0}", l.text))}</span>` : l.text ? `<span class="small muted">${esc(t("On the paper: {0}", l.text))}</span>` : ""}
      <div class="two"><div class="fld"><label>${esc(t("Quantity"))}${l.uom ? ` (${esc(t(l.uom))})` : ""}</label><input type="number" inputmode="decimal" step="any" data-k="qty" data-i="${i}" value="${esc(l.qty ?? "")}"></div><div class="fld"><label>${esc(t("Rate (Rs)"))}</label><input type="number" inputmode="decimal" step="any" data-k="rate" data-i="${i}" value="${esc(l.rate ?? "")}"></div></div></div>`).join("");
    total();
  };
  draw();
  box.addEventListener("input", (e) => { const k = e.target.dataset.k; if (k) { L[+e.target.dataset.i][k] = e.target.value; total(); } });
  box.addEventListener("click", async (e) => {
    const r = e.target.closest("[data-rml]"); if (r) { L.splice(+r.dataset.rml, 1); draw(); return; }
    const it = e.target.closest("[data-item]"); if (it) {
      const l = L[+it.dataset.item];
      const x = await pickItem(t("Choose the item"), { allowNew: C().new_item });
      if (!x) return;
      if (x.__new !== undefined) { const nm = x.__new || l.text || ""; const v = await ask(t("New item"), t("Name of the new item"), nm); if (v) { l.new_item = v; l.item_code = ""; l.item_name = ""; } }
      else { l.item_code = x.name; l.item_name = x.item_name; l.uom = l.uom || x.stock_uom; l.new_item = ""; }
      draw();
    }
  });
  sh.querySelector("[data-addl]").onclick = () => { L.push({ qty: 1 }); draw(); };
  sh.querySelector("[data-sup]").onclick = async (e) => {
    const s = await pickSupplier(); if (!s) return;
    if (s.__new !== undefined) return;
    sup.name = s.name; sup.label = s.supplier_name; sup.details = null; e.target.closest("button").textContent = s.supplier_name;
  };
  if (!sup.name && sup.details && sup.details.name && C().new_supplier) {
    sh.querySelector("[data-sup]").insertAdjacentHTML("afterend", `<button type="button" class="btn sm" data-newsup="1">${icon("plus")}${esc(t("Register {0} as a new supplier", sup.details.name))}</button>`);
    sh.querySelector("[data-newsup]").onclick = async () => { const n = await supplierSheet({ name: sup.details.name, phone: sup.details.phone, contact: sup.details.contact, address: sup.details.address, payment_terms: terms.payment_terms, delivery_time: terms.delivery_time }); if (n) { sup.name = n; sup.label = n; sh.querySelector("[data-sup]").textContent = n; sh.querySelector("[data-newsup]").remove(); } };
  }
  sh.querySelector("[data-save]").onclick = async () => {
    if (!sup.name) { sheetError(sh, t("Choose the supplier.")); return; }
    if (!need(sh, ["payment_terms", "delivery_time"].concat(q && q.amended_from ? ["revision_note"] : []))) return;
    const bad = L.find((l) => !(l.item_code || l.new_item));
    if (bad) { sheetError(sh, t("Choose the catalogue item for every line (or add it as a new item).")); return; }
    const v = vals(sh);
    const data = { name: q && q.name, supplier: sup.name, number: v.number, date: v.date, payment_terms: v.payment_terms, advance_percent: v.advance_percent, delivery_time: v.delivery_time, revision_note: v.revision_note, document: document || undefined,
      lines: L.filter((l) => +l.qty > 0).map((l) => ({ item_code: l.item_code, new_item: l.new_item, uom: l.uom, qty: +l.qty, rate: +l.rate, discount_percentage: +l.discount_percentage || 0, text: l.text })) };
    const r = await run(sh, () => api("quotation_save", { data }), t("Draft saved"));
    if (r) { closeAll(); go(`quote/${r}`); }
  };
}
VIEWS.quote = async (el, [name]) => {
  setTop(t("Quotation"), true); setTab("more");
  const q = await api("quotation", { name });
  const help = { Draft: t("Check the lines and terms, then confirm. A confirmed quotation can't be changed."), Confirmed: t("When the price is agreed, lock it as final. To change anything, make a revision."), Final: t("Locked as final. Raise the purchase order from it."), Replaced: t("Replaced by a newer revision."), Cancelled: t("Cancelled.") }[q.state] || "";
  el.innerHTML = `<div class="hero"><b>${esc(q.supplier_name)}</b><span class="small muted">${esc([q.name, q.number, fdate(q.date), q.revision ? t("revision {0}", q.revision) : ""].filter(Boolean).join(" · "))}</span></div>
    <div class="banner ${q.state === "Final" ? "good" : q.state === "Draft" ? "warn" : ""}"><b>${qstate(q.state)}</b>${esc(help)}${q.revision_note ? `<br>${esc(t("What changed: {0}", q.revision_note))}` : ""}</div>
    ${panel(t("Lines"), `<div class="body" style="overflow-x:auto"><table class="tbl"><tr><th>${esc(t("Item"))}</th><th class="r">${esc(t("Qty"))}</th><th class="r">${esc(t("Rate"))}</th><th class="r">${esc(t("Amount"))}</th></tr>${q.lines.map((l) => `<tr><td>${esc(l.item_name)}</td><td class="r num">${num(l.qty)} ${esc(t(l.uom))}</td><td class="r num">${num(l.rate)}</td><td class="r num">${num(l.amount)}</td></tr>`).join("")}</table></div><div class="tot" style="margin:0 14px 14px"><span>${esc(t("Total"))}</span><span class="num">${money(q.grand_total)}</span></div>`)}
    ${panel(t("Terms"), `<div class="body kv"><span>${esc(t("Payment terms"))}</span><b>${esc(q.payment_terms || "—")}</b><span>${esc(t("Advance"))}</span><b>${esc(q.advance_percent ? q.advance_percent + "%" : "—")}</b><span>${esc(t("Delivery / completion time"))}</span><b>${esc(q.delivery_time || "—")}</b></div>`)}
    ${q.document ? `<div class="thumbs"><img src="${esc(q.document)}" alt=""></div>` : ""}
    <div class="stack" data-actions></div>`;
  const A = el.querySelector("[data-actions]");
  if (q.state === "Draft") A.innerHTML = `<button class="btn big" data-act="edit">${icon("pencil")}${esc(t("Edit"))}</button><button class="btn pri big" data-act="confirm">${icon("check")}${esc(t("Confirm quotation"))}</button>`;
  if (q.state === "Confirmed") A.innerHTML = `<button class="btn pri big" data-act="lock">${icon("shield")}${esc(t("Lock as final"))}</button><button class="btn big" data-act="revise">${esc(t("Make a revision"))}</button>`;
  if (q.state === "Final") A.innerHTML = q.po ? `<button class="btn big" data-go="order/${esc(q.po)}">${icon("cart")}${esc(t("Open purchase order {0}", q.po))}</button>` : `<button class="btn pri big" data-act="po">${icon("cart")}${esc(t("Raise the purchase order"))}</button>`;
  Object.assign(S.acts, {
    edit: () => quoteEditor({ q }),
    async confirm() { if (!(await confirmBox(t("Confirm quotation"), t("After confirming, this quotation can't be changed; a change is a new revision."), t("Confirm")))) return; try { await busy(api("quotation_confirm", { name })); toast(t("Confirmed"), "good"); render(); } catch (e) { toast(e.message, "bad"); } },
    async lock() { if (!(await confirmBox(t("Lock as final"), t("The final quotation can't be revised again. The purchase order is raised from it."), t("Lock as final")))) return; try { await busy(api("quotation_lock", { name })); toast(t("Locked as final"), "good"); render(); } catch (e) { toast(e.message, "bad"); } },
    async revise() { const note = await ask(t("Make a revision"), t("What changed (price, discount or items)?"), "", { area: true }); if (!note) return; try { const n = await busy(api("quotation_revise", { name, note })); toast(t("Revision made: change it and confirm again"), "good"); go(`quote/${n}`); } catch (e) { toast(e.message, "bad"); } },
    async po() { try { const n = await busy(api("order_from_quotation", { quotation: name }), t("Saving…")); toast(t("Purchase order drafted"), "good"); go(`order/${n}`); } catch (e) { toast(e.message, "bad"); } },
  });
};

/* ---------------- purchase orders ---------------- */
VIEWS.orders = async (el) => {
  setTop(t("Purchase orders"), true);
  const rows = await api("orders");
  el.innerHTML = panel(t("Purchase orders"), rows.length ? `<div class="lst">${rows.map((o) => lrow({ go: `order/${o.name}`, ic: "cart", title: o.supplier_name, sub: `${esc([o.name, fdate(o.transaction_date)].join(" · "))}${o.docstatus ? `<span style="display:block;margin-top:6px">${bar(o.per_received, "mid")}</span>` : ""}`, end: `<b>${money(o.grand_total, 1)}</b>${o.docstatus === 0 ? pill(t("Draft"), "warn") : pill(ST(o.status), o.status === "Completed" ? "good" : "info")}` })).join("")}</div>` : empty(t("No purchase orders yet"), t("Purchase orders are raised from a final quotation.")), `<span class="cnt">${rows.length}</span>`);
};
VIEWS.order = async (el, [name]) => {
  setTop(t("Purchase order"), true); setTab("more");
  const o = await api("order", { name }); const c = C();
  el.innerHTML = `<div class="hero"><b>${esc(o.supplier_name)}</b><span class="small muted">${esc([o.name, fdate(o.date), o.quotation ? t("from {0}", o.quotation) : ""].filter(Boolean).join(" · "))}</span></div>
    <div class="banner ${o.docstatus === 0 ? "warn" : "good"}"><b>${o.docstatus === 0 ? esc(ST("Draft")) : esc(ST(o.status))}</b>${esc(o.docstatus === 0 ? t("Check it, then lock it. Only a locked purchase order can be sent to the supplier.") : t("Locked. {0}% received, {1}% billed.", num(o.per_received), num(o.per_billed)))}</div>
    ${panel(t("Lines"), `<div class="body" style="overflow-x:auto"><table class="tbl"><tr><th>${esc(t("Item"))}</th><th class="r">${esc(t("Qty"))}</th><th class="r">${esc(t("Received"))}</th>${o.grand_total != null ? `<th class="r">${esc(t("Rate"))}</th>` : ""}</tr>${o.lines.map((l) => `<tr><td>${esc(l.item_name)}</td><td class="r num">${num(l.qty)} ${esc(t(l.uom))}</td><td class="r num">${num(l.received)}</td>${o.grand_total != null ? `<td class="r num">${num(l.rate)}</td>` : ""}</tr>`).join("")}</table></div>${o.grand_total != null ? `<div class="tot" style="margin:0 14px 14px"><span>${esc(t("Total"))}</span><span class="num">${money(o.grand_total)}</span></div>` : ""}`)}
    ${panel(t("Terms"), `<div class="body kv"><span>${esc(t("Needed by"))}</span><b>${esc(fdate(o.schedule_date))}</b><span>${esc(t("Payment terms"))}</span><b>${esc(o.payment_terms || "—")}</b><span>${esc(t("Advance"))}</span><b>${esc(o.advance_percent ? `${o.advance_percent}% · ${t("paid {0}", money(o.advance_paid))}` : "—")}</b><span>${esc(t("Delivery / completion time"))}</span><b>${esc(o.delivery_time || "—")}</b></div>`)}
    <div class="stack" data-actions></div>`;
  const A = el.querySelector("[data-actions]"); const btns = [];
  if (o.docstatus === 0 && c.buy) btns.push(`<button class="btn pri big" data-act="lock">${icon("shield")}${esc(t("Lock purchase order"))}</button>`);
  if (o.docstatus === 1) {
    if (c.buy) btns.push(`<button class="btn good big" data-act="send">${icon("chat")}${esc(t("Send to supplier (WhatsApp / PDF)"))}</button>`);
    if (c.store && o.per_received < 100 && !["Closed", "Completed"].includes(o.status)) btns.push(`<button class="btn big" data-go="receive/${esc(o.name)}">${icon("truck")}${esc(t("Receive goods"))}</button>`);
    if (c.money && o.advance_left > 1) btns.push(`<button class="btn pri big" data-act="adv">${icon("pay")}${esc(t("Pay advance (up to {0})", money(o.advance_left)))}</button>`);
  }
  A.innerHTML = btns.join("");
  Object.assign(S.acts, {
    async lock() { if (!(await confirmBox(t("Lock purchase order"), t("A locked purchase order can't be changed or cancelled. Check the quantities, rates and terms first."), t("Lock")))) return; try { await busy(api("order_lock", { name })); toast(t("Locked"), "good"); render(); } catch (e) { toast(e.message, "bad"); } },
    async send() { try { const r = await busy(api("share", { doctype: "Purchase Order", name }), t("Making the PDF…")); shareSheet(t("Send purchase order"), r); } catch (e) { toast(e.message, "bad"); } },
    adv() { paySheet({ doctype: "Purchase Order", name, supplier_name: o.supplier_name, amount: o.advance_left, title: t("Advance on {0}", name) }); },
  });
};

/* ---------------- bills and payments ---------------- */
VIEWS.bills = async (el) => {
  setTop(t("Bills and payments"), true);
  const d = await api("bills");
  S.cache.bills = d;
  el.innerHTML = `${panel(t("Bills to pay"), d.open.length ? `<div class="lst">${d.open.map((b, i) => lrow({ act: "pay", data: i, title: b.supplier_name, dot: b.due_now ? "bad" : "info", sub: esc([b.bill_no ? t("bill {0}", b.bill_no) : b.name, b.due_date ? t("due {0}", fdate(b.due_date)) : ""].filter(Boolean).join(" · ")), end: `<b>${money(b.outstanding_amount)}</b>${b.due_now ? pill(t("Due now"), "bad") : ""}` })).join("")}</div>` : empty(t("Nothing to pay"), t("Bills recorded against goods received show here.")), `<span class="cnt">${d.open.length}</span>`)}
    ${panel(t("Goods received: record the bill"), d.to_bill.length ? `<div class="lst">${d.to_bill.map((r, i) => lrow({ act: "bill", data: i, ic: "log", title: r.supplier_name, sub: esc([r.name, r.supplier_delivery_note ? t("challan {0}", r.supplier_delivery_note) : "", fdate(r.posting_date)].filter(Boolean).join(" · ")), end: `<b>${money(r.grand_total)}</b>` })).join("")}</div>` : empty(t("No bills to record")), `<span class="cnt">${d.to_bill.length}</span>`)}
    ${panel(t("Advances agreed"), d.advances.length ? `<div class="lst">${d.advances.map((a, i) => lrow({ act: "adv", data: i, ic: "pay", title: a.supplier_name, sub: esc(t("{0}% advance on {1}", a.percent, a.name)), end: `<b>${money(a.left)}</b><span class="small muted">${esc(t("can be paid"))}</span>` })).join("")}</div>` : empty(t("No advances waiting")))}
    ${panel(t("Paid recently"), d.paid.length ? `<div class="lst">${d.paid.map((p) => lrow({ ic: "check", title: p.party_name, sub: esc([fdate(p.posting_date), t(p.mode_of_payment || ""), p.reference_no, p.name].filter(Boolean).join(" · ")), end: `<b>${money(p.paid_amount)}</b>`, chev: false })).join("")}</div>` : empty(t("No payments yet")))}`;
  Object.assign(S.acts, {
    pay: (i) => { const b = d.open[+i]; paySheet({ doctype: "Purchase Invoice", name: b.name, supplier_name: b.supplier_name, amount: b.outstanding_amount, title: t("Pay {0}", b.supplier_name) }); },
    adv: (i) => { const a = d.advances[+i]; paySheet({ doctype: "Purchase Order", name: a.name, supplier_name: a.supplier_name, amount: a.left, title: t("Advance on {0}", a.name) }); },
    bill: (i) => billSheet(d.to_bill[+i]),
  });
};
function paySheet({ doctype, name, supplier_name, amount, title }) {
  const sh = sheet(title, `<div class="form">
    <div class="kv"><span>${esc(t("Supplier"))}</span><b>${esc(supplier_name)}</b><span>${esc(t("Against"))}</span><b>${esc(name)}</b><span>${esc(t("At most"))}</span><b>${money(amount)}</b></div>
    ${fld(t("Amount (Rs)"), inp("amount", Math.round(amount * 100) / 100, "number"), { req: true })}
    ${fld(t("Paid by"), chips("mode", [["Cash", t("Cash")], ["Bank", t("Bank transfer")], ["Cheque", t("Cheque")]], "Cash"))}
    <div data-ref hidden class="two">${fld(t("Transaction / cheque no."), inp("reference_no"), { req: true })}${fld(t("Date"), inp("reference_date", today(), "date"))}</div>
    ${fld(t("Proof of payment"), `<div class="shots">${shot("proof", t("Transfer screenshot, cheque or receipt"), "", { wide: true })}${shot("proof_2", t("Supplier's receipt (optional)"))}</div>`, { req: !!S.b.rules.require_payment_proof, name: "proof" })}
  </div>`, { full: true, footer: `<button class="btn" data-x="1">${esc(t("Cancel"))}</button><button class="btn pri" data-save="1">${icon("pay")}${esc(t("Pay"))}</button>` });
  wireForm(sh);
  sh.addEventListener("chip", (e) => { if (e.target.closest("[data-chips=mode]")) sh.querySelector("[data-ref]").hidden = e.detail === "Cash"; });
  sh.querySelector("[data-save]").onclick = async () => {
    const v = vals(sh); const n = ["amount"]; if (v.mode !== "Cash") n.push("reference_no"); if (S.b.rules.require_payment_proof) n.push("proof");
    if (!need(sh, n)) return;
    if (+v.amount > amount + 1) { sheetError(sh, t("You can pay at most {0} here.", money(amount))); return; }
    if (!(await confirmBox(t("Pay"), t("Pay {0} to {1}?", money(v.amount), supplier_name), t("Pay")))) return;
    const r = await run(sh, () => api("pay", { doctype, name, amount: +v.amount, mode: v.mode, reference_no: v.reference_no, reference_date: v.reference_date, proof: v.proof, proof_2: v.proof_2 }), t("Payment saved"));
    if (r) { closeSheet(sh); render(); }
  };
}
function billSheet(r) {
  const sh = sheet(t("Record the bill"), `<div class="form">
    <div class="kv"><span>${esc(t("Supplier"))}</span><b>${esc(r.supplier_name)}</b><span>${esc(t("Goods received"))}</span><b>${esc(r.name)}</b><span>${esc(t("Amount"))}</span><b>${money(r.grand_total)}</b></div>
    ${fld(t("Photo of the bill"), `<div class="shots">${shot("bill_scan", t("Take photo"), "", { wide: true })}</div>`, { req: !!S.b.rules.require_bill_scan, name: "bill_scan" })}
    <div class="two">${fld(t("Bill no."), inp("bill_no"), { req: true })}${fld(t("Bill date"), inp("bill_date", today(), "date"))}</div>
    ${fld(t("Pay by (due date)"), inp("due_date", "", "date"))}
  </div>`, { full: true, footer: `<button class="btn" data-x="1">${esc(t("Cancel"))}</button><button class="btn pri" data-save="1">${esc(t("Record bill"))}</button>` });
  wireForm(sh);
  sh.querySelector("[data-save]").onclick = async () => {
    const n = ["bill_no"]; if (S.b.rules.require_bill_scan) n.push("bill_scan");
    if (!need(sh, n)) return;
    const v = vals(sh);
    const x = await run(sh, () => api("bill_from_receipt", { receipt: r.name, bill_no: v.bill_no, bill_date: v.bill_date, bill_scan: v.bill_scan, due_date: v.due_date || null }), t("Bill recorded"));
    if (x) { closeSheet(sh); render(); }
  };
}

/* ---------------- budget ---------------- */
VIEWS.budget = async (el) => {
  setTop(t("Budget"), true);
  const rows = await api("budget");
  const tb = rows.reduce((a, r) => a + r.budget, 0), ta = rows.reduce((a, r) => a + r.actual, 0), to = rows.reduce((a, r) => a + r.ordered, 0);
  el.innerHTML = `<div class="ctiles">${tile(t("Budget"), money(tb, 1), "", "", "k5")}${tile(t("Ordered"), money(to, 1), tb ? `${num((to / tb) * 100)}%` : "", "", "k2")}${tile(t("Spent (billed)"), money(ta, 1), tb ? `${num((ta / tb) * 100)}%` : "", "", "k6")}${tile(t("Left to spend"), money(tb - Math.max(ta, to), 1), "", "", "k1")}</div>` +
    panel(t("Budget lines"), rows.length ? `<div class="lst">${rows.map((r) => { const p = r.budget ? (Math.max(r.actual, r.ordered) / r.budget) * 100 : 0;
      return lrow({ title: r.name || r.account, sub: `${esc(t("ordered {0} · spent {1}", money(r.ordered, 1), money(r.actual, 1)))}<span style="display:block;margin-top:6px">${bar(p, p > 100 ? "late" : "mid")}</span>`, end: `<b>${money(r.budget, 1)}</b>${p > 100 ? pill(t("Over"), "bad") : ""}`, chev: false }); }).join("")}</div>` : empty(t("No budget yet")));
};

/* ---------------- connect a phone (laptop test set-up) ---------------- */
VIEWS.connect = async (el) => {
  setTop(t("Connect a phone"), true);
  const u = new URLSearchParams(location.hash.split("?")[1] || "").get("u") || "";
  let img = ""; if (u) { try { img = await api("qr", { text: u }); } catch (e) { /* */ } }
  el.innerHTML = panel(t("Connect a phone"), `<div class="body stack" style="align-items:center;text-align:center">
    ${u ? `${img ? `<img src="${esc(img)}" alt="" style="width:240px;height:240px;background:#fff;padding:10px;border-radius:14px">` : ""}<b class="ltr" style="font-size:20px">${esc(u)}</b>
      <span>${esc(t("On the phone, open the Mimaar ERP app, tap 'Scan the QR on the laptop' and point it here. The phone and this laptop must be on the same Wi-Fi."))}</span>`
      : `<span>${esc(t("Double-click 'Connect a phone' in the Mimaar ERP folder on this laptop. It shows the address and QR code for the phone."))}</span>`}</div>`);
};

/* ---------------- sign in ---------------- */
function loginScreen() {
  document.documentElement.lang = S.lang; document.documentElement.dir = S.lang === "ur" ? "rtl" : "ltr";
  $("#app").innerHTML = `<div class="login stack"><div class="logo">M</div><h1 style="text-align:center">${esc(t("Mimaar"))}</h1><p class="muted" style="text-align:center;margin:0">${esc(t("Sign in to your project"))}</p>
    <div class="seg"><button data-l="en" aria-pressed="${S.lang === "en"}">English</button><button data-l="ur" aria-pressed="${S.lang === "ur"}">اردو</button></div>
    <div class="form"><div class="fld"><label>${esc(t("Email or user name"))}</label><input name="usr" autocomplete="username" autocapitalize="none" class="ltr"></div><div class="fld"><label>${esc(t("Password"))}</label><input name="pwd" type="password" autocomplete="current-password" class="ltr"></div>
    <div data-err></div><button class="btn pri big wide" data-login="1">${esc(t("Sign in"))}</button></div></div>`;
  $$("[data-l]").forEach((b) => { b.onclick = () => { S.lang = b.dataset.l; try { localStorage.setItem("mimaar.lang", S.lang); } catch (e) { /* */ } loginScreen(); }; });
  const go_ = async () => {
    const usr = $("[name=usr]").value.trim(), pwd = $("[name=pwd]").value;
    if (!usr || !pwd) return;
    const r = await busy(fetch("/api/method/login", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ usr, pwd }) }));
    if (r.ok) { location.reload(); return; }
    $("[data-err]").innerHTML = `<div class="banner bad">${esc(t("Wrong user name or password."))}</div>`;
  };
  $("[data-login]").onclick = go_;
  $("[name=pwd]").addEventListener("keydown", (e) => { if (e.key === "Enter") go_(); });
}

/* ---------------- start ---------------- */
function start() {
  if (!S.b) { try { S.lang = localStorage.getItem("mimaar.lang") || S.lang; } catch (e) { /* */ } loginScreen(); return; }
  layout(); render();
  if (NATIVE) native("ready", { lang: S.lang }).catch(() => {});
}
window.MimaarField = { t, api, go, S };
start();
})();
