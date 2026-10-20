import { t } from "../src/lib/i18n";
import React, { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Banner, Button, Card, Field, Screen, Select, useColors } from "../src/components/ui";
import { useProject } from "../src/lib/project";
import { errText, supabase } from "../src/lib/supabase";

interface Member { user_id: string; role: string; active: boolean; email: string; name: string; person_status: string }
const ROLES = [["site_supervisor", "Site supervisor"], ["store_keeper", "Store keeper"], ["owner_supervisor", "Owner's supervisor"], ["builder", "Builder (contractor)"], ["consultant", "Consultant / engineer"], ["supplier", "Supplier"]];

/** Owner adds staff logins (email + password), changes roles, suspends access. */
export default function Team() {
  const { current } = useProject(); const c = useColors();
  const [ms, setMs] = useState<Member[]>([]); const [f, setF] = useState({ full_name: "", email: "", password: "", role: "site_supervisor" });
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ k: "good" | "bad"; t: string } | null>(null);
  const call = async (body: Record<string, unknown>) => { const { data, error } = await supabase.functions.invoke("team", { body: { project_id: current!.project_id, ...body } }); if (error) { let t = errText(error); try { t = (await (error as { context?: Response }).context?.json())?.error ?? t; } catch { /* keep */ } throw new Error(t); } return data; };
  const load = useCallback(async () => { if (current) setMs(((await call({ action: "list" })) as { members: Member[] }).members); }, [current]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load().catch((e) => setMsg({ k: "bad", t: String(e.message) })); }, [load]);
  if (!current) return null;
  const add = async () => {
    setBusy(true); setMsg(null);
    try { await call({ action: "add", ...f }); setMsg({ k: "good", t: `Login created. Give ${f.full_name || f.email} the email and password; they register themselves at first sign-in.` }); setF({ full_name: "", email: "", password: "", role: f.role }); await load(); }
    catch (e) { setMsg({ k: "bad", t: String((e as Error).message) }); }
    setBusy(false);
  };
  const pw = () => Math.random().toString(36).slice(2, 6) + "-" + Math.random().toString(36).slice(2, 6) + "-" + Math.floor(Math.random() * 90 + 10);
  return (
    <Screen title="Team & logins">
      <Card>
        <Text style={{ fontWeight: "700", color: c.ink }}>{t("Add a login")}</Text>
        <Field label="Name" value={f.full_name} onChangeText={(v) => setF({ ...f, full_name: v })} />
        <Field label="Email" value={f.email} onChangeText={(v) => setF({ ...f, email: v })} autoCapitalize="none" keyboardType="email-address" />
        <Field label="Password (8+ characters)" value={f.password} onChangeText={(v) => setF({ ...f, password: v })} autoCapitalize="none" />
        <Button title="Suggest a password" kind="plain" onPress={() => setF({ ...f, password: pw() })} />
        <Select label="Role" value={f.role} onChange={(v) => setF({ ...f, role: v })} options={ROLES.map(([value, label]) => ({ value, label }))} />
        <Button title="Create login" onPress={add} busy={busy} disabled={!f.email.includes("@") || f.password.length < 8} />
      </Card>
      {msg ? <Banner kind={msg.k} text={msg.t} /> : null}
      {ms.map((m) => (
        <Card key={m.user_id}>
          <Text style={{ fontWeight: "700", color: c.ink }}>{m.name || m.email}</Text>
          <Text style={{ color: c.muted }}>{m.email} · {m.role.replace("_", " ")} · registration: {m.person_status}{m.active ? "" : " · SUSPENDED"}</Text>
          {m.role !== "owner" ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}><Button title={m.active ? "Suspend" : "Restore"} kind={m.active ? "danger" : "plain"} onPress={() => call({ action: "set", user_id: m.user_id, active: !m.active }).then(load).catch((e) => setMsg({ k: "bad", t: e.message }))} /></View>
              <View style={{ flex: 1 }}><Button title="New password" kind="plain" onPress={() => { const p = pw(); call({ action: "reset", user_id: m.user_id, password: p }).then(() => setMsg({ k: "good", t: `New password for ${m.email}: ${p}` })).catch((e) => setMsg({ k: "bad", t: e.message })); }} /></View>
            </View>
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}
