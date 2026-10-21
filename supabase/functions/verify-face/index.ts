// POST /verify-face { attendance_id }
// Compares the attendance face photo with the person's registered photo and
// moves the attendance row from 'pending' to 'verified' or 'flagged'.
import { admin, b64, caller, download, handler, HttpError, json, membership } from "../_shared/common.ts";
import { askJson, img } from "../_shared/claude.ts";
import { aiConfig } from "../_shared/llm.ts";

interface Match { samePerson: "yes" | "no" | "unclear"; confidence: "low" | "medium" | "high"; livePhoto: "yes" | "no" | "unclear"; peopleInPhoto: number; notes: string }

Deno.serve(handler(async (req) => {
  const user = await caller(req);
  const { attendance_id } = await req.json();
  const db = admin();
  const { data: a } = await db.from("attendance").select("*").eq("id", attendance_id).single();
  if (!a) throw new HttpError(404, "Attendance not found");
  await membership(a.project_id, user.id);

  const { data: doc } = await db.from("person_docs").select("evidence_id").eq("person_id", a.person_id).eq("kind", "photo").maybeSingle();
  const flags: string[] = [...(a.flags || [])];
  if (!doc) {
    flags.push("no_registered_photo");
    await db.from("attendance").update({ status: "flagged", flags }).eq("id", a.id);
    return json({ status: "flagged", flags });
  }
  if (!(await aiConfig(a.project_id))) {   // AI not switched on yet: rely on the badge, GPS, time and phone checks only
    const status = a.status === "pending" ? "verified" : a.status;
    await db.from("attendance").update({ status, face_match: { checked: false, notes: "Face check is off (no AI key)" } }).eq("id", a.id);
    return json({ status, flags, face_match: null });
  }
  const { data: evs } = await db.from("evidence").select("id, storage_path").in("id", [doc.evidence_id, a.face_evidence_id]);
  const path = (id: string) => evs!.find((e) => e.id === id)!.storage_path;
  const [reg, now] = await Promise.all([download("evidence", path(doc.evidence_id)), download("evidence", path(a.face_evidence_id))]);

  const m = await askJson<Match>(
    "Image 1 is the registered photo of a construction worker. Image 2 was just taken at the site gate to mark attendance. Decide whether they show the same person. Also say whether image 2 is a live photo of a real person on a construction site (not a photo of a screen, a printout or a photo of a photo), and count the people visible in it.",
    `{"samePerson": "yes"|"no"|"unclear", "confidence": "low"|"medium"|"high", "livePhoto": "yes"|"no"|"unclear", "peopleInPhoto": number, "notes": string}`,
    [img(b64(reg)), img(b64(now))], 400, a.project_id,
  );
  if (m.samePerson === "no") flags.push("face_mismatch");
  if (m.samePerson === "unclear" || m.confidence === "low") flags.push("face_unclear");
  if (m.livePhoto === "no") flags.push("not_a_live_photo");
  const status = a.status === "pending" && flags.length === 0 ? "verified" : (a.status === "pending" ? "flagged" : a.status);
  await db.from("attendance").update({ status, flags, face_match: m }).eq("id", a.id);
  return json({ status, flags, face_match: m });
}));
