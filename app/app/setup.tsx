import React, { useState } from "react";
import { Text } from "react-native";
import * as Location from "expo-location";
import { router } from "expo-router";
import { Banner, Button, Field, Screen } from "../src/components/ui";
import { useProject } from "../src/lib/project";
import { errText, supabase } from "../src/lib/supabase";

/** First run for an owner: create the organisation and the project. The creator becomes the owner. */
export default function Setup() {
  const { reload, choose } = useProject();
  const [f, setF] = useState({ org: "", name: "", address: "", start_date: "", months: "18", lat: "", lng: "", radius: "300", description: "" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const here = async () => {
    setErr("");
    const p = await Location.requestForegroundPermissionsAsync(); if (p.status !== "granted") return setErr("Allow location to use this.");
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
    setF({ ...f, lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) });
  };
  const save = async () => {
    setBusy(true); setErr("");
    const o = await supabase.from("organizations").insert({ name: f.org || f.name, kind: "client" }).select("id").single();
    if (o.error) { setErr(errText(o.error)); setBusy(false); return; }
    const p = await supabase.from("projects").insert({
      org_id: o.data.id, name: f.name, address: f.address || null, description: f.description || null, start_date: f.start_date || null,
      contract_months: Number(f.months) || 18, site_lat: f.lat ? Number(f.lat) : null, site_lng: f.lng ? Number(f.lng) : null, site_radius_m: Number(f.radius) || 300,
    }).select("id").single();
    if (p.error) { setErr(errText(p.error)); setBusy(false); return; }
    await reload(); choose(p.data.id); setBusy(false); router.replace("/register");
  };
  return (
    <Screen title="Set up your project">
      <Text>One project per site. You become its owner and can add staff logins afterwards.</Text>
      <Field label="Your name or company (client)" value={f.org} onChangeText={set("org")} />
      <Field label="Project name" value={f.name} onChangeText={set("name")} placeholder="e.g. Villa 31" />
      <Field label="Site address" value={f.address} onChangeText={set("address")} />
      <Field label="Short description for the AI (floors, area, features)" value={f.description} onChangeText={set("description")} multiline />
      <Field label="Contract start (YYYY-MM-DD)" value={f.start_date} onChangeText={set("start_date")} placeholder="2026-11-01" />
      <Field label="Contract period (months)" value={f.months} onChangeText={set("months")} keyboardType="number-pad" />
      <Text style={{ fontWeight: "700" }}>Site location — photos taken outside it are refused</Text>
      <Button title="Use my current location (stand on the plot)" kind="plain" onPress={here} />
      <Field label="Latitude" value={f.lat} onChangeText={set("lat")} keyboardType="decimal-pad" />
      <Field label="Longitude" value={f.lng} onChangeText={set("lng")} keyboardType="decimal-pad" />
      <Field label="Allowed radius (metres)" value={f.radius} onChangeText={set("radius")} keyboardType="number-pad" />
      {err ? <Banner kind="bad" text={err} /> : null}
      <Button title="Create project" onPress={save} busy={busy} disabled={!f.name || !f.lat || !f.lng} />
    </Screen>
  );
}
