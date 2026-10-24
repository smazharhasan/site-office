import Constants from "expo-constants";
import React, { useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, useColorScheme } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { t } from "../lib/i18n";

export const palette = (dark: boolean) => dark
  ? { bg: "#141615", panel: "#1c1f1d", line: "#343835", ink: "#e7e8e4", muted: "#9da19a", accent: "#4fbf9f", bad: "#f2867c", good: "#7cc97f", warn: "#f0b04f" }
  : { bg: "#f3f2ef", panel: "#ffffff", line: "#d9d6cf", ink: "#1d2021", muted: "#62655f", accent: "#0f6f5c", bad: "#b3261e", good: "#2f7d32", warn: "#a35d00" };
// the Mabni app uses its own blue and amber; the Mimaar apps keep their green
const MABNI = ((Constants.expoConfig?.extra || {}) as { variant?: string }).variant === "mabni";
const mabni = (dark: boolean) => (dark
  ? { bg: "#0f151c", panel: "#17202a", line: "#2b3744", ink: "#e6ebf0", muted: "#9eabb8", accent: "#f2b01e", bad: "#f08a72", good: "#5fd198", warn: "#f0b33a" }
  : { bg: "#eef1f4", panel: "#ffffff", line: "#d3dae1", ink: "#14202b", muted: "#5b6875", accent: "#1e3a5f", bad: "#b3402a", good: "#1c7148", warn: "#9a6500" });
export const useColors = () => (MABNI ? mabni(useColorScheme() === "dark") : palette(useColorScheme() === "dark"));

export function Screen({ title, children, scroll = true }: { title: string; children: React.ReactNode; scroll?: boolean }) {
  const c = useColors();
  const body = <View style={{ padding: 16, gap: 12, width: "100%", maxWidth: 760, alignSelf: "center" }}>{children}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <Text style={[s.h1, { color: c.ink, width: "100%", maxWidth: 760, alignSelf: "center" }]}>{t(title)}</Text>
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled">{body}</ScrollView> : body}
    </SafeAreaView>
  );
}

export function Button({ title, onPress, kind = "primary", disabled, busy }: { title: string; onPress: () => void; kind?: "primary" | "plain" | "danger"; disabled?: boolean; busy?: boolean }) {
  const c = useColors();
  const bg = kind === "primary" ? c.accent : kind === "danger" ? c.bad : c.panel;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled || busy}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, borderColor: c.line, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }]}>
      {busy ? <ActivityIndicator color={kind === "plain" ? c.ink : "#fff"} /> : <Text style={[s.btnText, { color: kind === "plain" ? c.ink : "#fff" }]}>{t(title)}</Text>}
    </Pressable>
  );
}

export function Field({ label, ...p }: TextInputProps & { label: string }) {
  const c = useColors();
  return (
    <View style={{ gap: 4 }}>
      <Text style={[s.label, { color: c.muted }]}>{t(label)}</Text>
      <TextInput placeholderTextColor={c.muted} {...p} style={[s.input, { color: c.ink, borderColor: c.line, backgroundColor: c.panel }]} />
    </View>
  );
}

export interface Opt { value: string; label: string; sub?: string; disabled?: boolean }
export function Select({ label, value, options, onChange, placeholder = "Choose…" }: { label: string; value: string | null; options: Opt[]; onChange: (v: string) => void; placeholder?: string }) {
  const c = useColors(); const [open, setOpen] = useState(false); const [q, setQ] = useState("");
  const cur = options.find((o) => o.value === value);
  const shown = options.filter((o) => !q || (o.label + " " + (o.sub ?? "")).toLowerCase().includes(q.toLowerCase()));
  return (
    <View style={{ gap: 4 }}>
      <Text style={[s.label, { color: c.muted }]}>{t(label)}</Text>
      <Pressable onPress={() => setOpen(true)} style={[s.input, { borderColor: c.line, backgroundColor: c.panel }]}>
        <Text style={{ color: cur ? c.ink : c.muted }}>{cur ? cur.label : t(placeholder)}</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: c.bg, padding: 16, gap: 8 }}>
          <Text style={[s.h2, { color: c.ink }]}>{t(label)}</Text>
          {options.length > 8 && <TextInput placeholder="Search" value={q} onChangeText={setQ} placeholderTextColor={c.muted} style={[s.input, { color: c.ink, borderColor: c.line }]} />}
          <FlatList data={shown} keyExtractor={(o) => o.value} renderItem={({ item }) => (
            <Pressable disabled={item.disabled} onPress={() => { onChange(item.value); setOpen(false); }} style={[s.row, { borderColor: c.line, opacity: item.disabled ? 0.4 : 1 }]}>
              <Text style={{ color: c.ink, fontWeight: "600" }}>{item.label}</Text>
              {item.sub ? <Text style={{ color: c.muted }}>{item.sub}</Text> : null}
            </Pressable>)} />
          <Button title="Cancel" kind="plain" onPress={() => setOpen(false)} />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

export function Banner({ text, kind = "info" }: { text: string; kind?: "info" | "bad" | "good" | "warn" }) {
  const c = useColors(); const col = kind === "bad" ? c.bad : kind === "good" ? c.good : kind === "warn" ? c.warn : c.accent;
  return <View style={[s.banner, { borderColor: col, backgroundColor: c.panel }]}><Text style={{ color: col, fontWeight: "600" }}>{t(text)}</Text></View>;
}

export function Card({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return <View style={[s.card, { backgroundColor: c.panel, borderColor: c.line }]}>{children}</View>;
}

const s = StyleSheet.create({
  h1: { fontSize: 24, fontWeight: "800", paddingHorizontal: 16, paddingTop: 12 },
  h2: { fontSize: 18, fontWeight: "700" },
  btn: { minHeight: 50, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, borderWidth: 1 },
  btnText: { fontSize: 16, fontWeight: "700" },
  label: { fontSize: 13, fontWeight: "600" },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, minHeight: 48, justifyContent: "center", fontSize: 16 },
  row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
  banner: { borderWidth: 1, borderRadius: 10, padding: 12, borderLeftWidth: 5 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 6 },
});
