// POST /ai — AI for the full Site Office (progress checks, bill reading, inspections, "Ask the project").
//   { project_id, status: true }                         → { enabled, provider }
//   { project_id, prompt, images?: [{data, type}], json?, tier?, search? }   search: let the AI look things up on the internet → { text } or { json }
// Uses Claude or Google Gemini, whichever the owner set up in Project settings → AI.
import { caller, handler, HttpError, json, membership } from "../_shared/common.ts";
import { aiConfig, generate, jsonIn, type Part } from "../_shared/llm.ts";

Deno.serve(handler(async (req) => {
  const user = await caller(req);
  const b = await req.json();
  await membership(b.project_id, user.id);
  const cfg = await aiConfig(b.project_id);
  if (b.status) return json({ enabled: !!cfg, provider: cfg?.provider || null });
  if (!cfg) throw new HttpError(501, "AI is not switched on yet");
  const images = (Array.isArray(b.images) ? b.images : []).slice(0, 8);
  const parts: Part[] = [
    ...images.map((i: { data: string; type?: string }): Part => i.type === "application/pdf" ? { pdf: { data: i.data } } : { image: { data: i.data, mime: i.type || "image/jpeg" } }),
    { text: String(b.prompt || "").slice(0, 400000) + (b.json ? "\n\nReply with only a JSON value, no prose." : "") },
  ];
  const text = await generate(b.project_id, parts, { cfg, maxTokens: b.json ? 4000 : 2500, tier: b.tier === "complex" ? "complex" : "normal", search: !!b.search });
  if (!b.json) return json({ text });
  return json({ json: jsonIn(text) });
}));
