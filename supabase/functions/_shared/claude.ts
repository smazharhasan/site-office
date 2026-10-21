// Small JSON helper on top of llm.ts (works with Claude or Gemini, whichever the owner set up).
import { generate, jsonIn, type Part } from "./llm.ts";

export const img = (data: string, mime = "image/jpeg"): Part => ({ image: { data, mime } });
export const pdf = (data: string): Part => ({ pdf: { data } });

/** Ask the AI for a JSON answer. `shape` describes the JSON to return. */
export async function askJson<T>(instruction: string, shape: string, attachments: Part[] = [], maxTokens = 2000, projectId?: string): Promise<T> {
  const text = await generate(projectId, [...attachments, { text: `${instruction}\n\nReply with only a JSON object of this shape, no prose:\n${shape}` }], { maxTokens });
  return jsonIn<T>(text, false);
}
