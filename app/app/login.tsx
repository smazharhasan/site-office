import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Banner, Button, Field, useColors } from "../src/components/ui";
import { errText, supabase } from "../src/lib/supabase";
import { getLang, setLang, t } from "../src/lib/i18n";

/**
 * Staff sign in with the email and password the owner gave them.
 * The owner creates their own account once with "I'm the owner — create my account".
 */
export default function Login() {
  const c = useColors(); const [, force] = useState(0);
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [name, setName] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ k: "bad" | "good"; t: string } | null>(null);
  const go = async () => {
    setBusy(true); setMsg(null);
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
      if (error) setMsg({ k: "bad", t: /Invalid login/i.test(error.message) ? "Wrong email or password." : errText(error) }); else router.replace("/");
    } else {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password: pw, options: { data: { full_name: name }, emailRedirectTo: "https://smazharhasan.github.io/site-office/" } });
      if (error) setMsg({ k: "bad", t: errText(error) });
      else if (!data.session) setMsg({ k: "good", t: "Account created. Open the confirmation email we just sent, then come back and sign in." });
      else router.replace("/");
    }
    setBusy(false);
  };
  const ur = getLang() === "ur";
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 20, gap: 16, width: "100%", maxWidth: 460, alignSelf: "center" }} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => setLang(ur ? "en" : "ur").then(() => force((x) => x + 1))} style={{ alignSelf: "flex-end", paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: c.line, backgroundColor: c.panel }}>
            <Text style={{ color: c.ink, fontWeight: "600" }}>{ur ? "English" : "اردو"}</Text>
          </Pressable>
          <View style={{ alignItems: "center", gap: 6, marginBottom: 8 }}>
            <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "#fff", fontSize: 36, fontWeight: "800" }}>M</Text>
            </View>
            <Text style={{ color: c.ink, fontSize: 28, fontWeight: "800", marginTop: 6 }}>{ur ? "معمار" : "Mimaar"}</Text>
            <Text style={{ color: c.muted, textAlign: "center" }}>{t("Construction site office")}</Text>
          </View>
          <View style={{ backgroundColor: c.panel, borderRadius: 20, padding: 18, gap: 14, borderWidth: 1, borderColor: c.line }}>
            <Text style={{ color: c.ink, fontSize: 18, fontWeight: "700" }}>{t(mode === "in" ? "Sign in" : "Create the owner's account")}</Text>
            <Text style={{ color: c.muted }}>{t(mode === "in" ? "Sign in with the email and password the owner gave you." : "You'll set up the project next and add your staff from inside the app.")}</Text>
            {mode === "up" ? <Field label="Your full name" value={name} onChangeText={setName} /> : null}
            <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
            <Field label="Password" value={pw} onChangeText={setPw} secureTextEntry autoComplete={mode === "in" ? "current-password" : "new-password"} />
            {msg ? <Banner kind={msg.k} text={msg.t} /> : null}
            <Button title={mode === "in" ? "Sign in" : "Create account"} onPress={go} busy={busy} disabled={!email.includes("@") || pw.length < (mode === "up" ? 8 : 1) || (mode === "up" && !name)} />
          </View>
          <Button title={mode === "in" ? "I'm the owner — create my account" : "I already have an account"} kind="plain" onPress={() => { setMode(mode === "in" ? "up" : "in"); setMsg(null); }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
