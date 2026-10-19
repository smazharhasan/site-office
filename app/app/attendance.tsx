import React, { useState } from "react";
import { Text } from "react-native";
import { Banner, Button, Card, Screen, useColors } from "../src/components/ui";
import { BadgeScanner } from "../src/components/LiveCamera";
import { useEvidence } from "../src/components/useEvidence";
import { useProject } from "../src/lib/project";
import { errText, supabase } from "../src/lib/supabase";
import { flagText } from "../src/lib/evidence";
import { t } from "../src/lib/i18n";

interface Person { id: string; full_name: string; type: string; trade: string | null; gang: string | null; status: string; problem: string | null }

/**
 * Attendance needs all three, on the supervisor's own approved phone:
 *  1. a live scan of the worker's QR badge,
 *  2. a live photo of the worker's face, with a fresh GPS fix inside the site,
 *  3. the server's face match against the registered photo.
 * Anything that fails is saved as "flagged" and does not count until the owner approves it.
 */
export default function Attendance() {
  const { current } = useProject(); const c = useColors();
  const [scan, setScan] = useState(false); const [token, setToken] = useState<string | null>(null); const [person, setPerson] = useState<Person | null>(null);
  const [dir, setDir] = useState<"in" | "out">("in");
  const face = useEvidence("attendance", "Take the worker's photo", { strict: false });
  const [busy, setBusy] = useState(false); const [result, setResult] = useState<{ status: string; flags: string[] } | null>(null); const [err, setErr] = useState("");
  if (!current) return null;

  const onToken = async (tok: string) => {
    setScan(false); setErr(""); setResult(null); face.reset();
    const { data, error } = await supabase.rpc("resolve_badge", { p_project: current.project_id, p_token: tok });
    if (error || !data?.length) { setErr(error ? errText(error) : "Badge not recognised (lost or old badge?)"); return; }
    setToken(tok); setPerson(data[0] as Person);
  };
  const save = async () => {
    if (!token || !face.evidence) return;
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc("mark_attendance", { p_project: current.project_id, p_badge_token: token, p_face_evidence: face.evidence.id, p_badge_evidence: null, p_direction: dir });
    if (error) { setErr(errText(error)); setBusy(false); return; }
    const att = data as { id: string; status: string; flags: string[] };
    const v = await supabase.functions.invoke("verify-face", { body: { attendance_id: att.id } });
    setResult(v.error ? { status: att.status, flags: [...att.flags, "face check pending"] } : (v.data as { status: string; flags: string[] }));
    setBusy(false); setToken(null); setPerson(null); face.reset();
  };

  return (
    <Screen title="Attendance">
      <Button title={person ? "Scan another badge" : "Scan the worker's badge"} onPress={() => setScan(true)} />
      {person ? (
        <Card>
          <Text style={{ fontSize: 18, fontWeight: "700", color: c.ink }}>{person.full_name}</Text>
          <Text style={{ color: c.muted }}>{[person.trade || person.type, person.gang].filter(Boolean).join(" · ")}</Text>
          {person.problem ? <Text style={{ color: c.bad, fontWeight: "700" }}>⚠ {person.problem}</Text> : <Text style={{ color: c.good }}>✓ Registered and active</Text>}
          <Button title={dir === "in" ? "Check in" : "Check out"} kind="plain" onPress={() => setDir(dir === "in" ? "out" : "in")} />
        </Card>
      ) : null}
      {person ? face.ui : null}
      {err ? <Banner kind="bad" text={err} /> : null}
      {person && face.evidence ? <Button title="Save" onPress={save} busy={busy} /> : null}
      {result ? <Banner kind={result.status === "verified" ? "good" : "bad"} text={result.status === "verified" ? t("Verified") : `${t("Flagged for the owner")}: ${result.flags.map((f) => flagText[f] ?? f.replace(/_/g, " ")).join(", ")}`} /> : null}
      <BadgeScanner visible={scan} projectId={current.project_id} onToken={onToken} onClose={() => setScan(false)} />
    </Screen>
  );
}
