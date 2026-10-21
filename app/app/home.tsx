import React from "react";
import { Pressable, Text, View } from "react-native";
import { Redirect, router } from "expo-router";
import { Banner, Button, Card, Screen, useColors } from "../src/components/ui";
import { useProject } from "../src/lib/project";
import { supabase } from "../src/lib/supabase";
import { t } from "../src/lib/i18n";

/** Mimaar opens straight into the project. This screen only appears to pick a project
 *  when the person belongs to several, or to create the first one. */
export default function Home() {
  const { memberships, current, choose } = useProject(); const c = useColors();
  if (current) return <Redirect href="/office" />;
  return (
    <Screen title="Projects">
      {memberships.length ? memberships.map((m) => (
        <Pressable key={m.project_id} onPress={() => choose(m.project_id)}>
          <Card>
            <Text style={{ fontWeight: "700", fontSize: 17, color: c.ink }}>{m.projects?.name}</Text>
            <Text style={{ color: c.muted }}>{m.projects?.address}</Text>
          </Card>
        </Pressable>
      )) : <Banner text="You are not on any project yet. If you work on a site, ask the owner to add your login. If you are the owner, create your project." />}
      <View style={{ gap: 10, marginTop: 8 }}>
        <Button title="Create a new project (owner)" onPress={() => router.push("/setup")} />
        <Button title="Sign out" kind="plain" onPress={() => supabase.auth.signOut()} />
      </View>
      <Text style={{ color: c.muted, textAlign: "center", marginTop: 12 }}>{t("Mimaar")}</Text>
    </Screen>
  );
}
