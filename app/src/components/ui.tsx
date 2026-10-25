import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, useColorScheme } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// Buildiary's blue and amber
const colors = (dark: boolean) => (dark
  ? { bg: "#0f151c", panel: "#17202a", line: "#2b3744", ink: "#e6ebf0", muted: "#9eabb8", accent: "#f2b01e", bad: "#f08a72", good: "#5fd198", warn: "#f0b33a" }
  : { bg: "#eef1f4", panel: "#ffffff", line: "#d3dae1", ink: "#14202b", muted: "#5b6875", accent: "#1e3a5f", bad: "#b3402a", good: "#1c7148", warn: "#9a6500" });
export const useColors = () => colors(useColorScheme() === "dark");

export function Screen({ title, children, scroll = true }: { title: string; children: React.ReactNode; scroll?: boolean }) {
  const c = useColors();
  const body = <View style={{ padding: 16, gap: 12, width: "100%", maxWidth: 760, alignSelf: "center" }}>{children}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <Text style={[s.h1, { color: c.ink, width: "100%", maxWidth: 760, alignSelf: "center" }]}>{title}</Text>
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled">{body}</ScrollView> : body}
    </SafeAreaView>
  );
}

export function Button({ title, onPress, kind = "primary", disabled, busy }: { title: string; onPress: () => void; kind?: "primary" | "plain" | "danger"; disabled?: boolean; busy?: boolean }) {
  const c = useColors();
  const bg = kind === "primary" ? c.accent : kind === "danger" ? c.bad : c.panel;
  const fg = kind === "plain" ? c.ink : kind === "primary" && c.accent === "#f2b01e" ? "#1b1405" : "#fff";
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled || busy}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, borderColor: c.line, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }]}>
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, ...p }: TextInputProps & { label: string }) {
  const c = useColors();
  return (
    <View style={{ gap: 4 }}>
      <Text style={[s.label, { color: c.muted }]}>{label}</Text>
      <TextInput placeholderTextColor={c.muted} {...p} style={[s.input, { color: c.ink, borderColor: c.line, backgroundColor: c.panel }]} />
    </View>
  );
}

export function Banner({ text, kind = "info" }: { text: string; kind?: "info" | "bad" | "good" | "warn" }) {
  const c = useColors(); const col = kind === "bad" ? c.bad : kind === "good" ? c.good : kind === "warn" ? c.warn : c.accent;
  return <View style={[s.banner, { borderColor: col, backgroundColor: c.panel }]}><Text style={{ color: col, fontWeight: "600" }}>{text}</Text></View>;
}

const s = StyleSheet.create({
  h1: { fontSize: 24, fontWeight: "800", paddingHorizontal: 16, paddingTop: 12 },
  btn: { minHeight: 50, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, borderWidth: 1 },
  btnText: { fontSize: 16, fontWeight: "700" },
  label: { fontSize: 13, fontWeight: "600" },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, minHeight: 48, justifyContent: "center", fontSize: 16 },
  banner: { borderWidth: 1, borderRadius: 10, padding: 12, borderLeftWidth: 5 },
});
