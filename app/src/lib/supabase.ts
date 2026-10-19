import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { createClient } from "@supabase/supabase-js";

const extra = (Constants.expoConfig?.extra ?? {}) as { supabaseUrl?: string; supabaseAnonKey?: string };
// Public project address and anon key (safe to ship: the database's row-level security protects the data).
const DEFAULT_URL = "https://bctdsetigzdamxjduxgb.supabase.co";
const DEFAULT_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjdGRzZXRpZ3pkYW14amR1eGdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0MDA4ODksImV4cCI6MjEwNzk3Njg4OX0.Rn6AuNwHpVnMdYxJKO06qstvTCOBE-JKh1Dk1Sf01Yg";

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || extra.supabaseUrl || DEFAULT_URL;
export const supabase = createClient(
  SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || extra.supabaseAnonKey || DEFAULT_ANON,
  { auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } },
);

/** Turns a Supabase / Postgres error into a sentence a site supervisor can act on. */
export function errText(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e);
  if (/Network request failed|Failed to fetch/i.test(m)) return "No internet. The entry is saved on the phone and will be sent when the connection returns.";
  if (/row-level security/i.test(m)) return "You don't have permission for this.";
  return m.replace(/^.*?ERROR:\s*/, "");
}
