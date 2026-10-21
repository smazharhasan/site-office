// POST /ai-watch — background AI checks for the owner. Site staff never see the result.
//   { project_id, col, id, note? }        check a saved record (delivery, release, water, tank, petty cash, attendance, photo, log, count)
//   { project_id, action: "face", person_id, image }  → { match: "yes" | "no" | "unclear" } (used during the card scan)
//   { project_id, action: "rerun" }       owner: run every check that is still waiting (e.g. after the AI key was added)
import { admin, caller, handler, HttpError, json, membership } from "../_shared/common.ts";
import { generate, jsonIn, type Part } from "../_shared/llm.ts";

const WATCH = ["grns", "issues", "water", "tank", "pettycash", "attendance", "camera", "logs", "counts", "returns"];
type Img = Part;
const imgOf = (s: string): Img | null => { const m = String(s || "").match(/^data:(image\/[a-z+]+);base64,(.+)$/); return m ? { image: { mime: m[1], data: m[2] } } : null; };
const strip = (o: Record<string, unknown>) => JSON.parse(JSON.stringify(o, (_k, v) => typeof v === "string" && v.startsWith("data:") ? "[photo]" : v));
function photosIn(d: Record<string, unknown>): Img[] {
  const out: Img[] = []; const walk = (v: unknown) => { if (out.length >= 4) return; if (typeof v === "string") { const i = imgOf(v); if (i) out.push(i); } else if (v && typeof v === "object") Object.values(v).forEach(walk); };
  walk(d); return out;
}
let PROJ = "";
async function claude(content: Part[], maxTokens = 900): Promise<Record<string, unknown>> {
  return jsonIn<Record<string, unknown>>(await generate(PROJ, content, { maxTokens }), false);
}
const ASK: Record<string, string> = {
  grns: "This is a goods-received record at a house construction site in Pakistan, with photos of the delivered goods and/or the delivery note (challan). Check: does the material in the photos match the item entered; does the quantity look consistent with what was entered; do numbers on the challan (quantity, vehicle, date) match the record; any sign of short delivery, wrong grade/brand, or a photo that is not of this delivery (old photo, photo of a screen).",
  issues: "This is a store release (or return) record: material handed to a worker, with a photo of the item and the receiver. Check: does the material in the photo match the item entered; does the visible quantity look consistent with the quantity entered (flag if clearly more material is leaving than recorded); is a person receiving it; any sign of pilferage, e.g. material being loaded into a private vehicle, or a photo that is not live.",
  returns: "This is a return-to-store record. Check the photo shows the item and quantity entered.",
  water: "This is a water tanker delivery record with photos (tanker number plate, meter/TDS reading, water). Check: number plate readable and matches the record; TDS/meter reading in the photo matches the entered value; tanker size plausible for gallons entered; any sign the same tanker/photo was reused.",
  tank: "This is a water tank level reading with a photo. Check the level visible in the photo matches the entered reading.",
  pettycash: "This is a petty cash entry with a bill/receipt photo. Read the bill: shop name, date, items, total amount. Check the total and date match the entered amount and date; flag if the bill looks altered, handwritten without a shop name, duplicated, or the amount entered is higher than the bill.",
  attendance: "This is a site attendance record. The first photo is the person's registered photo (if given), the others were taken at time in / time out. Check: is it the same person; does the photo look like a live photo on a construction site (not a photo of a photo or screen); any sign of proxy attendance.",
  camera: "This is a site progress photo linked to a construction stage. Describe what work is visible and estimate the stage completion percentage; flag if the reported progress in the record looks higher than what the photo shows, or the photo is not of this site/stage.",
  logs: "This is a daily site log with photos. Check the work described and the people/labour count against what the photos show; flag over-reporting of labour or work.",
  counts: "This is a physical stock count with photos. Check whether the counted quantity is consistent with the photos.",
};
const SHAPE = `{"verdict": "ok" | "mismatch" | "unclear", "severity": "low" | "medium" | "high", "summary": "one short sentence for the owner", "checks": [{"item": string, "ok": boolean, "note": string}]}`;

async function check(db: ReturnType<typeof admin>, project_id: string, col: string, id: string, by: string | null, note?: string) {
  const { data: row } = await db.from("app_records").select("data").eq("project_id", project_id).eq("col", col).eq("id", id).maybeSingle();
  if (!row) throw new HttpError(404, "Record not found");
  const d = row.data as Record<string, unknown>; const imgs = photosIn(d);
  if (col === "attendance" && d.personId) {
    const { data: docs } = await db.from("app_records").select("data").eq("project_id", project_id).eq("col", "peopleDocs").filter("data->>personId", "eq", String(d.personId)).filter("data->>kind", "eq", "photo").limit(1);
    const reg = docs && docs[0] && imgOf(String((docs[0].data as Record<string, unknown>).img || "")); if (reg) imgs.unshift(reg);
  }
  const base = { col, recId: id, at: new Date().toISOString(), by, note: note || "", date: d.date || null };
  const wid = `${col}_${id}`;
  if (!imgs.length) { await db.from("app_records").upsert({ project_id, col: "aiwatch", id: wid, data: { ...base, verdict: "unclear", severity: "medium", summary: "No photo was attached, so nothing could be checked.", checks: [] } }); return; }
  try {
    const r = await claude([...imgs.slice(0, 4), { text: `${ASK[col] || "Check that the photos match this record."}\n\nThe record as entered by site staff:\n${JSON.stringify(strip(d)).slice(0, 6000)}${note ? `\n\nNote from the supervisor: ${note}` : ""}\n\nBe strict but fair: say "mismatch" only for a real discrepancy, "unclear" if the photo can't show it. Reply with only JSON of this shape:\n${SHAPE}` }]);
    await db.from("app_records").upsert({ project_id, col: "aiwatch", id: wid, data: { ...base, ...r, status: r.verdict === "ok" ? "Clear" : "Open" } });
  } catch (e) {
    const waiting = e instanceof HttpError && e.message === "no-key"; const why = e instanceof Error ? e.message : "";
    await db.from("app_records").upsert({ project_id, col: "aiwatch", id: wid, data: { ...base, verdict: "pending", severity: "low", summary: waiting ? "Waiting: AI is not switched on yet." : `Check failed; it will be retried. ${why}`.trim(), status: "Pending" } });
  }
}

Deno.serve(handler(async (req) => {
  const user = await caller(req);
  const b = await req.json().catch(() => ({}));
  const me = await membership(b.project_id, user.id);
  const db = admin(); PROJ = b.project_id;
  if (b.action === "face") {
    const shot = imgOf(String(b.image || "")); if (!shot) throw new HttpError(400, "No photo");
    const { data: docs } = await db.from("app_records").select("data").eq("project_id", b.project_id).eq("col", "peopleDocs").filter("data->>personId", "eq", String(b.person_id)).filter("data->>kind", "eq", "photo").limit(1);
    const reg = docs && docs[0] && imgOf(String((docs[0].data as Record<string, unknown>).img || ""));
    if (!reg) return json({ match: "unclear", reason: "no registered photo" });
    try { const r = await claude([reg, shot, { text: `The first photo is the registered photo of a construction worker; the second was just taken live at the site gate. Is it the same person? Is the second a live photo of a real person (not a photo of a screen or a printed photo)? Reply with only JSON: {"samePerson": "yes" | "no" | "unclear", "live": "yes" | "no" | "unclear"}` }], 200);
      const match = r.samePerson === "no" || r.live === "no" ? "no" : r.samePerson === "yes" ? "yes" : "unclear"; return json({ match });
    } catch (_e) { return json({ match: "unclear" }); }
  }
  if (b.action === "rerun") {
    if (me.role !== "owner") throw new HttpError(403, "Owner only");
    const { data: pend } = await db.from("app_records").select("id, data").eq("project_id", b.project_id).eq("col", "aiwatch").filter("data->>verdict", "eq", "pending").limit(25);
    for (const p of pend ?? []) { const x = p.data as Record<string, string>; await check(db, b.project_id, x.col, x.recId, x.by || null, x.note); }
    return json({ ok: true, done: (pend ?? []).length });
  }
  if (!WATCH.includes(b.col) || !b.id) throw new HttpError(400, "Nothing to check");
  await check(db, b.project_id, String(b.col), String(b.id), user.id, b.note ? String(b.note).slice(0, 500) : undefined);
  return json({ ok: true });
}));
