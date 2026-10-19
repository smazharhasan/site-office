// Offline queue. Photos and entries captured without signal are kept on the
// device (AsyncStorage + a copy of the photo) and sent in order when the
// connection returns. Works on Android and in the web app.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import { decode } from "base64-arraybuffer";
import { supabase } from "./supabase";

export interface QueueItem { id: number; kind: "evidence" | "insert" | "rpc"; payload: Record<string, unknown>; file: string | null; tries: number; lastError: string | null }
const KEY = "upload-queue";
const read = async (): Promise<QueueItem[]> => JSON.parse((await AsyncStorage.getItem(KEY)) ?? "[]");
const write = (q: QueueItem[]) => AsyncStorage.setItem(KEY, JSON.stringify(q));

/** `file` is a photo URI on Android, or base64 data on the web. */
export async function enqueue(item: { kind: QueueItem["kind"]; payload: Record<string, unknown>; fileUri?: string; base64?: string }) {
  let file: string | null = null;
  if (item.fileUri && Platform.OS !== "web") { file = `${FileSystem.documentDirectory}q-${Date.now()}.jpg`; await FileSystem.copyAsync({ from: item.fileUri, to: file }); }
  else if (item.base64) file = item.base64;
  const q = await read(); q.push({ id: Date.now(), kind: item.kind, payload: item.payload, file, tries: 0, lastError: null }); await write(q);
}
export const pending = read;

async function fileBytes(file: string): Promise<ArrayBuffer> {
  if (Platform.OS === "web") return decode(file);
  return decode(await FileSystem.readAsStringAsync(file, { encoding: FileSystem.EncodingType.Base64 }));
}

/** Sends everything waiting. Stops at the first network failure. */
export async function flush(): Promise<{ sent: number; left: number }> {
  let q = await read(); let sent = 0;
  for (const it of [...q]) {
    try {
      if (it.kind === "evidence") {
        const up = await supabase.storage.from("evidence").upload(String(it.payload.storage_path), await fileBytes(it.file!), { contentType: "image/jpeg", upsert: false });
        if (up.error && !/exists/i.test(up.error.message)) throw up.error;
        const { error } = await supabase.functions.invoke("ingest-evidence", { body: it.payload }); if (error) throw error;
      } else if (it.kind === "insert") {
        const { table, row } = it.payload as { table: string; row: Record<string, unknown> };
        const { error } = await supabase.from(table).insert(row); if (error) throw error;
      } else {
        const { fn, args } = it.payload as { fn: string; args: Record<string, unknown> };
        const { error } = await supabase.rpc(fn, args); if (error) throw error;
      }
      q = q.filter((x) => x.id !== it.id); await write(q);
      if (it.file && Platform.OS !== "web") await FileSystem.deleteAsync(it.file, { idempotent: true });
      sent++;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      q = q.map((x) => (x.id === it.id ? { ...x, tries: x.tries + 1, lastError: msg } : x)); await write(q);
      if (/Network request failed|Failed to fetch|timeout/i.test(msg)) break;
    }
  }
  return { sent, left: q.length };
}
