// POST /card-login — sign in by scanning the site card and typing a PIN.
//   { action: "login",   qr, pin }                         (no session needed)
//   { action: "setup",   project_id, person_id, user_id, pin }   owner: create or reissue a card login
//   { action: "list",    project_id }                      owner: people with card sign-in (+ card QR to print)
//   { action: "disable", project_id, person_id }            owner
//   { action: "pin",     project_id, old_pin, pin }         the person changes their own PIN
import { admin, caller, handler, HttpError, json, membership } from "../_shared/common.ts";

const MAX_FAILS = 5, LOCK_MIN = 15;
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const rand = (n: number) => { const u = crypto.getRandomValues(new Uint8Array(n)); return btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
async function pinHash(pin: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 120000 }, key, 256));
}
const same = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const validPin = (p: unknown) => /^\d{4,6}$/.test(String(p ?? ""));
const qrOf = (r: { project_id: string; person_id: string; secret: string }) => `MIM2|${r.project_id}|${r.person_id}|${r.secret}`;

Deno.serve(handler(async (req) => {
  const b = await req.json().catch(() => ({}));
  const db = admin();
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();

  if (b.action === "login") {
    const m = String(b.qr || "").trim().match(/^MIM2\|([0-9a-f-]{36})\|([^|]{1,80})\|([A-Za-z0-9_-]{20,64})$/);
    if (!m) throw new HttpError(400, "This is not a sign-in card. Ask the owner to print your new site card.");
    const [, project_id, person_id, secret] = m;
    const { data: row } = await db.from("card_logins").select("*").eq("project_id", project_id).eq("person_id", person_id).maybeSingle();
    const log = (ok: boolean, reason: string) => db.from("card_login_log").insert({ project_id, person_id, ok, reason, ip });
    if (!row || !same(row.secret, secret)) { await log(false, "unknown card"); throw new HttpError(401, "This card is not valid for sign-in. It may have been replaced by a new card."); }
    if (!row.enabled) { await log(false, "disabled"); throw new HttpError(403, "Card sign-in is turned off for this person."); }
    if (row.locked_until && new Date(row.locked_until) > new Date()) { await log(false, "locked"); throw new HttpError(429, `Too many wrong PINs. Try again after ${LOCK_MIN} minutes.`); }
    if (!validPin(b.pin) || !same(await pinHash(String(b.pin), row.pin_salt), row.pin_hash)) {
      const fails = row.failed_count + 1; const lock = fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60000).toISOString() : null;
      await db.from("card_logins").update({ failed_count: lock ? 0 : fails, locked_until: lock }).eq("project_id", project_id).eq("person_id", person_id);
      await log(false, "wrong pin");
      throw new HttpError(401, lock ? `Wrong PIN. Card locked for ${LOCK_MIN} minutes.` : `Wrong PIN. ${MAX_FAILS - fails} tries left.`);
    }
    const { data: mem } = await db.from("project_members").select("active").eq("project_id", project_id).eq("user_id", row.user_id).maybeSingle();
    if (!mem || !mem.active) { await log(false, "no access"); throw new HttpError(403, "Your access to this project has been turned off."); }
    const { data: u } = await db.auth.admin.getUserById(row.user_id);
    if (!u.user?.email) throw new HttpError(400, "This login has no email.");
    const link = await db.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
    if (link.error) throw new HttpError(500, "Couldn't start the session.");
    await db.from("card_logins").update({ failed_count: 0, locked_until: null, last_login_at: new Date().toISOString() }).eq("project_id", project_id).eq("person_id", person_id);
    await log(true, "ok");
    return json({ token_hash: link.data.properties.hashed_token, email: u.user.email, project_id });
  }

  const user = await caller(req);
  if (b.action === "pin") {
    if (!validPin(b.pin)) throw new HttpError(400, "The PIN must be 4 to 6 digits.");
    const { data: row } = await db.from("card_logins").select("*").eq("project_id", b.project_id).eq("user_id", user.id).maybeSingle();
    if (!row) throw new HttpError(404, "You don't have card sign-in yet.");
    if (!validPin(b.old_pin) || !same(await pinHash(String(b.old_pin), row.pin_salt), row.pin_hash)) throw new HttpError(401, "Your current PIN is wrong.");
    const salt = rand(16);
    await db.from("card_logins").update({ pin_salt: salt, pin_hash: await pinHash(String(b.pin), salt), updated_at: new Date().toISOString() }).eq("project_id", b.project_id).eq("person_id", row.person_id);
    return json({ ok: true });
  }

  const me = await membership(b.project_id, user.id);
  if (me.role !== "owner") throw new HttpError(403, "Only the owner manages card sign-in");

  if (b.action === "list") {
    const { data } = await db.from("card_logins").select("project_id, person_id, user_id, secret, enabled, last_login_at, locked_until").eq("project_id", b.project_id);
    return json({ cards: (data ?? []).map((r) => ({ person_id: r.person_id, user_id: r.user_id, enabled: r.enabled, last_login_at: r.last_login_at, locked: !!(r.locked_until && new Date(r.locked_until) > new Date()), qr: qrOf(r) })) });
  }
  if (b.action === "setup") {
    if (!b.person_id || !b.user_id) throw new HttpError(400, "Link this person to an app login first.");
    if (!validPin(b.pin)) throw new HttpError(400, "The PIN must be 4 to 6 digits.");
    const { data: mem } = await db.from("project_members").select("user_id").eq("project_id", b.project_id).eq("user_id", b.user_id).maybeSingle();
    if (!mem) throw new HttpError(400, "That login is not on this project.");
    const salt = rand(16); const row = { project_id: b.project_id, person_id: String(b.person_id), user_id: b.user_id, secret: rand(24), pin_salt: salt, pin_hash: await pinHash(String(b.pin), salt), enabled: true, failed_count: 0, locked_until: null, created_by: user.id, updated_at: new Date().toISOString() };
    const { error } = await db.from("card_logins").upsert(row);
    if (error) throw new HttpError(400, error.message);
    return json({ ok: true, qr: qrOf(row) });
  }
  if (b.action === "disable") {
    await db.from("card_logins").update({ enabled: false, updated_at: new Date().toISOString() }).eq("project_id", b.project_id).eq("person_id", String(b.person_id));
    return json({ ok: true });
  }
  throw new HttpError(400, "Unknown action");
}));
