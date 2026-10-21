import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Banner, Button, useColors } from "../src/components/ui";
import { supabase, SUPABASE_ANON, SUPABASE_URL } from "../src/lib/supabase";
import { t } from "../src/lib/i18n";


/** Sign in by scanning the site card (QR) and typing the PIN the owner gave you. */
export default function CardLogin() {
  const c = useColors(); const [perm, ask] = useCameraPermissions();
  const [qr, setQr] = useState<string | null>(null); const [pin, setPin] = useState("");
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);

  const onScan = ({ data }: { data: string }) => {
    if (qr || busy) return;
    if (data.startsWith("MIM2|")) { setQr(data); setMsg(""); }
    else if (/^(MIM1|V31)\|/.test(data)) setMsg("This card is for attendance only. Ask the owner for your new card with sign-in.");
  };
  const go = async (p: string) => {
    if (!qr || p.length < 4) return; setBusy(true); setMsg("");
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/card-login`, { method: "POST", headers: { "content-type": "application/json", apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` }, body: JSON.stringify({ action: "login", qr, pin: p }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Sign-in failed. Try again.");
      let v = await supabase.auth.verifyOtp({ token_hash: d.token_hash, type: "magiclink" });
      if (v.error) v = await supabase.auth.verifyOtp({ token_hash: d.token_hash, type: "email" });
      if (v.error) throw new Error(v.error.message);
      router.replace("/home");
    } catch (e) { setPin(""); setMsg(String((e as Error).message || e)); }
    setBusy(false);
  };
  const press = (k: string) => { if (busy) return; const n = k === "⌫" ? pin.slice(0, -1) : pin.length < 6 ? pin + k : pin; setPin(n); if (n.length === 6) go(n); };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ padding: 20, gap: 14, flex: 1, width: "100%", maxWidth: 460, alignSelf: "center" }}>
        <Text style={{ color: c.ink, fontSize: 24, fontWeight: "800" }}>{t(qr ? "Enter your PIN" : "Sign in with site card")}</Text>
        <Text style={{ color: c.muted }}>{t(qr ? "Card found. Type the PIN the owner gave you." : "Hold your site card's QR code inside the frame.")}</Text>
        {!qr ? (!perm?.granted ? <View style={{ gap: 10 }}><Banner text="Camera permission is needed." /><Button title="Allow camera" onPress={ask} /></View> : (
          <View style={{ flex: 1, borderRadius: 18, overflow: "hidden", backgroundColor: "#000", maxHeight: 460 }}>
            <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={onScan} />
            <View pointerEvents="none" style={{ position: "absolute", top: "18%", bottom: "18%", left: "14%", right: "14%", borderWidth: 3, borderColor: "rgba(255,255,255,.9)", borderRadius: 18 }} />
          </View>)) : (
          <View style={{ gap: 14 }}>
            <View style={{ flexDirection: "row", gap: 12, justifyContent: "center", marginVertical: 6 }}>
              {Array.from({ length: Math.max(4, pin.length) }, (_, i) => <View key={i} style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: c.ink, backgroundColor: i < pin.length ? c.ink : "transparent" }} />)}
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((k, i) => k === "" ? <View key={i} style={{ width: "31%" }} /> : (
                <Pressable key={i} onPress={() => press(k)} style={({ pressed }) => ({ width: "31%", minHeight: 60, borderRadius: 16, borderWidth: 1, borderColor: c.line, backgroundColor: pressed ? c.line : c.panel, alignItems: "center", justifyContent: "center" })}>
                  <Text style={{ color: c.ink, fontSize: 22, fontWeight: "600" }}>{k}</Text>
                </Pressable>))}
            </View>
            <Button title="Sign in" onPress={() => go(pin)} busy={busy} disabled={pin.length < 4} />
            <Button title="Scan again" kind="plain" onPress={() => { setQr(null); setPin(""); setMsg(""); }} />
          </View>)}
        {msg ? <Banner kind="bad" text={msg} /> : null}
        <Button title="Use email instead" kind="plain" onPress={() => router.replace("/login")} />
      </View>
    </SafeAreaView>
  );
}
