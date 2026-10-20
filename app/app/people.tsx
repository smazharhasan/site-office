import React, { useCallback, useEffect, useState } from "react";
import { Image, Platform, Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import * as Print from "expo-print";
import qrcode from "qrcode-generator";
import { Banner, Button, Card, Field, Screen, Select, useColors } from "../src/components/ui";
import { useEvidence } from "../src/components/useEvidence";
import { photoUrl } from "../src/lib/evidence";
import { useProject } from "../src/lib/project";
import { errText, supabase } from "../src/lib/supabase";

interface Person { id: string; full_name: string; father_name: string | null; cnic: string; phone: string | null; type: string; trade: string | null; gang: string | null; btk_card_no: string | null; btk_card_expiry: string | null; status: string; badge_token: string; daily_wage: number | null; person_docs: { kind: string; evidence_id: string }[] }
const TYPES = ["labour", "mistri", "store_keeper", "supervisor", "engineer", "guard", "cook", "driver", "supplier_staff", "builder_staff", "consultant", "owner_team"];
const blank = { full_name: "", father_name: "", cnic: "", phone: "", address: "", type: "labour", trade: "", gang: "", btk_card_no: "", btk_card_expiry: "", daily_wage: "" };

/** People register: add workers (no login needed), verify / block, and print QR site passes. Owner's side only. */
export default function People() {
  const { current } = useProject(); const c = useColors();
  const [list, setList] = useState<Person[]>([]); const [adding, setAdding] = useState(false); const [f, setF] = useState(blank);
  const [filter, setFilter] = useState("all"); const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const face = useEvidence("person_doc", "Photo of the person (face)", { strict: false }); const cnicF = useEvidence("person_doc", "CNIC front", { strict: false }); const cnicB = useEvidence("person_doc", "CNIC back", { strict: false }); const btk = useEvidence("person_doc", "BTK card", { strict: false });
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ k: "good" | "bad"; t: string } | null>(null);
  const load = useCallback(async () => {
    if (!current) return;
    const { data, error } = await supabase.from("people").select("id, full_name, father_name, cnic, phone, type, trade, gang, btk_card_no, btk_card_expiry, status, badge_token, daily_wage, person_docs(kind, evidence_id)").eq("project_id", current.project_id).order("full_name");
    if (error) { setMsg({ k: "bad", t: errText(error) }); return; }
    setList((data ?? []) as Person[]);
    const t: Record<string, string> = {};
    for (const p of (data ?? []) as Person[]) { const d = p.person_docs.find((x) => x.kind === "photo"); if (d) { const u = await photoUrl(d.evidence_id); if (u) t[p.id] = u; } }
    setThumbs(t);
  }, [current]);
  useEffect(() => { load(); }, [load]);
  if (!current) return null;
  const set = (k: keyof typeof blank) => (v: string) => setF({ ...f, [k]: v });

  const save = async () => {
    const d = f.cnic.replace(/\D/g, ""); if (d.length !== 13) return setMsg({ k: "bad", t: "CNIC must be 13 digits." });
    if (!face.evidence) return setMsg({ k: "bad", t: "Take the person's photo: it is used to check attendance." });
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.from("people").insert({
      project_id: current.project_id, full_name: f.full_name, father_name: f.father_name || null, cnic: `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`, phone: f.phone || null, address: f.address || null,
      type: f.type, trade: f.trade || null, gang: f.gang || null, btk_card_no: f.btk_card_no || null, btk_card_expiry: f.btk_card_expiry || null, daily_wage: f.daily_wage ? Number(f.daily_wage) : null, status: "active",
    }).select("id").single();
    if (error) { setMsg({ k: "bad", t: errText(error) }); setBusy(false); return; }
    const docs = ([["photo", face], ["cnic_front", cnicF], ["cnic_back", cnicB], ["btk_card", btk]] as const).filter(([, h]) => h.evidence).map(([kind, h]) => ({ person_id: data.id, kind, evidence_id: h.evidence!.id }));
    await supabase.from("person_docs").insert(docs);
    setMsg({ k: "good", t: `${f.full_name} registered.` }); setF(blank); [face, cnicF, cnicB, btk].forEach((h) => h.reset()); setAdding(false); setBusy(false); load();
  };
  const setStatus = async (p: Person, status: string) => { const { error } = await supabase.from("people").update({ status }).eq("id", p.id); if (error) setMsg({ k: "bad", t: errText(error) }); else load(); };
  const newPass = async (p: Person) => { const { error } = await supabase.from("people").update({ badge_token: Crypto.randomUUID() }).eq("id", p.id); if (error) setMsg({ k: "bad", t: errText(error) }); else { setMsg({ k: "good", t: `Old pass of ${p.full_name} no longer works. Print a new one.` }); load(); } };

  const printPasses = async (who: Person[]) => {
    const cards = who.map((p) => {
      const q = qrcode(0, "M"); q.addData(`SOP1|${current.project_id}|${p.badge_token}`); q.make();
      const img = thumbs[p.id] ? `<img class="ph" src="${thumbs[p.id]}">` : `<div class="ph"></div>`;
      return `<div class="card"><div class="hd">${esc(current.projects?.name ?? "")} · SITE PASS</div><div class="bd">${img}<div class="tx"><b>${esc(p.full_name)}</b><br>${esc(p.trade || p.type)}<br>Group: ${esc(p.gang || "—")}<br>BTK: ${esc(p.btk_card_no || "—")}<br>Valid to: ${esc(p.btk_card_expiry || "—")}<br>CNIC: ${esc(p.cnic.replace(/^(\d{5})-\d{7}-(\d)$/, "$1-*******-$2"))}</div><div class="qr">${q.createSvgTag({ cellSize: 3, margin: 0, scalable: true })}</div></div><div class="ft">Scan at the gate · must be worn on site</div></div>`;
    }).join("");
    const html = `<html><head><meta charset="utf-8"><style>@page{size:A4;margin:10mm}body{font-family:Arial,sans-serif;display:grid;grid-template-columns:86mm 86mm;gap:4mm 8mm}.card{width:86mm;height:54mm;border:1px solid #bbb;border-radius:3mm;overflow:hidden;break-inside:avoid;display:flex;flex-direction:column}.hd{background:#0f6f5c;color:#fff;font-size:9pt;font-weight:bold;padding:2mm 3mm}.bd{flex:1;display:flex;gap:2mm;padding:2mm 3mm;font-size:8pt}.ph{width:20mm;height:25mm;object-fit:cover;border:1px solid #ccc}.tx{flex:1}.qr{width:24mm;height:24mm}.qr svg{width:24mm;height:24mm}.ft{font-size:6.5pt;color:#666;padding:0 3mm 2mm}</style></head><body>${cards}</body></html>`;
    await Print.printAsync({ html, width: Platform.OS === "web" ? undefined : 595, height: Platform.OS === "web" ? undefined : 842 });
  };

  const shown = list.filter((p) => filter === "all" || p.status === filter);
  return (
    <Screen title="People register">
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}><Button title={adding ? "Close form" : "+ Register a person"} onPress={() => setAdding(!adding)} /></View>
        <View style={{ flex: 1 }}><Button title="Print site passes" kind="plain" onPress={() => printPasses(list.filter((p) => p.status === "active"))} /></View>
      </View>
      {msg ? <Banner kind={msg.k} text={msg.t} /> : null}
      {adding ? (
        <Card>
          <Field label="Full name" value={f.full_name} onChangeText={set("full_name")} />
          <Field label="Father's name" value={f.father_name} onChangeText={set("father_name")} />
          <Field label="CNIC (13 digits)" value={f.cnic} onChangeText={set("cnic")} keyboardType="number-pad" />
          <Field label="Mobile" value={f.phone} onChangeText={set("phone")} keyboardType="phone-pad" />
          <Field label="Address" value={f.address} onChangeText={set("address")} />
          <Select label="Type" value={f.type} onChange={set("type")} options={TYPES.map((x) => ({ value: x, label: x.replace("_", " ") }))} />
          <Field label="Trade (mason, steel fixer…)" value={f.trade} onChangeText={set("trade")} />
          <Field label="Group / contractor" value={f.gang} onChangeText={set("gang")} />
          <Field label="BTK registration card no." value={f.btk_card_no} onChangeText={set("btk_card_no")} />
          <Field label="BTK card valid to (YYYY-MM-DD)" value={f.btk_card_expiry} onChangeText={set("btk_card_expiry")} />
          {current?.role === "owner" ? <Field label="Daily wage (Rs)" value={f.daily_wage} onChangeText={set("daily_wage")} keyboardType="number-pad" /> : null}
          {face.ui}{cnicF.ui}{cnicB.ui}{btk.ui}
          <Button title="Save" onPress={save} busy={busy} disabled={!f.full_name || !f.cnic} />
        </Card>
      ) : null}
      <Select label="Show" value={filter} onChange={setFilter} options={[["all", "Everyone"], ["pending", "Waiting for verification"], ["active", "Active"], ["blocked", "Blocked"], ["inactive", "Inactive"]].map(([value, label]) => ({ value, label: `${label} (${value === "all" ? list.length : list.filter((p) => p.status === value).length})` }))} />
      {shown.map((p) => {
        const expired = p.btk_card_expiry && p.btk_card_expiry < new Date().toISOString().slice(0, 10);
        return (
          <Card key={p.id}>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {thumbs[p.id] ? <Image source={{ uri: thumbs[p.id] }} style={{ width: 56, height: 56, borderRadius: 28 }} /> : null}
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "700", color: c.ink }}>{p.full_name}</Text>
                <Text style={{ color: c.muted }}>{[p.trade || p.type.replace("_", " "), p.gang].filter(Boolean).join(" · ")} · {p.cnic}</Text>
                <Text style={{ color: p.status === "active" ? c.good : p.status === "blocked" ? c.bad : c.warn, fontWeight: "700" }}>{p.status.toUpperCase()}{expired ? " · BTK CARD EXPIRED" : ""}{p.person_docs.some((d) => d.kind === "photo") ? "" : " · NO PHOTO"}</Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              {p.status !== "active" ? <Button title="Verify (active)" onPress={() => setStatus(p, "active")} /> : null}
              {p.status !== "blocked" ? <Button title="Block" kind="danger" onPress={() => setStatus(p, "blocked")} /> : null}
              {p.status === "active" ? <Button title="Pass" kind="plain" onPress={() => printPasses([p])} /> : null}
              {p.status === "active" ? <Button title="Lost pass" kind="plain" onPress={() => newPass(p)} /> : null}
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
