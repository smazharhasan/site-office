import { getLang, t } from "../src/lib/i18n";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Platform, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, useColors } from "../src/components/ui";
import { supabase } from "../src/lib/supabase";
import { useProject } from "../src/lib/project";

export const OFFICE_URL = "https://office.15-252-213-18.sslip.io/site-office/";

/** The full Site Office (dashboard, schedule, payments, procurement, quality …) inside the phone app.
 *  The phone app owns the sign-in: it hands its session to the page and pushes refreshed tokens,
 *  so there is one login and one token refresher. */
export default function Office() {
  const c = useColors(); const { current } = useProject(); const { go } = useLocalSearchParams<{ go?: string }>();
  const web = useRef<WebView>(null);
  const [boot, setBoot] = useState<string | null>(null);
  const [failed, setFailed] = useState(false); const [canBack, setCanBack] = useState(false);

  useEffect(() => {
    if (Platform.OS === "web") { window.location.href = "/site-office/"; return; }
    supabase.auth.getSession().then(({ data }) => {
      const s = data.session;
      const payload = JSON.stringify({ access_token: s?.access_token, refresh_token: s?.refresh_token, project: current?.project_id ?? null });
      setBoot(`window.SO_NATIVE = ${payload}; try { if (window.SO_NATIVE.project) localStorage.setItem("so.project", window.SO_NATIVE.project); localStorage.setItem("v31.lang", "${getLang()}"); ${go ? `window.SO_GO = ${JSON.stringify(String(go))};` : ""} } catch (e) {} true;`);
    });
    const sub = supabase.auth.onAuthStateChange((ev, s) => {
      if (ev === "TOKEN_REFRESHED" && s) web.current?.injectJavaScript(`window.SO_setSession && window.SO_setSession(${JSON.stringify({ access_token: s.access_token, refresh_token: s.refresh_token })}); true;`);
      if (ev === "SIGNED_OUT") router.replace("/login");
    });
    return () => sub.data.subscription.unsubscribe();
  }, [current?.project_id, go]);

  useEffect(() => {
    const h = BackHandler.addEventListener("hardwareBackPress", () => { if (canBack) { web.current?.goBack(); return true; } return false; });
    return () => h.remove();
  }, [canBack]);

  const onMessage = async (e: WebViewMessageEvent) => {
    let m: { type: string; filename?: string; base64?: string; mime?: string };
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (m.type === "signout") { await supabase.auth.signOut(); router.replace("/login"); }
    if (m.type === "download" && m.base64) {
      const path = FileSystem.cacheDirectory + (m.filename || "download").replace(/[^A-Za-z0-9._-]/g, "_");
      await FileSystem.writeAsStringAsync(path, m.base64, { encoding: FileSystem.EncodingType.Base64 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: m.mime || undefined, dialogTitle: m.filename });
    }
  };

  if (failed) return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg, padding: 24, gap: 12, justifyContent: "center" }}>
      <Text style={{ color: c.ink, fontSize: 18, fontWeight: "700" }}>{t("No internet connection")}</Text>
      <Text style={{ color: c.muted }}>{t("Mimaar needs the internet to open your project. Check your connection and try again.")}</Text>
      <Button title="Try again" onPress={() => { setFailed(false); web.current?.reload(); }} />
    </SafeAreaView>
  );
  if (!boot) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg }}><ActivityIndicator /></View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={["top", "bottom"]}>
      <WebView ref={web} source={{ uri: OFFICE_URL }} injectedJavaScriptBeforeContentLoaded={boot}
        onMessage={onMessage} onError={() => setFailed(true)} onNavigationStateChange={(n) => setCanBack(n.canGoBack)}
        geolocationEnabled javaScriptEnabled domStorageEnabled allowFileAccess mediaCapturePermissionGrantType="grant"
        allowsInlineMediaPlayback setSupportMultipleWindows={false} pullToRefreshEnabled startInLoadingState
        renderLoading={() => <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: c.bg }}><ActivityIndicator size="large" /></View>} />
    </SafeAreaView>
  );
}
