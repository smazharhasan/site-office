import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Linking, Platform, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import { Banner, Button, Field, Screen, useColors } from "../src/components/ui";

const KEY = "mimaar.erp.site";
const clean = (s: string) => s.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();

/** Mimaar on ERPNext. The first time, the owner (or supervisor) types the site address, e.g. villa31.frappe.cloud.
 *  Sign-in, Urdu, scanning with the camera and everything else happen on the site itself. */
export default function Erp() {
  const c = useColors(); const web = useRef<WebView>(null);
  const [site, setSite] = useState<string | null | undefined>(undefined);
  const [input, setInput] = useState(""); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");
  const [failed, setFailed] = useState(false); const [canBack, setCanBack] = useState(false);

  const [cam, askCam] = useCameraPermissions();
  useEffect(() => { AsyncStorage.getItem(KEY).then((v) => setSite(v || null)).catch(() => setSite(null)); }, []);
  // the site uses the camera (scans, photos, site cards) and the location (attendance): ask once, up front
  useEffect(() => {
    if (!site || Platform.OS === "web") return;
    if (cam && !cam.granted && cam.canAskAgain) askCam().catch(() => {});
    Location.getForegroundPermissionsAsync().then((p) => { if (!p.granted && p.canAskAgain) Location.requestForegroundPermissionsAsync().catch(() => {}); }).catch(() => {});
  }, [site, cam?.granted]);
  useEffect(() => {
    const h = BackHandler.addEventListener("hardwareBackPress", () => { if (site && canBack) { web.current?.goBack(); return true; } return false; });
    return () => h.remove();
  }, [canBack, site]);

  const connect = async () => {
    const host = clean(input); if (!host || !host.includes(".")) { setMsg("Type the site address, for example villa31.frappe.cloud"); return; }
    setBusy(true); setMsg("");
    if (Platform.OS === "web") { await AsyncStorage.setItem(KEY, host); setSite(host); return; }
    try {
      const r = await fetch(`https://${host}/api/method/ping`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.message !== "pong") throw new Error("not erpnext");
      await AsyncStorage.setItem(KEY, host); setSite(host);
    } catch { setMsg("Couldn't reach a Mimaar / ERPNext site at that address. Check the spelling and the internet connection."); }
    setBusy(false);
  };
  const forget = async () => { await AsyncStorage.removeItem(KEY); setSite(null); setFailed(false); };

  if (site === undefined) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg }}><ActivityIndicator /></View>;
  if (!site) return (
    <Screen title="Mimaar">
      <Text style={{ color: c.ink, fontSize: 16, marginBottom: 6 }}>Open your project</Text>
      <Text style={{ color: c.muted, marginBottom: 12 }}>Type your Mimaar site address once. اپنی سائٹ کا پتہ ایک بار لکھیں۔</Text>
      <Field label="Site address / سائٹ کا پتہ" value={input} onChangeText={setInput} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="villa31.frappe.cloud" />
      {msg ? <Banner kind="bad" text={msg} /> : null}
      <View style={{ gap: 10, marginTop: 10 }}>
        <Button title="Open" onPress={connect} busy={busy} />
      </View>
    </Screen>
  );
  if (failed) return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg, padding: 24, gap: 12, justifyContent: "center" }}>
      <Text style={{ color: c.ink, fontSize: 18, fontWeight: "700" }}>No internet connection</Text>
      <Text style={{ color: c.muted }}>Mimaar needs the internet to open {site}. Check your connection and try again.</Text>
      <Button title="Try again" onPress={() => { setFailed(false); web.current?.reload(); }} />
      <Button title="Change site address" kind="plain" onPress={forget} />
    </SafeAreaView>
  );
  const base = `https://${site}`;
  if (Platform.OS === "web") { window.location.href = `${base}/desk/mimaar`; return null; }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={["top", "bottom"]}>
      <WebView ref={web} source={{ uri: `${base}/desk/mimaar` }}
        onError={() => setFailed(true)} onNavigationStateChange={(n) => setCanBack(n.canGoBack)}
        onShouldStartLoadWithRequest={(req) => {
          const u = req.url;
          if (/^(https?:)?\/\//i.test(u) && !u.startsWith(base)) { Linking.openURL(u); return false; }
          if (/^(mailto|tel|whatsapp|intent):/i.test(u)) { Linking.openURL(u); return false; }
          return true;
        }}
        // PDFs and other files are downloaded by the phone (with the sign-in), into Downloads
        sharedCookiesEnabled thirdPartyCookiesEnabled geolocationEnabled javaScriptEnabled domStorageEnabled allowFileAccess
        mediaCapturePermissionGrantType="grant" allowsInlineMediaPlayback setSupportMultipleWindows={false} pullToRefreshEnabled startInLoadingState
        renderLoading={() => <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: c.bg }}><ActivityIndicator size="large" /></View>} />
    </SafeAreaView>
  );
}
