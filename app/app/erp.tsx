import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Linking, Platform, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import { Banner, Button, Field, Screen, useColors } from "../src/components/ui";
import { ErpCamera, QrScan, tr } from "../src/components/ErpCamera";
import { freshFix } from "../src/lib/evidence";

const KEY = "mimaar.erp.site";

/** "villa31.frappe.cloud" → https://villa31.frappe.cloud ; "192.168.1.20:8081" (the laptop on Wi-Fi) → http://192.168.1.20:8081 */
function siteUrl(s: string): string | null {
  let v = (s || "").trim(); if (!v) return null;
  const scheme = v.match(/^(https?):\/\//i)?.[1]?.toLowerCase();
  v = v.replace(/^https?:\/\//i, "").replace(/[/?#].*$/, "").toLowerCase();
  if (!/^[a-z0-9.-]+(:\d{2,5})?$/.test(v)) return null;
  const host = v.replace(/:\d+$/, "");
  const local = /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host === "localhost" || host.endsWith(".local");
  if (!local && !host.includes(".")) return null;
  return `${scheme || (local ? "http" : "https")}://${v}`;
}

type Msg = { id: number; type: string; title?: string; facing?: "back" | "front"; url?: string; lang?: string };

/** Mimaar on ERPNext: the field screens of the site (/field) with the phone's live camera, GPS and card scanner.
 *  The first time, the address of the site is typed (villa31.frappe.cloud), or the laptop's QR code is scanned. */
export default function Erp() {
  const c = useColors(); const web = useRef<WebView>(null);
  const [site, setSite] = useState<string | null | undefined>(undefined);
  const [input, setInput] = useState(""); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");
  const [failed, setFailed] = useState(false); const [canBack, setCanBack] = useState(false);
  const [lang, setLang] = useState<"en" | "ur">("en");
  const [cam, setCam] = useState<Msg | null>(null); const [scan, setScan] = useState<Msg | null>(null); const [connectScan, setConnectScan] = useState(false);

  const [perm, askCam] = useCameraPermissions();
  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => setSite(v ? siteUrl(v) : null)).catch(() => setSite(null));
    AsyncStorage.getItem("mimaar.erp.lang").then((v) => { if (v === "ur") setLang("ur"); }).catch(() => {});
  }, []);
  // the field screens use the camera (photos, site cards) and the location (every photo, attendance): ask once, up front
  useEffect(() => {
    if (!site || Platform.OS === "web") return;
    if (perm && !perm.granted && perm.canAskAgain) askCam().catch(() => {});
    Location.getForegroundPermissionsAsync().then((p) => { if (!p.granted && p.canAskAgain) Location.requestForegroundPermissionsAsync().catch(() => {}); }).catch(() => {});
  }, [site, perm?.granted]);
  useEffect(() => {
    const h = BackHandler.addEventListener("hardwareBackPress", () => { if (site && canBack) { web.current?.goBack(); return true; } return false; });
    return () => h.remove();
  }, [canBack, site]);

  const open = async (raw: string) => {
    const base = siteUrl(raw);
    if (!base) { setMsg("Type the site address, for example villa31.frappe.cloud"); return; }
    setBusy(true); setMsg("");
    if (Platform.OS === "web") { await AsyncStorage.setItem(KEY, base); setSite(base); return; }
    try {
      const r = await fetch(`${base}/api/method/ping`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.message !== "pong") throw new Error("not erpnext");
      await AsyncStorage.setItem(KEY, base); setSite(base);
    } catch {
      setMsg(/^http:/.test(base)
        ? "Couldn't reach the laptop. The phone and the laptop must be on the same Wi-Fi, and Mimaar ERP must be running on the laptop."
        : "Couldn't reach a Mimaar / ERPNext site at that address. Check the spelling and the internet connection.");
    }
    setBusy(false);
  };
  const forget = async () => { await AsyncStorage.removeItem(KEY); setSite(null); setFailed(false); setInput(""); };

  /** answer a request from the field screens */
  const reply = (id: number, res: unknown) => web.current?.injectJavaScript(`window.MimaarNative && window.MimaarNative.resolve(${id}, ${JSON.stringify(res)}); true;`);
  const onMessage = async (e: WebViewMessageEvent) => {
    let m: Msg; try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (m.lang === "ur" || m.lang === "en") { setLang(m.lang); AsyncStorage.setItem("mimaar.erp.lang", m.lang).catch(() => {}); }
    try {
      if (m.type === "photo") setCam(m);
      else if (m.type === "scan") setScan(m);
      else if (m.type === "location") { const f = await freshFix(); reply(m.id, { lat: f.lat, lng: f.lng, accuracy: f.accuracy }); }
      else if (m.type === "open" && m.url) { await Linking.openURL(m.url); reply(m.id, { ok: 1 }); }
      else if (m.type === "forget") { reply(m.id, { ok: 1 }); forget(); }
      else reply(m.id, { ok: 1 });
    } catch (err) { reply(m.id, { error: tr(lang, String((err as Error).message ?? err)) }); }
  };

  if (site === undefined) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg }}><ActivityIndicator /></View>;
  if (!site) return (
    <Screen title="Mimaar ERP">
      <Text style={{ color: c.ink, fontSize: 16, marginBottom: 6 }}>Open your project · اپنا پروجیکٹ کھولیں</Text>
      <Text style={{ color: c.muted, marginBottom: 12 }}>Type your Mimaar site address once. اپنی سائٹ کا پتہ ایک بار لکھیں۔</Text>
      <Field label="Site address / سائٹ کا پتہ" value={input} onChangeText={setInput} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="villa31.frappe.cloud" />
      {msg ? <Banner kind="bad" text={msg} /> : null}
      <View style={{ gap: 10, marginTop: 10 }}>
        <Button title="Open · کھولیں" onPress={() => open(input)} busy={busy} />
        <Button title="Scan the QR on the laptop · لیپ ٹاپ کا QR اسکین کریں" kind="plain" onPress={() => setConnectScan(true)} />
      </View>
      <Text style={{ color: c.muted, marginTop: 14 }}>Testing on the laptop: double-click "Connect a phone" in the Mimaar ERP folder on the laptop, then scan its QR code here. The phone and the laptop must be on the same Wi-Fi.</Text>
      <QrScan visible={connectScan} title="Scan the QR on the laptop" lang="en" onClose={() => setConnectScan(false)}
        onText={(s) => { setConnectScan(false); setInput(s); open(s); }} />
    </Screen>
  );
  if (failed) return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg, padding: 24, gap: 12, justifyContent: "center" }}>
      <Text style={{ color: c.ink, fontSize: 18, fontWeight: "700" }}>{lang === "ur" ? "رابطہ نہیں ہو سکا" : "No connection"}</Text>
      <Text style={{ color: c.muted }}>{/^http:/.test(site)
        ? `Mimaar can't reach the laptop at ${site}. Check that the phone is on the same Wi-Fi and that Mimaar ERP is running on the laptop.`
        : `Mimaar needs the internet to open ${site}. Check your connection and try again.`}</Text>
      <Button title={lang === "ur" ? "دوبارہ کوشش کریں" : "Try again"} onPress={() => { setFailed(false); web.current?.reload(); }} />
      <Button title={lang === "ur" ? "سائٹ کا پتہ بدلیں" : "Change site address"} kind="plain" onPress={forget} />
    </SafeAreaView>
  );
  if (Platform.OS === "web") { window.location.href = `${site}/field`; return null; }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={["top", "bottom"]}>
      <WebView ref={web} source={{ uri: `${site}/field` }} onMessage={onMessage}
        onError={() => setFailed(true)} onNavigationStateChange={(n) => setCanBack(n.canGoBack)}
        onShouldStartLoadWithRequest={(req) => {
          const u = req.url;
          if (/^(https?:)?\/\//i.test(u) && !u.startsWith(site)) { Linking.openURL(u); return false; }
          if (/^(mailto|tel|whatsapp|intent):/i.test(u)) { Linking.openURL(u); return false; }
          return true;
        }}
        // PDFs and other files are downloaded by the phone (with the sign-in), into Downloads
        sharedCookiesEnabled thirdPartyCookiesEnabled geolocationEnabled javaScriptEnabled domStorageEnabled allowFileAccess
        mediaCapturePermissionGrantType="grant" allowsInlineMediaPlayback setSupportMultipleWindows={false} pullToRefreshEnabled startInLoadingState
        renderLoading={() => <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: c.bg }}><ActivityIndicator size="large" /></View>} />
      <ErpCamera visible={!!cam} title={cam?.title || ""} facing={cam?.facing} lang={lang}
        onClose={() => { if (cam) reply(cam.id, { cancelled: 1 }); setCam(null); }}
        onDone={(s) => { if (cam) reply(cam.id, { data: s.base64, lat: s.fix.lat, lng: s.fix.lng, accuracy: s.fix.accuracy }); setCam(null); }} />
      <QrScan visible={!!scan} title={scan?.title || ""} lang={lang}
        onClose={() => { if (scan) reply(scan.id, { cancelled: 1 }); setScan(null); }}
        onText={(text) => { if (scan) reply(scan.id, { text }); setScan(null); }} />
    </SafeAreaView>
  );
}
