import React, { useState } from "react";
import { Banner, Button, Field, Screen, Select } from "../src/components/ui";
import { useEvidence } from "../src/components/useEvidence";
import { useProject } from "../src/lib/project";
import { errText, supabase } from "../src/lib/supabase";

/** Water tanker at refill: photo of the tanker with its plate AND a scan of the tanker bill are both required. */
export default function Tanker() {
  const { current } = useProject();
  const [f, setF] = useState({ tanker_no: "", supplier: "", gallons: "3000", water_type: "sweet", tds_ppm: "", cost: "", bill_no: "", to_tank: "Underground tank" });
  const tanker = useEvidence("tanker", "Photo: tanker with number plate");
  const bill = useEvidence("tanker_bill", "Bill photo (required)");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ k: "good" | "bad"; t: string } | null>(null);
  if (!current) return null;
  const save = async () => {
    setBusy(true); setMsg(null);
    const me = (await supabase.rpc("my_person", { p: current.project_id })).data;
    const { data, error } = await supabase.from("water_tankers").insert({
      project_id: current.project_id, tanker_no: f.tanker_no, supplier: f.supplier || null, gallons: Number(f.gallons), water_type: f.water_type, tds_ppm: f.tds_ppm ? Number(f.tds_ppm) : null,
      cost: f.cost ? Number(f.cost) : null, bill_no: f.bill_no || null, to_tank: f.to_tank, tanker_evidence_id: tanker.evidence!.id, bill_evidence_id: bill.evidence!.id, received_by: me,
    }).select("id").single();
    if (error) setMsg({ k: "bad", t: errText(error) });
    else { setMsg({ k: "good", t: "Saved. The AI is reading the bill…" }); supabase.functions.invoke("read-document", { body: { kind: "tanker", id: data.id } }); tanker.reset(); bill.reset(); }
    setBusy(false);
  };
  return (
    <Screen title="Water tanker">
      <Field label="Tanker no." value={f.tanker_no} onChangeText={(v) => setF({ ...f, tanker_no: v.toUpperCase() })} autoCapitalize="characters" />
      <Field label="Hydrant / supplier" value={f.supplier} onChangeText={(v) => setF({ ...f, supplier: v })} />
      <Field label="Gallons" value={f.gallons} onChangeText={(v) => setF({ ...f, gallons: v })} keyboardType="number-pad" />
      <Select label="Water" value={f.water_type} onChange={(v) => setF({ ...f, water_type: v })} options={[{ value: "sweet", label: "Sweet (construction & curing)" }, { value: "drinking", label: "Drinking" }, { value: "brackish_rejected", label: "Brackish (rejected)" }]} />
      <Field label="TDS (ppm)" value={f.tds_ppm} onChangeText={(v) => setF({ ...f, tds_ppm: v })} keyboardType="number-pad" />
      {Number(f.tds_ppm) > 1000 ? <Banner kind="bad" text="Above 1,000 ppm: not suitable for concrete or curing." /> : null}
      <Field label="Cost (Rs)" value={f.cost} onChangeText={(v) => setF({ ...f, cost: v })} keyboardType="number-pad" />
      <Field label="Bill / slip no." value={f.bill_no} onChangeText={(v) => setF({ ...f, bill_no: v })} />
      <Select label="Emptied into" value={f.to_tank} onChange={(v) => setF({ ...f, to_tank: v })} options={["Underground tank", "Overhead tank", "Curing / site drums", "Direct use on slab"].map((x) => ({ value: x, label: x }))} />
      {tanker.ui}{bill.ui}
      {msg ? <Banner kind={msg.k} text={msg.t} /> : null}
      <Button title="Save" onPress={save} busy={busy} disabled={!f.tanker_no || !Number(f.gallons) || !tanker.evidence || !bill.evidence} />
    </Screen>
  );
}
