import React, { useEffect, useState } from "react";
import { Banner, Button, Field, Screen, Select } from "../src/components/ui";
import { useEvidence } from "../src/components/useEvidence";
import { useProject } from "../src/lib/project";
import { errText, supabase } from "../src/lib/supabase";

interface Po { id: string; no: string; material_id: string | null; description: string | null; qty: number; suppliers: { name: string } | null }
interface Mat { id: string; name: string; unit: string; kind: string }

/** Goods received note: against a PO, or a petty / canteen purchase with the shop's bill. The bill scan is mandatory. */
export default function Receive() {
  const { current } = useProject();
  const [pos, setPos] = useState<Po[]>([]); const [mats, setMats] = useState<Mat[]>([]);
  const [f, setF] = useState({ po_id: "", material_id: "", vendor: "", bill_no: "", vehicle_no: "", qty_received: "", qty_accepted: "", rate: "", amount: "" });
  const bill = useEvidence("receipt_bill", "Bill photo (required)");
  const truck = useEvidence("receipt_truck", "Photo: truck / goods");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ k: "good" | "bad"; t: string } | null>(null);
  useEffect(() => {
    if (!current) return;
    supabase.from("purchase_orders").select("id, no, material_id, description, qty, suppliers(name)").eq("project_id", current.project_id).in("status", ["approved", "issued"]).then(({ data }) => setPos((data ?? []) as unknown as Po[]));
    supabase.from("materials").select("id, name, unit, kind").eq("project_id", current.project_id).order("name").then(({ data }) => setMats((data ?? []) as Mat[]));
  }, [current]);
  if (!current) return null;
  const po = pos.find((p) => p.id === f.po_id);
  const save = async () => {
    setBusy(true); setMsg(null);
    const { count } = await supabase.from("grns").select("id", { count: "exact", head: true }).eq("project_id", current.project_id);
    const row = {
      project_id: current.project_id, no: `GRN-${String((count ?? 0) + 1).padStart(4, "0")}`, po_id: f.po_id || null, material_id: po?.material_id || f.material_id,
      vendor: f.po_id ? null : f.vendor, bill_no: f.bill_no || null, vehicle_no: f.vehicle_no || null, qty_received: Number(f.qty_received), qty_accepted: Number(f.qty_accepted || f.qty_received),
      rate: f.rate ? Number(f.rate) : null, amount: f.amount ? Number(f.amount) : null, bill_evidence_id: bill.evidence!.id, truck_evidence_id: truck.evidence?.id ?? null,
      received_by: (await supabase.rpc("my_person", { p: current.project_id })).data,
    };
    const { data, error } = await supabase.from("grns").insert(row).select("id, no").single();
    if (error) setMsg({ k: "bad", t: errText(error) });
    else { setMsg({ k: "good", t: `${data.no} saved. The AI is reading the bill…` }); supabase.functions.invoke("read-document", { body: { kind: "grn", id: data.id } }); bill.reset(); truck.reset(); }
    setBusy(false);
  };
  return (
    <Screen title="Receive goods">
      <Select label="Purchase order (leave empty for shop purchases)" value={f.po_id} onChange={(v) => setF({ ...f, po_id: v })} options={[{ value: "", label: "No PO (canteen / petty purchase)" }, ...pos.map((p) => ({ value: p.id, label: `${p.no} · ${p.suppliers?.name ?? ""}`, sub: `${p.qty} · ${p.description ?? ""}` }))]} />
      {!f.po_id ? <Select label="Item" value={f.material_id} onChange={(v) => setF({ ...f, material_id: v })} options={mats.map((m) => ({ value: m.id, label: m.name, sub: `${m.unit} · ${m.kind}` }))} /> : null}
      {!f.po_id ? <Field label="Vendor / shop" value={f.vendor} onChangeText={(v) => setF({ ...f, vendor: v })} /> : null}
      <Field label="Bill / challan no." value={f.bill_no} onChangeText={(v) => setF({ ...f, bill_no: v })} />
      <Field label="Vehicle no." value={f.vehicle_no} onChangeText={(v) => setF({ ...f, vehicle_no: v })} />
      <Field label="Quantity received" value={f.qty_received} onChangeText={(v) => setF({ ...f, qty_received: v })} keyboardType="decimal-pad" />
      <Field label="Quantity accepted" value={f.qty_accepted} onChangeText={(v) => setF({ ...f, qty_accepted: v })} keyboardType="decimal-pad" placeholder="Same as received" />
      <Field label="Rate on bill (Rs)" value={f.rate} onChangeText={(v) => setF({ ...f, rate: v })} keyboardType="decimal-pad" />
      <Field label="Bill amount (Rs)" value={f.amount} onChangeText={(v) => setF({ ...f, amount: v })} keyboardType="decimal-pad" />
      {bill.ui}{truck.ui}
      {msg ? <Banner kind={msg.k} text={msg.t} /> : null}
      <Button title="Save" onPress={save} busy={busy} disabled={!bill.evidence || !Number(f.qty_received) || (!f.po_id && (!f.material_id || !f.vendor))} />
    </Screen>
  );
}
