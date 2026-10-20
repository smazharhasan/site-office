import { t } from "../src/lib/i18n";
import React, { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Banner, Button, Card, Field, Screen, Select, useColors } from "../src/components/ui";
import { useProject } from "../src/lib/project";
import { errText, supabase } from "../src/lib/supabase";

interface Row { material_id: string; name: string; kind: string; unit: string; received: number; used_net: number; lost: number; on_hand: number; expected_by_now: number | null }
interface Tool { material_id: string; name: string; person_id: string; held: number; last_out: string; return_days: number | null }
const blank = { name: "", kind: "material", unit: "bag", phase: "grey", category: "", budget_qty: "", budget_rate: "", reorder_level: "", norm_per_man_day: "", monthly_budget: "", return_days: "1" };

/** Stock on hand, use against progress / norms, tools out, and the item catalogue. */
export default function Stock() {
  const { current } = useProject(); const c = useColors();
  const [rows, setRows] = useState<Row[]>([]); const [tools, setTools] = useState<Tool[]>([]); const [names, setNames] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false); const [f, setF] = useState(blank); const [msg, setMsg] = useState<{ k: "good" | "bad"; t: string } | null>(null);
  const canEdit = current && ["owner", "builder"].includes(current.role);
  const load = useCallback(async () => {
    if (!current) return; const pid = current.project_id;
    const r = await supabase.from("v_consumption").select("*").eq("project_id", pid).order("name"); setRows((r.data ?? []) as Row[]);
    const t = await supabase.from("v_tool_holdings").select("*").eq("project_id", pid); setTools((t.data ?? []) as Tool[]);
    const d = await supabase.from("people_directory").select("id, full_name").eq("project_id", pid); setNames(Object.fromEntries((d.data ?? []).map((p) => [p.id, p.full_name])));
  }, [current]);
  useEffect(() => { load(); }, [load]);
  if (!current) return null;
  const set = (k: keyof typeof blank) => (v: string) => setF({ ...f, [k]: v });
  const num = (v: string) => (v ? Number(v) : null);
  const save = async () => {
    const { error } = await supabase.from("materials").insert({ project_id: current.project_id, name: f.name, kind: f.kind, unit: f.unit, phase: f.phase, category: f.category || null, budget_qty: num(f.budget_qty), budget_rate: num(f.budget_rate), reorder_level: num(f.reorder_level), norm_per_man_day: num(f.norm_per_man_day), monthly_budget: num(f.monthly_budget), return_days: f.kind === "tool" ? num(f.return_days) : null });
    if (error) setMsg({ k: "bad", t: errText(error) }); else { setMsg({ k: "good", t: `${f.name} added.` }); setF(blank); setAdding(false); load(); }
  };
  const today = Date.now();
  return (
    <Screen title="Stock & consumption">
      {canEdit ? <Button title={adding ? "Close form" : "+ Add an item to the catalogue"} kind={adding ? "plain" : "primary"} onPress={() => setAdding(!adding)} /> : null}
      {msg ? <Banner kind={msg.k} text={msg.t} /> : null}
      {adding ? (
        <Card>
          <Field label="Item name" value={f.name} onChangeText={set("name")} />
          <Select label="Kind" value={f.kind} onChange={set("kind")} options={[["material", "Construction material"], ["tool", "Tool / equipment (returnable)"], ["canteen", "Canteen (tea, sugar, milk…)"], ["consumable", "Consumable"]].map(([value, label]) => ({ value, label }))} />
          <Select label="Unit" value={f.unit} onChange={set("unit")} options={["bag", "ton", "kg", "nos", "cft", "sft", "rft", "m³", "litre", "packet", "lot"].map((x) => ({ value: x, label: x }))} />
          <Select label="Used in" value={f.phase} onChange={set("phase")} options={[["grey", "Grey structure"], ["finishing", "Finishing"], ["site_running", "Site running (canteen, tools)"], ["design", "Design"], ["testing", "Testing"]].map(([value, label]) => ({ value, label }))} />
          {f.kind === "material" || f.kind === "consumable" ? <Field label="Estimated total quantity" value={f.budget_qty} onChangeText={set("budget_qty")} keyboardType="decimal-pad" /> : null}
          <Field label="Budget rate (Rs per unit)" value={f.budget_rate} onChangeText={set("budget_rate")} keyboardType="decimal-pad" />
          <Field label="Re-order level" value={f.reorder_level} onChangeText={set("reorder_level")} keyboardType="decimal-pad" />
          {f.kind === "canteen" ? <Field label="Normal use per worker per day (e.g. 0.01 kg tea)" value={f.norm_per_man_day} onChangeText={set("norm_per_man_day")} keyboardType="decimal-pad" /> : null}
          {f.kind === "canteen" || f.kind === "consumable" ? <Field label="Monthly budget (Rs)" value={f.monthly_budget} onChangeText={set("monthly_budget")} keyboardType="decimal-pad" /> : null}
          {f.kind === "tool" ? <Field label="Must be returned within (days)" value={f.return_days} onChangeText={set("return_days")} keyboardType="number-pad" /> : null}
          <Button title="Save" onPress={save} disabled={!f.name} />
        </Card>
      ) : null}
      {rows.map((r) => {
        const v = r.expected_by_now ? (Number(r.used_net) - Number(r.expected_by_now)) / Number(r.expected_by_now) * 100 : null;
        return (
          <Card key={r.material_id}>
            <Text style={{ fontWeight: "700", color: c.ink }}>{r.name} <Text style={{ color: c.muted, fontWeight: "400" }}>· {r.kind}</Text></Text>
            <Text style={{ color: c.ink }}>In store {Number(r.on_hand)} {r.unit} · received {Number(r.received)} · used {Number(r.used_net)}{Number(r.lost) ? ` · lost ${Number(r.lost)}` : ""}</Text>
            {r.expected_by_now != null ? <Text style={{ color: v != null && v > 15 ? c.bad : c.muted, fontWeight: v != null && v > 15 ? "700" : "400" }}>Expected by now {Math.round(Number(r.expected_by_now))} · {v == null ? "" : `${v > 0 ? "+" : ""}${Math.round(v)}%`}{v != null && v > 15 ? " · more used than progress justifies" : ""}</Text> : null}
          </Card>
        );
      })}
      {tools.length ? <Text style={{ fontWeight: "700", color: c.ink }}>{t("Tools out")}</Text> : null}
      {tools.map((t) => { const days = Math.floor((today - new Date(t.last_out).getTime()) / 864e5); const late = days > (t.return_days ?? 1);
        return <View key={t.material_id + t.person_id}><Text style={{ color: late ? c.bad : c.ink }}>{t.name}: {Number(t.held)} with {names[t.person_id] ?? "—"} for {days} day(s){late ? " · OVERDUE" : ""}</Text></View>; })}
    </Screen>
  );
}
