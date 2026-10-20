import React, { useEffect, useState } from "react";
import { AppState } from "react-native";
import { Redirect, Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ProjectProvider, useProject } from "../src/lib/project";
import { loadLang } from "../src/lib/i18n";
import { flush } from "../src/lib/queue";
import { supabase } from "../src/lib/supabase";

function Gate() {
  const { session, ready } = useProject(); const path = usePathname();
  useEffect(() => {
    // keep the auth token fresh and send queued items whenever the app comes to the front
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") { supabase.auth.startAutoRefresh(); flush().catch(() => {}); } else supabase.auth.stopAutoRefresh(); });
    return () => sub.remove();
  }, []);
  if (!ready) return null;
  if (!session && path !== "/login") return <Redirect href="/login" />;
  if (session && path === "/login") return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function Root() {
  const [lang, setLang] = useState(false);
  useEffect(() => { loadLang().then(() => setLang(true)); }, []);
  if (!lang) return null;
  return (
    <SafeAreaProvider>
      <ProjectProvider>
        <StatusBar style="auto" />
        <Gate />
      </ProjectProvider>
    </SafeAreaProvider>
  );
}
