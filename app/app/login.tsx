import React, { useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import { Banner, Button, Field, Screen } from "../src/components/ui";
import { errText, supabase } from "../src/lib/supabase";

/**
 * Staff sign in with the email and password the owner gave them.
 * The owner creates their own account once with "I'm the owner — create my account".
 */
export default function Login() {
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
  return (
    <Screen title="Site Office">
      <Text>{mode === "in" ? "Sign in with the email and password the owner gave you." : "Create the owner's account. You'll set up the project next and add your staff from inside the app."}</Text>
      {mode === "up" ? <Field label="Your full name" value={name} onChangeText={setName} /> : null}
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Field label="Password" value={pw} onChangeText={setPw} secureTextEntry autoComplete={mode === "in" ? "current-password" : "new-password"} />
      {msg ? <Banner kind={msg.k} text={msg.t} /> : null}
      <Button title={mode === "in" ? "Sign in" : "Create account"} onPress={go} busy={busy} disabled={!email.includes("@") || pw.length < (mode === "up" ? 8 : 1) || (mode === "up" && !name)} />
      <Button title={mode === "in" ? "I'm the owner — create my account" : "I already have an account"} kind="plain" onPress={() => { setMode(mode === "in" ? "up" : "in"); setMsg(null); }} />
    </Screen>
  );
}
