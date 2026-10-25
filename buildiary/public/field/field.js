/* Buildiary field app on ERPNext.
 * The phone screens of the earlier Buildiary app (colour theme, big buttons, Urdu/English),
 * talking to ERPNext through buildiary.field. Every rule is checked by ERPNext on the server;
 * this file only collects what the person sees and enters. */
(() => {
"use strict";
const BOOT = window.BUILDIARY_BOOT || {};
const UR = window.BUILDIARY_UR || {};
const CSRF = () => (window.frappe && window.frappe.csrf_token) || BOOT.csrf || "";
const NATIVE = !!window.ReactNativeWebView;
const S = { b: BOOT.boot || null, lang: (BOOT.boot && BOOT.boot.lang) || BOOT.lang || "en", acts: {}, att: null, rel: null, cache: {} };

/* ---------- small helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = (n, cls = "") => `<svg class="i ${cls}"><use href="#i-${n}"/></svg>`;
const RTL = () => S.lang === "ur" || S.lang === "ar";
const LOCALE = () => (S.lang === "ur" ? "ur-PK" : S.lang === "ar" ? "ar-SA-u-nu-latn-ca-gregory" : "en-GB");
function t(s, ...a) { let x = (S.lang !== "en" && S.lang === window.BUILDIARY_TR_LANG && UR[s]) || s; a.forEach((v, i) => { x = x.split(`{${i}}`).join(v); }); return x; }
const num = (n) => (+n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
/** Money in the company's currency: lakh and crore for rupees, thousands and millions elsewhere. */
const CUR = () => (S.b && S.b.currency) || "PKR";
const SOUTH_ASIA = () => ["PKR", "INR"].includes(CUR());
const CUR_SYM = { PKR: "Rs", INR: "₹", USD: "$", GBP: "£", EUR: "€" };
function money(n, short) {
  n = +n || 0; const a = Math.abs(n); const sym = CUR_SYM[CUR()] || CUR();
  if (SOUTH_ASIA()) {
    if (short && a >= 1e7) return `${(n / 1e7).toFixed(2).replace(/\.?0+$/, "")} ${t("crore")}`;
    if (short && a >= 1e5) return `${(n / 1e5).toFixed(1).replace(/\.0$/, "")} ${t("lac")}`;
    return `${sym} ${Math.round(n).toLocaleString("en-US")}`;
  }
  if (short && a >= 1e6) return `${sym} ${(n / 1e6).toFixed(2).replace(/\.?0+$/, "")} ${t("million")}`;
  if (short && a >= 1e4) return `${sym} ${(n / 1e3).toFixed(1).replace(/\.0$/, "")} ${t("thousand")}`;
  return `${sym} ${Math.round(n).toLocaleString("en-US")}`;
}
function fdate(d) {
  if (!d) return "";
  const x = new Date(String(d).length === 10 ? `${d}T00:00:00` : String(d).replace(" ", "T"));
  if (isNaN(x)) return String(d);
  return x.toLocaleDateString(LOCALE(), { day: "numeric", month: "short", year: "numeric" });
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
  const path = method.includes(".") ? method : `buildiary.field.${method}`;
  let r;
  try {
    r = await fetch(`/api/method/${path}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json", "X-Frappe-CSRF-Token": CSRF() }, body: JSON.stringify(args) });
  } catch (e) { throw new UserError(t("No connection to Buildiary. Check the internet (or Wi-Fi) and try again.")); }
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
window.BuildiaryNative = window.BuildiaryNative || {};
window.BuildiaryNative.resolve = (id, res) => { const p = pending[id]; if (!p) return; delete pending[id]; if (res && res.error) p.reject(new UserError(res.error)); else p.resolve(res || {}); };
function native(type, data = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending[id] = { resolve, reject }; window.ReactNativeWebView.postMessage(JSON.stringify({ id, type, csrf: CSRF(), ...data })); });
}
function pickFile(capture) {
  return new Promise((resolve) => {
    const i = document.createElement("input"); i.type = "file"; i.accept = "image/*,application/pdf"; if (capture) i.capture = "environment";
    i.onchange = () => resolve(i.files && i.files[0]); i.click();
  });
}
/** A photo. In the phone app: live camera only, stamped with GPS. In a browser: the live camera for
 *  face photos (opts.live), otherwise the phone's camera through the file picker. Returns {url, loc}. */
function chooseSource(title) {
  return new Promise((resolve) => {
    let done = false;
    const sh = sheet(title, `<div class="stack"><button class="btn big wide" data-c="cam">${icon("cam")}${esc(t("Take photo"))}</button><button class="btn big wide" data-c="file">${icon("photo")}${esc(t("Choose from the phone (screenshot or PDF)"))}</button></div>`);
    sh.addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (!b) return; done = true; closeSheet(sh); resolve(b.dataset.c); });
    const obs = new MutationObserver(() => { if (!document.body.contains(sh) || sh.parentElement.classList.contains("closing")) { obs.disconnect(); if (!done) { done = true; resolve(null); } } }); obs.observe($("#sheetRoot"), { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  });
}
async function takePhoto(title, opts = {}) {
  if (opts.gallery) {
    // proofs such as a transfer screenshot come from the phone's gallery or files
    const how = await chooseSource(title);
    if (!how) return null;
    if (how === "file") { const f = await pickFile(false); if (!f) return null; return { url: await busy(upload(f), t("Saving the photo…")), loc: "" }; }
  }
  if (NATIVE) {
    const r = await native("photo", { title: t(title), facing: opts.facing || "back", lang: S.lang });
    if (!r || r.cancelled || !r.data) return null;
    const file = new File([b64bytes(r.data)], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
    return { url: await busy(upload(file), t("Saving the photo…")), loc: r.lat ? `${(+r.lat).toFixed(6)}, ${(+r.lng).toFixed(6)} (±${Math.round(r.accuracy || 0)} m)` : "" };
  }
  if (opts.live) {
    const blob = await liveCamera(title, { facing: opts.facing === "front" ? "user" : "environment", face: opts.face });
    if (!blob) return null;
    const [url, loc] = await busy(Promise.all([upload(new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" })), getLocation().catch(() => "")]), t("Saving the photo…"));
    return { url, loc };
  }
  const f = await pickFile(true); if (!f) return null;
  return { url: await busy(upload(f), t("Saving the photo…")), loc: "" };
}
function b64bytes(b64) { const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return bytes; }
/** A live face photo as a data URL (for signing in, before there is a session). */
async function liveFaceData(title) {
  if (NATIVE) { const r = await native("photo", { title: t(title), facing: "front", lang: S.lang }); return r && r.data ? `data:image/jpeg;base64,${r.data}` : null; }
  const blob = await liveCamera(title, { facing: "user", face: true });
  if (!blob) return null;
  return new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(blob); });
}
/** Live camera in a browser (no gallery): take, check, use. Resolves a JPEG blob or null. */
function liveCamera(title, { facing = "environment", face = false } = {}) {
  return new Promise((resolve) => {
    let stream = null, done = false, mode = facing, shotBlob = null;
    const sh = sheet(title, `<div class="cam"><video playsinline muted autoplay></video><canvas hidden></canvas>${face ? '<div class="face"></div>' : ""}<div class="note" data-note>${esc(face ? t("Face the camera in good light") : t("Point the camera"))}</div></div>`,
      { full: true, footer: `<button class="btn" data-flip="1">${icon("refresh")}${esc(t("Switch camera"))}</button><button class="btn pri" data-take="1">${icon("cam")}${esc(t("Take photo"))}</button>` });
    const video = sh.querySelector("video"), canvas = sh.querySelector("canvas"), note = sh.querySelector("[data-note]"), take = sh.querySelector("[data-take]");
    const stop = () => { if (stream) stream.getTracks().forEach((x) => x.stop()); stream = null; };
    const start = async () => {
      stop();
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false }); video.srcObject = stream; await video.play().catch(() => {}); note.hidden = false; }
      catch (e) { note.textContent = t("The camera can't be opened here. Allow the camera for this site, or use the Buildiary app."); }
    };
    const finish = (v) => { if (done) return; done = true; stop(); closeSheet(sh); resolve(v); };
    sh.querySelector("[data-flip]").onclick = () => { mode = mode === "user" ? "environment" : "user"; start(); };
    take.onclick = () => {
      if (shotBlob) { finish(shotBlob); return; }
      if (!stream || !video.videoWidth) return;
      const k = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * k); canvas.height = Math.round(video.videoHeight * k);
      const g = canvas.getContext("2d"); if (mode === "user") { g.translate(canvas.width, 0); g.scale(-1, 1); }
      g.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => { shotBlob = b; video.hidden = true; canvas.hidden = false; take.innerHTML = `${icon("check")}${esc(t("Use photo"))}`; const f = sh.querySelector("[data-flip]"); f.innerHTML = `${icon("refresh")}${esc(t("Retake"))}`; f.onclick = () => { shotBlob = null; video.hidden = false; canvas.hidden = true; take.innerHTML = `${icon("cam")}${esc(t("Take photo"))}`; f.innerHTML = `${icon("refresh")}${esc(t("Switch camera"))}`; f.onclick = () => { mode = mode === "user" ? "environment" : "user"; start(); }; }; }, "image/jpeg", 0.85);
    };
    if (mode === "user") video.style.transform = "scaleX(-1)";
    const obs = new MutationObserver(() => { if (!document.body.contains(sh) || sh.parentElement.classList.contains("closing")) { obs.disconnect(); if (!done) { done = true; stop(); resolve(null); } } });
    obs.observe($("#sheetRoot"), { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    start();
  });
}
/** Reads a QR code with the camera in a browser (BarcodeDetector). Resolves the text. */
function qrReader(box, flipBtn) {
  let stream = null, stopped = false, mode = "environment";
  const video = box.querySelector("video"), note = box.querySelector(".note");
  const stop = () => { stopped = true; if (stream) stream.getTracks().forEach((x) => x.stop()); stream = null; };
  const result = new Promise(async (resolve, reject) => {
    if (!("BarcodeDetector" in window)) { reject(new UserError(t("This browser can't read QR codes. Use the Buildiary app on the phone, or Chrome."))); return; }
    const det = new window.BarcodeDetector({ formats: ["qr_code"] });
    const open = async () => {
      if (stream) stream.getTracks().forEach((x) => x.stop());
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode }, audio: false }); video.srcObject = stream; await video.play().catch(() => {}); }
      catch (e) { reject(new UserError(t("The camera can't be opened here. Allow the camera for this site, or use the Buildiary app."))); }
    };
    if (flipBtn) flipBtn.onclick = () => { mode = mode === "user" ? "environment" : "user"; open(); };
    await open();
    const tick = async () => {
      if (stopped) return;
      try { if (video.readyState >= 2) { const c = await det.detect(video); if (c && c.length && c[0].rawValue) { stop(); resolve(c[0].rawValue); return; } } } catch (e) { /* keep trying */ }
      setTimeout(tick, 250);
    };
    tick();
  });
  return { result, stop };
}
async function getLocation() {
  if (NATIVE) { const r = await native("location", { lang: S.lang }); return r && r.lat ? `${(+r.lat).toFixed(6)}, ${(+r.lng).toFixed(6)} (±${Math.round(r.accuracy || 0)} m)` : ""; }
  if (!navigator.geolocation) return "";
  return new Promise((ok) => navigator.geolocation.getCurrentPosition((p) => ok(`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)} (±${Math.round(p.coords.accuracy)} m)`), () => ok(""), { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }));
}
async function scanCode(title) {
  if (NATIVE) { const r = await native("scan", { title: t(title), lang: S.lang }); return r && r.text ? r.text : ""; }
  if (!("BarcodeDetector" in window)) return ask(title, t("Type the number on the site card (or the CNIC)."), "");
  return new Promise((resolve) => {
    let done = false;
    const sh = sheet(title, `<div class="cam"><video playsinline muted autoplay></video><div class="frame"></div><div class="note">${esc(t("Waiting for a site card… hold the card's QR inside the frame"))}</div></div>`,
      { full: true, footer: `<button class="btn" data-x="1">${esc(t("Cancel"))}</button><button class="btn" data-flip="1">${icon("refresh")}${esc(t("Switch camera"))}</button>` });
    const r = qrReader(sh.querySelector(".cam"), sh.querySelector("[data-flip]"));
    r.result.then((v) => { done = true; closeSheet(sh); resolve(v); }).catch((e) => { sh.querySelector(".note").textContent = e.message; });
    const obs = new MutationObserver(() => { if (!document.body.contains(sh) || sh.parentElement.classList.contains("closing")) { obs.disconnect(); r.stop(); if (!done) { done = true; resolve(""); } } });
    obs.observe($("#sheetRoot"), { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  });
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
  return `<button type="button" class="shot ${url ? "has" : ""} ${opts.wide ? "wide" : ""}" data-shot="${name}" data-title="${esc(label)}" ${opts.facing ? `data-facing="${opts.facing}"` : ""} ${opts.facing === "front" ? 'data-live="1"' : ""} ${opts.gallery ? 'data-gallery="1"' : ""}>${url ? `<img src="${esc(url)}" alt="">` : `${icon("cam")}<span>${esc(label)}${opts.req ? " *" : ""}</span>`}</button><input type="hidden" name="${name}" value="${esc(url)}">`;
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
        const r = await takePhoto(s.dataset.title, { facing: s.dataset.facing, live: s.dataset.live === "1", face: s.dataset.live === "1", gallery: s.dataset.gallery === "1" });
        if (!r) return;
        const h = s.nextElementSibling; h.value = r.url; s.classList.add("has"); s.innerHTML = /\.pdf$/i.test(r.url) ? `${icon("file")}<span>PDF</span>` : `<img src="${esc(r.url)}" alt="">`;
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
const pickSupplier = (title = t("Choose the supplier")) => picker(title, (q) => api("suppliers", { q }), (r, i) => pickRow(i, r.supplier_name, t(r.buildiary_work_area || "")));
const pickItem = (title = t("Choose the item"), opts = {}) => picker(title, (q) => (opts.stock ? api("stock", { q }).then((d) => d.rows.filter((r) => +r.qty > 0)) : api("item_search", { q })), (r, i) => pickRow(i, r.item_name, r.item_code, "", opts.stock ? `<b>${num(r.qty)}</b><span class="small muted">${esc(r.uom)}</span>` : esc(r.stock_uom || "")), { top: opts.allowNew ? `<button class="btn sm" data-new="1">${icon("plus")}${esc(t("Not in the list: add as a new item"))}</button>` : "" });
const pickWorker = () => picker(t("Choose the worker"), (q) => api("workers", { q }), (r, i) => pickRow(i, r.full_name, [t(r.trade || ""), r.name].filter(Boolean).join(" · "), r.photo));

/* ---------- layout ---------- */
const TABS = [["dash", "Dashboard", "dash"], ["build", "Construction", "house"], ["+", "", "plus"], ["store", "Stores", "box"], ["more", "More", "menu"]];
const PETTY = () => { const c = C(); return !c.partner && (c.owner || c.money || c.site || c.store); };
const STORE = () => { const c = C(); return !c.partner && (c.store || c.site); };
const TOP_OF = { dash: "dash", build: "build", store: "store", receive: "store", item: "store", money: "more", ask: "more" };
function layout() {
  document.documentElement.lang = S.lang; document.documentElement.dir = RTL() ? "rtl" : "ltr";
  const tabs = TABS.filter(([id]) => id !== "store" || !C().partner);
  $("#app").innerHTML = `<header class="top" id="top"></header><main class="content" id="content"></main>
    <nav class="bottombar" id="bar" style="grid-template-columns:repeat(${tabs.length},minmax(0,1fr))">${tabs.map(([id, l, ic]) => id === "+" ? `<button class="bb-plus" data-act="quick" aria-label="${esc(t("Quick actions"))}"><span>${icon("plus")}</span></button>` : `<button data-go="${id}" data-tab="${id}">${icon(ic)}<span>${esc(t(l))}</span></button>`).join("")}</nav>`;
}
function setTop(title, back) {
  const b = S.b || {}; const ini = (b.full_name || "?").trim().charAt(0).toUpperCase();
  $("#top").innerHTML = `${back ? `<button class="back" data-back="1" aria-label="${esc(t("Back"))}">${icon("chev", "flip")}</button>` : ""}<div class="ttl"><h1>${esc(title)}</h1>${projChip()}</div>
    <div class="who"><button class="iconbtn" data-act="search" aria-label="${esc(t("Search"))}">${icon("search")}</button><button class="av" data-act="me" aria-label="${esc(b.full_name || "")}">${b.image ? `<img src="${esc(b.image)}" alt="">` : esc(ini)}</button></div>`;
  const back_ = $("#top [data-back]"); if (back_) { back_.querySelector(".i").style.transform = RTL() ? "" : "scaleX(-1)"; }
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
    if (c.store) A.push(["Receive goods", "truck", "store/receive", "k2"], ["Release to work", "box", "release", "k3"], ["Return to store", "store", "return", "k7"]);
    if (STORE()) A.push(["Water tanker", "drop", "tanker", "k7"], ["Tank level", "tank", "tanklevel", "k2"]);
    if (c.people) A.push(["Attendance by site card", "card", "attcard", "k1"]);
    if (PETTY()) A.push(["Petty cash expense", "pay", "pettyexp", "k3"], ["Pay by site card", "cash", "paycard", "k8"]);
    if (c.site) A.push(["Site diary", "log", "diary", "k7"], ["Report a snag", "alert", "snag", "k4"], ["Progress photo", "cam", "build/schedule", "k5"]);
    if (c.buy) A.push(["Scan a quotation", "ai", "scanquote", "k6"]);
    if (c.money) A.push(["Pay a supplier", "pay", "money/bills", "k8"]);
    const sh = sheet(t("Quick actions"), `<div class="qa-grid">${A.map(([l, ic, to, tc], i) => `<button class="qa" data-q="${i}"><span class="qa-i" style="--tc:var(--${tc})">${icon(ic)}</span><span>${esc(t(l))}</span></button>`).join("")}</div>`);
    sh.addEventListener("click", (e) => {
      const b = e.target.closest("[data-q]"); if (!b) return; const to = A[+b.dataset.q][2]; closeSheet();
      if (to === "release") return S.b.rules.card_for_store ? storeByCard("issue") : releaseSheet();
      if (to === "return") return storeByCard("return");
      if (to === "attcard") return attendanceByCard();
      if (to === "tanker") return tankerSheet();
      if (to === "tanklevel") return readingSheet();
      if (to === "pettyexp") return busy(api("buildiary.petty.overview")).then((d) => { S.petty = d; if (d.no_person) { toast(t("Your sign-in isn't linked to a person on site, so you can't hold petty cash. Ask the owner."), "bad"); return; } expenseSheet(d); }).catch((e) => toast(e.message, "bad"));
      if (to === "paycard") return payByCard();
      if (to === "diary") return diarySheet();
      if (to === "snag") return snagNewSheet();
      if (to === "scanquote") return scanQuote();
      go(to);
    });
  },
  me() { go("settings"); },
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
          grp(t("Suppliers"), (r.suppliers || []).map((s) => lrow({ go: `supplier/${s.name}`, title: s.supplier_name, sub: esc(t(s.buildiary_work_area || "")) }))),
          grp(t("Items in store"), (r.items || []).map((s) => lrow({ go: `item/${encodeURIComponent(s.item_code)}`, title: s.item_name, end: `<b>${num(s.qty)}</b><span class="small muted">${esc(t(s.uom))}</span>` }))),
          grp(t("Purchase orders"), (r.orders || []).map((o) => lrow({ go: `order/${o.name}`, title: `${o.supplier_name}`, sub: esc(o.name) }))),
          grp(t("Quotations"), (r.quotes || []).map((o) => lrow({ go: `quote/${o.name}`, title: `${o.supplier_name}`, sub: esc(o.name) }))),
        ].join("") || empty(t("Nothing found"));
      } catch (e) { res.innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; }
    }, 300); });
  },
};

/* ================================================================== dashboard */
/** Buildiary Cloud: the trial or plan line on the home screen (only on a Buildiary workspace). */
function planBanner() {
  const p = S.b.plan;
  if (!p || !p.show) return "";
  const own = C().owner;
  let msg, cls = "";
  if (p.status === "Trial") msg = p.days_left > 0 ? t("Free trial: {0} days left", p.days_left) : t("Your free trial ends today");
  else if (p.status === "Payment due") { msg = t("Your plan has ended. Pay within {0} days to keep working.", p.grace_left == null ? "" : p.grace_left); cls = "bad"; }
  else { msg = t("Your plan ends in {0} days", p.days_left); cls = "warn"; }
  return `<div class="banner ${cls} plan-line"><span>${esc(msg)}</span>${own ? `<a class="btn sm pri" href="/billing">${esc(t("Plan & billing"))}</a>` : ""}</div>`;
}

VIEWS.dash = async (el) => {
  const b = S.b; setTop(t("Dashboard"));
  const d = await api("buildiary.dash.overview"); const T = d.tiles; const c = C();
  const tiles = [];
  if (T.paid) tiles.push(tile(t("Paid to suppliers"), money(T.paid.paid, 1), t("of {0} ordered", money(T.paid.committed, 1)), "money/bills", "k1"));
  if (T.budget) tiles.push(tile(t("Budget"), money(T.budget.budget, 1), t("{0} committed", money(T.budget.committed, 1)), "money/budget", "k2"));
  if (T.stock) tiles.push(tile(t("Stock alerts"), String(T.stock.low + T.stock.out), T.stock.low + T.stock.out ? t("{0} low · {1} out", T.stock.low, T.stock.out) : t("all above re-order level"), "store/items", T.stock.low + T.stock.out ? "k4" : "k3"));
  if (T.water) tiles.push(tile(t("Water today"), t("{0} gal", num(T.water.gallons)), t("{0} tankers · {1} gal this week", T.water.tankers, num(T.water.week)), "store/water", "k7"));
  if (T.ncr) tiles.push(tile(t("Open NCRs"), String(T.ncr.open), t("{0} inspections waiting", T.ncr.waiting), "build/inspect", T.ncr.open ? "k4" : "k1"));
  if (T.onsite) tiles.push(tile(t("On site now"), String(T.onsite.now), t("{0} came and left · {1} registered", T.onsite.left, T.onsite.registered), "att", "k7"));
  if (T.snags) tiles.push(tile(t("Open snags"), String(T.snags.open), t("{0} overdue", T.snags.overdue), "build/snags", T.snags.overdue ? "k4" : "k6"));
  if (T.petty) tiles.push(tile(t("Petty cash to check"), String(T.petty.waiting), money(T.petty.amount), "money/petty", "k3"));
  if (T.photos) tiles.push(tile(t("Photos today"), String(T.photos.today), t("{0} checked by AI", T.photos.ai), "", "k5"));
  if (tiles.length % 2) tiles.push(`<span class="ctile" style="cursor:default"></span>`);
  const A = [];
  if (c.people) A.push(qa(t("Attendance by site card"), "card", "attcard", "k1"));
  if (c.store) A.push(qa(t("Receive goods"), "truck", "go_receive", "k2"), qa(t("Release to work"), "box", "release", "k3"), qa(t("Return to store"), "store", "ret", "k7"));
  if (STORE()) A.push(qa(t("Water tanker"), "drop", "tanker", "k7"));
  if (c.site) A.push(qa(t("Report progress"), "house", "go_build", "k5"), qa(t("Site diary"), "log", "diary", "k7"), qa(t("Report a snag"), "alert", "snag", "k4"));
  if (PETTY()) A.push(qa(t("Petty cash"), "cash", "go_petty", "k1"));
  if (c.buy) A.push(qa(t("Scan a quotation"), "ai", "scanquote", "k6"));
  if (c.money) A.push(qa(t("Pay a supplier"), "pay", "go_bills", "k8"));
  if (S.b.ai) A.push(qa(t("Ask the project"), "sparkle", "go_ask", "k5"));
  Object.assign(S.acts, { go_petty: () => go("money/petty"), tanker: () => tankerSheet(), go_receive: () => go("store/receive"), go_att: () => go("att"), go_bills: () => go("money/bills"), go_build: () => go("build/progress"), go_ask: () => go("ask"),
    attcard: () => attendanceByCard(), ret: () => storeByCard("return"), release: () => (S.b.rules.card_for_store ? storeByCard("issue") : releaseSheet()), diary: () => diarySheet(), snag: () => snagNewSheet(), scanquote: () => scanQuote() });
  const G = {}; d.acts.forEach((a) => { (G[a.g] = G[a.g] || []).push(a); });
  const GI = { Buying: "cart", Stores: "box", Money: "pay", Quality: "alert", Build: "house", People: "users", Water: "drop", Other: "alert" };
  const att = d.acts.length ? Object.entries(G).map(([g, rows]) => `<div class="agrp"><div class="ag-h">${icon(GI[g] || "alert")}<b>${esc(t(g))}</b><span class="cnt">${rows.length}</span></div><div class="lst">${rows.slice(0, 6).map((a) => lrow({ act: "open", data: a.go.join("|"), title: a.t, dot: a.k })).join("")}${rows.length > 6 ? `<div class="more-rest" hidden>${rows.slice(6).map((a) => lrow({ act: "open", data: a.go.join("|"), title: a.t, dot: a.k })).join("")}</div>` : ""}</div>${rows.length > 6 ? `<button class="btn sm showall" data-showall="1">${esc(t("Show all ({0})", rows.length))}</button>` : ""}</div>`).join("") : empty(t("All clear"), t("Nothing is waiting for you right now."));
  const P = d.panels; const parts = [];
  if (P.paid && P.paid.length) {
    const max = Math.max(1, ...P.paid.map((r) => Math.max(r.committed, r.paid)));
    parts.push(fold("paid", t("Paid to suppliers"), `<div class="body hbars">${P.paid.map((r) => `<div class="hb2"><span>${esc(t(r.grp))}</span><i><b class="g" style="width:${(r.paid / max) * 100}%"></b><b class="c" style="width:${(Math.max(0, r.committed - r.paid) / max) * 100}%"></b></i><em>${esc(money(r.paid, 1))}</em></div>`).join("")}
      <div class="legend"><span><i class="g"></i>${esc(t("Paid {0}", money(P.paid.reduce((a, r) => a + r.paid, 0), 1)))}</span><span><i class="c"></i>${esc(t("Still to pay {0}", money(P.paid.reduce((a, r) => a + Math.max(0, r.committed - r.paid), 0), 1)))}</span></div></div>`));
  }
  if (P.budget && P.budget.length) {
    const max = Math.max(1, ...P.budget.map((r) => Math.max(r.budget, r.spent + r.committed)));
    parts.push(fold("budget", t("Budget by category"), `<div class="body hbars">${P.budget.map((r) => `<div class="hb2" title="${esc(t("Budget {0} · spent {1} · committed {2}", money(r.budget, 1), money(r.spent, 1), money(r.committed, 1)))}"><span>${esc(t(r.category))}</span><i><b class="g" style="width:${(r.spent / max) * 100}%"></b><b class="b" style="width:${(r.committed / max) * 100}%"></b><s style="left:${(r.budget / max) * 100}%"></s></i><em>${esc(money(r.budget, 1))}</em></div>`).join("")}
      <div class="legend"><span><i class="g"></i>${esc(t("Spent"))}</span><span><i class="b"></i>${esc(t("Committed, not yet paid"))}</span><span><i class="m"></i>${esc(t("Budget mark"))}</span></div></div>`));
  }
  if (P.labour) {
    const max = Math.max(1, ...P.labour.map((r) => r.registered));
    parts.push(fold("labour", t("Labour: registered vs present today"), P.labour.length ? `<div class="body hbars">${P.labour.map((r) => `<div class="hb2"><span>${esc(r.name)}</span><i><b class="g" style="width:${(r.present / max) * 100}%"></b><b class="r" style="width:${(Math.max(0, r.registered - r.present) / max) * 100}%"></b></i><em>${r.present}/${r.registered}</em></div>`).join("")}
      <div class="legend"><span><i class="g"></i>${esc(t("Came today"))}</span><span><i class="r"></i>${esc(t("Registered, not here"))}</span></div></div>` : empty(t("No workers registered yet"))));
  }
  if (P.stages) {
    const s = P.stages, n = s.counts || {};
    parts.push(fold("stages", t("Stage status"), `<div class="body stack">${s.now ? `<button class="snow" data-go="build/progress"><span class="small muted">${esc(t("Now"))}</span><b>${esc(stTitle(s.now))}</b>${s.next ? `<span class="small muted">${esc(t("Next: {0} · {1}", stTitle(s.next), fdate(s.next.start)))}</span>` : ""}</button>` : ""}
      <div class="bcounts">${[["done", "Done"], ["now", "Building now"], ["behind", "Behind plan"], ["soon", "Starts soon"], ["later", "Later"]].map(([k, l]) => `<button class="bc ${k}" data-go="build/progress"><b>${n[k] || 0}</b><span>${esc(t(l))}</span></button>`).join("")}</div>
      ${s.phases.map((p) => `<div><div class="row" style="justify-content:space-between"><b>${esc(t(p.name))}</b><span class="small muted">${esc(`${fdate(p.start)} → ${fdate(p.end)}`)}</span></div>${stageBar({ built: p.built, reported: p.built, verified: p.built, planned: p.planned })}<span class="small muted">${esc(t("{0}% built · {1}% planned", num(p.built), num(p.planned)))}</span></div>`).join("")}</div>`, true));
  }
  if (P.released) {
    const max = Math.max(1, ...P.released.count);
    parts.push(fold("released", t("Material released, last 14 days"), `<div class="body"><div class="wbars">${P.released.days.map((day, i) => `<div class="wb"><div class="wbb"><span class="u" style="width:70%;height:${(P.released.count[i] / max) * 100}%"></span></div><em>${new Date(day + "T00:00:00").getDate()}</em></div>`).join("")}</div>
      <div class="legend"><span><i class="u"></i>${esc(t("Releases from the store"))}</span></div></div>`));
  }
  el.innerHTML = `${planBanner()}<div class="hero"><span class="muted small">${esc(fdate(b.today))}</span><b>${esc(t("Salaam, {0}", (b.full_name || "").split(" ")[0]))}</b><span class="small muted">${esc(b.project_name || "")}</span></div>
    ${tiles.length ? `<div class="ctiles">${tiles.join("")}</div>` : ""}
    ${A.length ? panel(t("Quick actions"), `<div class="body"><div class="qa-grid">${A.slice(0, 12).join("")}</div></div>`) : ""}
    ${panel(t("Needs your attention"), `<div class="body stack" style="gap:6px">${att}</div>`, d.acts.length ? `<span class="cnt">${d.acts.length}</span>` : "")}
    ${parts.join("")}`;
  S.acts.open = (v) => {
    const [kind, name] = v.split("|");
    const map = { quote: `quote/${name}`, order: `order/${name}`, receive: `receive/${name}`, bill: "money/bills", billnew: "money/bills", snag: "build/snags", task: "build/progress", stage: "build/progress", worker: name ? `worker/${name}` : "people", water: "store/water", item: `item/${encodeURIComponent(name)}`, petty: "money/petty" };
    if (kind === "petty" && name) { S.petty = S.petty || { full: !!T.petty }; return pcSheet(name); }
    go(map[kind] || "dash");
  };
};
/** A dashboard panel that opens and closes (remembered on this phone). */
function fold(id, title, body, openDefault = false) {
  let open = openDefault;
  try { const v = localStorage.getItem(`buildiary.fold.${id}`); if (v != null) open = v === "1"; } catch (e) { /* no storage */ }
  return `<section class="panel fold ${open ? "open" : ""}" data-fold="${id}"><header data-ftoggle="${id}"><h2>${esc(title)}</h2><span class="btn sm">${esc(open ? t("Close") : t("Open"))}</span>${icon("chev", "lch")}</header><div class="fbody">${body}</div></section>`;
}
document.addEventListener("click", (e) => {
  const h = e.target.closest("[data-ftoggle]"); if (!h) return;
  const p = h.closest(".fold"); const open = !p.classList.contains("open"); p.classList.toggle("open", open);
  h.querySelector(".btn").textContent = open ? t("Close") : t("Open");
  try { localStorage.setItem(`buildiary.fold.${h.dataset.ftoggle}`, open ? "1" : "0"); } catch (err) { /* no storage */ }
});

/* ================================================================== construction */
VIEWS.build = async (el, [tab = "progress"]) => {
  tab = tab.split("?")[0];
  if (tab === "schedule") tab = "progress";
  setTop(t("Construction"));
  const tabs = [["progress", "Build progress"], ["diary", "Diary"], ["inspect", "Inspections"], ["snags", "Snags"]];
  el.innerHTML = hubtabs("build", tabs, tab) + `<div id="pane" class="stack"><div class="spin"></div></div>`;
  const pane = $("#pane");
  if (tab === "progress") return buildPane(pane);
  if (tab === "diary") {
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

/* ---------------- build progress: stages by phase, report, verify, compare photos ---------------- */
const stTitle = (s) => (s && S.lang === "ur" && s.title_ur ? s.title_ur : (s || {}).title || "");
const SSTATE = { done: ["Done", "good"], now: ["In progress", "warn"], behind: ["Behind plan", "bad"], soon: ["Starts soon", "info"], later: ["Later", ""] };
const sstate = (s) => pill(t(SSTATE[s.state][0]), SSTATE[s.state][1]);
const stageBar = (s) => `<div class="sbar" role="img" aria-label="${esc(t("{0}% built, {1}% reported, {2}% planned", num(s.built), num(s.reported), num(s.planned)))}"><i class="rep" style="width:${Math.min(100, s.reported)}%"></i><i class="ver" style="width:${Math.min(100, s.verified || 0)}%"></i><b class="plan" style="left:${Math.min(100, s.planned)}%"></b></div>`;
const buildLegend = () => `<div class="legend"><span><i class="g"></i>${esc(t("Built (verified)"))}</span><span><i class="a"></i>${esc(t("Reported"))}</span><span><i class="m"></i>${esc(t("Planned for today"))}</span></div>`;
async function buildPane(pane) {
  const d = await api("buildiary.build.stages");
  S.build = d;
  const all = d.phases.flatMap((p) => p.stages);
  const opts = [["", t("All stages")], ["now", t("Building now")], ["behind", t("Behind plan")], ["soon", t("Starts soon")], ["done", t("Done")]].concat(d.phases.map((p) => ["ph:" + p.name, t(p.name)]));
  const f = S.buildF || "";
  pane.innerHTML = `<section class="panel plain"><div class="body bhero">
      <div class="row" style="flex-wrap:nowrap;justify-content:space-between;align-items:flex-end"><div><span class="small muted">${esc(t("Whole project"))}</span><b class="big">${num(d.built)}%</b><span class="small muted">${esc(t("built · {0}% planned by today", num(d.planned)))}</span></div>
        ${d.now ? `<div class="bnow"><span class="small muted">${esc(t("Now"))}</span><b>${esc(stTitle(d.now))}</b>${d.next ? `<span class="small muted">${esc(t("Next: {0} · {1}", stTitle(d.next), fdate(d.next.start)))}</span>` : ""}</div>` : ""}</div>
      ${stageBar({ built: d.built, reported: d.built, verified: d.built, planned: d.planned })}
      <div class="bcounts">${[["done", "Done"], ["now", "In progress"], ["behind", "Behind plan"], ["soon", "Starts soon"], ["later", "Later"]].map(([k, l]) => `<button data-act="bfilter" data-v="${k}" class="bc ${k}"><b>${(d.counts || {})[k] || 0}</b><span>${esc(t(l))}</span></button>`).join("")}</div></div></section>
    ${buildLegend()}
    <select name="f" class="pillsel" style="align-self:flex-start">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === f ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
    <div data-list class="stack"></div>`;
  const list = pane.querySelector("[data-list]"), fs = pane.querySelector("[name=f]");
  const draw = () => {
    const v = (S.buildF = fs.value);
    const ok = (s, p) => !v || (v.startsWith("ph:") ? p.name === v.slice(3) : s.state === v);
    const html = d.phases.map((p) => { const ss = p.stages.filter((s) => ok(s, p)); return ss.length ? `<div class="phead"><b>${esc(t(p.name))}</b><span class="cnt">${ss.length}</span><span class="small muted">${esc(t("{0}% built · {1}% planned", num(p.built), num(p.planned)))}</span></div>${ss.map(stageCard).join("")}` : ""; }).join("");
    list.innerHTML = html || empty(t("Nothing here"), all.length ? "" : t("The project's stages appear here."));
  };
  fs.addEventListener("change", draw);
  draw();
  const find = (n) => all.find((s) => s.name === n);
  Object.assign(S.acts, {
    stoggle: (n) => { const c = list.querySelector(`.scard[data-st="${CSS.escape(n)}"]`); if (c) c.classList.toggle("open"); },
    bfilter: (k) => { fs.value = k; draw(); list.scrollIntoView({ behavior: "smooth" }); },
    sreport: (n) => progressSheet(find(n), "report"), sverify: (n) => progressSheet(find(n), "verify"), sphoto: (n) => stagePhotoSheet(find(n)),
    scompare: (n) => compareSheet(find(n)), sdetail: (n) => stageDetail(find(n)),
  });
}
function stageCard(s) {
  const open = s.state === "now" || s.state === "behind";
  const b = S.build || {};
  return `<article class="scard ${open ? "open" : ""} ${s.state}" data-st="${esc(s.name)}">
    <button class="sc-head" data-act="stoggle" data-v="${esc(s.name)}"><span class="sc-t"><b>${esc(stTitle(s))}</b><span class="small muted">${esc([s.code, `${fdate(s.start)} → ${fdate(s.end)}`].filter(Boolean).join(" · "))}</span></span>
      <span class="sc-p"><b>${num(s.built)}%</b><span class="small muted">${esc(t("built"))}</span></span>${icon("chev", "lch")}</button>
    <div class="sc-body">${stageBar(s)}
      <div class="row small" style="gap:6px">${sstate(s)}<span class="muted">${esc(t("Reported {0}% · Planned {1}%", num(s.reported), num(s.planned)))}${s.verified != null ? ` · ${esc(t("Verified {0}%", num(s.verified)))}` : ""}</span></div>
      ${s.photos.length ? `<div class="thumbs">${s.photos.map((p) => `<img src="${esc(p.url)}" alt="" loading="lazy" title="${esc(fdate(p.date))}">`).join("")}</div>` : ""}
      <div class="sc-acts">${b.can_report ? `<button class="btn sm" data-act="sphoto" data-v="${esc(s.name)}">${icon("cam")}${esc(t("Photo"))}</button><button class="btn sm" data-act="sreport" data-v="${esc(s.name)}">${esc(t("Report progress"))}</button>` : ""}
        ${b.can_verify ? `<button class="btn sm pri" data-act="sverify" data-v="${esc(s.name)}">${icon("check")}${esc(t("Verify"))}</button>` : ""}
        ${s.photos.length > 1 ? `<button class="btn sm" data-act="scompare" data-v="${esc(s.name)}">${esc(t("Compare photos"))}</button>` : ""}<button class="btn sm" data-act="sdetail" data-v="${esc(s.name)}">${esc(t("Details"))}</button></div></div></article>`;
}
function progressSheet(s, kind) {
  if (!s) return;
  const verify = kind === "verify";
  const start = verify ? (s.verified != null ? s.verified : s.reported) : s.reported;
  const sh = sheet(verify ? t("Verify: {0}", stTitle(s)) : t("Report progress: {0}", stTitle(s)), `<div class="form">
      ${stageBar(s)}<span class="small muted">${esc(t("Reported {0}% · Planned {1}%", num(s.reported), num(s.planned)))}${s.verified != null ? ` · ${esc(t("Verified {0}%", num(s.verified)))}` : ""}</span>
      <div class="pctbox"><b data-pct>${num(start)}%</b><input type="range" name="pct" min="0" max="100" step="5" value="${Math.round(start / 5) * 5}" aria-label="${esc(t("Work done (%)"))}"></div>
      <div class="chips" data-q>${[["+5", "+5%"], ["+10", "+10%"], ["25", "25%"], ["50", "50%"], ["75", "75%"], ["100", "100%"]].map(([v, l]) => `<button type="button" data-p="${v}">${l}</button>`).join("")}</div>
      ${fld(verify ? t("What you checked on site") : t("What was done"), area("note", "", `placeholder="${esc(verify ? t("e.g. slab steel checked with the drawing, cover blocks in place") : t("e.g. columns cast on grid A and B"))}"`))}
      ${fld(t("Photos of the work"), `<div class="shots">${shot("p1", t("Photo 1"))}${shot("p2", t("Photo 2"))}${shot("p3", t("Photo 3"))}</div>`, { req: !verify })}<input type="hidden" name="location"></div>`,
    { full: true, footer: `<button class="btn" data-x="1">${esc(t("Cancel"))}</button><button class="btn pri" data-save="1">${esc(verify ? t("Save check") : t("Save progress"))}</button>` });
  wireForm(sh);
  const r = sh.querySelector("[name=pct]"), out = sh.querySelector("[data-pct]");
  const upd = () => { out.textContent = r.value + "%"; };
  r.addEventListener("input", upd);
  sh.querySelector("[data-q]").addEventListener("click", (e) => { const b = e.target.closest("[data-p]"); if (!b) return; const v = b.dataset.p; r.value = v.startsWith("+") ? Math.min(100, +r.value + +v.slice(1)) : v; upd(); });
  sh.querySelector("[data-save]").onclick = async () => {
    const v = vals(sh); const photos = [v.p1, v.p2, v.p3].filter(Boolean);
    if (!verify && !photos.length && +v.pct > s.reported) { sheetError(sh, t("Take at least one photo of the work.")); return; }
    const res = await run(sh, () => api(verify ? "buildiary.build.verify" : "buildiary.build.report", { task: s.name, pct: v.pct, note: v.note, photos, location: v.location }), verify ? t("Check saved") : t("Progress saved"));
    if (res) { closeSheet(sh); render(); }
  };
}
function stagePhotoSheet(s) {
  if (!s) return;
  const sh = sheet(t("Photo: {0}", stTitle(s)), `<div class="form">${fld(t("Photos of the work"), `<div class="shots">${shot("p1", t("Photo 1"))}${shot("p2", t("Photo 2"))}${shot("p3", t("Photo 3"))}</div>`, { req: true })}
      ${fld(t("Note"), area("note"))}<input type="hidden" name="location"></div>`, { footer: `<button class="btn" data-x="1">${esc(t("Cancel"))}</button><button class="btn pri" data-save="1">${esc(t("Save"))}</button>` });
  wireForm(sh);
  sh.querySelector("[data-save]").onclick = async () => {
    const v = vals(sh); const photos = [v.p1, v.p2, v.p3].filter(Boolean);
    if (!photos.length) { sheetError(sh, t("Take the photo first.")); return; }
    const r = await run(sh, () => api("buildiary.build.add_photo", { task: s.name, photos, note: v.note, location: v.location }), t("Saved"));
    if (r) { closeSheet(sh); render(); }
  };
}
async function stagePhotos(s) {
  const d = await busy(api("buildiary.build.stage", { name: s.name }));
  const ph = [];
  d.updates.forEach((u) => [u.photo_1, u.photo_2, u.photo_3].filter(Boolean).forEach((url) => ph.push({ url, date: u.date, kind: u.kind, note: u.note })));
  return { d, ph };
}
async function compareSheet(s) {
  if (!s) return;
  let x; try { x = await stagePhotos(s); } catch (e) { toast(e.message, "bad"); return; }
  const ph = x.ph.slice().reverse(); // oldest first
  if (ph.length < 2) { toast(t("Take at least two photos of this stage to compare."), "bad"); return; }
  const opt = (sel) => ph.map((p, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${esc(`${fdate(p.date)} · ${t(p.kind)}`)}</option>`).join("");
  const sh = sheet(t("Compare photos: {0}", stTitle(s)), `<div class="stack">
      <div class="cmp2"><figure><select name="a">${opt(0)}</select><img data-a src="${esc(ph[0].url)}" alt="" class="zoomable"></figure><figure><select name="b">${opt(ph.length - 1)}</select><img data-b src="${esc(ph[ph.length - 1].url)}" alt="" class="zoomable"></figure></div>
      ${S.b.ai ? `<button class="btn wide" data-ai="1">${icon("sparkle")}${esc(t("What changed? (AI)"))}</button>` : ""}<div data-res></div></div>`, { full: true });
  const a = sh.querySelector("[name=a]"), b = sh.querySelector("[name=b]");
  a.onchange = () => { sh.querySelector("[data-a]").src = ph[+a.value].url; sh.querySelector("[data-res]").innerHTML = ""; };
  b.onchange = () => { sh.querySelector("[data-b]").src = ph[+b.value].url; sh.querySelector("[data-res]").innerHTML = ""; };
  const ai = sh.querySelector("[data-ai]");
  if (ai) ai.onclick = async () => {
    try {
      const r = await busy(api("buildiary.build.compare", { task: s.name, before: ph[+a.value].url, after: ph[+b.value].url }), t("The AI is comparing the photos…"));
      sh.querySelector("[data-res]").innerHTML = `<div class="verdict ${(r.concerns || []).length ? "warn" : "good"}">${icon("sparkle")}<span>${esc(r.summary)}${r.estimate != null ? `<br><b>${esc(t("Looks about {0}% done", num(r.estimate)))}</b>` : ""}${(r.concerns || []).map((c) => `<br>⚠ ${esc(c)}`).join("")}</span></div>`;
    } catch (e) { toast(e.message, "bad"); }
  };
}
async function stageDetail(s) {
  if (!s) return;
  let x; try { x = await stagePhotos(s); } catch (e) { toast(e.message, "bad"); return; }
  const u = x.d.updates;
  sheet(stTitle(s), `<div class="stack">${stageBar(s)}${buildLegend()}
      <div class="kvs"><div class="kv"><span>${esc(t("Planned"))}</span><b>${esc(`${fdate(s.start)} → ${fdate(s.end)}`)}</b></div><div class="kv"><span>${esc(t("Built"))}</span><b>${num(s.built)}%</b></div>
        <div class="kv"><span>${esc(t("Reported"))}</span><b>${num(s.reported)}%</b></div><div class="kv"><span>${esc(t("Verified"))}</span><b>${s.verified != null ? `${num(s.verified)}% · ${esc(fdate(s.verified_on))}` : "—"}</b></div>
        <div class="kv"><span>${esc(t("Planned for today"))}</span><b>${num(s.planned)}%</b></div>${s.days_left != null ? `<div class="kv"><span>${esc(t("Days to the planned finish"))}</span><b>${num(s.days_left)}</b></div>` : ""}</div>
      ${panel(t("Updates"), u.length ? `<div class="lst">${u.map((x) => `<div class="lrow static" style="flex-direction:column;align-items:stretch;gap:6px"><div class="row" style="justify-content:space-between"><b>${esc(t(x.kind))}${x.pct != null && x.kind !== "Photo" ? ` · ${num(x.pct)}%` : ""}</b><span class="small muted">${esc([fdate(x.date), x.time, x.by].filter(Boolean).join(" · "))}</span></div>
        ${x.note ? `<div class="small">${esc(x.note)}</div>` : ""}${[x.photo_1, x.photo_2, x.photo_3].filter(Boolean).length ? `<div class="thumbs">${[x.photo_1, x.photo_2, x.photo_3].filter(Boolean).map((p) => `<img src="${esc(p)}" alt="">`).join("")}</div>` : ""}</div>`).join("")}</div>` : empty(t("No updates yet")), "", "plain")}</div>`, { full: true });
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
/* ================================================================== stores & water */
/* category pictures: an item without its own photo shows its category's picture */
const ART = [[/power tool|machin/i, "drill", "k5"], [/cement/i, "bag", "k2"], [/block|brick/i, "bricks", "k3"], [/sand|crush|aggregate|bajri/i, "pile", "k3"],
  [/steel|rebar|sarya/i, "bars", "k4"], [/ready.?mix/i, "mixer", "k2"], [/plumb|pipe/i, "pipe", "k7"], [/sanitary|kitchen|tap\b/i, "tap", "k7"], [/light/i, "bulb", "k3"],
  [/electric|cable|switch|breaker/i, "bolt", "k3"], [/alumin|glass|window/i, "window", "k2"], [/door/i, "door", "k5"], [/shutter|formwork/i, "planks", "k5"],
  [/wood|board|ply/i, "planks", "k3"], [/tile|marble|stone|granite/i, "tiles", "k6"], [/paint|wall treat|putty/i, "bucket", "k6"], [/termite/i, "bug", "k4"],
  [/waterproof|admix|chemical|curing/i, "drop", "k7"], [/gypsum|ceiling/i, "board", "k5"], [/\bms\b|railing/i, "rail", "k5"], [/access|ladder|scaffold/i, "ladder", "k6"],
  [/measur|level/i, "ruler", "k8"], [/safety|ppe|helmet|glove/i, "helmet", "k3"], [/canteen|food|tea|sugar/i, "cup", "k1"], [/fuel|lubric|diesel|petrol/i, "fuel", "k4"],
  [/binding|fixing|wire|nail/i, "coil", "k4"], [/cutting|grind|disc/i, "disc", "k8"], [/hand tool|tools|hardware|equipment/i, "wrench", "k8"]];
function artFor(group, name) {
  for (const [re, ic, k] of ART) if (re.test(group || "")) return [ic, k];
  for (const [re, ic, k] of ART) if (re.test(name || "")) return [ic, k];
  return ["box", "k5"];
}
function ithumb(r, big) {
  if (r.image) return `<img class="ith ${big ? "big zoomable" : ""}" src="${esc(r.image)}" alt="" loading="lazy">`;
  const [ic, k] = artFor(r.group, r.name);
  return `<span class="ith ${big ? "big" : ""}" style="--tc:var(--${k})"><svg class="art"><use href="#c-${ic}"/></svg></span>`;
}
/** A long list shows its first rows and a "Show all" button. */
function moreList(rows, render, n = 8) {
  return `<div class="lst">${rows.slice(0, n).map(render).join("")}${rows.length > n ? `<div class="more-rest" hidden>${rows.slice(n).map(render).join("")}</div>` : ""}</div>${rows.length > n ? `<button class="btn sm showall" data-showall="1">${esc(t("Show all ({0})", rows.length))}</button>` : ""}`;
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-showall]"); if (!b) return; const r = b.previousElementSibling && b.previousElementSibling.querySelector(".more-rest"); if (r) r.hidden = false; b.remove(); });
const ISTATE = { none: ["Not received yet", ""], out: ["Out of stock", "bad"], low: ["Running low", "warn"], in: ["In store", "good"] };
const istate = (s) => pill(t((ISTATE[s] || ISTATE.none)[0]), (ISTATE[s] || ISTATE.none)[1]);

VIEWS.store = async (el, [tab = "items"]) => {
  tab = tab.split("?")[0];
  if (tab === "stock") tab = "items";
  setTop(t("Stores & water"));
  const tabs = [["items", "Items"], ["receive", "Receive"], ["release", "Release"], ["water", "Water"], ["moves", "Movements"]];
  el.innerHTML = hubtabs("store", tabs, tab) + `<div id="pane" class="stack"><div class="spin"></div></div>`;
  const pane = $("#pane");
  if (tab === "items") return storeItems(pane);
  if (tab === "water") return waterPane(pane);
  if (tab === "receive") {
    const rows = await api("to_receive");
    pane.innerHTML = panel(t("Deliveries expected"), rows.length ? `<div class="lst">${rows.map((r) => lrow({ go: `receive/${r.name}`, ic: "truck", title: r.supplier_name, sub: `${esc(r.name)} · ${esc(t("needed by {0}", fdate(r.schedule_date)))}<span style="display:block;margin-top:6px">${bar(r.per_received, "mid")}</span>`, end: `<b>${num(r.per_received)}%</b><span class="small muted">${esc(t("received"))}</span>` })).join("")}</div>` : empty(t("Nothing to receive"), t("Locked purchase orders waiting for delivery appear here.")), `<span class="cnt">${rows.length}</span>`);
  } else if (tab === "release") {
    pane.innerHTML = `<div class="banner">${esc(S.b.rules.card_for_store ? t("Material leaves the store only against a person: scan their site card and take their photo.") : t("Material leaves the store only against a name: the mistri or group head who takes it."))}</div>
      <button class="btn pri big wide" data-act="rel">${icon(S.b.rules.card_for_store ? "card" : "box")}${esc(S.b.rules.card_for_store ? t("Issue from store by site card") : t("Release material"))}</button>
      <button class="btn wide" data-act="ret">${icon("store")}${esc(t("Return to store by site card"))}</button><div data-moves></div>`;
    S.acts.rel = () => (S.b.rules.card_for_store ? storeByCard("issue") : releaseSheet());
    S.acts.ret = () => storeByCard("return");
    const m = (await api("movements")).filter((x) => x.kind !== "in");
    pane.querySelector("[data-moves]").innerHTML = panel(t("Released recently"), m.length ? `<div class="lst">${m.map(moveRow).join("")}</div>` : empty(t("Nothing released yet")));
  } else if (tab === "moves") {
    const m = await api("movements");
    pane.innerHTML = panel(t("Movements"), m.length ? `<div class="lst">${m.map(moveRow).join("")}</div>` : empty(t("No movements yet")));
  }
};
const moveRow = (x) => lrow({ ic: x.kind === "in" ? "truck" : x.kind === "back" ? "store" : "box", title: `${x.kind === "in" ? t("Received from {0}", x.who || "") : x.kind === "back" ? t("Returned by {0}", x.who || "") : t("Released to {0}", x.who || "")}${x.face ? " ✓" : ""}`,
  sub: esc(x.items.map((i) => `${i.item_name} ${num(i.qty)} ${t(i.uom)}`).join(", ")) + `<span style="display:block">${esc([fdate(x.date), x.ref, x.name].filter(Boolean).join(" · "))}</span>`, chev: false });

/* every item as a card, with search, category and state filters */
async function storeItems(pane) {
  const q0 = decodeURIComponent(location.hash.split("?")[1] || "");
  const d = await api("buildiary.stores.items");
  const R = d.rows; const st = (S.storeF = S.storeF || { g: "" });
  const n = (f) => R.filter(f).length;
  const tops = {};
  R.forEach((r) => { const k = r.top || r.group; tops[k] = tops[k] || {}; tops[k][r.group] = (tops[k][r.group] || 0) + 1; });
  const opt = (v, l, c) => `<option value="${esc(v)}" ${st.g === v ? "selected" : ""}>${esc(l)} (${c})</option>`;
  const filt = `<select name="g" class="pillsel" aria-label="${esc(t("Show"))}">${opt("", t("All"), R.length)}${opt("s:in", t("In store"), n((r) => r.qty > 0))}${opt("s:low", t("Running low or out"), n((r) => r.state === "low" || r.state === "out"))}${opt("s:order", t("On order"), n((r) => r.on_order > 0))}${opt("s:none", t("Not received yet"), n((r) => r.state === "none"))}
    ${Object.keys(tops).sort((a, b) => t(a).localeCompare(t(b))).map((top) => `<optgroup label="${esc(t(top))}">${Object.entries(tops[top]).sort((a, b) => t(a[0]).localeCompare(t(b[0]))).map(([g, c]) => opt("g:" + g, t(g), c)).join("")}</optgroup>`).join("")}</select>`;
  pane.innerHTML = `<div class="fld search">${icon("search")}<input name="q" value="${esc(q0)}" placeholder="${esc(t("Search any item"))}" autocomplete="off"></div>
    <div class="row">${S.b.ai ? `<button class="btn sm" data-act="identify">${icon("cam")}${esc(t("Identify from a photo"))}</button>` : ""}${d.new_item ? `<button class="btn sm pri" style="flex:0 0 auto" data-act="newitem">${icon("plus")}${esc(t("Item"))}</button>` : ""}</div>
    <div class="row" style="flex-wrap:nowrap">${filt}<span class="small muted" data-n style="flex:none"></span></div><div class="ilist" data-list></div>`;
  const list = pane.querySelector("[data-list]"), q = pane.querySelector("[name=q]"), g = pane.querySelector("[name=g]");
  const show = () => {
    const s = q.value.trim().toLowerCase(); st.g = g.value;
    const ok = (r) => !st.g || (st.g === "s:in" ? r.qty > 0 : st.g === "s:none" ? r.state === "none" : st.g === "s:low" ? r.state === "low" || r.state === "out" : st.g === "s:order" ? r.on_order > 0 : st.g === "g:" + r.group);
    const rows = R.filter((r) => ok(r) && (!s || r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s) || t(r.group).toLowerCase().includes(s)));
    list.innerHTML = rows.length ? rows.map(icard).join("") : empty(t("Nothing found"), s ? t("Try another word, or identify the item from a photo.") : "");
    pane.querySelector("[data-n]").textContent = rows.length === R.length ? "" : t("{0} of {1}", rows.length, R.length);
  };
  let tm = null;
  q.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(show, 150); });
  g.addEventListener("change", show);
  S.acts.identify = () => identifyItem();
  S.acts.newitem = () => itemSheet();
  show();
}
const icard = (r) => `<button class="icard" data-go="item/${encodeURIComponent(r.code)}">${ithumb(r)}<span class="im"><b>${esc(r.name)}</b><span class="small muted">${esc(t(r.group))}</span>
  <span class="iq"><b>${num(r.qty)}</b> ${esc(t(r.uom))}</span>${r.on_order > 0 ? `<span class="small muted">${esc(t("{0} on order", num(r.on_order)))}</span>` : ""}</span><span class="ie">${istate(r.state)}</span></button>`;

/* one item: figures, actions, orders to come, movements */
VIEWS.item = async (el, [code]) => {
  setTop(t("Stores & water"), true); setTab("store");
  const d = await api("buildiary.stores.item", { code });
  const c = C(); const showMoney = d.value != null;
  const stat = (l, v, cls = "", unit = "") => `<div class="istat ${cls}"><span>${esc(l)}</span><b>${v}</b>${unit ? `<em>${esc(unit)}</em>` : ""}</div>`;
  el.innerHTML = `<section class="panel plain"><div class="body"><div class="row" style="flex-wrap:nowrap;align-items:flex-start;gap:14px">${ithumb(d, true)}
      <div style="flex:1;min-width:0"><div class="row" style="flex-wrap:nowrap;justify-content:space-between;align-items:flex-start"><h2 class="ititle">${esc(d.name)}</h2>${istate(d.state)}</div>
      <span class="small muted">${esc([t(d.group), t(d.uom)].join(" · "))}</span>${d.description ? `<p class="small" style="margin:6px 0 0">${esc(d.description)}</p>` : ""}</div></div>
    <div class="istats">${stat(t("In store"), num(d.qty), "main", t(d.uom))}${stat(t("Received"), num(d.received))}${stat(t("Released"), num(d.released))}${stat(t("Returned"), num(d.returned))}${stat(t("On order"), num(d.on_order))}${showMoney ? stat(t("Value in store"), esc(money(d.value || 0, 1))) : stat(t("Warn at"), d.reorder ? num(d.reorder) : "—")}</div>
    <div class="row" style="margin-top:12px">${c.store ? `<button class="btn pri" data-act="rel">${icon("box")}${esc(t("Release to work"))}</button><button class="btn" data-act="ret">${icon("store")}${esc(t("Return to store"))}</button>${d.orders.length ? `<button class="btn" data-act="recv">${icon("truck")}${esc(t("Receive"))}</button>` : ""}` : ""}${d.can_edit ? `<button class="btn" data-act="edit">${icon("pencil")}${esc(t("Edit item"))}</button>` : ""}</div></div></section>
    ${d.orders.length ? panel(t("Coming on order"), moreList(d.orders, (o) => lrow({ go: `receive/${o.name}`, ic: "truck", title: o.supplier_name, sub: esc(`${o.name} · ${t("needed by {0}", fdate(o.schedule_date))}`), end: `<b>${num(o.pending)}</b><span class="small muted">${esc(t(d.uom))}</span>` }), 3), `<span class="cnt">${d.orders.length}</span>`) : ""}
    ${panel(t("Stock movements"), d.moves.length ? moreList(d.moves, (m) => imove(m, d.uom), 10) : empty(t("No movement yet")), d.moves.length ? `<span class="cnt">${d.moves.length}</span>` : "")}`;
  const it = { item_code: d.code, item_name: d.name, uom: d.uom, qty: d.qty };
  S.acts.rel = () => (S.b.rules.card_for_store ? storeByCard("issue", [it]) : releaseSheet([it]));
  S.acts.ret = () => storeByCard("return", [it]);
  S.acts.recv = () => go(d.orders.length === 1 ? `receive/${d.orders[0].name}` : "store/receive");
  S.acts.edit = () => itemSheet(d);
};
const imove = (m, uom) => lrow({ ic: m.kind === "in" ? "truck" : m.kind === "back" ? "store" : "box",
  title: `${m.kind === "in" ? t("Received from {0}", m.who || "") : m.kind === "back" ? t("Returned by {0}", m.who || "") : m.kind === "out" ? t("Released to {0}", m.who || "") : t("Stock adjusted")}${m.face ? " ✓" : ""}`,
  sub: esc([fdate(m.date), m.time, m.ref, m.name].filter(Boolean).join(" · ")), end: `<b class="${m.kind === "out" ? "neg" : "pos"}" dir="ltr">${m.kind === "out" ? "−" : "+"}${num(m.qty)}</b><span class="small muted">${esc(t(uom))}</span>`, chev: false });

/* identify an item from a photo (AI), then open it or add it */
async function identifyItem() {
  let p;
  try { p = await takePhoto(t("Photo of the item")); } catch (e) { toast(e.message, "bad"); return; }
  if (!p) return;
  let r;
  try { r = await busy(api("buildiary.stores.identify", { file_url: p.url }), t("The AI is looking at the photo…")); } catch (e) { toast(e.message, "bad"); return; }
  const sh = sheet(t("Identify from a photo"), `<div class="stack"><div class="row" style="flex-wrap:nowrap;gap:12px;align-items:flex-start"><img class="ith big zoomable" src="${esc(p.url)}" alt="">
      <div style="min-width:0"><b>${esc(r.what || t("Not sure what this is"))}</b>${r.count ? `<span class="small muted" style="display:block">${esc(t("About {0} visible", r.count))}</span>` : ""}</div></div>
    ${r.matches.length ? panel(t("In the store list"), `<div class="lst">${r.matches.map((m) => lrow({ go: `item/${encodeURIComponent(m.code)}`, title: m.name, sub: esc(m.why || ""), end: pill(`${m.confidence}%`, m.confidence >= 70 ? "good" : "warn") })).join("")}</div>`, "", "plain") : `<div class="banner warn">${esc(t("This doesn't match any item in the store list."))}</div>`}
    ${C().new_item ? `<button class="btn wide" data-new="1">${icon("plus")}${esc(r.suggested.name ? t("Add as a new item: {0}", r.suggested.name) : t("Add as a new item"))}</button>` : ""}</div>`, { full: true });
  const nb = sh.querySelector("[data-new]");
  if (nb) nb.onclick = () => { closeSheet(sh); itemSheet({ name: r.suggested.name, item_group: r.suggested.group, uom: r.suggested.uom, image: p.url }); };
}

/* add or edit a store item */
async function itemSheet(d = {}) {
  const isNew = !d.code;
  let groups;
  try { groups = await busy(api("buildiary.stores.groups")); } catch (e) { toast(e.message, "bad"); return; }
  const units = ["Nos", "Bag", "Kg", "Tonne", "Cubic Foot", "Square Foot", "Foot", "Litre", "Gallon", "Set", "Roll", "Coil", "Box", "Pair", "Lot", "Truck Load"];
  const unit = units.find((u) => u.toLowerCase() === String(d.uom || "").toLowerCase()) || "Nos";
  const topsList = [...new Set(groups.map((g) => g.top))];
  const gsel = `<select name="item_group"><option value=""></option>${topsList.map((top) => `<optgroup label="${esc(t(top || "Other"))}">${groups.filter((g) => g.top === top).map((g) => `<option value="${esc(g.name)}" ${g.name === d.item_group ? "selected" : ""}>${esc(t(g.label))}</option>`).join("")}</optgroup>`).join("")}</select>`;
  const sh = sheet(isNew ? t("New item") : t("Edit item"), `<div class="form">
      <div class="shots">${shot("image", t("Photo of the item"), d.image || "")}</div>
      ${fld(t("Item name"), inp("item_name", d.name || ""), { req: true })}
      ${fld(t("Category"), gsel, { req: true })}
      ${isNew ? fld(t("Unit"), sel("uom", units, unit, false)) : ""}
      ${fld(t("Warn when the store has this much or less"), inp("reorder", d.reorder || "", "number"), { hint: t("Leave empty for no warning.") })}
      ${fld(t("Description"), area("description", d.description || ""))}</div>`,
    { full: true, footer: `<button class="btn" data-x="1">${esc(t("Cancel"))}</button><button class="btn pri" data-save="1">${esc(t("Save"))}</button>` });
  wireForm(sh);
  sh.querySelector("[data-save]").onclick = async () => {
    if (!need(sh, ["item_name", "item_group"])) return;
    const v = vals(sh); v.code = d.code || "";
    const r = await run(sh, () => api("buildiary.stores.item_save", { data: v }), t("Saved"));
    if (r) { closeSheet(sh); go(`item/${encodeURIComponent(r)}`); }
  };
}

/* ---------------- water: tank levels, tankers ---------------- */
const VERD = { Verified: "good", Check: "warn", Mismatch: "bad", "Not checked": "" };
const verdictPill = (v) => (v ? pill(v === "Verified" ? t("AI ✓") : v === "Mismatch" ? t("AI: mismatch") : v === "Check" ? t("AI: check") : t("AI: not checked"), VERD[v] || "") : "");
const REJ = "Brackish (rejected)";
async function waterPane(pane) {
  const d = await api("buildiary.water.overview");
  S.water = d;
  const gauge = (k) => (k.kind === "Direct use" ? "" : `<button class="gauge" data-act="read" data-v="${esc(k.name)}"><span class="small b">${esc(t(k.name))}</span>
    <span class="tankv"><i style="height:${k.level == null ? 0 : Math.max(0, Math.min(100, k.level))}%"></i><b>${k.level == null ? "—" : num(k.level) + "%"}</b></span>
    <span class="small">${k.level == null ? esc(t("No reading yet")) : esc(t("≈ {0} gal", num(Math.round(k.gallons))))}</span>
    <span class="small muted">${k.date ? esc([fdate(k.date), k.time].filter(Boolean).join(" ")) : esc(t("{0} gal tank", num(k.capacity)))}${k.ai_level != null ? ` · ${esc(t("AI {0}%", num(k.ai_level)))}` : ""}</span></button>`);
  const span = (x) => t("{0} gal", num(x.gallons)) + (x.cost ? ` · ${money(x.cost, 1)}` : "");
  const tiles = [tile(t("Tankers today"), String(d.today.count), span(d.today), "", "k7"), tile(t("This week"), String(d.week.count), span(d.week), "", "k2"),
    tile(t("This month"), String(d.month.count), span(d.month), "", "k5"), tile(t("Water quality"), d.bad ? t("{0} bad", d.bad) : t("OK"), d.bad ? t("TDS above {0} or rejected", num(d.tds_limit)) : t("No tanker above {0} ppm", num(d.tds_limit)), "", d.bad ? "k4" : "k1")];
  const maxv = Math.max(1, ...d.used, ...d.received);
  const chart = `<div class="wbars" role="img" aria-label="${esc(t("Water received and used, last 14 days"))}">${d.days.map((day, i) => `<div class="wb"><div class="wbb"><span class="r" style="height:${(d.received[i] / maxv) * 100}%"></span><span class="u" style="height:${(d.used[i] / maxv) * 100}%"></span></div><em>${new Date(day + "T00:00:00").getDate()}</em></div>`).join("")}</div>
    <div class="legend"><span><i class="r"></i>${esc(t("Received (gallons)"))}</span><span><i class="u"></i>${esc(t("Used (from tank levels)"))}</span></div>`;
  const unread = d.tanks.filter((k) => k.kind !== "Direct use" && !d.read_today.includes(k.name));
  pane.innerHTML = `<div class="ctiles">${tiles.join("")}</div>
    <div class="row"><button class="btn pri big" data-act="tanker">${icon("truck")}${esc(t("Tanker received"))}</button><button class="btn big" data-act="read">${icon("tank")}${esc(t("Level reading"))}</button></div>
    ${unread.length ? `<div class="banner warn">${esc(t("Today's level not read yet: {0}", unread.map((k) => t(k.name)).join(", ")))}</div>` : ""}
    ${panel(t("Tank levels now"), `<div class="body"><div class="gauges">${d.tanks.map(gauge).join("")}</div><p class="small muted" style="margin:10px 0 0">${esc(t("In the tanks about {0} gallons · in the books {1} gallons", num(Math.round(d.in_tanks)), num(Math.round(d.in_books))))}</p></div>`, d.owner ? `<button class="btn sm" data-act="tanks">${icon("gear")}${esc(t("Tanks"))}</button>` : "")}
    ${panel(t("Water received and used, last 14 days"), `<div class="body">${chart}</div>`)}
    ${panel(t("Tanker log"), d.tankers.length ? moreList(d.tankers, tankerRow, 8) : empty(t("No tankers logged"), t("Log each tanker at the gate with its number plate, size, TDS reading and a photo.")), `<span class="cnt">${d.tankers.length}</span>`)}
    ${panel(t("Tank readings"), d.readings.length ? moreList(d.readings, readingRow, 6) : empty(t("No readings yet"), t("Photograph the inside of the tank through the manhole each morning; the AI estimates the level from the photo.")))}`;
  S.acts.tanker = () => tankerSheet(d);
  S.acts.read = (v) => readingSheet(d, v);
  S.acts.tanks = () => tanksSheet(d);
  S.acts.wtk = (name) => tankerDetail(d.tankers.find((x) => x.name === name));
  S.acts.wtr = (name) => readingDetail(d.readings.find((x) => x.name === name));
}
const badWater = (r) => r.water_type === REJ || +r.tds_ppm > ((S.water && S.water.tds_limit) || 1000);
const tankerRow = (r) => lrow({ act: "wtk", data: r.name, img: r.tanker_photo, ic: r.tanker_photo ? null : "truck", title: `${r.vehicle_no} · ${t("{0} gal", num(r.gallons))}`,
  sub: esc([fdate(r.date), r.time, r.supplier_text, r.water_type === REJ ? t("Rejected") : r.tds_ppm ? `TDS ${r.tds_ppm}` : "", r.received_by_name].filter(Boolean).join(" · ")),
  end: `${badWater(r) ? pill(t("Bad water"), "bad") : ""}${verdictPill(r.ai_verdict)}` });
const readingRow = (r) => lrow({ act: "wtr", data: r.name, img: r.photo, ic: r.photo ? null : "tank", title: `${t(r.tank)} · ${num(r.level_pct)}%`,
  sub: esc([fdate(r.date), r.time, r.ai_level_pct != null ? t("AI {0}%", num(r.ai_level_pct)) : "", r.ai_clarity ? t(r.ai_clarity) : ""].filter(Boolean).join(" · ")), end: verdictPill(r.ai_verdict) });

function tankerForm(box, d) {
  const tanks = d.tanks.map((k) => [k.name, t(k.name)]);
  const first = (d.tanks.find((k) => k.kind === "Underground") || d.tanks[0] || {}).name || "";
  const money_ = C().money || C().owner;
  box.innerHTML = `<div class="form">
    ${fld(t("Tanker vehicle no."), inp("vehicle_no", "", "text", 'autocapitalize="characters" placeholder="TLA-123"'), { req: true })}
    ${fld(t("Water supplier / hydrant"), inp("supplier_text"))}
    ${fld(t("Tanker size (gallons)"), `${chips("gal", [["1000", "1,000"], ["2000", "2,000"], ["3000", "3,000"], ["5000", "5,000"]], "")}<input name="gallons" type="number" inputmode="decimal" step="any" style="margin-top:8px" placeholder="${esc(t("or type the size"))}">`, { req: true })}
    ${fld(t("Water"), chips("water_type", ["Sweet (construction & curing)", "Drinking", REJ], "Sweet (construction & curing)"))}
    ${fld(t("TDS reading (ppm)"), inp("tds_ppm", "", "number"), { hint: t("Above {0} ppm is not fit for concrete or curing.", num(d.tds_limit)) })}
    <div data-f="emptied_into">${fld(t("Emptied into"), sel("emptied_into", tanks, first, false))}</div>
    ${fld(t("Cost (Rs)"), inp("cost", "", "number"), { hint: money_ ? "" : t("Fill in when you pay it from petty cash.") })}
    <label class="checkrow"><input type="checkbox" name="paid_from_petty_cash"><span>${esc(t("Paid in cash from petty cash"))}</span></label>
    ${fld(t("Photos"), `<div class="shots">${shot("tanker_photo", t("Tanker with number plate"), "", { req: true })}${shot("bill_scan", t("Tanker bill / slip"), "", { req: true })}${shot("tds_photo", t("TDS meter or water sample"))}</div>`, { req: true })}
    ${fld(t("Tanker bill / slip no."), inp("bill_no"))}
    ${fld(t("Notes"), area("notes"))}<input type="hidden" name="location">
    <button type="button" class="btn wide" data-verify="1">${icon("sparkle")}${esc(t("Verify with AI"))}</button><div data-ai></div></div>`;
  wireForm(box);
  box.addEventListener("chip", (e) => {
    const g = e.target.closest("[data-chips]"); if (!g) return;
    if (g.dataset.chips === "gal") box.querySelector("[name=gallons]").value = e.detail;
    if (g.dataset.chips === "water_type") box.querySelector('[data-f="emptied_into"]').hidden = e.detail === REJ;
  });
  box.querySelector("[name=gallons]").addEventListener("input", () => $$('[data-chips="gal"] button', box).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.cv === box.querySelector("[name=gallons]").value))));
  box.querySelector("[data-verify]").onclick = () => verifyTanker(box);
}
async function verifyTanker(box) {
  const v = vals(box); const out = box.querySelector("[data-ai]");
  if (!v.tanker_photo) { toast(t("Take a photo of the tanker with its number plate."), "bad"); return; }
  try {
    const r = await busy(api("buildiary.water.verify_draft", { data: v }), t("The AI is checking the photos…"));
    const k = VERD[r.verdict] || "warn";
    out.innerHTML = `<div class="verdict ${k || "warn"}" style="margin-top:8px">${icon(r.verdict === "Verified" ? "check" : "alert")}<span><b>${esc(t(r.verdict))}</b> ${esc(r.summary || "")}
      ${r.plate ? `<br>${esc(t("Number plate: {0}", r.plate))}` : ""}${r.gallons ? `<br>${esc(t("Tanker size about {0} gallons", num(r.gallons)))}` : ""}${r.tds ? `<br>${esc(t("TDS on the meter: {0}", r.tds))}` : ""}</span></div>`;
  } catch (e) { out.innerHTML = `<div class="banner bad" style="margin-top:8px">${esc(e.message)}</div>`; }
}
async function tankerSave(box, check) {
  const v = vals(box);
  if (!v.vehicle_no || !(+v.gallons > 0)) throw new UserError(t("Enter the tanker number and its size in gallons."));
  if (!v.tanker_photo) throw new UserError(t("Take a photo of the tanker with its number plate."));
  if (v.water_type !== REJ && !v.bill_scan) throw new UserError(t("Scan the tanker's bill or slip."));
  v.paid_from_petty_cash = v.paid_from_petty_cash ? 1 : 0;
  if (v.paid_from_petty_cash && !(+v.cost > 0)) throw new UserError(t("Enter the cost paid from petty cash."));
  const r = await api("buildiary.water.tanker_save", { data: v, check });
  (r.warnings || []).forEach((w) => toast(w, "bad"));
  return r;
}
async function tankerSheet(d) {
  d = d || (await busy(api("buildiary.water.overview")));
  if (S.b.rules.card_for_receiving) {
    const r = await cardFlow({ title: t("Water tanker: receiver's site card"), action: "Receiving goods",
      step3: { label: "Tanker", ok: t("Save"), render(box) { tankerForm(box, d); }, submit(st, box) { return tankerSave(box, st.check.check); } } });
    if (r) { toast(t("Tanker saved"), "good"); if (location.hash.includes("water")) render(); }
    return;
  }
  const sh = sheet(t("New water tanker"), `<div data-f></div>`, { full: true, footer: `<button class="btn" data-x="1">${esc(t("Cancel"))}</button><button class="btn pri" data-save="1">${esc(t("Save"))}</button>` });
  const box = sh.querySelector("[data-f]"); tankerForm(box, d);
  sh.querySelector("[data-save]").onclick = async () => { const r = await run(sh, () => tankerSave(box, null), t("Tanker saved")); if (r) { closeSheet(sh); if (location.hash.includes("water")) render(); } };
}
async function readingSheet(d, tank) {
  d = d || (await busy(api("buildiary.water.overview")));
  const tanks = d.tanks.filter((k) => k.kind !== "Direct use");
  if (!tanks.length) { toast(t("No tanks yet. The owner adds them under Tanks."), "bad"); return; }
  const cur = tank && tanks.some((k) => k.name === tank) ? tank : (tanks.find((k) => !d.read_today.includes(k.name)) || tanks[0]).name;
  const info = (n) => tanks.find((k) => k.name === n) || {};
  const sh = sheet(t("Tank level reading"), `<div class="form">
      ${fld(t("Tank"), chips("tank", tanks.map((k) => [k.name, t(k.name)]), cur))}
      <div class="lvl"><span class="tankv big"><i style="height:50%"></i><b data-pct>50%</b></span><div class="stack" style="flex:1;gap:8px">
        <input type="range" name="level_pct" min="0" max="100" step="5" value="50" aria-label="${esc(t("Level (% full)"))}">
        <div class="chips" data-q>${[0, 25, 50, 75, 100].map((v) => `<button type="button" data-lv="${v}">${v}%</button>`).join("")}</div>
        <span class="small" data-gal></span><span class="small muted" data-last></span></div></div>
      ${fld(t("Photo inside the tank"), `<div class="shots">${shot("photo", t("Photo through the manhole"), "", { req: true, wide: true })}</div>`, { req: true })}
      ${fld(t("Notes (cleanliness, leaks)"), area("notes"))}<input type="hidden" name="location"></div>`,
    { full: true, footer: `<button class="btn" data-x="1">${esc(t("Cancel"))}</button><button class="btn pri" data-save="1">${esc(t("Save"))}</button>` });
  wireForm(sh);
  const range = sh.querySelector("[name=level_pct]");
  const upd = () => {
    const v = +range.value; const k = info(sh.querySelector("[name=tank]").value);
    sh.querySelector(".tankv i").style.height = v + "%"; sh.querySelector("[data-pct]").textContent = v + "%";
    sh.querySelector("[data-gal]").textContent = k.capacity ? t("≈ {0} of {1} gallons", num(Math.round((k.capacity * v) / 100)), num(k.capacity)) : t("The owner sets this tank's size under Tanks.");
    sh.querySelector("[data-last]").textContent = k.level != null ? t("Last reading: {0}% on {1}", num(k.level), fdate(k.date)) : t("No reading yet");
  };
  const startAt = () => { const k = info(sh.querySelector("[name=tank]").value); range.value = k.level != null ? Math.round(k.level / 5) * 5 : 50; upd(); };
  range.addEventListener("input", upd);
  sh.addEventListener("chip", startAt);
  sh.querySelector("[data-q]").addEventListener("click", (e) => { const b = e.target.closest("[data-lv]"); if (b) { range.value = b.dataset.lv; upd(); } });
  startAt();
  sh.querySelector("[data-save]").onclick = async () => {
    const v = vals(sh);
    if (!v.photo) { sheetError(sh, t("Take a photo inside the tank (through the manhole).")); return; }
    const r = await run(sh, () => api("buildiary.water.reading_save", { tank: v.tank, level_pct: v.level_pct, photo: v.photo, notes: v.notes, location: v.location }));
    if (!r) return;
    closeSheet(sh);
    toast(r.used > 0 ? t("Saved. Water used since the last reading: about {0} gallons", num(Math.round(r.used))) : t("Saved"), "good");
    if (r.warning) toast(r.warning, "warn");
    if (location.hash.includes("water")) render();
  };
}
function tanksSheet(d) {
  const kinds = ["Underground", "Overhead", "Drums", "Direct use"];
  const sh = sheet(t("Tanks"), `<div class="form">${d.tanks.map((k, i) => `<div class="line" data-skip="1"><div class="lt"><b>${esc(t(k.name))}</b><span class="small muted">${esc(t(k.kind))}</span></div>
      <div class="two">${fld(t("Size (gallons)"), `<input data-cap="${i}" type="number" inputmode="decimal" value="${esc(k.capacity || "")}">`)}${fld(t("In use"), `<select data-use="${i}"><option value="1" selected>${esc(t("Yes"))}</option><option value="0">${esc(t("No"))}</option></select>`)}</div></div>`).join("")}
      ${panel(t("Add a tank"), `<div class="body form">${fld(t("Tank name"), inp("tank_name", "", "text", `placeholder="${esc(t("e.g. Second overhead tank"))}"`))}<div class="two">${fld(t("Kind"), sel("kind", kinds, "Overhead", false))}${fld(t("Size (gallons)"), inp("capacity_gallons", "", "number"))}</div></div>`, "", "plain")}</div>`,
    { full: true, footer: `<button class="btn" data-x="1">${esc(t("Cancel"))}</button><button class="btn pri" data-save="1">${esc(t("Save"))}</button>` });
  sh.querySelector("[data-save]").onclick = async () => {
    const jobs = [];
    d.tanks.forEach((k, i) => {
      const cap = +sh.querySelector(`[data-cap="${i}"]`).value || 0, use = sh.querySelector(`[data-use="${i}"]`).value;
      if (cap !== +k.capacity || use === "0") jobs.push({ name: k.name, kind: k.kind, capacity_gallons: cap, is_active: +use });
    });
    const v = vals(sh);
    if (v.tank_name) jobs.push({ tank_name: v.tank_name, kind: v.kind, capacity_gallons: +v.capacity_gallons || 0, is_active: 1 });
    const r = await run(sh, async () => { for (const j of jobs) await api("buildiary.water.tank_save", { data: j }); return true; }, t("Saved"));
    if (r) { closeSheet(sh); render(); }
  };
}
const photoFig = (src, cap) => (src ? `<figure class="pfig"><img src="${esc(src)}" alt="" class="zoomable"><figcaption>${esc(cap)}</figcaption></figure>` : "");
function aiBox(verdict, summary, extra = "") {
  if (!verdict) return `<div class="banner">${esc(t("The AI check runs after saving when an AI key is set in Settings."))}</div>`;
  return `<div class="verdict ${VERD[verdict] || "warn"}">${icon(verdict === "Verified" ? "check" : "alert")}<span><b>${esc(t(verdict))}</b> ${esc(summary || "")}${extra}</span></div>`;
}
function tankerDetail(r) {
  if (!r) return;
  const kv = (l, v) => (v || v === 0 ? `<div class="kv"><span>${esc(l)}</span><b>${esc(v)}</b></div>` : "");
  const sh = sheet(`${r.vehicle_no} · ${t("{0} gal", num(r.gallons))}`, `<div class="stack">
      <div class="pfigs">${photoFig(r.tanker_photo, t("Tanker with number plate"))}${photoFig(r.tds_photo, t("TDS meter or water sample"))}${photoFig(r.bill_scan, t("Tanker bill / slip"))}</div>
      <div class="kvs">${kv(t("Date"), `${fdate(r.date)} ${r.time || ""}`)}${kv(t("Water"), t(r.water_type))}${kv(t("TDS reading (ppm)"), r.tds_ppm || "—")}${kv(t("Emptied into"), r.emptied_into ? t(r.emptied_into) : "")}
        ${kv(t("Water supplier / hydrant"), r.supplier_text)}${kv(t("Received by"), r.received_by_name)}${kv(t("Tanker bill / slip no."), r.bill_no)}${r.cost != null && r.cost ? kv(t("Cost (Rs)"), money(r.cost)) : ""}</div>
      ${badWater(r) ? `<div class="banner bad">${esc(r.water_type === REJ ? t("Rejected at the gate (brackish water).") : t("TDS above {0} ppm: not fit for concrete or curing.", num(S.water.tds_limit)))}</div>` : ""}
      <div data-ai>${aiBox(r.ai_verdict, r.ai_summary)}</div>
      ${S.b.ai ? `<button class="btn" data-re="1">${icon("sparkle")}${esc(t("Check again with AI"))}</button>` : ""}</div>`, { full: true });
  const b = sh.querySelector("[data-re]");
  if (b) b.onclick = async () => { try { const x = await busy(api("buildiary.water.recheck", { doctype: "Water Tanker", name: r.name }), t("The AI is checking the photos…")); sh.querySelector("[data-ai]").innerHTML = aiBox(x.ai_verdict, x.ai_summary); } catch (e) { toast(e.message, "bad"); } };
}
function readingDetail(r) {
  if (!r) return;
  const sh = sheet(`${t(r.tank)} · ${num(r.level_pct)}%`, `<div class="stack"><div class="pfigs">${photoFig(r.photo, t("Photo inside the tank"))}</div>
      <div class="kvs"><div class="kv"><span>${esc(t("Date"))}</span><b>${esc(`${fdate(r.date)} ${r.time || ""}`)}</b></div><div class="kv"><span>${esc(t("Level (% full)"))}</span><b>${num(r.level_pct)}% · ${esc(t("≈ {0} gal", num(Math.round(r.gallons || 0))))}</b></div>
      ${r.ai_level_pct != null ? `<div class="kv"><span>${esc(t("AI estimate (% full)"))}</span><b>${num(r.ai_level_pct)}%</b></div>` : ""}${r.ai_clarity ? `<div class="kv"><span>${esc(t("Water clarity"))}</span><b>${esc(t(r.ai_clarity))}</b></div>` : ""}${r.notes ? `<div class="kv"><span>${esc(t("Notes"))}</span><b>${esc(r.notes)}</b></div>` : ""}</div>
      <div data-ai>${aiBox(r.ai_verdict, r.ai_summary)}</div>${S.b.ai ? `<button class="btn" data-re="1">${icon("sparkle")}${esc(t("Check again with AI"))}</button>` : ""}</div>`, { full: true });
  const b = sh.querySelector("[data-re]");
  if (b) b.onclick = async () => { try { const x = await busy(api("buildiary.water.recheck", { doctype: "Water Tank Reading", name: r.name }), t("The AI is checking the photo…")); sh.querySelector("[data-ai]").innerHTML = aiBox(x.ai_verdict, x.ai_summary); } catch (e) { toast(e.message, "bad"); } };
}

/* ================================================================== petty cash */
const PCST = { "Waiting for owner": "warn", Approved: "good", Rejected: "bad" };
const METHODS = ["Cash in hand", "Bank transfer", "Cheque", "JazzCash / Easypaisa", "Raast"];
VIEWS.petty = async (el) => {
  setTop(t("Petty cash"), true);
  const d = await api("buildiary.petty.overview");
  S.petty = d;
  if (d.no_person) { el.innerHTML = `<div class="banner warn">${esc(t("Your sign-in isn't linked to a person on site, so you can't hold petty cash. Ask the owner."))}</div>`; return; }
  const tiles = [tile(t("Cash in hand"), money(d.in_hand), d.full ? t("with all cash holders") : t("with you"), "", "k1"), tile(t("Spent this month"), money(d.spent_month), t("{0} bills", d.bills_month), "", "k3"),
    tile(t("Waiting for owner"), String(d.waiting), money(d.waiting_amount), "", "k4")];
  if (tiles.length % 2) tiles.push(`<span class="ctile" style="cursor:default"></span>`);
  const waiting = d.entries.filter((e) => e.docstatus === 0 && e.status === "Waiting for owner");
  const maxc = Math.max(1, ...d.by_category.map((x) => x[1]));
  el.innerHTML = `<p class="small muted" style="margin:0">${esc(t("Cash kept on site for small daily costs. Every expense needs a bill photo; the owner checks it."))}</p>
    <div class="ctiles">${tiles.join("")}</div>
    <div class="row"><button class="btn pri" data-act="exp">${icon("plus")}${esc(t("Expense"))}</button><button class="btn" data-act="paycard">${icon("card")}${esc(t("Pay by site card"))}</button>
      ${d.can_give ? `<button class="btn" data-act="give">${icon("cash")}${esc(t("Give cash"))}</button>` : ""}<button class="btn" data-act="back">${icon("refresh")}${esc(t("Return cash"))}</button></div>
    ${d.full && waiting.length ? panel(t("Waiting for your check"), `<div class="lst">${waiting.map(pcRow).join("")}</div>`, `<span class="cnt">${waiting.length}</span>`) : ""}
    ${d.full ? panel(t("Cash holders"), d.holders.length ? `<div class="lst">${d.holders.map((h) => lrow({ title: h.holder_name, sub: esc(t("Given {0} · spent {1} · returned {2}", money(h.given), money(+h.spent + +h.waiting), money(h.returned))), end: `<b>${esc(money(h.in_hand))}</b><span class="small muted">${esc(t("in hand"))}</span>`, chev: false })).join("")}</div>` : empty(t("No cash given yet"), t("The owner records cash handed to a supervisor with Give cash."))) : ""}
    ${panel(t("Spent this month by type"), d.by_category.length ? `<div class="body hbars">${d.by_category.map(([c, v]) => `<div class="hb"><span>${esc(t(c))}</span><i><b style="width:${(v / maxc) * 100}%"></b></i><em>${esc(money(v))}</em></div>`).join("")}</div>` : empty(t("Nothing spent this month")))}
    ${d.full ? panel(t("Budget lines for petty cash"), `<div class="lst">${d.categories.map((c) => lrow({ act: C().owner ? "budget" : null, data: c.name, title: t(c.name),
      sub: c.has_budget ? esc(t("Budget {0} · booked {1} · waiting {2}", money(c.budget, 1), money(c.used, 1), money(c.waiting, 1))) : esc(t("No budget yet")),
      end: c.has_budget ? `<b class="${c.left < 0 ? "neg" : ""}">${esc(money(c.left, 1))}</b><span class="small muted">${esc(t("left"))}</span>` : pill(C().owner ? t("+ Budget") : t("No budget"), C().owner ? "pri" : "warn"), chev: false })).join("")}</div>`) : ""}
    ${panel(t("Entries"), d.entries.length ? moreList(d.entries, pcRow, 10) : empty(t("No petty cash entries yet"), t("Record each small expense with its bill photo.")), `<span class="cnt">${d.entries.length}</span>`)}`;
  Object.assign(S.acts, { exp: () => expenseSheet(d), paycard: () => payByCard(d), give: () => giveCash(d), back: () => returnCash(d), pc: (n) => pcSheet(n), budget: (c) => budgetSheet(c) });
};
const pcRow = (e) => lrow({ act: "pc", data: e.name, img: e.bill_photo || e.proof_1, ic: e.bill_photo || e.proof_1 ? null : e.entry_type === "Expense" ? "pay" : "cash",
  title: `${t(e.entry_type)} · ${money(e.amount)}`, sub: esc([fdate(e.date), e.entry_type === "Expense" ? t(e.category || "") : t(e.method || ""), e.paid_to, S.petty && S.petty.full ? e.holder_name : ""].filter(Boolean).join(" · ")),
  end: `${e.face ? pill(e.face === "Match" ? t("Face ✓") : ST(e.face), e.face === "Match" ? "good" : "warn") : ""}${pill(ST(e.status), PCST[e.status])}` });
const holderSel = (d, label) => (d.full && d.holder_list.length ? fld(label, sel("holder", d.holder_list.map((h) => [h.name, h.full_name]), d.me || "", true), { req: true }) : "");
const catSel = (d, wages) => {
  const cats = d.categories.slice().sort((a, b) => (wages ? b.for_wages - a.for_wages : 0));
  const first = wages ? (cats.find((c) => c.for_wages) || {}).name || "" : "";
  return sel("category", cats.map((c) => [c.name, t(c.name) + (!c.has_budget ? ` · ${t("no budget")}` : c.over ? ` · ${t("over budget")}` : "")]), first, !wages);
};
function budgetNote(box, d) {
  const out = box.querySelector("[data-bud]"); const c = d.categories.find((x) => x.name === box.querySelector("[name=category]").value);
  if (!out) return;
  if (!c) { out.innerHTML = ""; return; }
  if (!c.has_budget) { out.innerHTML = `<div class="banner bad">${esc(d.rules.budget ? t("There is no budget for {0} yet. Ask the owner to add it before spending.", t(c.name)) : t("There is no budget for {0} yet.", t(c.name)))}</div>`; return; }
  out.innerHTML = d.full ? `<div class="banner ${c.left < 0 ? "bad" : "good"}">${esc(t("Budget {0} · left {1}", money(c.budget, 1), money(c.left, 1)))}</div>` : c.over ? `<div class="banner warn">${esc(t("This line is over its budget. The owner will see it."))}</div>` : "";
}
function expenseSheet(d) {
  const sh = sheet(t("Petty cash expense"), `<div class="form">
      ${holderSel(d, t("Paid from cash held by"))}
      ${fld(t("Amount (Rs)"), inp("amount", "", "number"), { req: true })}
      ${fld(t("Spent on"), catSel(d, false), { req: true })}<div data-bud></div>
      ${fld(t("Paid to / shop"), inp("paid_to"), { req: true })}
      ${fld(t("Bill / receipt no."), inp("bill_no"))}
      ${fld(t("Photo of the bill or receipt"), `<div class="shots">${shot("bill_photo", t("Bill or receipt"), "", { req: !!d.rules.bill, wide: true })}</div>`, { req: !!d.rules.bill })}
      ${fld(t("What it was for"), area("notes"))}</div>`,
    { full: true, footer: `<button class="btn" data-x="1">${esc(t("Cancel"))}</button><button class="btn pri" data-save="1">${esc(t("Save"))}</button>` });
  wireForm(sh);
  sh.querySelector("[name=category]").addEventListener("change", () => budgetNote(sh, d));
  sh.querySelector("[data-save]").onclick = async () => {
    if (!need(sh, ["amount", "category", "paid_to"].concat(d.full && d.holder_list.length ? ["holder"] : []))) return;
    const v = vals(sh);
    if (d.rules.bill && !v.bill_photo) { sheetError(sh, t("Take a photo of the bill or receipt.")); return; }
    const r = await run(sh, () => api("buildiary.petty.entry_save", { data: Object.assign(v, { entry_type: "Expense" }) }));
    if (r) { closeSheet(sh); toast(r.status === "Approved" ? t("Saved and booked") : t("Saved: waiting for the owner's check"), "good"); render(); }
  };
}
async function payByCard(d) {
  d = d || (await busy(api("buildiary.petty.overview")));
  const r = await cardFlow({ title: t("Pay from petty cash by site card"), action: "Petty cash", step3: { label: "Payment", ok: t("Pay"),
    render(box) {
      box.innerHTML = `<div class="form">${holderSel(d, t("Paid from cash held by"))}${fld(t("Amount (Rs)"), inp("amount", "", "number"), { req: true })}
        ${fld(t("Spent on"), catSel(d, true), { req: true })}<div data-bud></div>${fld(t("What it was for"), area("notes", "", `placeholder="${esc(t("e.g. wage advance for this week"))}"`))}</div>`;
      wireForm(box); box.querySelector("[name=category]").addEventListener("change", () => budgetNote(box, d)); budgetNote(box, d);
    },
    submit(st, box) {
      const v = vals(box);
      if (!(+v.amount > 0)) throw new UserError(t("Enter the amount."));
      if (!v.category) throw new UserError(t("Choose what the money was spent on."));
      return api("buildiary.petty.entry_save", { data: Object.assign(v, { entry_type: "Expense", paid_to_person: st.who.name }), check: st.check.check });
    } } });
  if (r) { toast(r.status === "Approved" ? t("Paid and booked") : t("Paid: waiting for the owner's check"), "good"); if (location.hash.includes("petty")) render(); }
}
function cashForm(d, giving, withHolder) {
  return `<div class="form">${withHolder ? holderSel(d, giving ? t("Supervisor (cash holder)") : t("Returned by (cash holder)")) : ""}
    ${fld(t("Amount (Rs)"), inp("amount", "", "number"), { req: true })}
    ${fld(giving ? t("Given by") : t("Returned by"), chips("method", METHODS, "Cash in hand"))}
    ${fld(t("Transfer / cheque / receipt no."), inp("reference"))}
    ${fld(t("Handed over in front of (witness)"), inp("witness"))}
    ${fld(t("Proofs"), `<div class="shots">${shot("proof_1", t("Signed receipt or handover photo"))}${shot("proof_2", t("Transfer screenshot or cheque photo"), "", { gallery: true })}${shot("proof_3", t("Proof 3 (optional)"), "", { gallery: true })}</div>`)}
    ${fld(t("Notes"), area("notes"))}</div>`;
}
async function giveCash(d) {
  if (d.rules.card) {
    const r = await cardFlow({ title: t("Give cash by site card"), action: "Petty cash", step3: { label: "Cash", ok: t("Save"),
      render(box) { box.innerHTML = cashForm(d, true, false); wireForm(box); },
      submit(st, box) { const v = vals(box); if (!(+v.amount > 0)) throw new UserError(t("Enter the amount.")); return api("buildiary.petty.entry_save", { data: Object.assign(v, { entry_type: "Cash given", holder: st.who.name }), check: st.check.check }); } } });
    if (r) { toast(t("Saved and booked"), "good"); render(); }
    return;
  }
  cashSheet(d, true);
}
function returnCash(d) { cashSheet(d, false); }
function cashSheet(d, giving) {
  const sh = sheet(giving ? t("Give cash") : t("Return cash"), cashForm(d, giving, true), { full: true, footer: `<button class="btn" data-x="1">${esc(t("Cancel"))}</button><button class="btn pri" data-save="1">${esc(t("Save"))}</button>` });
  wireForm(sh);
  sh.querySelector("[data-save]").onclick = async () => {
    if (!need(sh, ["amount"].concat(d.full && d.holder_list.length ? ["holder"] : []))) return;
    const v = vals(sh);
    if (!v.proof_1 && !v.proof_2 && !v.proof_3) { sheetError(sh, t("Add at least one proof of the handover (signed receipt, photo, transfer screenshot or cheque).")); return; }
    const r = await run(sh, () => api("buildiary.petty.entry_save", { data: Object.assign(v, { entry_type: giving ? "Cash given" : "Cash returned" }) }));
    if (r) { closeSheet(sh); toast(r.status === "Approved" ? t("Saved and booked") : t("Saved: waiting for the owner's check"), "good"); render(); }
  };
}
async function pcSheet(name) {
  let e;
  try { e = await busy(api("buildiary.petty.entry", { name })); } catch (err) { toast(err.message, "bad"); return; }
  const kv = (l, v) => (v || v === 0 ? `<div class="kv"><span>${esc(l)}</span><b>${esc(v)}</b></div>` : "");
  const f = e.face;
  const canCheck = S.petty && S.petty.full && e.docstatus === 0 && e.status === "Waiting for owner";
  const sh = sheet(`${t(e.entry_type)} · ${money(e.amount)}`, `<div class="stack">
      <div class="row" style="justify-content:space-between">${pill(ST(e.status), PCST[e.status])}<span class="small muted">${esc(e.name)}</span></div>
      <div class="kvs">${kv(t("Date"), fdate(e.date))}${kv(t("Cash holder"), e.holder_name)}${kv(t("Spent on"), e.category ? t(e.category) : "")}${kv(t("Paid to / shop"), e.paid_to)}${kv(t("Bill / receipt no."), e.bill_no)}
        ${e.entry_type !== "Expense" ? kv(t("Given by"), t(e.method || "")) + kv(t("Transfer / cheque / receipt no."), e.reference) + kv(t("Handed over in front of (witness)"), e.witness) : ""}${kv(t("What it was for"), e.notes)}
        ${e.check_note ? kv(t("Owner's note"), e.check_note) : ""}</div>
      ${e.budget ? `<div class="banner ${e.budget.left < 0 ? "bad" : "good"}">${esc(e.budget.has_budget ? t("Budget {0} · left {1}", money(e.budget.budget, 1), money(e.budget.left, 1)) : t("No budget yet"))}</div>` : ""}
      ${f ? `<div class="facecmp"><figure><img src="${esc(f.registered_photo || "")}" alt="" class="zoomable"><figcaption>${esc(t("Registered photo"))}</figcaption></figure><figure><img src="${esc(f.live_photo || "")}" alt="" class="zoomable"><figcaption>${esc(t("Taken now"))}</figcaption></figure></div>
        <div class="verdict ${f.result === "Match" ? "good" : "warn"}">${icon(f.result === "Match" ? "check" : "alert")}<span>${esc(f.result === "Match" ? t("Face matches ({0}%)", f.score) : ST(f.result))} · ${esc(f.person_name || "")}</span></div>` : ""}
      <div class="pfigs">${photoFig(e.bill_photo, t("Bill or receipt"))}${photoFig(e.proof_1, t("Proof 1"))}${photoFig(e.proof_2, t("Proof 2"))}${photoFig(e.proof_3, t("Proof 3"))}</div></div>`,
    { full: true, footer: canCheck ? `<button class="btn bad" data-no="1">${esc(t("Reject"))}</button><button class="btn good" data-ok="1">${icon("check")}${esc(t("Approve"))}</button>` : "" });
  if (!canCheck) return;
  sh.querySelector("[data-ok]").onclick = async () => { const r = await run(sh, () => api("buildiary.petty.decide", { name, status: "Approved" }), t("Approved and booked")); if (r) { closeSheet(sh); render(); } };
  sh.querySelector("[data-no]").onclick = async () => {
    const why = await ask(t("Reject"), t("Why is it rejected? The cash holder sees this."), "", { area: true, ok: t("Reject") });
    if (!why) return;
    const r = await run(sh, () => api("buildiary.petty.decide", { name, status: "Rejected", note: why }), t("Rejected"));
    if (r) { closeSheet(sh); render(); }
  };
}
async function budgetSheet(cat) {
  const v = await ask(t("Budget for {0}", t(cat)), t("Amount to add to this budget line (Rs). It is saved as a budget in the ERP."), "", { type: "number", ok: t("Add budget") });
  if (!v) return;
  try { await busy(api("buildiary.petty.budget_add", { category: cat, amount: v })); toast(t("Budget added"), "good"); render(); } catch (e) { toast(e.message, "bad"); }
}

function releaseSheet(preset = []) {
  S.rel = preset.map((x) => ({ item_code: x.item_code, item_name: x.item_name, uom: x.uom, stock: x.qty, qty: "" }));
  const sh = sheet(t("Release to work"), `<div class="form">
    ${fld(t("Released to (mistri or group head)"), inp("issued_to"), { req: true })}
    ${fld(t("Area / activity"), inp("work_area", "", "text", `placeholder="${esc(t("e.g. first floor slab"))}"`))}
    <div class="fld"><label>${esc(t("Items"))}${req(true)}</label><div data-items class="stack"></div><button type="button" class="btn wide" data-add="1">${icon("plus")}${esc(t("Add item from the store"))}</button></div>
    ${fld(t("Photo of the material going out"), `<div class="shots">${shot("photo", t("Take photo"))}</div>`)}
  </div>`, { full: true, footer: `<button class="btn" data-x="1">${esc(t("Cancel"))}</button><button class="btn pri" data-save="1">${esc(t("Release"))}</button>` });
  wireForm(sh);
  const box = sh.querySelector("[data-items]");
  const draw = () => { box.innerHTML = S.rel.map((r, i) => `<div class="line" data-skip="1"><div class="lt"><b>${esc(r.item_name)}</b><span class="small muted">${esc(t("in store: {0} {1}", num(r.stock), t(r.uom)))}</span><button type="button" class="sh-x" data-rm="${i}">${icon("x")}</button></div>${qtyBox(`q_${i}`, r.qty || "")}</div>`).join(""); };
  draw();
  sh.querySelector("[data-add]").onclick = async () => { const it = await pickItem(t("Item from the store"), { stock: true }); if (it && !it.__new) { S.rel.push({ item_code: it.item_code, item_name: it.item_name, uom: it.uom, stock: it.qty, qty: "" }); draw(); } };
  box.addEventListener("click", (e) => { const r = e.target.closest("[data-rm]"); if (r) { S.rel.splice(+r.dataset.rm, 1); draw(); } });
  box.addEventListener("input", (e) => { const m = e.target.name && e.target.name.match(/^q_(\d+)$/); if (m) S.rel[+m[1]].qty = e.target.value; });
  sh.querySelector("[data-save]").onclick = async () => {
    if (!need(sh, ["issued_to"])) return;
    const items = S.rel.filter((r) => +r.qty > 0).map((r) => ({ item_code: r.item_code, qty: +r.qty }));
    const over = S.rel.filter((r) => +r.qty > 0 && r.stock != null && +r.qty > +r.stock);
    if (over.length) { sheetError(sh, over.map((r) => t("{0}: only {1} in the store", r.item_name, num(r.stock))).join(" · ")); return; }
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
      ${R.card_for_receiving ? `<div data-recv><button class="btn pri wide" data-act="recv">${icon("card")}${esc(t("Receiver's site card and face"))}</button></div><input type="hidden" name="check">`
        : `<div class="shots">${shot("receiver_photo", t("Photo of the person receiving") + (R.require_receiver_photo ? " *" : ""), "", { facing: "front" })}</div>${fld(t("Received by"), inp("received_by", S.b.full_name))}`}
      <div class="shots">${shot("goods_photo", t("Photo of the material"))}</div><input type="hidden" name="location"></div>`)}
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
  S.acts.recv = async () => {
    const ck = await cardFlow({ title: t("Receive goods: receiver's site card"), action: "Receiving goods" });
    if (!ck) return;
    el.querySelector("[name=check]").value = ck.check;
    if (ck.loc) el.querySelector("[name=location]").value = ck.loc;
    el.querySelector("[data-recv]").innerHTML = whoCard({ full_name: ck.full_name, full_name_ur: ck.full_name_ur, photo: ck.photo, worker_type: ck.worker_type, trade: ck.trade, name: ck.person })
      + `<div class="verdict ${ck.result === "Match" ? "good" : "warn"}" style="margin-top:8px">${icon(ck.result === "Match" ? "check" : "alert")}<span>${esc(ck.result === "Match" ? t("Face matches ({0}%)", ck.score) : ST(ck.result))}</span></div>
      <button class="btn sm" data-act="recv" style="margin-top:8px">${icon("refresh")}${esc(t("Change the receiver"))}</button>`;
  };
  S.acts.save = async () => {
    if (R.card_for_receiving && !el.querySelector("[name=check]").value) { toast(t("Scan the receiver's site card and take their photo first."), "bad"); el.querySelector("[data-recv]").scrollIntoView({ block: "center" }); return; }
    const need_ = ["dn_no"]; if (R.require_dn_scan) need_.push("dn_scan"); if (R.require_receiver_photo && !R.card_for_receiving) need_.push("receiver_photo");
    if (!need(el, need_)) return;
    const v = vals(el);
    const lines = d.lines.map((l, i) => ({ po_detail: l.po_detail, qty: +(v[`q_${i}`] || 0) })).filter((x) => x.qty > 0);
    if (!lines.length) { toast(t("Enter the quantity received for at least one item."), "bad"); return; }
    if (!v.location) v.location = await getLocation().catch(() => "");
    try {
      const r = await busy(api("receive", { po, lines, dn_no: v.dn_no, dn_scan: v.dn_scan, receiver_photo: v.receiver_photo, goods_photo: v.goods_photo, vehicle: v.vehicle, received_by: v.received_by, location: v.location, check: v.check || null }), t("Saving…"));
      sheet(t("Goods received"), `<div class="stack" style="align-items:center;text-align:center"><span class="qa-i" style="--tc:var(--k1);width:64px;height:64px">${icon("check")}</span><b style="font-size:18px">${esc(r.name)}</b><span>${esc(t("The purchase order is now {0}% received.", num(r.po_status.per_received)))}</span></div>`,
        { footer: `<button class="btn pri" data-go="store/receive">${esc(t("Done"))}</button>` });
    } catch (e) { el.querySelector("[data-err]").innerHTML = `<div class="banner bad"><b>${esc(t("Not saved"))}</b>${esc(e.message)}</div>`; el.querySelector("[data-err]").scrollIntoView({ block: "center" }); }
  };
};

/* ================================================================== more */
/** The maker: SMH Global Services (its logo, light or dark to suit the theme). */
const MAKER = () => `<a class="maker" href="https://www.smhglobal.com.pk" target="_blank" rel="noopener"><span>${esc(t("A product of"))}</span><img class="mk-d" src="/assets/buildiary/images/smh-global.svg" alt="SMH Global Services"><img class="mk-l" src="/assets/buildiary/images/smh-global-light.svg" alt="SMH Global Services"></a>`;
VIEWS.more = async (el) => {
  setTop(t("More"));
  const c = C(); const b = S.b;
  const T = [];
  if (c.people) T.push(["Attendance", "users", "att", "k1"], ["People and access", "card", "people", "k7"]);
  if (c.suppliers) T.push(["Suppliers", "truck", "suppliers", "k2"]);
  if (c.buy) T.push(["Quotations", "log", "quotes", "k6"], ["Purchase orders", "cart", "orders", "k5"]);
  if (c.money) T.push(["Money", "pay", "money/bills", "k8"], ["Budget", "budget", "money/budget", "k3"]);
  if (c.site) T.push(["Snags", "alert", "build/snags", "k4"], ["Site diary", "log", "build/diary", "k7"]);
  if (STORE()) T.push(["Stock", "box", "store/items", "k3"], ["Water", "drop", "store/water", "k7"]);
  if (PETTY()) T.push(["Petty cash", "cash", "money/petty", "k1"]);
  if (S.b.ai) T.push(["Ask the project", "sparkle", "ask", "k5"]);
  if (c.owner || PROJECTS().length > 1) T.push(["Projects", "house", "projects", "k2"]);
  T.push(["My settings", "gear", "settings", "k8"]);
  if (c.owner && S.b.plan) T.push(["Plan & billing", "pay", "@billing", "k6"]);
  if (c.owner && !NATIVE && !S.b.plan) T.push(["Connect a phone", "globe", "connect", "k2"]);
  el.innerHTML = `<button class="mo-me" data-go="settings"><span class="av">${b.image ? `<img src="${esc(b.image)}" alt="">` : esc((b.full_name || "?").charAt(0))}</span><span><b>${esc(b.full_name)}</b><span class="small muted">${esc(b.project_name || "")}</span></span>${icon("chev", "lch")}</button>
    <div class="qa-grid">${T.map(([l, ic, to, tc]) => `<button class="qa" ${to.startsWith("@") ? `onclick="location.href='/${to.slice(1)}'"` : `data-go="${to}"`}><span class="qa-i" style="--tc:var(--${tc})">${icon(ic)}</span><span>${esc(t(l))}</span></button>`).join("")}</div>${MAKER()}`;
};

/* ================================================================== projects (a builder's sites) */
const PROJECTS = () => (S.b && S.b.projects) || [];
/** Under the screen title: the project being worked in (only when there is more than one). */
function projChip() {
  if (PROJECTS().length < 2) return "";
  return `<button class="projchip" data-act="project" aria-label="${esc(t("Change project"))}">${icon("house")}<span>${esc(S.b.project_name || "")}</span>${icon("chev", "dn")}</button>`;
}
async function switchProject(name) {
  const r = await busy(api("buildiary.projects.switch", { name }), t("Opening…"));
  S.b.project = r.project; S.b.project_name = r.project_name; S.b.store = r.store;
  S.b.projects = PROJECTS().map((p) => Object.assign(p, { current: p.name === r.project }));
  S.cache = {}; S.build = null; S.petty = null;
  toast(t("Now working in {0}", r.project_name), "good");
  render();
}
GLOBAL.project = () => {
  const P = PROJECTS(); const c = C();
  const row = (p) => `<button class="lrow ${p.current ? "cur" : ""}" data-p="${esc(p.name)}"><span class="lth">${icon(p.current ? "check" : "house")}</span><span class="lmain"><b>${esc(p.title)}</b><span class="lsub">${esc([p.status === "Open" ? t("{0}% done", p.done) : t("Finished"), p.end ? t("Finish {0}", fdate(p.end)) : ""].filter(Boolean).join(" · "))}</span></span></button>`;
  const sh = sheet(t("Choose the project"), `<div class="lst">${P.map(row).join("")}</div>`,
    { footer: `<button class="btn" data-all="1">${esc(t("All projects"))}</button>${c.owner ? `<button class="btn pri" data-new="1">${icon("plus")}${esc(t("Add a project"))}</button>` : ""}` });
  sh.addEventListener("click", (e) => {
    const b = e.target.closest("[data-p]");
    if (b) { closeSheet(sh); if (b.dataset.p !== S.b.project) switchProject(b.dataset.p).catch((er) => toast(er.message, "bad")); return; }
    if (e.target.closest("[data-all]")) { closeSheet(sh); go("projects"); return; }
    if (e.target.closest("[data-new]")) { closeSheet(sh); projectSheet(); }
  });
};
VIEWS.projects = async (el) => {
  setTop(t("Projects"), true);
  const d = await api("buildiary.projects.projects");
  S.b.projects = d.rows.map((r) => ({ name: r.name, title: r.title, status: r.status, done: r.done, start: r.start, end: r.end, current: r.current }));
  const limit = d.limit ? `<p class="small muted" style="margin:0 0 10px">${esc(t("{0} of {1} open projects on your plan", d.open, d.limit))}</p>` : "";
  const card = (r) => `<article class="pcard ${r.current ? "cur" : ""}">
      <div class="pc-h"><span class="pc-t"><b>${esc(r.title)}</b><span class="small muted">${esc([r.address, r.start && r.end ? `${fdate(r.start)} → ${fdate(r.end)}` : r.start ? t("From {0}", fdate(r.start)) : ""].filter(Boolean).join(" · "))}</span></span>
        ${r.current ? pill(t("Working here"), "good") : r.status !== "Open" ? pill(t("Finished")) : ""}</div>
      ${r.stages ? `${bar(r.built)}<div class="row small" style="gap:8px;flex-wrap:wrap"><span><b>${num(r.built)}%</b> ${esc(t("built"))}</span><span class="muted">${esc(t("Planned {0}%", num(r.planned)))}</span>${r.behind ? pill(t("{0} behind plan", r.behind), "bad") : ""}</div>`
        : `<p class="small muted" style="margin:0">${esc(t("No stages yet."))}</p>${d.can_add ? `<button class="btn sm" data-act="pstages" data-v="${esc(r.name)}">${icon("plus")}${esc(t("Add the usual stages of building"))}</button>` : ""}`}
      <div class="sc-acts">${r.current ? `<button class="btn sm pri" data-go="build">${esc(t("Go to the project"))}</button>` : `<button class="btn sm pri" data-act="pswitch" data-v="${esc(r.name)}">${esc(t("Work in this project"))}</button>`}
        ${d.can_add ? `<button class="btn sm" data-act="pedit" data-v="${esc(r.name)}">${icon("pencil")}${esc(t("Edit"))}</button>` : ""}</div></article>`;
  el.innerHTML = `${limit}<div class="stack">${d.rows.map(card).join("")}</div>
    ${d.can_add ? `<button class="btn pri wide" data-act="pnew" style="margin-top:14px">${icon("plus")}${esc(t("Add a project"))}</button>
      <p class="small muted" style="margin-top:8px">${esc(t("Each project has its own store, schedule, attendance, buying and budget. Workers and suppliers are shared."))}</p>` : ""}`;
  S.acts.pswitch = (v) => switchProject(v).catch((e) => toast(e.message, "bad"));
  S.acts.pnew = () => projectSheet();
  S.acts.pstages = async (v) => { try { const n = await busy(api("buildiary.projects.add_stages", { name: v }), t("Saving…")); toast(t("{0} stages added", n), "good"); S.build = null; render(); } catch (e) { toast(e.message, "bad"); } };
  S.acts.pedit = (v) => projectSheet(d.rows.find((r) => r.name === v));
};
function projectSheet(p) {
  const edit = !!p;
  const sh = sheet(edit ? t("Change the project") : t("Add a project"), `<div class="form">
    ${fld(t("Project name"), inp("title", edit ? p.title : "", "text", `placeholder="${esc(t("e.g. House 14, DHA Phase 6"))}" maxlength="80"`), { req: true })}
    ${fld(t("Address"), inp("address", edit ? p.address : ""))}
    <div class="two">${fld(t("Start"), inp("start", edit ? (p.start || "") : S.b.today, "date"))}${fld(t("Finish (planned)"), inp("end", edit ? (p.end || "") : "", "date"))}</div>
    ${edit ? fld(t("Status"), chips("status", [["Open", t("Under construction")], ["Completed", t("Finished")]], p.status === "Open" ? "Open" : "Completed"))
      : `${fld(t("Budget (optional)"), inp("budget", "", "number"))}
        <label class="check"><input type="checkbox" name="schedule" value="1" checked><span>${esc(t("Start with the usual stages of building a house (design to handover), spread between the start and finish dates"))}</span></label>`}
  </div>`, { full: true, footer: `<button class="btn" data-x="1">${esc(t("Cancel"))}</button><button class="btn pri" data-save="1">${esc(edit ? t("Save") : t("Add project"))}</button>` });
  wireForm(sh);
  sh.querySelector("[data-save]").onclick = async () => {
    if (!need(sh, ["title"])) return;
    const v = vals(sh);
    if (!edit) v.schedule = sh.querySelector("[name=schedule]").checked ? 1 : 0;
    const r = await run(sh, () => edit ? api("buildiary.projects.edit", { name: p.name, data: v }) : api("buildiary.projects.new", { data: v }), edit ? t("Saved") : t("Project added"));
    if (!r) return;
    closeSheet(sh);
    if (edit) { if (p.current) S.b.project_name = v.title; render(); return; }
    const b = await api("boot"); S.b = Object.assign(S.b, { project: b.project, project_name: b.project_name, store: b.store, projects: b.projects });
    S.cache = {}; S.build = null;
    go("build");
  };
}

/* ---------------- site card and face: the steps used wherever a person is identified ---------------- */
const whoCard = (w) => `<div class="who-card">${w.photo ? `<img src="${esc(w.photo)}" alt="" class="zoomable">` : `<span class="ph"></span>`}<div style="min-width:0"><b>${esc(w.full_name)}</b>${w.full_name_ur ? `<span class="ur" style="display:block">${esc(w.full_name_ur)}</span>` : ""}<span class="small muted">${esc([t(w.worker_type || ""), t(w.trade || ""), w.name].filter(Boolean).join(" · "))}</span></div></div>`;
/** Site card → face → (the entry). Resolves the entry's result (or the face check when there is no third step), or null. */
function cardFlow({ title, action, step3, needCard = 1 }) {
  return new Promise((resolve) => {
    const labels = [t("Card"), t("Face")].concat(step3 ? [t(step3.label)] : []);
    const st = { code: "", who: null, check: null, done: false };
    const sh = sheet(title, `<div class="steps">${labels.map((l, i) => `<span data-s="${i}"><b>${i + 1}</b>${esc(l)}</span>`).join("")}</div><div data-body></div>`,
      { full: true, footer: `<button class="btn" data-x="1">${esc(t("Cancel"))}</button><button class="btn pri" data-next="1" hidden></button>` });
    const body = sh.querySelector("[data-body]"), next = sh.querySelector("[data-next]");
    let stopScan = null;
    const mark = (i) => $$("[data-s]", sh).forEach((x) => { const k = +x.dataset.s; x.classList.toggle("on", k === i); x.classList.toggle("done", k < i); });
    const finish = (v) => { if (st.done) return; st.done = true; if (stopScan) stopScan(); closeSheet(sh); resolve(v); };
    const obs = new MutationObserver(() => { if (!document.body.contains(sh) || sh.parentElement.classList.contains("closing")) { obs.disconnect(); if (stopScan) stopScan(); if (!st.done) { st.done = true; resolve(null); } } });
    obs.observe($("#sheetRoot"), { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    async function step1(err) {
      mark(0); next.hidden = true; sheetError(sh, err || "");
      if (NATIVE || !("BarcodeDetector" in window)) {
        body.innerHTML = `<div class="stack" style="align-items:center;text-align:center;padding:10px 0"><span class="qa-i" style="--tc:var(--k2);width:76px;height:76px">${icon("card")}</span>
          <p style="margin:0">${esc(t("Hold the person's site card in front of the camera."))}</p><button class="btn pri big wide" data-scan="1">${icon("qr")}${esc(t("Scan site card"))}</button></div>`;
        const scan = async () => { const code = await scanCode(t("Scan the site card")); if (code) gotCode(code); };
        body.querySelector("[data-scan]").onclick = scan;
        if (NATIVE && !err) scan();
      } else {
        body.innerHTML = `<div class="cam"><video playsinline muted autoplay></video><div class="frame"></div><div class="note">${esc(t("Waiting for a site card… hold the card's QR inside the frame"))}</div></div>
          <div class="row" style="margin-top:10px;justify-content:center"><button class="btn sm" data-flip="1">${icon("refresh")}${esc(t("Switch camera"))}</button></div>`;
        const r = qrReader(body.querySelector(".cam"), body.querySelector("[data-flip]"));
        stopScan = r.stop;
        r.result.then((c) => { stopScan = null; if (c) gotCode(c); }).catch((e) => { const n = body.querySelector(".note"); if (n) n.textContent = e.message; });
      }
    }
    async function gotCode(code) {
      try {
        const w = await busy(api("buildiary.api.find_worker", { code }), t("Finding the person…"));
        if (!w) return step1(t("This card is not recognised. Is the person registered?"));
        if (needCard && !w.card_scanned) return step1(t("Scan the person's site card. Typing the number is not enough here."));
        if (w.status !== "Active") return step1(t("{0} is {1} in the register and can't be used here.", w.full_name, ST(w.status)));
        st.code = code; st.who = w; step2();
      } catch (e) { step1(e.message); }
    }
    function step2() {
      mark(1); next.hidden = true; sheetError(sh, "");
      body.innerHTML = `<div class="stack">${whoCard(st.who)}<p style="margin:0">${esc(t("Take a photo of {0}'s face now. The AI compares it with the registered photo.", st.who.full_name))}</p>
        <button class="btn pri big wide" data-face="1">${icon("cam")}${esc(t("Take face photo"))}</button><div data-res></div></div>`;
      const btn = body.querySelector("[data-face]");
      btn.onclick = async () => {
        sheetError(sh, "");
        try {
          const p = await takePhoto(t("Face of {0}", st.who.full_name), { facing: "front", live: true, face: true });
          if (!p) return;
          const r = await busy(api("buildiary.identity.verify", { code: st.code, photo: p.url, action, location: p.loc || "", need_card: needCard }), t("Checking the face…"));
          st.check = r;
          const kind = r.result === "Match" ? "good" : r.ok ? "warn" : "bad";
          const msg = r.result === "Match" ? t("Face matches ({0}%)", r.score) : r.result === "Not checked" ? t("Face not checked: {0}", r.notes || "")
            : r.ok ? t("Face not clear ({0}). Allowed, and flagged for the owner.", ST(r.result)) : (r.message || t("The face does not match."));
          body.querySelector("[data-res]").innerHTML = `<div class="facecmp"><figure><img src="${esc(r.photo || "")}" alt="" class="zoomable"><figcaption>${esc(t("Registered photo"))}</figcaption></figure><figure><img src="${esc(p.url)}" alt="" class="zoomable"><figcaption>${esc(t("Taken now"))}</figcaption></figure></div>
            <div class="verdict ${kind}" style="margin-top:10px">${icon(kind === "good" ? "check" : "alert")}<span>${esc(msg)}</span></div>${(r.warnings || []).length ? `<div class="banner warn" style="margin-top:8px">${r.warnings.map(esc).join("<br>")}</div>` : ""}`;
          if (r.ok) { next.hidden = false; next.textContent = step3 ? t("Next") : t("Done"); next.onclick = () => (step3 ? step3go() : finish(st.check)); }
          else btn.innerHTML = `${icon("cam")}${esc(t("Take the photo again"))}`;
        } catch (e) { sheetError(sh, e.message); }
      };
    }
    function step3go() {
      mark(2); sheetError(sh, "");
      body.innerHTML = whoCard(st.who) + `<div data-s3 class="form" style="margin-top:12px"></div>`;
      const box = body.querySelector("[data-s3]");
      step3.render(box, st, sh);
      next.hidden = false; next.textContent = step3.ok || t("Save");
      next.onclick = async () => { const r = await run(sh, () => step3.submit(st, box)); if (r !== undefined && r !== false) finish(r); };
    }
    step1();
  });
}

/* attendance by site card: card → face → time in / out */
async function attendanceByCard() {
  const r = await cardFlow({ title: t("Attendance by site card"), action: "Attendance", step3: { label: "Time in / out", ok: t("Save"),
    async render(box, st) {
      box.innerHTML = `<div class="spin"></div>`;
      let row = null, locked = false; try { const d = await api("attendance_today"); locked = !!(d && d.docstatus === 1); row = d && d.rows.find((x) => x.worker === st.who.name); } catch (e) { /* */ }
      const mode = locked || (row && row.time_in && !row.time_out) ? "out" : "in";
      box.innerHTML = `${locked ? `<div class="banner info" style="margin-bottom:10px">${esc(t("Today's attendance is submitted. Only time out can be marked now."))}</div>` : ""}<div class="bigchoice" data-mode="${mode}"><button type="button" data-m="in" aria-pressed="${mode === "in"}"${locked ? " disabled" : ""}>${esc(t("Time in"))}<small>${esc(row && row.time_in ? t("in at {0}", row.time_in) : t("Starting work"))}</small></button>
        <button type="button" data-m="out" aria-pressed="${mode === "out"}">${esc(t("Time out"))}<small>${esc(row && row.time_out ? t("out at {0}", row.time_out) : t("Leaving the site"))}</small></button></div>`;
      box.addEventListener("click", (e) => { const b = e.target.closest("[data-m]"); if (!b) return; $$("[data-m]", box).forEach((x) => x.setAttribute("aria-pressed", String(x === b))); box.firstElementChild.dataset.mode = b.dataset.m; });
    },
    submit(st, box) { const mode = (box.querySelector("[data-mode]") || {}).dataset?.mode || "in"; return api("attendance_card", { check: st.check.check, mode }); },
  } });
  if (r) { toast(r.mode === "out" ? t("Time out marked for {0} at {1}", r.full_name, r.time) : t("Time in marked for {0} at {1}", r.full_name, r.time), "good"); if (/#\/(att|people)/.test(location.hash)) render(); }
}

/* store issue / return by site card: card → face → items */
async function storeByCard(kind, preset = []) {
  const items = preset.map((x) => ({ item_code: x.item_code, item_name: x.item_name, uom: x.uom, stock: x.qty, qty: "" }));
  const issue = kind === "issue";
  const r = await cardFlow({ title: issue ? t("Issue from store by site card") : t("Return to store by site card"), action: issue ? "Store issue" : "Store return", step3: { label: "Items", ok: issue ? t("Release") : t("Return to store"),
    render(box) {
      box.innerHTML = `${fld(t("Area / activity"), inp("work_area", "", "text", `placeholder="${esc(t("e.g. first floor slab"))}"`))}
        <div class="fld"><label>${esc(t("Items"))}${req(true)}</label><div data-items class="stack"></div><button type="button" class="btn wide" data-add="1">${icon("plus")}${esc(issue ? t("Add item from the store") : t("Add item being returned"))}</button></div>
        ${fld(issue ? t("Photo of the material going out") : t("Photo of the material returned"), `<div class="shots">${shot("photo", t("Take photo"))}</div>`)}`;
      wireForm(box);
      const list = box.querySelector("[data-items]");
      const draw = () => { list.innerHTML = items.map((x, i) => `<div class="line" data-skip="1"><div class="lt"><b>${esc(x.item_name)}</b>${issue ? `<span class="small muted">${esc(t("in store: {0} {1}", num(x.stock), t(x.uom)))}</span>` : ""}<button type="button" class="sh-x" data-rm="${i}">${icon("x")}</button></div>${qtyBox(`q_${i}`, x.qty || "")}</div>`).join(""); };
      box.querySelector("[data-add]").onclick = async () => {
        const it = await pickItem(issue ? t("Item from the store") : t("Item being returned"), { stock: issue });
        if (it && !it.__new) { items.push({ item_code: it.item_code || it.name, item_name: it.item_name, uom: it.uom || it.stock_uom, stock: it.qty, qty: "" }); draw(); }
      };
      list.addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (b) { items.splice(+b.dataset.rm, 1); draw(); } });
      list.addEventListener("input", (e) => { const m = e.target.name && e.target.name.match(/^q_(\d+)$/); if (m) items[+m[1]].qty = e.target.value; });
      draw();
    },
    submit(st, box) {
      const rows = items.filter((x) => +x.qty > 0).map((x) => ({ item_code: x.item_code, qty: +x.qty }));
      if (!rows.length) throw new UserError(t("Add at least one item and its quantity."));
      const over = issue ? items.filter((x) => +x.qty > 0 && x.stock != null && +x.qty > +x.stock) : [];
      if (over.length) throw new UserError(over.map((x) => t("{0}: only {1} in the store", x.item_name, num(x.stock))).join(" · "));
      const v = vals(box);
      return api(issue ? "release" : "return_to_store", { items: rows, check: st.check.check, work_area: v.work_area, photo: v.photo });
    },
  } });
  if (r) { toast(issue ? t("Released") : t("Returned to the store"), "good"); if (location.hash.includes("store")) render(); }
}

/* ---------------- attendance ---------------- */
VIEWS.att = async (el) => {
  setTop(t("Attendance"), true);
  const d = await api("attendance_today");
  const A = S.att = { name: d && d.name, docstatus: d ? d.docstatus : 0, rows: (d && d.rows) || [], group_photo: d && d.group_photo, location: (d && d.location) || "" };
  const locked = A.docstatus === 1;
  const draw = () => {
    const p = A.rows.filter((r) => r.status === "Present").length, h = A.rows.filter((r) => r.status === "Half day").length;
    const now = A.rows.filter((r) => r.status !== "Absent" && r.time_in && !r.time_out).length;
    el.innerHTML = `<div class="hero"><span class="muted small">${esc(fdate(today()))}</span><b>${esc(t("{0} present · {1} half day", p, h))}</b><span class="small muted">${esc(t("{0} on site now", now))}</span></div>
      ${locked ? `<div class="banner good">${esc(t("Today's attendance is submitted."))}</div><button class="btn pri big wide" data-act="card">${icon("card")}${esc(t("Time out by site card"))}</button>` : `<button class="btn pri big wide" data-act="card">${icon("card")}${esc(t("Attendance by site card"))}</button>
        <button class="btn wide" data-act="add">${icon("plus")}${esc(t("Add by name (no card)"))}</button>`}
      ${panel(t("Workers on site"), A.rows.length ? `<div class="lst">${A.rows.map((r, i) => `<div class="lrow static" style="flex-wrap:wrap">${r.photo || r.worker_photo ? `<img class="lth round zoomable" src="${esc(r.photo || r.worker_photo)}" alt="">` : `<span class="lth round">${icon("users")}</span>`}
        <span class="lmain"><b>${esc(r.worker_name || r.worker)}</b><span class="lsub">${esc([t(r.trade || ""), r.time_in ? t("in {0}", r.time_in) : "", r.time_out ? t("out {0}", r.time_out) : ""].filter(Boolean).join(" · "))}</span></span>
        <span class="lend">${r.face === "Match" ? pill(t("Face ✓"), "good") : r.face ? pill(ST(r.face), "warn") : r.scanned ? pill(t("Card"), "info") : pill(t("By name"), "")}</span>
        ${locked ? pill(ST(r.status), r.status === "Present" ? "good" : r.status === "Absent" ? "bad" : "warn") : `${r.identity_check ? "" : `<button class="sh-x" data-act="rm" data-v="${i}">${icon("x")}</button>`}
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
  const addWorker = async (w) => {
    if (!w) return;
    if (w.status !== "Active") { toast(t("{0} is {1} in the worker register: not allowed on site.", w.full_name, ST(w.status)), "bad", w.photo); return; }
    if (A.rows.some((r) => r.worker === w.name)) { toast(t("{0} is already marked.", w.full_name), "", w.photo); return; }
    A.rows.unshift({ worker: w.name, worker_name: w.full_name, trade: w.trade, status: "Present", time_in: nowTime(), scanned: 0, worker_photo: w.photo });
    toast(t("{0}: present. Check the face matches.", w.full_name), "good", w.photo);
    draw(); persist(true);
  };
  draw();
  if (!A.location && !locked) getLocation().then((l) => { if (l) { A.location = l; const x = el.querySelector("[data-loc]"); if (x) x.textContent = l; const h = el.querySelector("[name=location]"); if (h) h.value = l; } }).catch(() => {});
  Object.assign(S.acts, {
    card: () => attendanceByCard(),
    async add() { const w = await pickWorker(); if (w) addWorker(w); },
    rm(i) { A.rows.splice(+i, 1); draw(); persist(true); },
    st(v) { const [i, s] = v.split("|"); A.rows[+i].status = s; draw(); persist(true); },
    async loc() { const l = await busy(getLocation(), t("Getting the location…")); if (!l) { toast(t("Location not available: allow location for Buildiary, then try again."), "bad"); return; } A.location = l; el.querySelector("[data-loc]").textContent = l; el.querySelector("[name=location]").value = l; },
    save() { persist(false); },
    async submit() {
      const v = vals(el); A.group_photo = v.group_photo || A.group_photo; A.location = v.location || A.location;
      try { await busy(api("attendance_save", { rows: A.rows, group_photo: A.group_photo, location: A.location, submit: 1 }), t("Saving…")); toast(t("Attendance submitted"), "good"); render(); }
      catch (e) { el.querySelector("[data-err]").innerHTML = `<div class="banner bad"><b>${esc(t("Not saved"))}</b>${esc(e.message)}</div>`; }
    },
  });
};

/* ---------------- people and access ---------------- */
const STAFF_TYPES = ["Supervisor", "Engineer", "Store keeper", "Accountant", "Owner", "Builder staff", "Consultant"];
const PEOPLE_FILTERS = [["all", "All"], ["site", "On site today"], ["labour", "Labour and mistri"], ["staff", "Site staff"], ["access", "Sign in to Buildiary"], ["left", "Left or blocked"]];
VIEWS.workers = (el) => VIEWS.people(el);
VIEWS.people = async (el) => {
  setTop(t("People and access"), true); setTab("more");
  const f0 = (location.hash.split("?")[1] || "all");
  el.innerHTML = `<div class="row" style="align-items:center;flex-wrap:nowrap"><div data-sum style="flex:1;display:flex;gap:6px;flex-wrap:wrap"></div><button class="btn pri" data-act="new" style="flex:none">${icon("plus")}${esc(t("Person"))}</button></div>
    <div class="row"><div class="fld search" style="flex:1;margin:0">${icon("search")}<input name="q" placeholder="${esc(t("Search name, phone, CNIC or card"))}" autocomplete="off"></div>${sel("f", PEOPLE_FILTERS, f0, false)}</div>
    <div data-list><div class="spin"></div></div>`;
  const list = el.querySelector("[data-list]"), q = el.querySelector("[name=q]"), fsel = el.querySelector("[name=f]");
  let rows = []; let tm = null;
  const draw = () => {
    const f = fsel.value, now = today();
    const show = rows.filter((w) => f === "all" ? w.status === "Active" : f === "site" ? w.on_site : f === "labour" ? w.status === "Active" && ["Labour", "Mistri", "Group head"].includes(w.worker_type)
      : f === "staff" ? w.status === "Active" && STAFF_TYPES.includes(w.worker_type) : f === "access" ? w.status === "Active" && (w.app_access && w.app_access !== "No sign-in" || w.store_keeper) : w.status !== "Active");
    list.innerHTML = panel(t("People"), show.length ? `<div class="lst">${show.map((w) => {
      const exp = [w.cnic_expiry, w.entry_card_expiry].some((x) => x && x < now);
      const badge = w.status !== "Active" ? pill(ST(w.status), "bad") : exp ? pill(t("Expired card"), "bad") : w.police_verification === "Verified" ? pill(ST("Active"), "good")
        : w.entry_card_no ? pill(t("Society card on record"), "info") : pill(t("Police verification pending"), "warn");
      return lrow({ go: `person/${w.name}`, img: w.photo, ic: w.photo ? "" : "users", title: w.full_name + (w.on_site ? " ●" : ""),
        sub: esc([t(w.worker_type || ""), t(w.trade || ""), w.cnic || w.phone || "", w.entry_card_no ? `BTK ${w.entry_card_no}` : ""].filter(Boolean).join(" · ")), end: badge });
    }).join("")}</div>` : empty(t("Nobody here"), t("Register each worker to print their site card.")), `<span class="cnt">${show.length}</span>`);
  };
  const load = async () => {
    rows = await api("workers", { q: q.value.trim(), status: "" });
    const act = rows.filter((w) => w.status === "Active");
    el.querySelector("[data-sum]").innerHTML = `<span class="pill info" style="padding:8px 12px">${esc(t("{0} people", act.length))}</span><span class="pill good" style="padding:8px 12px">${esc(t("{0} on site today", act.filter((w) => w.on_site).length))}</span>`;
    draw();
  };
  q.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(load, 300); });
  fsel.addEventListener("change", draw);
  S.acts.new = () => personSheet();
  await load();
};
VIEWS.worker = (el, args) => VIEWS.person(el, args);
VIEWS.person = async (el, [name]) => {
  setTop(t("Person"), true); setTab("more");
  const w = await api("person", { name }); const c = C();
  const warn = w.warnings || [];
  const doc = (k, label) => `<div class="doc"><b>${esc(label)}</b>${w[k] ? (/\.pdf$/i.test(w[k]) ? `<button class="btn sm" data-open="${esc(w[k])}">${icon("file")}${esc(t("Open"))}</button>` : `<img src="${esc(w[k])}" alt="" class="zoomable">`) : `<div class="none">${esc(t("Not uploaded"))}</div>`}
    <button class="btn sm" data-doc="${k}">${icon("cam")}${esc(w[k] ? t("Replace") : t("Upload"))}</button></div>`;
  const kv = (l, v, ltr) => v ? `<span>${esc(l)}</span><b class="${ltr ? "ltr" : ""}">${esc(v)}</b>` : "";
  const card = w.card;
  el.innerHTML = `<div class="panel plain"><div class="body" style="display:flex;gap:14px;align-items:center">${w.photo ? `<img src="${esc(w.photo)}" class="zoomable" style="width:96px;height:116px;border-radius:14px;object-fit:cover" alt="">` : `<span class="lth" style="width:96px;height:116px">${icon("users")}</span>`}
    <div class="stack" style="gap:2px;min-width:0"><b style="font-size:19px">${esc(w.full_name)}</b>${w.full_name_ur ? `<span class="ur" style="font-size:17px">${esc(w.full_name_ur)}</span>` : ""}<span class="muted">${esc(t(w.worker_type || ""))}${w.trade ? " · " + esc(t(w.trade)) : ""}</span><span class="small muted">${esc(w.name)}${w.days ? " · " + esc(t("{0} days worked", w.days)) : ""}</span>${pill(ST(w.status), w.status === "Active" ? "good" : "bad")}</div></div></div>
    ${warn.length ? `<div class="banner warn">${warn.map(esc).join("<br>")}</div>` : ""}
    <div class="pgrid">
    ${panel(t("Details"), `<div class="body kv">${kv(t("Father's name"), [w.father_name, w.father_name_ur].filter(Boolean).join(" · "))}${kv(t("Group / team"), w.gang)}${kv(t("Works for"), w.contractor_name || w.contractor)}
      ${kv(t("Mobile"), w.phone, 1)}${kv(t("CNIC"), w.cnic && (w.cnic + (w.cnic_expiry ? ` (${fdate(w.cnic_expiry)})` : "")), 1)}${kv(t("BTK registration card"), w.entry_card_no && (w.entry_card_no + (w.entry_card_expiry ? ` (${fdate(w.entry_card_expiry)})` : "")), 1)}
      ${kv(t("Police verification"), t(w.police_verification || "Not done"))}${kv(t("Joined on"), fdate(w.joined_on))}${c.money ? kv(t("Daily wage"), w.daily_wage ? money(w.daily_wage) : "") : ""}
      ${kv(t("Emergency contact"), w.emergency_contact)}${kv(t("Address"), [w.address, w.address_ur].filter(Boolean).join(" · "))}${kv(t("Notes"), w.notes)}</div>`)}
    ${panel(t("Documents"), `<div class="body docs">${doc("photo", t("Photo"))}${doc("cnic_front", t("CNIC front"))}${doc("cnic_back", t("CNIC back"))}${doc("entry_card_photo", t("BTK registration card"))}${doc("police_document", t("Police verification letter"))}</div>`)}
    ${c.owner ? panel(t("Access to Buildiary"), `<div class="body form">${fld(t("Signs in as"), chips("app_access", [["No sign-in", t("No sign-in")], ["Site supervisor", t("Site supervisor")], ["Owner's supervisor", t("Owner's supervisor")], ["Partner (builder or consultant)", t("Partner (builder or consultant)")], ["Accountant", t("Accountant")], ["Owner", t("Owner")]], w.app_access || "No sign-in"))}
      <label class="row" style="gap:10px"><input type="checkbox" name="store_keeper" ${w.store_keeper ? "checked" : ""} style="width:22px;height:22px"><span>${esc(t("Also store keeper (receives, issues and returns material)"))}</span></label>
      <button class="btn wide" data-act="access">${icon("check")}${esc(t("Save access"))}</button></div>`) : ""}
    ${c.owner ? panel(t("Sign in with site card"), `<div class="body form">
      <div class="banner ${card && card.sign_in_enabled && card.pin_set ? "good" : ""}">${esc(card && card.sign_in_enabled && card.pin_set ? t("Card sign-in is on.") + (card.last_sign_in ? " " + t("Last used {0}", fdate(String(card.last_sign_in).slice(0, 10))) : "") : t("Card sign-in is off."))}${card && card.locked ? "<br>" + esc(t("Locked after wrong PINs.")) : ""}</div>
      ${w.user ? `<div class="row">${inp("pin", "", "password", `inputmode="numeric" maxlength="6" placeholder="${esc(t("New PIN (4-6 digits)"))}" style="flex:1"`)}<button class="btn pri" data-act="pin">${esc(t("Set PIN"))}</button></div>` : `<span class="small muted">${esc(t("Choose 'Signs in as' first to give this person a sign-in."))}</span>`}
      <div class="row"><button class="btn" data-act="newcard">${icon("refresh")}${esc(t("New card"))}</button><button class="btn" data-act="card">${icon("card")}${esc(t("Print site card"))}</button>${card && card.sign_in_enabled ? `<button class="btn bad" data-act="off">${esc(t("Turn off"))}</button>` : ""}</div>
      <span class="small muted">${esc(t("A new card makes the old site card stop working for signing in and for card scans. Print and hand over the new card."))}</span></div>`) : ""}
    ${(w.checks || []).length ? panel(t("Face checks"), `<div class="lst">${w.checks.map((x) => lrow({ img: x.live_photo, title: t(x.action), sub: esc(fdate(String(x.checked_at).slice(0, 10)) + " " + String(x.checked_at).slice(11, 16)), end: pill(ST(x.result) + (x.score ? ` ${x.score}%` : ""), x.result === "Match" ? "good" : x.result === "No match" ? "bad" : "warn"), chev: false })).join("")}</div>`) : ""}
    </div>
    <div class="row"><button class="btn big" data-act="edit">${icon("pencil")}${esc(t("Edit"))}</button>${c.owner ? "" : `<button class="btn pri big" data-act="card">${icon("card")}${esc(t("Print site card"))}</button>`}</div>
    ${w.phone ? `<button class="btn wide" data-act="call">${icon("phone")}${esc(t("Call {0}", w.phone))}</button>` : ""}`;
  wireForm(el);
  el.querySelectorAll("[data-doc]").forEach((b) => { b.onclick = async () => {
    const k = b.dataset.doc;
    try { const p = await takePhoto(t("Document"), { facing: k === "photo" ? "front" : "back", live: k === "photo", face: k === "photo" }); if (!p) return; await busy(api("worker_save", { data: { name: w.name, [k]: p.url } }), t("Saving…")); toast(t("Saved"), "good"); render(); } catch (e) { toast(e.message, "bad"); }
  }; });
  el.querySelectorAll("[data-open]").forEach((b) => { b.onclick = () => openOut(location.origin + b.dataset.open); });
  Object.assign(S.acts, {
    edit: () => personSheet(w),
    card: () => openOut(NATIVE ? `${location.origin}/api/method/frappe.utils.print_format.download_pdf?doctype=Site%20Worker&name=${encodeURIComponent(w.name)}&format=Site%20Worker%20Card&no_letterhead=1`
      : `${location.origin}/printview?doctype=Site%20Worker&name=${encodeURIComponent(w.name)}&format=Site%20Worker%20Card&no_letterhead=1&trigger_print=1`),
    call: () => openOut(`tel:${w.phone}`),
    async access() { const v = vals(el); try { await busy(api("worker_save", { data: { name: w.name, app_access: v.app_access, store_keeper: el.querySelector("[name=store_keeper]").checked ? 1 : 0 } }), t("Saving…")); toast(t("Access saved"), "good"); render(); } catch (e) { toast(e.message, "bad"); } },
    async pin() { const pin = el.querySelector("[name=pin]").value.trim(); try { await busy(api("buildiary.identity.set_card_pin", { person: w.name, pin })); toast(t("PIN set. Card sign-in is on."), "good"); render(); } catch (e) { toast(e.message, "bad"); } },
    async newcard() { if (!(await confirmBox(t("New card"), t("A new card makes the old site card stop working for signing in and for card scans. Print and hand over the new card."), t("New card")))) return; try { await busy(api("buildiary.identity.new_card", { person: w.name })); toast(t("New card made. Print it now."), "good"); render(); } catch (e) { toast(e.message, "bad"); } },
    async off() { try { await busy(api("buildiary.identity.card_sign_in_off", { person: w.name })); toast(t("Card sign-in turned off"), "good"); render(); } catch (e) { toast(e.message, "bad"); } },
  });
};
function personSheet(w = {}) {
  const types = ["Labour", "Mistri", "Group head", "Supervisor", "Engineer", "Store keeper", "Accountant", "Owner", "Builder staff", "Supplier staff", "Consultant", "Other"];
  const trades = ["Mason", "Steel fixer", "Carpenter", "Shuttering", "Electrician", "Plumber", "Painter", "Tile and marble", "Welder", "Helper", "Other"];
  const c = C();
  const sh = sheet(w.name ? t("Edit person") : t("New person"), `<div class="form">
    <div class="shots">${shot("photo", t("Face photo"), w.photo || "", { facing: "front" })}${shot("cnic_front", t("CNIC front"), w.cnic_front || "")}${shot("cnic_back", t("CNIC back"), w.cnic_back || "")}${shot("entry_card_photo", t("BTK registration card"), w.entry_card_photo || "")}</div>
    <div class="two">${fld(t("Name"), inp("full_name", w.full_name || ""), { req: true })}${fld(t("Name in Urdu (printed on the site card)"), inp("full_name_ur", w.full_name_ur || "", "text", 'dir="rtl"'))}</div>
    <div class="two">${fld(t("Father's name"), inp("father_name", w.father_name || ""))}${fld(t("Father's name in Urdu"), inp("father_name_ur", w.father_name_ur || "", "text", 'dir="rtl"'))}</div>
    <div class="two">${fld(t("Type"), sel("worker_type", types, w.worker_type || "Labour", false), { req: true })}${fld(t("Trade"), sel("trade", trades, w.trade || ""))}</div>
    <div class="two">${fld(t("Group / team"), inp("gang", w.gang || ""))}${fld(t("Works for"), `<button type="button" class="btn wide" data-sup="1">${esc(w.contractor_name || w.contractor || t("Choose (optional)"))}</button><input type="hidden" name="contractor" value="${esc(w.contractor || "")}">`)}</div>
    <div class="two">${fld(t("Mobile"), inp("phone", w.phone || "", "tel"))}${fld(t("Joined on"), inp("joined_on", w.joined_on || today(), "date"))}</div>
    <div class="two">${fld(t("CNIC"), inp("cnic", w.cnic || "", "text", 'inputmode="numeric" placeholder="42101-1234567-1"'))}${fld(t("CNIC expiry"), inp("cnic_expiry", w.cnic_expiry || "", "date"))}</div>
    <div class="two">${fld(t("BTK registration card no."), inp("entry_card_no", w.entry_card_no || ""))}${fld(t("BTK card expiry"), inp("entry_card_expiry", w.entry_card_expiry || "", "date"))}</div>
    ${fld(t("Police verification"), chips("police_verification", ["Not done", "Applied", "Verified"], w.police_verification || "Not done"))}
    ${w.name ? fld(t("Status"), chips("status", ["Active", "Left the site", "Blocked"], w.status || "Active")) : ""}
    ${c.money ? fld(t("Daily wage (Rs)"), inp("daily_wage", w.daily_wage || "", "number")) : ""}
    ${fld(t("Emergency contact"), inp("emergency_contact", w.emergency_contact || ""))}
    <div class="two">${fld(t("Address"), area("address", w.address || ""))}${fld(t("Address in Urdu"), area("address_ur", w.address_ur || "", 'dir="rtl"'))}</div>
    ${fld(t("Notes"), area("notes", w.notes || ""))}
  </div>`, { full: true, footer: `<button class="btn" data-x="1">${esc(t("Cancel"))}</button><button class="btn pri" data-save="1">${esc(t("Save"))}</button>` });
  wireForm(sh);
  sh.querySelector("[data-sup]").onclick = async (e) => { const s = await pickSupplier(t("Works for")); if (s && !s.__new) { sh.querySelector("[name=contractor]").value = s.name; e.target.closest("button").textContent = s.supplier_name; } };
  sh.querySelector("[data-save]").onclick = async () => {
    if (!need(sh, ["full_name"])) return;
    const v = vals(sh); if (w.name) v.name = w.name;
    const r = await run(sh, () => api("worker_save", { data: v }), t("Saved"));
    if (r) { closeAll(); if (r.warnings && r.warnings.length) toast(r.warnings.join(" · "), "warn"); go(`person/${r.name}`); }
  };
}

/* ---------------- suppliers ---------------- */
VIEWS.suppliers = async (el) => {
  setTop(t("Suppliers"), true);
  el.innerHTML = `${C().new_supplier ? `<button class="btn pri big wide" data-act="new">${icon("plus")}${esc(t("New supplier"))}</button>` : ""}<div class="fld search">${icon("search")}<input name="q" placeholder="${esc(t("Search suppliers"))}"></div><div data-list><div class="spin"></div></div>`;
  const list = el.querySelector("[data-list]"), q = el.querySelector("[name=q]"); let tm = null;
  const show = async () => {
    const rows = await api("suppliers", { q: q.value.trim() });
    list.innerHTML = panel(t("Suppliers"), rows.length ? `<div class="lst">${rows.map((s) => lrow({ go: `supplier/${s.name}`, ic: "truck", title: s.supplier_name, sub: esc(t(s.buildiary_work_area || s.supplier_group || "")), end: s.due ? `<b>${money(s.due, 1)}</b><span class="small muted">${esc(t("to pay"))}</span>` : "" })).join("")}</div>` : empty(t("No suppliers yet")), `<span class="cnt">${rows.length}</span>`);
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
    ${panel(t("Quotations"), s.quotes.length ? `<div class="lst">${s.quotes.map((q) => lrow({ go: `quote/${q.name}`, title: q.name, sub: esc(fdate(q.transaction_date)), end: `<b>${money(q.grand_total, 1)}</b>${q.buildiary_final ? pill(t("Final"), "good") : q.docstatus ? pill(t("Confirmed"), "info") : pill(t("Draft"), "warn")}` })).join("")}</div>` : empty(t("No quotations yet")))}
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
    ${panel(t("Quotations"), rows.length ? `<div class="lst">${rows.map((q) => lrow({ go: `quote/${q.name}`, title: q.supplier_name, sub: esc([q.name, q.quotation_number, fdate(q.transaction_date), q.buildiary_revision ? t("revision {0}", q.buildiary_revision) : ""].filter(Boolean).join(" · ")), end: `<b>${money(q.grand_total, 1)}</b>${qstate(q.state)}` })).join("")}</div>` : empty(t("No quotations yet"), t("Scan the supplier's quotation to start.")), `<span class="cnt">${rows.length}</span>`)}`;
  Object.assign(S.acts, { scan: () => scanQuote(), type: () => quoteEditor({}) });
};
async function scanQuote() {
  if (!S.b.ai) { toast(t("AI reading is off. The owner can turn it on in Settings."), "bad"); return quoteEditor({}); }
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
    ${fld(t("Proof of payment"), `<div class="shots">${shot("proof", t("Transfer screenshot, cheque or receipt"), "", { wide: true, gallery: true })}${shot("proof_2", t("Supplier's receipt (optional)"), "", { gallery: true })}</div>`, { req: !!S.b.rules.require_payment_proof, name: "proof" })}
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
/* ---------------- Money > Budget (owner and project accountant) ---------------- */
const lac = (n) => (SOUTH_ASIA() ? `${(Math.round(((+n || 0) / 1e5) * 10) / 10).toLocaleString("en-US")} ${t("lac")}` : money(n, 1));
const monthLbl = (m) => new Date(m + "-01T00:00:00").toLocaleDateString(LOCALE(), { month: "short", year: "2-digit" });
VIEWS.budget = async (el) => {
  setTop(t("Budget"), true);
  const d = await api("buildiary.money.budget_overview");
  S.budget = d;
  const pc = (a) => (d.budget ? `${num(Math.round((a / d.budget) * 100))}% ${t("of budget")}` : "");
  const tiles = [tile(t("Budgeted"), lac(d.budget), money(d.budget), "", "k5"), tile(t("Contracted (committed)"), lac(d.committed), pc(d.committed), "", "k2"),
    tile(t("Paid"), lac(d.paid), pc(d.paid), "", "k1"), tile(t("Remaining"), lac(d.left), t("budget less paid · {0} still owed on contracts", lac(d.still_owed)), "", "k3")];
  const maxp = Math.max(1, ...d.phases.map((p) => p.budget));
  const cost = `<div class="body"><div class="pcost">${d.phases.map((p, i) => `<div class="pc"><span class="small"><i style="background:var(--k${(i % 8) + 1})"></i>${esc(t(p.phase))}</span><b>${esc(lac(p.budget))}</b><span class="small muted">${esc(t("{0}% of total", num(Math.round((p.budget / (d.budget || 1)) * 100))))}</span></div>`).join("")}
    <div class="pc tot"><span class="small">${esc(t("Total project budget"))}</span><b>${esc(lac(d.budget))}</b><span class="small muted">${esc(money(d.budget))}</span></div></div>
    <div class="row" style="margin-top:10px;gap:6px">${d.over ? pill(t("{0} over budget", d.over), "bad") : ""}${pill(t("{0} within budget", d.within), "good")}</div></div>`;
  const cf = d.cash, maxc = Math.max(1, ...cf.months.map((m, i) => cf.scheduled[i] + cf.projected[i]));
  const flow = cf.months.length ? `<div class="body"><div class="cfbars" role="img" aria-label="${esc(t("Projected cash flow, whole project"))}">${cf.months.map((m, i) => `<div class="cf" title="${esc(`${monthLbl(m)}: ${lac(cf.scheduled[i] + cf.projected[i])}`)}"><div class="cfb"><span class="s" style="height:${(cf.scheduled[i] / maxc) * 100}%"></span><span class="p" style="height:${(cf.projected[i] / maxc) * 100}%"></span></div>${i % 3 === 0 ? `<em>${esc(monthLbl(m))}</em>` : "<em></em>"}</div>`).join("")}</div>
    <div class="legend"><span><i class="s"></i>${esc(t("Scheduled payments"))}</span><span><i class="p"></i>${esc(t("Projected purchases and labour (from budget)"))}</span></div>
    <div class="ctiles" style="margin-top:12px">${tile(t("Total projected"), lac(d.total_projected), `${monthLbl(cf.months[0])} – ${monthLbl(cf.months[cf.months.length - 1])}`, "", "k5")}${d.busiest ? tile(t("Busiest month"), lac(d.busiest.amount), monthLbl(d.busiest.month), "", "k4") : ""}${d.heavy ? tile(t("Heavy quarter"), lac(d.heavy.amount), d.heavy.quarter, "", "k3") : ""}<span class="ctile" style="cursor:default"></span></div>
    <p class="small muted" style="margin:10px 0 0">${esc(t("Payments still due on purchase orders are placed on their due dates. Budget not yet ordered is spread month by month over the stages it is needed for."))}</p></div>` : empty(t("Nothing to project yet"));
  const lineRow = (x) => lrow({ act: "bline", data: x.account, title: x.name, sub: `${esc(t("committed {0} · paid {1}", money(x.committed, 1), money(x.paid, 1)))}<span style="display:block;margin-top:6px">${bar(x.budget ? (Math.max(x.committed, x.booked) / x.budget) * 100 : 0, x.over ? "late" : "mid")}</span>`,
    end: `<b>${esc(money(x.budget, 1))}</b>${x.over ? pill(t("Over budget"), "bad") : pill(t("Within"), "good")}` });
  el.innerHTML = `<div class="ctiles">${tiles.join("")}</div>
    ${panel(t("Full project cost"), cost)}
    ${panel(t(SOUTH_ASIA() ? "Projected cash flow, whole project (lac)" : "Projected cash flow, whole project"), flow)}
    ${d.phases.map((p) => panel(t(p.phase), moreList(p.lines, lineRow, 6), `<span class="small muted">${esc(lac(p.budget))}</span>`)).join("")}
    ${d.owner ? `<button class="btn pri big wide" data-act="addline">${icon("plus")}${esc(t("Budget line"))}</button>` : ""}
    <p class="small muted" style="margin:0">${esc(t("Tap a line to see every order and payment behind it."))}</p>`;
  S.acts.bline = (acc) => budgetLineSheet(acc, d);
  S.acts.addline = () => addBudgetLine(d);
};
async function budgetLineSheet(acc, d) {
  let r; try { r = await busy(api("buildiary.money.budget_line", { account: acc })); } catch (e) { toast(e.message, "bad"); return; }
  const x = r.line;
  const sh = sheet(x.name, `<div class="stack"><div class="ctiles">${tile(t("Budget"), money(x.budget, 1), t(x.category), "", "k5")}${tile(t("Committed"), money(x.committed, 1), "", "", "k2")}${tile(t("Paid"), money(x.paid, 1), "", "", "k1")}${tile(t("Left"), money(x.left, 1), x.over ? t("Over budget") : "", "", x.over ? "k4" : "k3")}</div>
      ${d.owner ? fld(t("Category"), sel("category", d.categories, x.category, false)) : ""}
      ${panel(t("Purchase orders"), r.orders.length ? `<div class="lst">${r.orders.map((o) => lrow({ go: `order/${o.name}`, title: o.supplier_name, sub: esc(`${o.name} · ${fdate(o.transaction_date)} · ${t("{0}% received · {1}% billed", num(o.per_received), num(o.per_billed))}`), end: `<b>${esc(money(o.amount, 1))}</b>` })).join("")}</div>` : empty(t("No orders yet")), "", "plain")}
      ${panel(t("Booked in the accounts"), r.postings.length ? `<div class="lst">${r.postings.map((g) => lrow({ title: `${t(g.voucher_type)} · ${g.voucher_no}`, sub: esc([fdate(g.posting_date), (g.remarks || "").slice(0, 90)].filter(Boolean).join(" · ")), end: `<b>${esc(money(g.amount, 1))}</b>`, chev: false })).join("")}</div>` : empty(t("Nothing booked yet")), "", "plain")}</div>`, { full: true });
  const cs = sh.querySelector("[name=category]");
  if (cs) cs.onchange = async () => { try { await api("buildiary.money.budget_line_category", { account: acc, category: cs.value }); toast(t("Saved"), "good"); } catch (e) { toast(e.message, "bad"); } };
}
function addBudgetLine(d) {
  const sh = sheet(t("New budget line"), `<div class="form">${fld(t("Budget line"), inp("name", "", "text", `placeholder="${esc(t("e.g. Solar panels"))}"`), { req: true })}
      ${fld(t("Category"), sel("category", d.categories, "Finishing materials", false))}${fld(t("Amount (Rs)"), inp("amount", "", "number"), { req: true })}
      <p class="small muted" style="margin:0">${esc(t("It is saved in the ERP as an expense account with its budget for the project."))}</p></div>`,
    { footer: `<button class="btn" data-x="1">${esc(t("Cancel"))}</button><button class="btn pri" data-save="1">${esc(t("Save"))}</button>` });
  sh.querySelector("[data-save]").onclick = async () => {
    if (!need(sh, ["name", "amount"])) return;
    const v = vals(sh);
    const r = await run(sh, () => api("buildiary.money.budget_line_add", v), t("Budget line added"));
    if (r) { closeSheet(sh); render(); }
  };
}

/* ---------------- Ask the project (AI over the live records) ---------------- */
function mdLite(s) {
  const lines = esc(s || "").split(/\n/);
  let html = "", list = false;
  const inl = (x) => x.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  for (const ln of lines) {
    const m = ln.match(/^\s*[-•*]\s+(.*)$/);
    if (m) { if (!list) { html += "<ul>"; list = true; } html += `<li>${inl(m[1])}</li>`; continue; }
    if (list) { html += "</ul>"; list = false; }
    const h = ln.match(/^\s*#{1,4}\s+(.*)$/);
    if (h) html += `<h3>${inl(h[1])}</h3>`; else if (ln.trim()) html += `<p>${inl(ln)}</p>`;
  }
  return html + (list ? "</ul>" : "");
}
const ASK_SUGGEST = () => [t("Are we on schedule? What's behind?"), ...(C().money || C().owner ? [t("What do I owe the builder next and when?")] : []), t("Which materials need ordering this week?"),
  t("Summarise this week's site diary and open NCRs"), t("Draft a weekly progress report for the owner"), t("How much cement and steel went out this week, and to whom?"), t("How much water came this week, and was any of it bad?")];
VIEWS.ask = async (el) => {
  setTop(t("Ask the project"), true);
  if (!S.b.ai) { el.innerHTML = `<div class="banner warn">${esc(t("Ask the project needs the AI. The owner adds the Gemini key in Settings."))}</div>`; return; }
  S.askLog = S.askLog || [];
  el.innerHTML = panel(t("Ask the project"), `<div class="body stack"><p class="small muted" style="margin:0">${esc(t("Questions are answered from this project's live records: schedule, payments, budget, buying, stock, water, attendance, inspections and the site diary."))}</p>
      <div class="asks">${ASK_SUGGEST().map((q) => `<button class="btn sm" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>
      ${fld(t("Your question"), area("q", "", `placeholder="${esc(t("e.g. How much steel have we received against the estimate?"))}"`))}
      <button class="btn pri big wide" data-act="ask">${icon("sparkle")}${esc(t("Ask"))}</button></div>`) + `<div data-ans class="stack"></div>`;
  const box = el.querySelector("[data-ans]"), qa_ = el.querySelector("[name=q]");
  const draw = () => { box.innerHTML = S.askLog.map((x) => `<section class="panel plain"><div class="body stack" style="gap:8px"><b class="askq">${esc(x.q)}</b><div class="md">${mdLite(x.a)}</div>
      ${(x.f || []).length ? `<div class="asks">${x.f.map((q) => `<button class="btn sm" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>` : ""}</div></section>`).reverse().join(""); };
  const ask = async (q) => {
    q = (q || "").trim(); if (q.length < 3) { toast(t("Write your question."), "bad"); return; }
    try {
      const r = await busy(api("buildiary.askai.ask", { question: q }), t("Looking through the project's records…"));
      S.askLog.push({ q, a: r.answer, f: r.followups }); qa_.value = ""; draw(); box.scrollIntoView({ behavior: "smooth" });
    } catch (e) { toast(e.message, "bad"); }
  };
  el.addEventListener("click", (e) => { const b = e.target.closest("[data-q]"); if (b) { qa_.value = b.dataset.q; ask(b.dataset.q); } });
  S.acts.ask = () => ask(qa_.value);
  draw();
};

/* ---------------- Money hub: payments, supplier accounts, budget, petty cash ---------------- */
VIEWS.money = async (el, [tab = ""]) => {
  const c = C(); const tabs = [];
  if (c.money) tabs.push(["bills", "Payments"], ["suppliers", "Supplier accounts"], ["budget", "Budget"]);
  else if (S.b && (c.owner)) tabs.push(["budget", "Budget"]);
  if (PETTY()) tabs.push(["petty", "Petty cash"]);
  if (!tabs.length) { el.innerHTML = `<div class="banner warn">${esc(t("You don't have access to this. Ask the owner."))}</div>`; return; }
  if (!tabs.some((x) => x[0] === tab)) tab = tabs[0][0];
  el.innerHTML = (tabs.length > 1 ? hubtabs("money", tabs, tab) : "") + `<div id="mpane" class="stack"><div class="spin"></div></div>`;
  await VIEWS[tab]($("#mpane"), []);
  setTop(t("Money"));
};

/* ---------------- connect a phone (laptop test set-up) ---------------- */
VIEWS.connect = async (el) => {
  setTop(t("Connect a phone"), true);
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const u = new URLSearchParams(location.hash.split("?")[1] || "").get("u") || (local ? "" : location.host);
  let img = ""; if (u) { try { img = await api("qr", { text: u }); } catch (e) { /* */ } }
  el.innerHTML = panel(t("Connect a phone"), `<div class="body stack" style="align-items:center;text-align:center">
    ${u ? `${img ? `<img src="${esc(img)}" alt="" style="width:240px;height:240px;background:#fff;padding:10px;border-radius:14px">` : ""}<b class="ltr" style="font-size:20px;overflow-wrap:anywhere">${esc(u)}</b>
      <span>${esc(local || /^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(u) ? t("On the phone, open the Buildiary app, tap 'Scan the QR on the laptop' and point it here. The phone and this laptop must be on the same Wi-Fi.")
        : t("On the phone, install and open the Buildiary app, tap 'Scan the QR on the laptop' and point it at this code, or type the address above."))}</span>`
      : `<span>${esc(t("Double-click 'Connect a phone' in the Buildiary folder on this laptop. It shows the address and QR code for the phone."))}</span>`}</div>`);
};

/* ---------------- my settings: look, language, PIN ---------------- */
const SKINS = [["buildiary", "Buildiary blue", "Blueprint blue with amber, the Buildiary look", ["#1e3a5f", "#f2b01e", "#eef1f4"]], ["site", "Site green", "Calm green, the original look", ["#0f6f5c", "#dcefe9", "#f3f2ef"]], ["slate", "Slate & copper", "Cool grey with a copper accent", ["#1b2430", "#52627a", "#b4642d"]],
  ["sand", "Desert sand", "Warm sand with indigo", ["#2a241b", "#b07a1e", "#3b4fa0"]], ["colour", "Colourful", "Bright colours on every menu and panel", ["#8b5cf6", "#ec4899", "#f59e0b"]],
  ["night", "Night", "Dark blue, easy on the eyes at night", ["#0b1220", "#111a2e", "#38bdf8"]], ["contrast", "High contrast", "Black and white, strongest readability", ["#000", "#fff", "#0040c0"]]];
const UR_FONTS = [["Noto Nastaliq Urdu", "Nastaliq (Noto)", 1.95, "wght@400;600"], ["Gulzar", "Gulzar Nastaliq", 2.0, ""], ["Noto Naskh Arabic", "Naskh: clear and easy", 1.65, "wght@400;600"],
  ["Lateef", "Lateef", 1.7, "wght@400;600"], ["Scheherazade New", "Scheherazade", 1.7, "wght@400;600"], ["Amiri", "Amiri", 1.7, "wght@400;700"], ["Noto Sans Arabic", "Modern sans (Noto Sans)", 1.6, "wght@400;600"], ["Vazirmatn", "Modern sans (Vazirmatn)", 1.6, "wght@400;600"]];
const EN_FONTS = [["IBM Plex Sans", "IBM Plex Sans", "wght@400;500;600;700"], ["Source Sans 3", "Source Sans", "wght@400;600;700"], ["Nunito Sans", "Nunito Sans", "wght@400;600;700"], ["Lato", "Lato", "wght@400;700"], ["Work Sans", "Work Sans", "wght@400;600;700"]];
const MODES = [["light", "Light"], ["dark", "Dark"], ["auto", "Follow the phone"]];
const SIZES = [["s", "Small"], ["m", "Normal"], ["l", "Large"], ["xl", "Extra large"]];
const UR_SAMPLE = "آج سائٹ پر 12 مزدور حاضر ہیں";
function localLook() { try { return JSON.parse(localStorage.getItem("buildiary.look") || "{}"); } catch (e) { return {}; } }
function look() { return Object.assign({ skin: "buildiary", mode: "light", ur: "Noto Nastaliq Urdu", en: "IBM Plex Sans", size: "m" }, localLook(), (S.b && S.b.ui) || {}); }
const loaded = new Set(["IBM Plex Sans", "Noto Nastaliq Urdu"]);
function loadFont(fam, spec) {
  if (loaded.has(fam)) return; loaded.add(fam);
  const l = document.createElement("link"); l.rel = "stylesheet";
  l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, "+")}${spec ? ":" + spec : ""}&display=swap`;
  document.head.appendChild(l);
}
function applyLook(l = look()) {
  const h = document.documentElement;
  h.dataset.skin = l.skin; h.dataset.size = l.size;
  const dark = l.skin === "night" || l.mode === "dark" || (l.mode === "auto" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) h.dataset.theme = "dark"; else delete h.dataset.theme;
  const en = EN_FONTS.find((x) => x[0] === l.en) || EN_FONTS[0], ur = UR_FONTS.find((x) => x[0] === l.ur) || UR_FONTS[0];
  loadFont(en[0], en[2]); loadFont(ur[0], ur[3]);
  h.style.setProperty("--f-body", `"${en[0]}",system-ui,-apple-system,"Segoe UI",sans-serif`);
  h.style.setProperty("--f-ur", `"${ur[0]}","Noto Nastaliq Urdu"`);
  h.style.setProperty("--ur-lh", ur[2]);
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = getComputedStyle(h).getPropertyValue("--accent").trim() || "#8b5cf6";
}
async function saveLook(change) {
  const l = Object.assign(look(), change);
  try { localStorage.setItem("buildiary.look", JSON.stringify(l)); } catch (e) { /* */ }
  if (S.b) { S.b.ui = l; api("ui_save", { ui: l }).catch(() => {}); }
  applyLook(l);
}
VIEWS.settings = async (el) => {
  setTop(t("My settings"), true); setTab("more");
  const b = S.b, c = C(), me = b.person, l = look();
  const role = c.owner ? t("Owner") : c.accountant ? t("Accountant") : c.buy || c.people ? t("Site supervisor") : c.store ? t("Store keeper") : t("Site staff");
  const urAll = el.dataset.urAll === "1";
  el.innerHTML = `<button class="mo-me" ${me ? `data-go="person/${esc(me.name)}"` : ""}><span class="av">${b.image ? `<img src="${esc(b.image)}" alt="">` : esc((b.full_name || "?").charAt(0))}</span><span><b>${esc(b.full_name)}</b><span class="small muted">${esc(role)}${me && me.entry_card_no ? " · BTK " + esc(me.entry_card_no) : ""}</span></span>${me ? icon("chev", "lch") : ""}</button>
    ${panel(t("Language"), `<div class="body"><div class="seg"><button data-lang="en" aria-pressed="${S.lang === "en"}">English</button><button data-lang="ur" aria-pressed="${S.lang === "ur"}">اردو</button><button data-lang="ar" aria-pressed="${S.lang === "ar"}">العربية</button></div></div>`)}
    ${panel(t("Theme"), `<div class="body stack"><div class="skins">${SKINS.map(([k, n, d, sw]) => `<button data-skin="${k}" aria-pressed="${l.skin === k}"><span class="sw">${sw.map((x) => `<i style="background:${x}"></i>`).join("")}</span><b>${esc(t(n))}</b><span class="small muted">${esc(t(d))}</span></button>`).join("")}</div>
      <div class="seg">${MODES.map(([k, n]) => `<button data-mode="${k}" aria-pressed="${l.mode === k}">${esc(t(n))}</button>`).join("")}</div></div>`)}
    ${panel(t("Text size"), `<div class="body"><div class="seg">${SIZES.map(([k, n]) => `<button data-size="${k}" aria-pressed="${l.size === k}">${esc(t(n))}</button>`).join("")}</div></div>`)}
    ${S.lang !== "ur" ? "" : panel(t("Urdu font"), `<div class="body stack"><span class="small muted">${esc(t("Used when the app is in Urdu. Naskh fonts are clearer on small phone screens; Nastaliq looks more traditional."))}</span>
      <div class="fontlist">${UR_FONTS.slice(0, urAll ? 99 : 3).map(([f, n]) => `<button data-ur="${esc(f)}" aria-pressed="${l.ur === f}"><span style="font-family:'${f}',serif;line-height:2">${UR_SAMPLE}</span><small>${esc(t(n))}</small></button>`).join("")}</div>
      ${urAll ? "" : `<button class="btn sm" data-urall="1">${esc(t("Show all"))} ${icon("chev")}</button>`}</div>`)}
    ${panel(t("English font"), `<div class="body"><div class="chips">${EN_FONTS.map(([f, n]) => `<button data-en="${esc(f)}" aria-pressed="${l.en === f}" style="font-family:'${f}',sans-serif">${esc(n)}</button>`).join("")}</div></div>`)}
    ${me ? panel(t("Sign in with site card"), `<div class="body form"><span class="small muted">${esc(me.pin_set ? t("If the owner turned on card sign-in for you, change your PIN here.") : t("The owner sets your first PIN."))}</span>
      ${me.pin_set ? `${fld(t("Current PIN"), inp("cur", "", "password", 'inputmode="numeric" maxlength="6"'))}${fld(t("New PIN (4-6 digits)"), inp("new", "", "password", 'inputmode="numeric" maxlength="6"'))}<button class="btn pri wide" data-act="pin">${esc(t("Change PIN"))}</button>` : ""}</div>`) : ""}
    <div class="stack">${c.owner || c.money ? `<button class="btn wide" data-act="desk">${icon("dash")}${esc(t("Open the full ERPNext (office)"))}</button>` : ""}
      ${NATIVE ? `<button class="btn wide" data-act="site">${icon("globe")}${esc(t("Change site address"))}</button>` : ""}
      <button class="btn wide bad" data-act="out">${icon("out")}${esc(t("Sign out"))}</button></div>`;
  for (const f of UR_FONTS.slice(0, urAll ? 99 : 3)) loadFont(f[0], f[3]);
  for (const f of EN_FONTS) loadFont(f[0], f[2]);
  el.onclick = async (e) => {
    const x = e.target.closest("[data-skin],[data-mode],[data-size],[data-ur],[data-en],[data-lang],[data-urall]"); if (!x) return;
    if (x.dataset.lang) { if (x.dataset.lang !== S.lang) { await busy(api("set_language", { lang: x.dataset.lang })); location.reload(); } return; }
    if (x.dataset.urall) { el.dataset.urAll = "1"; render(); return; }
    const k = ["skin", "mode", "size", "ur", "en"].find((n) => x.dataset[n] !== undefined);
    await saveLook({ [k]: x.dataset[k] });
    $$(`[data-${k}]`, el).forEach((y) => y.setAttribute("aria-pressed", String(y === x)));
  };
  Object.assign(S.acts, {
    desk() { location.href = "/desk/buildiary"; },
    async site() { if (await confirmBox(t("Change site address"), t("The app will ask for the site address again."), t("Change"))) native("forget").catch(() => {}); },
    async out() { await fetch("/api/method/logout", { credentials: "same-origin" }); if (NATIVE) native("signout").catch(() => {}); location.reload(); },
    async pin() { const v = vals(el); try { await busy(api("buildiary.identity.change_my_pin", { current: v.cur, new: v.new })); toast(t("PIN changed"), "good"); render(); } catch (e) { toast(e.message, "bad"); } },
  });
};

/* ---------------- sign in ---------------- */
function loginScreen() {
  document.documentElement.lang = S.lang; document.documentElement.dir = RTL() ? "rtl" : "ltr";
  applyLook();
  $("#app").innerHTML = `<div class="login stack"><div class="logo"><svg viewBox="0 0 120 120" aria-hidden="true"><path d="M53.5 18H45A24 24 0 0 0 21 42V78A24 24 0 0 0 45 102H53.5Z M53.5 30H44A11 11 0 0 0 33 41V52.5H53.5Z M53.5 64.5H33V79A11 11 0 0 0 44 90H53.5Z M66.5 18H75A24 24 0 0 1 99 42V78A24 24 0 0 1 75 102H66.5Z M66.5 30V90H76A11 11 0 0 0 87 79V41A11 11 0 0 0 76 30Z" fill="#FFFFFF" fill-rule="evenodd"/><rect x="53.5" y="18" width="13.0" height="84" fill="#F2B01E"/></svg></div><h1 class="brandname" style="text-align:center">Buil<i class="bd-d">d</i>iary</h1><p class="muted" style="text-align:center;margin:0">${esc(t("Sign in to your project"))}</p>
    <div class="seg"><button data-l="en" aria-pressed="${S.lang === "en"}">English</button><button data-l="ur" aria-pressed="${S.lang === "ur"}">اردو</button><button data-l="ar" aria-pressed="${S.lang === "ar"}">العربية</button></div>
    ${BOOT.card_sign_in ? `<button class="btn pri big wide" data-card="1">${icon("card")}${esc(t("Sign in with site card"))}</button><p class="small muted" style="text-align:center;margin:0">${esc(t("Scan your site card, type your PIN and take a photo of your face."))}</p>
      <div class="small muted" style="text-align:center">— ${esc(t("or"))} —</div>` : ""}
    <div class="form"><div class="fld"><label>${esc(t("Email or user name"))}</label><input name="usr" autocomplete="username" autocapitalize="none" class="ltr"></div><div class="fld"><label>${esc(t("Password"))}</label><input name="pwd" type="password" autocomplete="current-password" class="ltr"></div>
    <div data-err></div><button class="btn ${BOOT.card_sign_in ? "" : "pri"} big wide" data-login="1">${esc(t("Sign in"))}</button></div>${MAKER()}</div>`;
  $$("[data-l]").forEach((b) => { b.onclick = () => {
    S.lang = b.dataset.l; try { localStorage.setItem("buildiary.lang", S.lang); } catch (e) { /* */ }
    // the page carries one language's words: switching between Urdu and Arabic reloads them
    if (S.lang !== "en" && S.lang !== window.BUILDIARY_TR_LANG) { document.cookie = `preferred_language=${S.lang};path=/;max-age=31536000;SameSite=Lax`; location.reload(); return; }
    loginScreen(); }; });
  const go_ = async () => {
    const usr = $("[name=usr]").value.trim(), pwd = $("[name=pwd]").value;
    if (!usr || !pwd) return;
    const r = await busy(fetch("/api/method/login", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ usr, pwd }) }));
    if (r.ok) { location.reload(); return; }
    $("[data-err]").innerHTML = `<div class="banner bad">${esc(t("Wrong user name or password."))}</div>`;
  };
  $("[data-login]").onclick = go_;
  $("[name=pwd]").addEventListener("keydown", (e) => { if (e.key === "Enter") go_(); });
  const c = $("[data-card]"); if (c) c.onclick = cardSignIn;
}
/** Sign in with the site card: scan the card, type the PIN, take a photo of the face. */
async function cardSignIn() {
  const code = await scanCode(t("Scan your site card"));
  if (!code) return;
  if (!code.startsWith("MMR1:")) { toast(t("This is not a Buildiary site card."), "bad"); return; }
  const pin = await new Promise((resolve) => {
    let v = "", done = false;
    const sh = sheet(t("Your PIN"), `<div class="stack" style="align-items:center"><p style="margin:0">${esc(t("Type your PIN"))}</p><div class="pindots">${[0, 1, 2, 3, 4, 5].map((i) => `<i data-d="${i}"></i>`).join("")}</div>
      <div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, "⌫", 0, "✓"].map((k) => `<button type="button" data-k="${k}">${k}</button>`).join("")}</div></div>`);
    const dots = () => $$("[data-d]", sh).forEach((d) => d.classList.toggle("on", +d.dataset.d < v.length));
    sh.addEventListener("click", (e) => { const b = e.target.closest("[data-k]"); if (!b) return; const k = b.dataset.k;
      if (k === "⌫") v = v.slice(0, -1); else if (k === "✓") { if (v.length >= 4) { done = true; closeSheet(sh); resolve(v); } return; } else if (v.length < 6) v += k; dots(); });
    const obs = new MutationObserver(() => { if (!document.body.contains(sh) || sh.parentElement.classList.contains("closing")) { obs.disconnect(); if (!done) { done = true; resolve(""); } } });
    obs.observe($("#sheetRoot"), { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  });
  if (!pin) return;
  const photo = await liveFaceData(t("Photo of your face"));
  if (!photo) return;
  try {
    const r = await busy(fetch("/api/method/buildiary.identity.sign_in", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ code, pin, photo }) }), t("Checking…"));
    let j = {}; try { j = await r.json(); } catch (e) { /* */ }
    if (r.ok && j.message && j.message.ok) { location.reload(); return; }
    $("[data-err]").innerHTML = `<div class="banner bad">${esc(serverMessage(j) || (r.status === 429 ? t("Too many tries. Wait a few minutes.") : t("This card and PIN were not accepted.")))}</div>`;
  } catch (e) { $("[data-err]").innerHTML = `<div class="banner bad">${esc(t("No connection to Buildiary. Check the internet (or Wi-Fi) and try again."))}</div>`; }
}

/* ---------------- start ---------------- */
function start() {
  applyLook();
  if (window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyLook());
  if (!S.b) { try { S.lang = localStorage.getItem("buildiary.lang") || S.lang; } catch (e) { /* */ } loginScreen(); return; }
  layout(); render();
  if (NATIVE) native("ready", { lang: S.lang }).catch(() => {});
}
window.BuildiaryField = { t, api, go, S };
start();
})();
