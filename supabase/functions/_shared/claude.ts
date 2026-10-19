// Minimal Claude (Anthropic Messages API) client for image / PDF reading.
// Set the secrets: ANTHROPIC_API_KEY, optionally ANTHROPIC_MODEL.
import { HttpError } from "./common.ts";

type Block =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

export const img = (data: string, media_type = "image/jpeg"): Block => ({ type: "image", source: { type: "base64", media_type, data } });
export const pdf = (data: string): Block => ({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });

/** Ask Claude for a JSON answer. `shape` describes the JSON to return. */
export async function askJson<T>(instruction: string, shape: string, attachments: Block[] = [], maxTokens = 2000): Promise<T> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new HttpError(501, "AI is not configured (ANTHROPIC_API_KEY)");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: [...attachments, { type: "text", text: `${instruction}\n\nReply with only a JSON object of this shape, no prose:\n${shape}` }] }],
    }),
  });
  if (!res.ok) throw new HttpError(502, `AI request failed (${res.status})`);
  const out = await res.json();
  const text: string = (out.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new HttpError(502, "AI returned no JSON");
  return JSON.parse(m[0]) as T;
}
