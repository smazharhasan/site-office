import { t } from "../src/lib/i18n";
import React, { useEffect, useState } from "react";
import { Text } from "react-native";
import { Banner, Button, Card, Field, Screen, Select, useColors } from "../src/components/ui";
import { BadgeScanner } from "../src/components/LiveCamera";
import { useEvidence } from "../src/components/useEvidence";
import { useProject } from "../src/lib/project";
import { errText, supabase } from "../src/lib/supabase";

interface Stock { material_id: string; name: string; kind: string; unit: string; on_hand: number }
interface Dir { id: string; full_name: string; type: string; status: string }

/**
 * Release / return / lost: the receiver is identified by scanning their badge
 * (only registered, active people), the authoriser is chosen from registered
 * staff, and a live photo of the item with the receiver is required. The
 * database refuses anything else.
 */
export default function Release() {
  const { current } = useProject(); const c = useColors();
  const [stock, setStock] = useState<Stock[]>([]); const [staff, setStaff] = useState<Dir[]>([]);
  const [scan, setScan] = useState(false); const [receiver, setReceiver] = useState<{ id: string; name: string; problem: string | null } | null>(null);
  const [f, setF] = useState({ kind: "release", material_id: "", qty: "", authorised_by: "", area: "" });
  const photo = useEvidence("release", "Photo: the item with the receiver");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ k: "good" | "bad"; t: string } | null>(null);
  useEffect(() => {
    if (!current) return;
    supabase.from("v_stock_on_hand").select("material_id, name, kind, unit, on_hand").eq("project_id", current.project_id).order("name").then(({ data }) => setStock((data ?? []) as Stock[]));
    supabase.from("people_directory").select("id, full_name, type, status").eq("project_id", current.project_id).eq("status", "active").not("type", "in", "(labour,guard,cook,driver)").then(({ data }) => setStaff((data ?? []) as Dir[]));
  }, [current]);
  if (!current) return null;
  const mat = stock.find((s) => s.material_id === f.material_id);

  const onToken = async (tok: string) => {
    setScan(false);
    const { data } = await supabase.rpc("resolve_badge", { p_project: current.project_id, p_token: tok });
    const p = data?.[0]; setReceiver(p ? { id: p.id, name: p.full_name, problem: p.problem } : null);
    if (!p) setMsg({ k: "bad", t: "Badge not recognised" });
  };
  const save = async () => {
    if (!receiver || !mat || !photo.evidence) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.from("stock_moves").insert({ project_id: current.project_id, material_id: mat.material_id, kind: f.kind, qty: Number(f.qty), person_id: receiver.id, authorised_by: f.authorised_by, area: f.area || null, evidence_id: photo.evidence.id });
    if (error) setMsg({ k: "bad", t: errText(error) });
    else { setMsg({ k: "good", t: `Saved: ${f.qty} ${mat.unit} ${mat.name} → ${receiver.name}` }); setF({ ...f, qty: "", area: "" }); setReceiver(null); photo.reset(); }
    setBusy(false);
  };
  return (
    <Screen title="Release material">
      <Select label="Movement" value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={[{ value: "release", label: "Release to work" }, { value: "return", label: "Return to store" }, { value: "lost", label: "Lost / damaged" }]} />
      <Button title={receiver ? `Receiver: ${receiver.name} (scan again)` : "Scan the receiver's badge"} kind={receiver ? "plain" : "primary"} onPress={() => setScan(true)} />
      {receiver?.problem ? <Banner kind="bad" text={`Cannot release to ${receiver.name}: ${receiver.problem}`} /> : null}
      <Select label="Item" value={f.material_id} onChange={(v) => setF({ ...f, material_id: v })} options={stock.map((s) => ({ value: s.material_id, label: s.name, sub: `${s.on_hand} ${s.unit} in store · ${s.kind}` }))} />
      <Field label="Quantity" value={f.qty} onChangeText={(v) => setF({ ...f, qty: v })} keyboardType="decimal-pad" />
      {mat && Number(f.qty) > mat.on_hand && f.kind === "release" ? <Text style={{ color: c.bad }}>{t(`Only ${mat.on_hand} ${mat.unit} in store.`)}</Text> : null}
      <Select label="Authorised by" value={f.authorised_by} onChange={(v) => setF({ ...f, authorised_by: v })} options={staff.map((p) => ({ value: p.id, label: p.full_name, sub: p.type.replace("_", " ") }))} />
      <Field label="Area / activity" value={f.area} onChangeText={(v) => setF({ ...f, area: v })} />
      {photo.ui}
      {msg ? <Banner kind={msg.k} text={msg.t} /> : null}
      <Button title="Save" onPress={save} busy={busy} disabled={!receiver || !!receiver.problem || !mat || !Number(f.qty) || !f.authorised_by || !photo.evidence} />
      <Card><Text style={{ color: c.muted }}>{t("The store keeper is you (your registered record). Time, GPS, phone and your name are stored with the photo and cannot be edited later.")}</Text></Card>
      <BadgeScanner visible={scan} projectId={current.project_id} onToken={onToken} onClose={() => setScan(false)} />
    </Screen>
  );
}
