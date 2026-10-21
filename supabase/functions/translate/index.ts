// POST /translate { project_id, texts: string[] } → { pairs: { text: translation } }
// Any project member. English values come back in Urdu, Urdu values in English. The pairs are also
// kept in the project's dictionary (config "i18n"), so every screen shows typed data in the viewer's language.
import { admin, caller, handler, HttpError, json, membership } from "../_shared/common.ts";
import { aiConfig, generate, jsonIn } from "../_shared/llm.ts";

Deno.serve(handler(async (req) => {
  const user = await caller(req);
  const b = await req.json().catch(() => ({}));
  await membership(b.project_id, user.id);
  const texts = [...new Set((Array.isArray(b.texts) ? b.texts : []).map((x: unknown) => String(x ?? "").trim()).filter((x: string) => x.length > 0 && x.length <= 300))].slice(0, 80) as string[];
  if (!texts.length) return json({ pairs: {} });
  const cfg = await aiConfig(b.project_id); if (!cfg) throw new HttpError(501, "AI is not switched on yet");
  const text = await generate(b.project_id, [{ text: `These values were typed into a construction project app in Pakistan (names of people and companies, roles, trades, items, addresses, places and short notes). Write each value in the OTHER language: English into natural, simple Urdu in Urdu script; Urdu into simple English. Names of people, companies, roads and places: write the same name in the other script (transliterate), do not translate its meaning. Keep numbers, sizes, codes and units (12mm, 60x60, Rs, sft, PO-001) as they are. Reply with only JSON: {"t": [[value, translation], ...]}\n${JSON.stringify(texts)}` }], { cfg, maxTokens: 4000, tier: "fast" });
  const out = jsonIn<{ t?: unknown[] }>(text, false); const pairs: Record<string, string> = {};
  for (const x of out.t || []) if (Array.isArray(x) && texts.includes(String(x[0])) && x[1] && String(x[1]).trim() && String(x[1]).length <= 400) pairs[String(x[0])] = String(x[1]).trim();
  if (Object.keys(pairs).length) {
    const db = admin();
    const { data: row } = await db.from("app_records").select("data").eq("project_id", b.project_id).eq("col", "config").eq("id", "i18n").maybeSingle();
    const d = (row?.data || {}) as Record<string, unknown>; const merged = Object.assign({}, (d.pairs || {}) as Record<string, string>, pairs);
    await db.from("app_records").upsert({ project_id: b.project_id, col: "config", id: "i18n", data: { ...d, id: "i18n", pairs: merged, at: new Date().toISOString() } });
  }
  return json({ pairs });
}));
