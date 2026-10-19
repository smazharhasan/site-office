import React, { useCallback, useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { Banner, Button, Card, Screen, Select, useColors } from "../src/components/ui";
import { flagText, photoUrl } from "../src/lib/evidence";
import { useProject } from "../src/lib/project";
import { errText, supabase } from "../src/lib/supabase";

interface Att { id: string; work_date: string; direction: string; at: string; status: string; flags: string[]; face_evidence_id: string; face_match: { samePerson?: string; notes?: string } | null; people: { full_name: string; trade: string | null } | null }
interface Dev { id: string; device_key: string; model: string | null; os: string | null; approved: boolean; last_seen: string; user_id: string }

/** Owner's desk: flagged attendance and phones waiting for approval. */
export default function Review() {
  const { current } = useProject(); const c = useColors();
  const [tab, setTab] = useState("attendance"); const [att, setAtt] = useState<Att[]>([]); const [devs, setDevs] = useState<Dev[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({}); const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    if (!current) return;
    const a = await supabase.from("attendance").select("id, work_date, direction, at, status, flags, face_evidence_id, face_match, people(full_name, trade)").eq("project_id", current.project_id).in("status", ["flagged", "pending"]).order("at", { ascending: false }).limit(100);
    if (a.error) setMsg(errText(a.error));
    const rows = (a.data ?? []) as unknown as Att[]; setAtt(rows);
    const u: Record<string, string> = {}; for (const r of rows) { const x = await photoUrl(r.face_evidence_id); if (x) u[r.id] = x; } setUrls(u);
    const d = await supabase.from("devices").select("id, device_key, model, os, approved, last_seen, user_id").eq("project_id", current.project_id).order("approved").order("last_seen", { ascending: false });
    setDevs((d.data ?? []) as Dev[]);
  }, [current]);
  useEffect(() => { load(); }, [load]);
  if (!current) return null;
  const decide = async (id: string, status: "approved" | "rejected") => { const { error } = await supabase.from("attendance").update({ status }).eq("id", id); if (error) setMsg(errText(error)); else load(); };
  const approveDev = async (id: string, approved: boolean) => { const { error } = await supabase.from("devices").update({ approved }).eq("id", id); if (error) setMsg(errText(error)); else load(); };
  return (
    <Screen title="Review & approve">
      <Select label="Show" value={tab} onChange={setTab} options={[{ value: "attendance", label: `Flagged attendance (${att.length})` }, { value: "devices", label: `Phones (${devs.filter((d) => !d.approved).length} waiting)` }]} />
      {msg ? <Banner kind="bad" text={msg} /> : null}
      {tab === "attendance" ? (att.length ? att.map((a) => (
        <Card key={a.id}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {urls[a.id] ? <Image source={{ uri: urls[a.id] }} style={{ width: 90, height: 110, borderRadius: 6 }} /> : null}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontWeight: "700", color: c.ink }}>{a.people?.full_name}</Text>
              <Text style={{ color: c.muted }}>{a.work_date} · {a.direction.toUpperCase()} · {new Date(a.at).toLocaleTimeString()}</Text>
              <Text style={{ color: c.bad }}>{a.status === "pending" ? "Face check not finished" : a.flags.map((f) => flagText[f] ?? f.replace(/_/g, " ")).join(", ")}</Text>
              {a.face_match?.notes ? <Text style={{ color: c.muted }}>AI: {a.face_match.notes}</Text> : null}
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}><Button title="Reject" kind="danger" onPress={() => decide(a.id, "rejected")} /></View>
            <View style={{ flex: 1 }}><Button title="Approve" onPress={() => decide(a.id, "approved")} /></View>
          </View>
        </Card>)) : <Banner kind="good" text="Nothing waiting." />) : devs.map((d) => (
        <Card key={d.id}>
          <Text style={{ fontWeight: "700", color: c.ink }}>{d.model || "Phone"} · {d.os}</Text>
          <Text style={{ color: c.muted }}>Last used {new Date(d.last_seen).toLocaleString()} · {d.approved ? "APPROVED" : "WAITING"}</Text>
          <Button title={d.approved ? "Revoke" : "Approve this phone"} kind={d.approved ? "danger" : "primary"} onPress={() => approveDev(d.id, !d.approved)} />
        </Card>))}
    </Screen>
  );
}
