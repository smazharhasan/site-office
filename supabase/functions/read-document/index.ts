// POST /read-document { kind: "grn" | "tanker" | "contract", id }
// grn / tanker: reads the scanned bill and checks it against the record.
// contract: reviews the uploaded contract (PDF or text) for obligations,
// money, timeline and risks. Result is stored in the row's `ai` column.
import { admin, b64, caller, download, handler, HttpError, json, membership } from "../_shared/common.ts";
import { askJson, img, pdf } from "../_shared/claude.ts";

const BILL_SHAPE = `{"verdict": "verified"|"check"|"mismatch", "summary": string, "bill": {"shop": string, "billNo": string, "date": string, "items": [{"item": string, "qty": string, "rate": string, "amount": string}], "total": string}, "matchesRecord": "yes"|"no"|"unclear", "differences": [string], "tamperingSigns": [string], "rateComment": string}`;
const CONTRACT_SHAPE = `{"summary": string, "contractValue": string, "paymentTerms": [{"stage": string, "amountOrPercent": string, "trigger": string}], "timeline": [{"milestone": string, "dateOrDuration": string}], "obligationsOwner": [string], "obligationsOtherParty": [string], "deliverables": [string], "exclusions": [string], "penalties": [string], "warranties": [string], "variations": string, "termination": string, "disputes": string, "risks": [{"risk": string, "severity": "low"|"medium"|"high", "whoBearsIt": "owner"|"other party"|"shared", "mitigation": string}], "missingOrWeakClauses": [string], "keyDates": [{"what": string, "when": string}], "riskScore": number}`;

Deno.serve(handler(async (req) => {
  const user = await caller(req);
  const { kind, id } = await req.json();
  const db = admin();

  if (kind === "grn" || kind === "tanker") {
    const table = kind === "grn" ? "grns" : "water_tankers";
    const { data: r } = await db.from(table).select("*").eq("id", id).single();
    if (!r) throw new HttpError(404, "Record not found");
    const m = await membership(r.project_id, user.id);
    if (m.role === "supplier") throw new HttpError(403, "Not allowed");
    const { data: ev } = await db.from("evidence").select("storage_path").eq("id", r.bill_evidence_id).single();
    const bill = await download("evidence", ev!.storage_path);
    let record = "";
    if (kind === "grn") {
      const { data: mat } = await db.from("materials").select("name, unit, budget_rate, spec").eq("id", r.material_id).single();
      record = `Goods received: ${r.qty_received} ${mat?.unit} of ${mat?.name} (accepted ${r.qty_accepted}), vendor ${r.vendor || "PO supplier"}, bill no. ${r.bill_no || "?"}, rate Rs ${r.rate ?? "?"}, amount Rs ${r.amount ?? "?"}. Budget rate Rs ${mat?.budget_rate ?? "not set"}. Approved spec: ${mat?.spec || "—"}.`;
    } else {
      record = `Water tanker ${r.tanker_no}, ${r.gallons} gallons, ${r.water_type}, cost Rs ${r.cost ?? "?"}, bill no. ${r.bill_no || "?"}.`;
    }
    const ai = await askJson(`You are checking a scanned bill at a house construction site in Karachi, Pakistan. Read the bill and compare it with the record: ${record} Flag differences in quantity, rate or total, a missing shop name or date, signs of overwriting or tampering, and rates far above the budget.`, BILL_SHAPE, [img(b64(bill))], 1500);
    await db.from(table).update({ ai }).eq("id", id);
    return json({ ai });
  }

  if (kind === "contract") {
    const { data: c } = await db.from("contracts").select("*, projects(name, address, description)").eq("id", id).single();
    if (!c) throw new HttpError(404, "Contract not found");
    const m = await membership(c.project_id, user.id);
    if (m.role !== "owner") throw new HttpError(403, "Only the owner can analyse contracts");
    const ctx = `You are a senior construction contracts adviser in Pakistan reviewing a ${c.type} contract "${c.title}" for the owner of ${c.projects?.name} (${c.projects?.address || ""}; ${c.projects?.description || ""}). List both parties' obligations fairly, the money, the timeline and the risks to the owner, using Pakistani practice (PEC conditions, Bahria Town by-laws). Quote clause numbers where you can.`;
    let ai;
    if (c.file_path && c.file_path.toLowerCase().endsWith(".pdf")) ai = await askJson(ctx, CONTRACT_SHAPE, [pdf(b64(await download("contracts", c.file_path)))], 4000);
    else if (c.text_content) ai = await askJson(`${ctx}\n\nCONTRACT TEXT:\n${String(c.text_content).slice(0, 150000)}`, CONTRACT_SHAPE, [], 4000);
    else throw new HttpError(400, "Upload the contract PDF first");
    await db.from("contracts").update({ ai }).eq("id", id);
    return json({ ai });
  }
  throw new HttpError(400, "Unknown kind");
}));
