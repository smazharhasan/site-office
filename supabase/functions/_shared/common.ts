// Shared helpers for the Edge Functions (Deno).
import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.45.4";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Service-role client: bypasses row-level security. Use only after checking the caller. */
export function admin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}

/** The signed-in caller, from the Authorization header. */
export async function caller(req: Request): Promise<User> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sign in first");
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Session expired: sign in again");
  return data.user;
}

export type Role = "owner" | "owner_supervisor" | "builder" | "site_supervisor" | "store_keeper" | "supplier" | "consultant" | "labour";

export async function membership(projectId: string, userId: string): Promise<{ role: Role; person_id: string | null }> {
  const { data } = await admin().from("project_members").select("role, person_id").eq("project_id", projectId).eq("user_id", userId).eq("active", true).maybeSingle();
  if (!data) throw new HttpError(403, "You are not a member of this project");
  return data as { role: Role; person_id: string | null };
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function b64(buf: ArrayBuffer): string {
  let s = ""; const u = new Uint8Array(buf); const chunk = 0x8000;
  for (let i = 0; i < u.length; i += chunk) s += String.fromCharCode(...u.subarray(i, i + chunk));
  return btoa(s);
}

export async function download(bucket: string, path: string): Promise<ArrayBuffer> {
  const { data, error } = await admin().storage.from(bucket).download(path);
  if (error || !data) throw new HttpError(404, `File not found: ${path}`);
  return await data.arrayBuffer();
}

export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    try { return await fn(req); }
    catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Server error" }, 500);
    }
  };
}
