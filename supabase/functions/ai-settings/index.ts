// POST /ai-settings — the owner chooses the AI service for the project (Claude or Google Gemini) and stores its key.
//   { project_id, action: "get" }   → { provider, model, model_complex, model_fast, has_key, key_hint, secret_fallback, defaults }
//   { project_id, action: "set", provider, model?, model_complex?, model_fast?, api_key?, clear_key? }
//   { project_id, action: "test" }  → { ok, reply, provider, model }
// The key is never sent back to the app, only its last 4 characters.
import { admin, caller, handler, HttpError, json, membership } from "../_shared/common.ts";
import { aiConfig, DEFAULTS, forget, generate } from "../_shared/llm.ts";

Deno.serve(handler(async (req) => {
  const user = await caller(req);
  const b = await req.json().catch(() => ({}));
  const me = await membership(b.project_id, user.id);
  if (me.role !== "owner") throw new HttpError(403, "Only the owner sets up AI");
  const db = admin();
  const { data: row } = await db.from("ai_settings").select("*").eq("project_id", b.project_id).maybeSingle();
  if (b.action === "set") {
    const provider = ["claude", "gemini", "off"].includes(b.provider) ? b.provider : "claude";
    const clean = (v: unknown) => { const s = String(v ?? "").trim(); return s && /^[A-Za-z0-9._:\/-]{2,80}$/.test(s) ? s : null; };
    const key = typeof b.api_key === "string" && b.api_key.trim() ? b.api_key.trim() : null;
    if (key && (key.length < 20 || key.length > 300 || /\s/.test(key))) throw new HttpError(400, "That doesn't look like an API key.");
    const providerChanged = row && row.provider !== provider && provider !== "off";
    const next = { project_id: b.project_id, provider, model: clean(b.model), model_complex: clean(b.model_complex), model_fast: clean(b.model_fast),
      api_key: b.clear_key ? null : key || (providerChanged ? null : row?.api_key ?? null), updated_by: user.id, updated_at: new Date().toISOString() };
    const { error } = await db.from("ai_settings").upsert(next); if (error) throw new HttpError(400, error.message);
    forget(b.project_id);
    return json({ ok: true, has_key: !!next.api_key, key_hint: next.api_key ? next.api_key.slice(-4) : null });
  }
  if (b.action === "test") {
    forget(b.project_id); const cfg = await aiConfig(b.project_id); if (!cfg) throw new HttpError(400, "AI is off: choose a service and enter its key first.");
    const reply = (await generate(b.project_id, [{ text: "Reply with just the word OK." }], { cfg, maxTokens: 20, tier: "fast" })).trim().slice(0, 60);
    return json({ ok: true, reply, provider: cfg.provider, model: cfg.fast, source: cfg.source });
  }
  return json({ provider: row?.provider || (Deno.env.get("ANTHROPIC_API_KEY") ? "claude" : "off"), model: row?.model || null, model_complex: row?.model_complex || null, model_fast: row?.model_fast || null,
    has_key: !!row?.api_key, key_hint: row?.api_key ? row.api_key.slice(-4) : null, secret_fallback: !!Deno.env.get("ANTHROPIC_API_KEY"), defaults: DEFAULTS });
}));
