import React, { useEffect, useState } from "react";
import { Banner, Button, Field, Screen, Select } from "../src/components/ui";
import { useEvidence } from "../src/components/useEvidence";
import { useProject } from "../src/lib/project";
import { errText, supabase } from "../src/lib/supabase";

/** Physical stock count with a photo of the stack. The book quantity is filled in by the server, not typed. */
export default function Count() {
  const { current } = useProject();
  const [mats, setMats] = useState<{ id: string; name: string; unit: string }[]>([]);
  const [mid, setMid] = useState(""); const [counted, setCounted] = useState("");
  const photo = useEvidence("count", "Photo of the stack");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ k: "good" | "bad"; t: string } | null>(null);
  useEffect(() => { if (current) supabase.from("materials").select("id, name, unit").eq("project_id", current.project_id).order("name").then(({ data }) => setMats(data ?? [])); }, [current]);
  if (!current) return null;
  const save = async () => {
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.from("stock_counts").insert({ project_id: current.project_id, material_id: mid, counted: Number(counted), evidence_id: photo.evidence!.id, counted_by: null }).select("counted, book_qty").single();
    if (error) setMsg({ k: "bad", t: errText(error) });
    else { const d = Number(data.counted) - Number(data.book_qty); setMsg({ k: d < 0 ? "bad" : "good", t: d === 0 ? "Matches the books." : `Difference against the books: ${d > 0 ? "+" : ""}${d}` }); setCounted(""); photo.reset(); }
    setBusy(false);
  };
  return (
    <Screen title="Stock count">
      <Select label="Item" value={mid} onChange={setMid} options={mats.map((m) => ({ value: m.id, label: m.name, sub: m.unit }))} />
      <Field label="Counted" value={counted} onChangeText={setCounted} keyboardType="decimal-pad" />
      {photo.ui}
      {msg ? <Banner kind={msg.k} text={msg.t} /> : null}
      <Button title="Save" onPress={save} busy={busy} disabled={!mid || counted === "" || !photo.evidence} />
    </Screen>
  );
}
