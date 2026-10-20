// POST /team — the owner manages staff logins without touching the database.
//   { action: "list",   project_id }
//   { action: "add",    project_id, email, password, full_name, role }
//   { action: "set",    project_id, user_id, role?, active? }
//   { action: "reset",  project_id, user_id, password }
import { admin, caller, handler, HttpError, json, membership } from "../_shared/common.ts";

const ROLES = ["owner_supervisor", "builder", "site_supervisor", "store_keeper", "supplier", "consultant", "labour"];

Deno.serve(handler(async (req) => {
  const user = await caller(req);
  const b = await req.json();
  const me = await membership(b.project_id, user.id);
  const db = admin();

  if (b.action === "list") {
    if (!["owner", "owner_supervisor"].includes(me.role)) throw new HttpError(403, "Owner only");
    const { data: ms } = await db.from("project_members").select("user_id, role, active, person_id, created_at").eq("project_id", b.project_id).order("created_at");
    const out = [];
    for (const m of ms ?? []) {
      const { data } = await db.auth.admin.getUserById(m.user_id);
      const { data: p } = m.person_id ? await db.from("people").select("full_name, status").eq("id", m.person_id).maybeSingle() : { data: null };
      out.push({ ...m, email: data.user?.email ?? "", name: p?.full_name ?? data.user?.user_metadata?.full_name ?? "", person_status: p?.status ?? "not registered" });
    }
    return json({ members: out });
  }

  if (me.role !== "owner") throw new HttpError(403, "Only the owner manages logins");

  if (b.action === "add") {
    const email = String(b.email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "Enter a valid email");
    if (String(b.password || "").length < 8) throw new HttpError(400, "Password must be at least 8 characters");
    if (!ROLES.includes(b.role)) throw new HttpError(400, "Choose a role");
    let uid: string | null = null;
    const created = await db.auth.admin.createUser({ email, password: b.password, email_confirm: true, user_metadata: { full_name: b.full_name || "" } });
    if (created.error) {
      // already has a login (e.g. on another project): find it
      for (let page = 1; page < 50 && !uid; page++) {
        const { data } = await db.auth.admin.listUsers({ page, perPage: 200 });
        const hit = data.users.find((u) => (u.email || "").toLowerCase() === email); if (hit) uid = hit.id;
        if (data.users.length < 200) break;
      }
      if (!uid) throw new HttpError(400, created.error.message);
    } else uid = created.data.user!.id;
    const { error } = await db.from("project_members").upsert({ project_id: b.project_id, user_id: uid, role: b.role, active: true, added_by: user.id });
    if (error) throw new HttpError(400, error.message);
    return json({ ok: true, user_id: uid });
  }

  if (b.action === "set") {
    if (b.user_id === user.id) throw new HttpError(400, "You can't change your own access");
    const patch: Record<string, unknown> = {};
    if (b.role) { if (!ROLES.includes(b.role)) throw new HttpError(400, "Unknown role"); patch.role = b.role; }
    if (typeof b.active === "boolean") patch.active = b.active;
    const { error } = await db.from("project_members").update(patch).eq("project_id", b.project_id).eq("user_id", b.user_id);
    if (error) throw new HttpError(400, error.message);
    return json({ ok: true });
  }

  if (b.action === "reset") {
    const { data: m } = await db.from("project_members").select("user_id").eq("project_id", b.project_id).eq("user_id", b.user_id).maybeSingle();
    if (!m) throw new HttpError(404, "Not on this project");
    if (String(b.password || "").length < 8) throw new HttpError(400, "Password must be at least 8 characters");
    const { error } = await db.auth.admin.updateUserById(b.user_id, { password: b.password });
    if (error) throw new HttpError(400, error.message);
    return json({ ok: true });
  }
  throw new HttpError(400, "Unknown action");
}));
