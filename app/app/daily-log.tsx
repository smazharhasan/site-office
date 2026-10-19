import React, { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Banner, Button, Card, Field, Screen, Select, useColors } from "../src/components/ui";
import { useEvidence } from "../src/components/useEvidence";
import { useProject } from "../src/lib/project";
import { errText, supabase, SUPABASE_URL } from "../src/lib/supabase";
import { t } from "../src/lib/i18n";

interface Task { id: string; title: string; status: string; plan_start: string | null; plan_end: string | null }
interface Weather { temp_c: number; feels_c: number; humidity: number; rain_mm: number; wind_kmh: number; phrase: string; advice: string | null }
const pad = (n: number) => String(n).padStart(2, "0");
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** Daily log: weather from the internet, staff from the register, work picked from the programme, photos from the camera. */
export default function DailyLog() {
  const { current } = useProject(); const c = useColors();
  const [w, setW] = useState<Weather | null>(null); const [tasks, setTasks] = useState<Task[]>([]); const [staff, setStaff] = useState<{ id: string; full_name: string; type: string }[]>([]);
  const [present, setPresent] = useState<string[]>([]); const [done, setDone] = useState<Record<string, string>>({}); const [plan, setPlan] = useState<Record<string, string>>({});
  const [power, setPower] = useState("btk_normal"); const [outage, setOutage] = useState(""); const [notes, setNotes] = useState("");
  const [labour, setLabour] = useState<number | null>(null);
  const p1 = useEvidence("daily_log", "Site photo 1"); const p2 = useEvidence("daily_log", "Site photo 2");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ k: "good" | "bad"; t: string } | null>(null);
  useEffect(() => {
    if (!current) return; const pid = current.project_id;
    fetchWeather(pid).then(setW).catch(() => setW(null));
    supabase.from("tasks").select("id, title, status, plan_start, plan_end").eq("project_id", pid).neq("status", "done").order("plan_start").then(({ data }) => setTasks((data ?? []) as Task[]));
    supabase.from("people_directory").select("id, full_name, type").eq("project_id", pid).eq("status", "active").in("type", ["supervisor", "engineer", "supplier_staff", "builder_staff", "consultant", "owner_team", "store_keeper"]).then(({ data }) => setStaff(data ?? []));
    supabase.from("attendance").select("id", { count: "exact", head: true }).eq("project_id", pid).eq("work_date", today()).eq("direction", "in").in("status", ["verified", "approved"]).then(({ count }) => setLabour(count ?? 0));
  }, [current]);
  if (!current) return null;
  const toggle = (set: React.Dispatch<React.SetStateAction<Record<string, string>>>, id: string) => set((m) => { const n = { ...m }; if (id in n) delete n[id]; else n[id] = ""; return n; });
  const save = async () => {
    setBusy(true); setMsg(null);
    const { error } = await supabase.from("daily_logs").upsert({
      project_id: current.project_id, log_date: today(), weather: w, power, outage_hours: outage ? Number(outage) : null, staff_present: present,
      work_done: Object.entries(done).map(([task_id, note]) => ({ task_id, note })), plan_tomorrow: Object.entries(plan).map(([task_id, note]) => ({ task_id, note })),
      notes: notes || null, photo_evidence_ids: [p1.evidence?.id, p2.evidence?.id].filter(Boolean),
    }, { onConflict: "project_id,log_date" });
    setMsg(error ? { k: "bad", t: errText(error) } : { k: "good", t: "Saved" });
    setBusy(false);
  };
  const TaskPick = ({ sel, set }: { sel: Record<string, string>; set: React.Dispatch<React.SetStateAction<Record<string, string>>> }) => (
    <View style={{ gap: 6 }}>{tasks.map((tk) => (
      <View key={tk.id} style={{ gap: 4 }}>
        <Pressable onPress={() => toggle(set, tk.id)}><Text style={{ color: c.ink }}>{tk.id in sel ? "☑" : "☐"} {tk.title}</Text></Pressable>
        {tk.id in sel ? <TextInput value={sel[tk.id]} onChangeText={(v) => set((m) => ({ ...m, [tk.id]: v }))} placeholder="What exactly, quantity, gang" placeholderTextColor={c.muted} style={{ borderWidth: 1, borderColor: c.line, borderRadius: 6, padding: 8, color: c.ink }} /> : null}
      </View>))}</View>
  );
  return (
    <Screen title="Daily log">
      <Card>
        <Text style={{ fontWeight: "700", color: c.ink }}>{t("Weather")}</Text>
        <Text style={{ color: c.ink }}>{w ? `${Math.round(w.temp_c)}°C (feels ${Math.round(w.feels_c)}°C), ${w.phrase}, humidity ${w.humidity}%, wind ${Math.round(w.wind_kmh)} km/h, rain ${w.rain_mm} mm` : "Weather unavailable (set the site location in the project)."}</Text>
        {w?.advice ? <Text style={{ color: c.bad }}>{w.advice}</Text> : null}
      </Card>
      <Card><Text style={{ color: c.ink }}>Verified labour on site today: <Text style={{ fontWeight: "800" }}>{labour ?? "…"}</Text> (from attendance)</Text></Card>
      <Text style={{ fontWeight: "700", color: c.ink }}>{t("Staff present")}</Text>
      {staff.map((p) => <Pressable key={p.id} onPress={() => setPresent((x) => x.includes(p.id) ? x.filter((y) => y !== p.id) : [...x, p.id])}><Text style={{ color: c.ink }}>{present.includes(p.id) ? "☑" : "☐"} {p.full_name} · {p.type.replace("_", " ")}</Text></Pressable>)}
      <Select label="Power" value={power} onChange={setPower} options={[{ value: "btk_normal", label: "BTK Electric – normal" }, { value: "btk_outage_generator", label: "BTK outage – generator used" }, { value: "btk_outage_work_affected", label: "BTK outage – work affected" }, { value: "generator_only", label: "Generator only" }]} />
      {power !== "btk_normal" ? <Field label="Outage hours" value={outage} onChangeText={setOutage} keyboardType="decimal-pad" /> : null}
      <Text style={{ fontWeight: "700", color: c.ink }}>{t("Work done today")}</Text><TaskPick sel={done} set={setDone} />
      <Text style={{ fontWeight: "700", color: c.ink }}>{t("Plan for tomorrow")}</Text><TaskPick sel={plan} set={setPlan} />
      <Field label="Problems, delays, safety (extra notes)" value={notes} onChangeText={setNotes} multiline />
      {p1.ui}{p2.ui}
      {msg ? <Banner kind={msg.k} text={msg.t} /> : null}
      <Button title="Save" onPress={save} busy={busy} />
    </Screen>
  );
}

async function fetchWeather(projectId: string): Promise<Weather> {
  const { data: s } = await supabase.auth.getSession();
  const r = await fetch(`${SUPABASE_URL}/functions/v1/weather?project_id=${projectId}`, { headers: { Authorization: `Bearer ${s.session?.access_token}` } });
  if (!r.ok) throw new Error("weather");
  return (await r.json()) as Weather;
}
