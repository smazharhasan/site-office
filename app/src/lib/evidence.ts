// Live photo → evidence. Photos only come from the camera component (the
// gallery is not available in this app), are stamped with a fresh GPS fix
// and the device identity, hashed, uploaded, and registered by the
// ingest-evidence function, which applies the server's checks.
import * as Application from "expo-application";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { decode, encode } from "base64-arraybuffer";
import { supabase } from "./supabase";
import { enqueue } from "./queue";

export type Purpose = "attendance" | "badge" | "release" | "receipt_truck" | "receipt_bill" | "receipt_marking" | "tanker" | "tanker_bill" | "count" | "daily_log" | "inspection" | "snag" | "person_doc" | "progress";
export interface Fix { lat: number; lng: number; accuracy: number | null; mocked: boolean; at: number }
export interface Evidence { id: string; flags: string[]; distance_m: number | null }

export class EvidenceError extends Error {}

export async function deviceKey(): Promise<string> {
  if (Platform.OS === "android") return Application.getAndroidId();
  // web: a random id kept by this browser (counts as a separate device for the owner to approve)
  let k = await AsyncStorage.getItem("device-key");
  if (!k) { k = "web-" + Crypto.randomUUID(); await AsyncStorage.setItem("device-key", k); }
  return k;
}

/** Fresh, high-accuracy GPS fix. Mock locations are refused on the phone and flagged on the server. */
export async function freshFix(): Promise<Fix> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== "granted") throw new EvidenceError("Location permission is required: every photo must show where it was taken.");
  if (Platform.OS !== "web" && !(await Location.hasServicesEnabledAsync())) throw new EvidenceError("Turn on the phone's location (GPS).");
  const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest, mayShowUserSettingsDialog: true });
  if (p.mocked) throw new EvidenceError("Location is fake (mock GPS). Turn off mock location apps.");
  return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null, mocked: !!p.mocked, at: p.timestamp };
}

function uuid(): string { return Crypto.randomUUID(); }
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Turns a just-taken camera photo into server evidence.
 * If the phone is offline the photo is queued and sent later; the server
 * then marks it as a late upload for the owner to review.
 */
export async function submitPhoto(opts: { projectId: string; userId: string; uri: string; capturedAt: number; fix: Fix; purpose: Purpose }): Promise<Evidence | null> {
  const small = await ImageManipulator.manipulateAsync(opts.uri, [{ resize: { width: 1280 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG });
  const bytes = Platform.OS === "web" ? await (await fetch(small.uri)).arrayBuffer() : decode(await FileSystem.readAsStringAsync(small.uri, { encoding: FileSystem.EncodingType.Base64 }));
  const sha = hex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes)));
  const path = `${opts.projectId}/${opts.userId}/${uuid()}.jpg`;
  const body = {
    project_id: opts.projectId, storage_path: path, purpose: opts.purpose, sha256: sha, captured_at: new Date(opts.capturedAt).toISOString(),
    lat: opts.fix.lat, lng: opts.fix.lng, accuracy_m: opts.fix.accuracy, mocked: opts.fix.mocked,
    device_key: await deviceKey(), model: Platform.OS === "web" ? "Web browser" : `${Device.manufacturer ?? ""} ${Device.modelName ?? ""}`.trim(), os: Platform.OS === "web" ? "Web" : `Android ${Device.osVersion ?? ""}`, app_version: Application.nativeApplicationVersion ?? "",
  };
  try {
    const up = await supabase.storage.from("evidence").upload(path, bytes, { contentType: "image/jpeg", upsert: false });
    if (up.error) throw up.error;
    const { data, error } = await supabase.functions.invoke("ingest-evidence", { body });
    if (error) throw error;
    return (data as { evidence: Evidence }).evidence;
  } catch (e) {
    if (/Network request failed|Failed to fetch|timeout/i.test(String((e as Error)?.message ?? e))) {
      await enqueue({ kind: "evidence", fileUri: small.uri, base64: Platform.OS === "web" ? encode(bytes) : undefined, payload: body });
      return null;
    }
    throw e;
  }
}

const HARD = ["no_gps", "away_from_site", "mocked_location", "clock_skew_or_old_photo", "unknown_device", "unapproved_device", "integrity_failed", "device_of_other_user"];
export const hardFlags = (ev: Evidence) => ev.flags.filter((f) => HARD.includes(f));
export const flagText: Record<string, string> = {
  no_gps: "No GPS", away_from_site: "Not on site", mocked_location: "Fake GPS", clock_skew_or_old_photo: "Late or old photo", unknown_device: "Unknown phone",
  unapproved_device: "Phone not approved by the owner", integrity_failed: "App or phone failed the integrity check", device_of_other_user: "Phone belongs to another user", low_gps_accuracy: "Weak GPS",
};

/** Temporary link to view a private evidence photo. */
export async function photoUrl(evidenceId: string | null | undefined): Promise<string | null> {
  if (!evidenceId) return null;
  const { data } = await supabase.from("evidence").select("storage_path").eq("id", evidenceId).maybeSingle();
  if (!data) return null;
  const s = await supabase.storage.from("evidence").createSignedUrl(data.storage_path, 3600);
  return s.data?.signedUrl ?? null;
}
