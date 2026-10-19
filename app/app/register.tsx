import React, { useState } from "react";
import { Text } from "react-native";
import { Redirect, router } from "expo-router";
import { Banner, Button, Field, Screen, Select } from "../src/components/ui";
import { useEvidence } from "../src/components/useEvidence";
import { useProject } from "../src/lib/project";
import { errText, supabase } from "../src/lib/supabase";

const TYPES = ["store_keeper", "supervisor", "engineer", "builder_staff", "supplier_staff", "consultant", "owner_team", "owner"];

/** Everyone who uses the app registers with full details; the owner's side then verifies them. */
export default function Register() {
  const { current, session, me, reload } = useProject();
  const [f, setF] = useState({ full_name: String(session?.user.user_metadata?.full_name ?? ""), father_name: "", cnic: "", phone: session?.user.phone ? "+" + session.user.phone : "", address: "", btk_card_no: "", type: current?.role === "owner" ? "owner" : current?.role === "store_keeper" ? "store_keeper" : "supervisor" });
  const face = useEvidence("person_doc", "Your photo (face, now)", { facing: "front", strict: false });
  const cnicF = useEvidence("person_doc", "CNIC front", { strict: false });
  const cnicB = useEvidence("person_doc", "CNIC back", { strict: false });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  if (!current) return null;
  if (me && me.status === "active") return <Redirect href="/" />;
  if (me && me.status === "pending") return <Screen title="Register yourself"><Banner kind="warn" text="Registered. The owner's side is verifying your record; you'll get access once they mark you active." /><Button title="Check again" onPress={() => reload().then(() => router.replace("/"))} /></Screen>;
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const save = async () => {
    const d = f.cnic.replace(/\D/g, "");
    if (!f.full_name || d.length !== 13 || !f.phone || !f.address) return setErr("Fill name, a 13-digit CNIC, phone and address.");
    if (!face.evidence || !cnicF.evidence) return setErr("Take your photo and a photo of your CNIC front.");
    setBusy(true); setErr("");
    const { data, error } = await supabase.from("people").insert({ ...f, cnic: `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`, project_id: current.project_id, user_id: session!.user.id, status: current.role === "owner" ? "active" : "pending" }).select("id").single();
    if (error) { setErr(errText(error)); setBusy(false); return; }
    const docs = [["photo", face.evidence], ["cnic_front", cnicF.evidence], ["cnic_back", cnicB.evidence]].filter(([, e]) => e) as [string, { id: string }][];
    const r = await supabase.from("person_docs").insert(docs.map(([kind, e]) => ({ person_id: data.id, kind, evidence_id: e.id })));
    if (r.error) { setErr(errText(r.error)); setBusy(false); return; }
    await reload(); setBusy(false);
    router.replace("/");
  };
  return (
    <Screen title="Register yourself">
      <Text>Everyone using the site app must be registered with full details. The owner's side verifies your record before you can record anything.</Text>
      <Field label="Full name" value={f.full_name} onChangeText={set("full_name")} />
      <Field label="Father's name" value={f.father_name} onChangeText={set("father_name")} />
      <Field label="CNIC (13 digits)" value={f.cnic} onChangeText={set("cnic")} keyboardType="number-pad" />
      <Field label="Mobile" value={f.phone} onChangeText={set("phone")} keyboardType="phone-pad" />
      <Field label="Address" value={f.address} onChangeText={set("address")} />
      <Field label="BTK registration card no." value={f.btk_card_no} onChangeText={set("btk_card_no")} />
      <Select label="Your role on site" value={f.type} onChange={set("type")} options={TYPES.map((x) => ({ value: x, label: x.replace("_", " ") }))} />
      {face.ui}{cnicF.ui}{cnicB.ui}
      {err ? <Banner kind="bad" text={err} /> : null}
      <Button title="Save" onPress={save} busy={busy} />
    </Screen>
  );
}
