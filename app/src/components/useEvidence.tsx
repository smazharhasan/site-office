import React, { useState } from "react";
import { Image, Text, View } from "react-native";
import { LiveCamera, type Shot } from "./LiveCamera";
import { Button, useColors } from "./ui";
import { flagText, hardFlags, submitPhoto, type Evidence, type Purpose } from "../lib/evidence";
import { errText } from "../lib/supabase";
import { useProject } from "../lib/project";
import { t } from "../lib/i18n";

/**
 * One photo slot: opens the live camera, uploads, and shows the server's
 * verdict. `strict` slots (stock, receipts) refuse photos with hard flags.
 */
export function useEvidence(purpose: Purpose, label: string, opts: { facing?: "back" | "front"; strict?: boolean } = {}) {
  const { current, session } = useProject(); const c = useColors();
  const [open, setOpen] = useState(false); const [ev, setEv] = useState<Evidence | null>(null);
  const [preview, setPreview] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const onShot = async (s: Shot) => {
    setOpen(false); setBusy(true); setErr(""); setPreview(s.uri);
    try {
      const e = await submitPhoto({ projectId: current!.project_id, userId: session!.user.id, uri: s.uri, capturedAt: s.capturedAt, fix: s.fix, purpose });
      if (!e) { setErr("No internet: the photo is saved on the phone. This entry needs a connection to be checked; try again when online."); setEv(null); }
      else if (opts.strict !== false && hardFlags(e).length) { setErr("Photo refused: " + hardFlags(e).map((f) => flagText[f] ?? f).join(", ")); setEv(null); }
      else setEv(e);
    } catch (e) { setErr(errText(e)); setEv(null); }
    setBusy(false);
  };
  const ui = (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.muted, fontWeight: "600" }}>{t(label)}</Text>
      {preview ? <Image source={{ uri: preview }} style={{ height: 160, borderRadius: 8 }} resizeMode="cover" /> : null}
      {ev ? <Text style={{ color: ev.flags.length ? c.warn : c.good }}>{ev.flags.length ? "Saved with notes: " + ev.flags.map((f) => flagText[f] ?? f).join(", ") : `✓ On site${ev.distance_m != null ? ` (${Math.round(ev.distance_m)} m)` : ""}`}</Text> : null}
      {err ? <Text style={{ color: c.bad }}>{err}</Text> : null}
      <Button title={preview ? "Retake" : "Take photo"} kind={preview ? "plain" : "primary"} busy={busy} onPress={() => setOpen(true)} />
      <LiveCamera visible={open} title={label} facing={opts.facing} onDone={onShot} onClose={() => setOpen(false)} />
    </View>
  );
  return { evidence: ev, ui, reset: () => { setEv(null); setPreview(null); setErr(""); } };
}
