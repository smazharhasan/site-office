// POST /ai — AI for the full Site Office (progress checks, bill reading, inspections, "Ask the project").
//   { project_id, status: true }                         → { enabled }
//   { project_id, prompt, images?: [{data, type}], json?, tier? } → { text } or { json }
// Off until the ANTHROPIC_API_KEY secret is set.
import { caller, handler, HttpError, json, membership } from "../_shared/common.ts";

Deno.serve(handler(async (req) => {
  const user = await caller(req);
  const b = await req.json();
  await membership(b.project_id, user.id);
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (b.status) return json({ enabled: !!key });
  if (!key) throw new HttpError(501, "AI is not switched on yet");
  const images = (Array.isArray(b.images) ? b.images : []).slice(0, 8);
  const content = [
    ...images.map((i: { data: string; type?: string }) => i.type === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: i.data } }
      : { type: "image", source: { type: "base64", media_type: i.type || "image/jpeg", data: i.data } }),
    { type: "text", text: String(b.prompt || "").slice(0, 400000) + (b.json ? "\n\nReply with only a JSON value, no prose." : "") },
  ];
  const model = b.tier === "complex" ? (Deno.env.get("ANTHROPIC_MODEL_COMPLEX") || "claude-opus-5-5") : (Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: b.json ? 4000 : 2500, messages: [{ role: "user", content }] }),
  });
  if (!res.ok) throw new HttpError(502, `AI request failed (${res.status})`);
  const out = await res.json();
  const text: string = (out.content || []).filter((x: { type: string }) => x.type === "text").map((x: { text: string }) => x.text).join("");
  if (!b.json) return json({ text });
  const m = text.match(/[\[{][\s\S]*[\]}]/);
  if (!m) throw new HttpError(502, "AI returned no JSON");
  return json({ json: JSON.parse(m[0]) });
}));
