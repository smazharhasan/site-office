import React, { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Banner, Button, Card, Screen, useColors } from "../src/components/ui";
import { canOpen, useProject } from "../src/lib/project";
import { deviceKey } from "../src/lib/evidence";
import { flush, pending } from "../src/lib/queue";
import { supabase } from "../src/lib/supabase";
import { getLang, setLang, t } from "../src/lib/i18n";

let officeOpened = false; // the phone app opens the full Site Office once per launch

const TILES: [string, string][] = [["attendance", "Attendance"], ["release", "Release material"], ["receive", "Receive goods"], ["tanker", "Water tanker"], ["count", "Stock count"], ["daily-log", "Daily log"], ["stock", "Stock & consumption"], ["review", "Review & approve"], ["people", "People register"], ["team", "Team & logins"]];

export default function Home() {
  const { memberships, current, me, choose, phone } = useProject(); const c = useColors();
  const [queued, setQueued] = useState(0); const [device, setDevice] = useState<"approved" | "waiting" | "unknown">("unknown");
  useFocusEffect(useCallback(() => { pending().then((p) => setQueued(p.length)); }, []));
  useEffect(() => {
    if (!current) return;
    (async () => {
      const { data } = await supabase.from("devices").select("approved").eq("project_id", current.project_id).eq("device_key", await deviceKey()).maybeSingle();
      setDevice(data ? (data.approved ? "approved" : "waiting") : "unknown");
    })();
  }, [current]);

  useEffect(() => {
    if (current && Platform.OS !== "web" && !officeOpened && canOpen("office", current.role, phone)) { officeOpened = true; router.push("/office"); }
  }, [current, phone]);

  if (!current) return (
    <Screen title="Projects">
      {memberships.length ? memberships.map((m) => (
        <Pressable key={m.project_id} onPress={() => choose(m.project_id)}><Card><Text style={{ fontWeight: "700", color: c.ink }}>{m.projects?.name}</Text><Text style={{ color: c.muted }}>{m.projects?.address} · {m.role.replace("_", " ")}</Text></Card></Pressable>
      )) : <Banner text="You are not on any project yet. If you work on a site, ask the owner to add your login. If you are the owner, create your project." />}
      <Button title="Create a new project (owner)" onPress={() => router.push("/setup")} />
      <Button title="Sign out" kind="plain" onPress={() => supabase.auth.signOut()} />
    </Screen>
  );

  return (
    <Screen title={current.projects?.name ?? "Site Office"}>
      <Text style={{ color: c.muted }}>{me?.full_name} · {current.role.replace("_", " ")}</Text>
      {canOpen("office", current.role, phone) ? <Pressable onPress={() => router.push("/office")}>
        <View style={{ backgroundColor: c.accent, borderRadius: 12, padding: 16, gap: 4 }}>
          <Text style={{ color: "#fff", fontSize: 18, fontWeight: "800" }}>{t("Full Site Office")}</Text>
          <Text style={{ color: "#fff", opacity: 0.9 }}>{t("Dashboard, progress, schedule, payments, budget, procurement, quality, snags, checklists")}</Text>
        </View>
      </Pressable> : null}
      <Text style={{ color: c.muted, fontWeight: "700", marginTop: 4 }}>{t("Field screens (camera & GPS checked)")}</Text>
      {device === "waiting" ? <Banner kind="warn" text="This phone is waiting for the owner's approval." /> : null}
      {device === "unknown" ? <Banner text="This phone will be registered with your first photo, then the owner approves it." /> : null}
      {queued ? <Banner kind="warn" text={`${queued} item(s) waiting to upload`} /> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {TILES.filter(([k]) => canOpen(k, current.role, phone)).map(([k, label]) => (
          <Pressable key={k} onPress={() => router.push(`/${k}` as never)} style={{ width: "48%" }}>
            <Card><Text style={{ fontSize: 16, fontWeight: "700", color: c.ink }}>{t(label)}</Text></Card>
          </Pressable>
        ))}
      </View>
      {queued ? <Button title="Send now" kind="plain" onPress={async () => { const r = await flush(); setQueued(r.left); }} /> : null}
      <Button title={getLang() === "ur" ? "English" : "اردو"} kind="plain" onPress={() => setLang(getLang() === "ur" ? "en" : "ur").then(() => router.replace("/"))} />
      {memberships.length > 1 ? <Button title="Projects" kind="plain" onPress={() => choose("")} /> : null}
      <Button title="Sign out" kind="plain" onPress={() => supabase.auth.signOut()} />
    </Screen>
  );
}
