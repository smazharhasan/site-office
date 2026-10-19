// POST /ingest-evidence
// The ONLY way a photo becomes evidence. The phone uploads the JPEG to
// evidence/<project>/<user>/<uuid>.jpg, then calls this with the capture
// metadata. The function re-hashes the file, binds the phone to the user,
// optionally verifies a Google Play Integrity token, and writes the
// evidence row with the service role. The database computes the GPS,
// clock and device flags (see evidence_flags trigger).
import { admin, caller, download, handler, HttpError, json, membership, sha256Hex } from "../_shared/common.ts";
import { verifyPlayIntegrity } from "./integrity.ts";

const PURPOSES = new Set(["attendance", "badge", "release", "receipt_truck", "receipt_bill", "receipt_marking", "tanker", "tanker_bill", "count", "daily_log", "inspection", "snag", "person_doc", "progress", "other"]);

interface Body {
  project_id: string; storage_path: string; purpose: string; sha256: string;
  captured_at: string; lat?: number | null; lng?: number | null; accuracy_m?: number | null; mocked?: boolean | null;
  device_key: string; model?: string; os?: string; app_version?: string; integrity_token?: string;
}

Deno.serve(handler(async (req) => {
  const user = await caller(req);
  const b = (await req.json()) as Body;
  if (!b.project_id || !b.storage_path || !b.device_key || !b.captured_at) throw new HttpError(400, "Missing fields");
  if (!PURPOSES.has(b.purpose)) throw new HttpError(400, "Unknown purpose");
  const me = await membership(b.project_id, user.id);
  if (!b.storage_path.startsWith(`${b.project_id}/${user.id}/`)) throw new HttpError(403, "Upload path does not belong to you");

  const file = await download("evidence", b.storage_path);
  if (file.byteLength > 6 * 1024 * 1024) throw new HttpError(413, "Photo too large");
  const sha = await sha256Hex(file);
  if (b.sha256 && b.sha256 !== sha) throw new HttpError(400, "Photo changed after capture");

  const db = admin();
  const extra: string[] = [];
  // bind the phone: one device row per (project, device); a phone used by two accounts is flagged
  let { data: dev } = await db.from("devices").select("*").eq("project_id", b.project_id).eq("device_key", b.device_key).maybeSingle();
  if (!dev) {
    const ins = await db.from("devices").insert({ project_id: b.project_id, user_id: user.id, device_key: b.device_key, model: b.model, os: b.os, app_version: b.app_version, approved: me.role === "owner", approved_by: me.role === "owner" ? user.id : null }).select().single();   // the owner's own phone is trusted
    dev = ins.data;
  } else {
    await db.from("devices").update({ last_seen: new Date().toISOString(), model: b.model ?? dev.model, app_version: b.app_version ?? dev.app_version }).eq("id", dev.id);
    if (dev.user_id !== user.id) extra.push("device_of_other_user");
  }

  let integrity: "ok" | "failed" | "not_checked" = "not_checked";
  if (b.integrity_token) integrity = await verifyPlayIntegrity(b.integrity_token, sha);
  else if (Deno.env.get("PLAY_INTEGRITY_REQUIRED") === "true") integrity = "failed";

  const { data: ev, error } = await db.from("evidence").insert({
    project_id: b.project_id, storage_path: b.storage_path, sha256: sha, purpose: b.purpose, user_id: user.id, device_id: dev?.id,
    captured_at: b.captured_at, lat: b.lat ?? null, lng: b.lng ?? null, accuracy_m: b.accuracy_m ?? null, mocked: b.mocked ?? null,
    integrity, flags: extra,
  }).select("id, flags, distance_m, received_at").single();
  if (error) throw new HttpError(409, error.message);
  return json({ evidence: ev, device_approved: !!dev?.approved });
}));
