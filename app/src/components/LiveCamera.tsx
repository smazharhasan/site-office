// Live camera only: there is deliberately no way to pick a photo from the
// gallery anywhere in this app. Each capture takes a fresh GPS fix at the
// same moment.
import React, { useRef, useState } from "react";
import { Image, Modal, Text, View } from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, useColors } from "./ui";
import { freshFix, type Fix } from "../lib/evidence";
import { t } from "../lib/i18n";

export interface Shot { uri: string; capturedAt: number; fix: Fix }

export function LiveCamera({ visible, title, facing = "back", onDone, onClose }: { visible: boolean; title: string; facing?: "back" | "front"; onDone: (s: Shot) => void; onClose: () => void }) {
  const ref = useRef<CameraView>(null); const c = useColors();
  const [perm, ask] = useCameraPermissions();
  const [shot, setShot] = useState<Shot | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const take = async () => {
    setBusy(true); setErr("");
    try {
      const [pic, fix] = await Promise.all([ref.current!.takePictureAsync({ quality: 0.7, skipProcessing: false }), freshFix()]);
      setShot({ uri: pic.uri, capturedAt: Date.now(), fix });
    } catch (e) { setErr(String((e as Error).message ?? e)); }
    setBusy(false);
  };
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
        <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700", padding: 12 }}>{t(title)}</Text>
        {!perm?.granted ? (
          <View style={{ padding: 16, gap: 12 }}><Text style={{ color: "#fff" }}>{t("Camera permission is needed.")}</Text><Button title="Allow camera" onPress={ask} /></View>
        ) : shot ? (
          <Image source={{ uri: shot.uri }} style={{ flex: 1 }} resizeMode="contain" />
        ) : (
          <CameraView ref={ref} style={{ flex: 1 }} facing={facing} />
        )}
        <View style={{ padding: 12, gap: 8, backgroundColor: c.bg }}>
          {err ? <Text style={{ color: c.bad }}>{t(err)}</Text> : null}
          {shot ? <Text style={{ color: c.muted }}>GPS {shot.fix.lat.toFixed(5)}, {shot.fix.lng.toFixed(5)} ± {Math.round(shot.fix.accuracy ?? 0)} m</Text> : null}
          {shot ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}><Button title="Retake" kind="plain" onPress={() => setShot(null)} /></View>
              <View style={{ flex: 1 }}><Button title="Next" onPress={() => { const s = shot; setShot(null); onDone(s); }} /></View>
            </View>
          ) : (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}><Button title="Cancel" kind="plain" onPress={onClose} /></View>
              <View style={{ flex: 2 }}><Button title="Take photo" onPress={take} busy={busy} disabled={!perm?.granted} /></View>
            </View>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

/** Live QR scanner for worker badges. Badge QR = "SOP1|<project_id>|<badge_token>". */
export function BadgeScanner({ visible, projectId, onToken, onClose }: { visible: boolean; projectId: string; onToken: (token: string) => void; onClose: () => void }) {
  const [perm, ask] = useCameraPermissions(); const [msg, setMsg] = useState("");
  const scanned = (r: BarcodeScanningResult) => {
    const parts = String(r.data).split("|");
    // keep waiting quietly until a real site card is in front of the camera
    if (parts[0] !== "SOP1" || parts.length !== 3) return setMsg("Waiting for a site card…");
    if (parts[1] !== projectId) return setMsg("This card is for another project");
    onToken(parts[2]);
  };
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
        <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700", padding: 12 }}>{t("Scan the worker's badge")}</Text>
        {perm?.granted ? <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={visible ? scanned : undefined} />
          : <View style={{ padding: 16 }}><Button title="Allow camera" onPress={ask} /></View>}
        <View style={{ padding: 12, gap: 8 }}>{msg ? <Text style={{ color: "#ffb4a8" }}>{msg}</Text> : null}<Button title="Cancel" kind="plain" onPress={onClose} /></View>
      </SafeAreaView>
    </Modal>
  );
}
