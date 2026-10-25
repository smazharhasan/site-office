// The phone's position for site photos and attendance: a fresh, high-accuracy GPS fix.
// A fake (mock) location is refused.
import * as Location from "expo-location";
import { Platform } from "react-native";

export interface Fix { lat: number; lng: number; accuracy: number | null; mocked: boolean; at: number }

export class LocationError extends Error {}

export async function freshFix(): Promise<Fix> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== "granted") throw new LocationError("Location permission is required: every photo must show where it was taken.");
  if (Platform.OS !== "web" && !(await Location.hasServicesEnabledAsync())) throw new LocationError("Turn on the phone's location (GPS).");
  const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest, mayShowUserSettingsDialog: true });
  if (p.mocked) throw new LocationError("Location is fake (mock GPS). Turn off mock location apps.");
  return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null, mocked: !!p.mocked, at: p.timestamp };
}
