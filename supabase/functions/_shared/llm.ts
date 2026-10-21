// One AI client for every Edge Function: the owner chooses Claude (Anthropic) or Google Gemini in
// Project settings → AI. The key lives in the ai_settings table (server only). If no row exists,
// the ANTHROPIC_API_KEY secret is used, as before.
import { admin, HttpError } from "./common.ts";

export type Part = { text: string } | { image: { data: string; mime: string } } | { pdf: { data: string } };
export type Tier = "fast" | "normal" | "complex";
export type AiConfig = { provider: "claude" | "gemini"; key: string; model: string; complex: string; fast: string; source: "settings" | "secret" };

export const DEFAULTS = {
  claude: { model: "claude-sonnet-5-5", complex: "claude-opus-5-5", fast: "claude-haiku-5-5" },
  gemini: { model: "gemini-3.8-flash", complex: "gemini-4-argon", fast: "gemini-3.5-flash-lite" },
};

const cache = new Map<string, { at: number; cfg: AiConfig | null }>();
export function forget(projectId: string) { cache.delete(projectId); }

export async function aiConfig(projectId?: string): Promise<AiConfig | null> {
  const k = projectId || "-"; const hit = cache.get(k); if (hit && Date.now() - hit.at < 30000) return hit.cfg;
  let cfg: AiConfig | null = null;
  if (projectId) {
    const { data } = await admin().from("ai_settings").select("provider, model, model_complex, model_fast, api_key").eq("project_id", projectId).maybeSingle();
    if (data) {
      if (data.provider === "off") { cache.set(k, { at: Date.now(), cfg: null }); return null; }
      const p = data.provider === "gemini" ? "gemini" : "claude"; const d = DEFAULTS[p];
      if (data.api_key) cfg = { provider: p, key: data.api_key, model: data.model || d.model, complex: data.model_complex || d.complex, fast: data.model_fast || d.fast, source: "settings" };
    }
  }
  if (!cfg) {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (key) cfg = { provider: "claude", key, model: Deno.env.get("ANTHROPIC_MODEL") || DEFAULTS.claude.model, complex: Deno.env.get("ANTHROPIC_MODEL_COMPLEX") || DEFAULTS.claude.complex, fast: DEFAULTS.claude.fast, source: "secret" };
  }
  cache.set(k, { at: Date.now(), cfg }); return cfg;
}

const refused = (status: number) => status === 401 || status === 403 ? "The AI key was refused. Check it in Project settings → AI." : status === 404 ? "That AI model name was not found. Check it in Project settings → AI." : status === 429 ? "The AI service is busy or the account has run out of credit. Try again later." : `AI request failed (${status})`;

/** Ask the configured AI. Returns plain text. Throws HttpError(503, "no-key") when AI is off. */
export async function generate(projectId: string | undefined, parts: Part[], opts: { maxTokens?: number; tier?: Tier; cfg?: AiConfig; search?: boolean } = {}): Promise<string> {
  const cfg = opts.cfg || await aiConfig(projectId); if (!cfg) throw new HttpError(503, "no-key");
  const model = opts.tier === "complex" ? cfg.complex : opts.tier === "fast" ? cfg.fast : cfg.model; const max = opts.maxTokens || 2000;
  if (cfg.provider === "gemini") {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", headers: { "x-goog-api-key": cfg.key, "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: parts.map((p) => "text" in p ? { text: p.text } : "image" in p ? { inline_data: { mime_type: p.image.mime, data: p.image.data } } : { inline_data: { mime_type: "application/pdf", data: p.pdf.data } }) }],
        ...(opts.search ? { tools: [{ google_search: {} }] } : {}),
        generationConfig: { maxOutputTokens: Math.max(max * 3, 8192) } }),
    });
    if (!res.ok) throw new HttpError(502, refused(res.status));
    const out = await res.json();
    return ((out.candidates?.[0]?.content?.parts) || []).filter((x: { text?: string; thought?: boolean }) => x.text && !x.thought).map((x: { text: string }) => x.text).join("");
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "x-api-key": cfg.key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: max, ...(opts.search ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }] } : {}), messages: [{ role: "user", content: parts.map((p) => "text" in p ? { type: "text", text: p.text } : "image" in p ? { type: "image", source: { type: "base64", media_type: p.image.mime, data: p.image.data } } : { type: "document", source: { type: "base64", media_type: "application/pdf", data: p.pdf.data } }) }] }),
  });
  if (!res.ok) throw new HttpError(502, refused(res.status));
  const out = await res.json();
  return (out.content || []).filter((x: { type: string }) => x.type === "text").map((x: { text: string }) => x.text).join("");
}

/** The first JSON object or array in a reply. */
export function jsonIn<T = unknown>(text: string, arrayOk = true): T {
  const m = text.match(arrayOk ? /[\[{][\s\S]*[\]}]/ : /\{[\s\S]*\}/); if (!m) throw new HttpError(502, "AI returned no JSON");
  return JSON.parse(m[0]) as T;
}
export const imgPart = (dataUrlOrB64: string, mime = "image/jpeg"): Part | null => {
  const m = String(dataUrlOrB64 || "").match(/^data:(image\/[a-z+]+);base64,(.+)$/); if (m) return { image: { mime: m[1], data: m[2] } };
  return dataUrlOrB64 && !dataUrlOrB64.startsWith("data:") ? { image: { mime, data: dataUrlOrB64 } } : null;
};
