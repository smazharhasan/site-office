// Camera screens of the Buildiary app (the field screens run in the WebView and
// ask for these through the bridge). Live camera only, no gallery; every photo is
// taken with a fresh GPS fix, and a fake (mock) location is refused.
import React, { useRef, useState } from "react";
import { Image, Modal, Text, View } from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImageManipulator from "expo-image-manipulator";
import { Button, useColors } from "./ui";
import { freshFix, type Fix } from "../lib/location";

type Lang = "en" | "ur" | "ar";
const W: Record<string, string> = {
  "Take photo": "تصویر لیں", "Retake": "دوبارہ لیں", "Use photo": "یہ تصویر لگائیں", "Cancel": "منسوخ", "Allow camera": "کیمرے کی اجازت دیں",
  "Camera permission is needed.": "کیمرے کی اجازت ضروری ہے۔", "Point the camera at the QR code": "کیمرہ QR کوڈ کی طرف کریں",
  "Location permission is required: every photo must show where it was taken.": "لوکیشن کی اجازت ضروری ہے: ہر تصویر کے ساتھ جگہ درج ہوتی ہے۔",
  "Turn on the phone's location (GPS).": "فون کی لوکیشن (GPS) آن کریں۔",
  "Location is fake (mock GPS). Turn off mock location apps.": "لوکیشن جعلی ہے۔ جعلی لوکیشن والی ایپ بند کریں۔",
};
const WA: Record<string, string> = {
  "Take photo": "التقط صورة", "Retake": "إعادة الالتقاط", "Use photo": "استخدم الصورة", "Cancel": "إلغاء", "Allow camera": "اسمح بالكاميرا",
  "Camera permission is needed.": "إذن الكاميرا مطلوب.", "Point the camera at the QR code": "وجّه الكاميرا إلى رمز QR",
  "Location permission is required: every photo must show where it was taken.": "إذن الموقع مطلوب: كل صورة يجب أن تُظهر مكان التقاطها.",
  "Turn on the phone's location (GPS).": "شغّل الموقع (GPS) في الجوال.",
  "Location is fake (mock GPS). Turn off mock location apps.": "الموقع مزيّف. أوقف تطبيقات الموقع الوهمي.",
};
export const tr = (lang: Lang, s: string) => (lang === "ur" ? W[s] ?? s : lang === "ar" ? WA[s] ?? s : s);

export interface Shot { base64: string; fix: Fix }

export function SiteCamera({ visible, title, facing = "back", lang, onDone, onClose }: { visible: boolean; title: string; facing?: "back" | "front"; lang: Lang; onDone: (s: Shot) => void; onClose: () => void }) {
  const ref = useRef<CameraView>(null); const c = useColors();
  const [perm, ask] = useCameraPermissions();
  const [shot, setShot] = useState<{ uri: string; fix: Fix } | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const take = async () => {
    setBusy(true); setErr("");
    try {
      const [pic, fix] = await Promise.all([ref.current!.takePictureAsync({ quality: 0.8 }), freshFix()]);
      setShot({ uri: pic.uri, fix });
    } catch (e) { setErr(String((e as Error).message ?? e)); }
    setBusy(false);
  };
  const use = async () => {
    if (!shot) return; setBusy(true);
    try {
      const small = await ImageManipulator.manipulateAsync(shot.uri, [{ resize: { width: 1280 } }], { compress: 0.72, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      const s = { base64: small.base64 || "", fix: shot.fix }; setShot(null); onDone(s);
    } catch (e) { setErr(String((e as Error).message ?? e)); }
    setBusy(false);
  };
  const close = () => { setShot(null); setErr(""); onClose(); };
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
        <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700", padding: 12, textAlign: lang === "ur" ? "right" : "left" }}>{title}</Text>
        {!perm?.granted ? (
          <View style={{ padding: 16, gap: 12 }}><Text style={{ color: "#fff" }}>{tr(lang, "Camera permission is needed.")}</Text><Button title={tr(lang, "Allow camera")} onPress={ask} /></View>
        ) : shot ? (
          <Image source={{ uri: shot.uri }} style={{ flex: 1 }} resizeMode="contain" />
        ) : visible ? (
          <CameraView ref={ref} style={{ flex: 1 }} facing={facing} />
        ) : null}
        <View style={{ padding: 12, gap: 8, backgroundColor: c.bg }}>
          {err ? <Text style={{ color: c.bad }}>{tr(lang, err)}</Text> : null}
          {shot ? <Text style={{ color: c.muted }}>GPS {shot.fix.lat.toFixed(5)}, {shot.fix.lng.toFixed(5)} ± {Math.round(shot.fix.accuracy ?? 0)} m</Text> : null}
          {shot ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}><Button title={tr(lang, "Retake")} kind="plain" onPress={() => setShot(null)} /></View>
              <View style={{ flex: 1 }}><Button title={tr(lang, "Use photo")} onPress={use} busy={busy} /></View>
            </View>
          ) : (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}><Button title={tr(lang, "Cancel")} kind="plain" onPress={close} /></View>
              <View style={{ flex: 2 }}><Button title={tr(lang, "Take photo")} onPress={take} busy={busy} disabled={!perm?.granted} /></View>
            </View>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

/** Reads any QR code (a worker's site card, or the laptop's connect code). */
export function QrScan({ visible, title, lang, onText, onClose }: { visible: boolean; title: string; lang: Lang; onText: (s: string) => void; onClose: () => void }) {
  const [perm, ask] = useCameraPermissions(); const done = useRef(false);
  const scanned = (r: BarcodeScanningResult) => { if (done.current || !r.data) return; done.current = true; onText(String(r.data)); };
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={() => { done.current = false; }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
        <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700", padding: 12, textAlign: lang === "ur" ? "right" : "left" }}>{title}</Text>
        {perm?.granted ? (visible ? <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={scanned} /> : null)
          : <View style={{ padding: 16 }}><Button title={tr(lang, "Allow camera")} onPress={ask} /></View>}
        <View style={{ padding: 12, gap: 8 }}>
          <Text style={{ color: "#ddd", textAlign: "center" }}>{tr(lang, "Point the camera at the QR code")}</Text>
          <Button title={tr(lang, "Cancel")} kind="plain" onPress={onClose} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}
