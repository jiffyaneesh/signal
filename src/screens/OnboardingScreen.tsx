import { useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Body, Display, Label, SignalButton, TextField } from "../components/ui";
import { supabase } from "../lib/supabase";
import { brutalistShadow, colors, radius, space } from "../theme";

// Bundled hero art for the sign-up screen (voices/waveforms illustration).
const SIGNUP_ILLUSTRATION = require("../../assets/images/signup_illustration.png");

// Welcome + auth. Email/password sign up or log in. On success, AuthContext
// flips the navigator; new users with no username land on the Username step.
//
// Sign up and log in intentionally look different so the mode is obvious at a
// glance: sign up leads with the illustration + an inviting "join" framing,
// while log in is a stripped-back "welcome back" with a lime wordmark block.
export default function OnboardingScreen() {
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignup = mode === "signup";

  async function submit() {
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      const credentials = { email: email.trim(), password };
      const { error: authError } =
        isSignup
          ? await supabase.auth.signUp(credentials)
          : await supabase.auth.signInWithPassword(credentials);
      if (authError) setError(authError.message);
      // On success, onAuthStateChange in AuthContext drives navigation.
    } catch (e: unknown) {
      console.log(e);
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={["top"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            paddingHorizontal: space.containerPadding,
            paddingVertical: space.sectionMargin,
            gap: space.sectionMargin,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {isSignup ? <SignupHeader /> : <LoginHeader />}

          <View style={{ gap: 16 }}>
            <TextField
              placeholder="EMAIL"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              importantForAutofill="yes"
            />
            <TextField
              placeholder="PASSWORD"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password"
              importantForAutofill="yes"
            />

            {error && <Body style={{ color: colors.error }}>{error}</Body>}

            <SignalButton
              label={
                busy
                  ? "PLEASE WAIT…"
                  : isSignup
                    ? "START LISTENING"
                    : "LOG IN"
              }
              onPress={submit}
              disabled={busy}
            />

            <Pressable
              onPress={() => {
                setMode(isSignup ? "login" : "signup");
                setError(null);
              }}
              style={{ alignItems: "center", paddingVertical: 8 }}
            >
              <Label muted>
                {isSignup
                  ? "HAVE AN ACCOUNT? LOG IN"
                  : "NEW HERE? SIGN UP"}
              </Label>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Sign-up hero: illustration in a bordered brutalist frame, then an inviting
// "join" headline. Leads with imagery to feel like an entry point.
function SignupHeader() {
  return (
    <View style={{ gap: 28 }}>
      <Image
        source={SIGNUP_ILLUSTRATION}
        resizeMode="contain"
        style={{ width: "80%", alignSelf: "center", aspectRatio: 677 / 369 }}
      />
      <View style={{ gap: 12 }}>
        <Label muted>● NEW VOICE</Label>
        <Display style={{ fontSize: 52, lineHeight: 52 }}>JOIN THE{"\n"}SIGNAL</Display>
        <Body muted style={{ fontSize: 18 }}>
          30 seconds of pure voice. No feeds to scroll, no noise — just people.
        </Body>
      </View>
    </View>
  );
}

// Log-in header: no illustration. A lime wordmark block + "welcome back" copy —
// stripped back and unmistakably distinct from sign up.
function LoginHeader() {
  return (
    <View style={{ gap: 24 }}>
      <View
        style={[
          {
            backgroundColor: colors.signal,
            borderWidth: 2,
            borderColor: colors.ink,
            borderRadius: radius.lg,
            paddingVertical: 32,
            paddingHorizontal: 24,
          },
          brutalistShadow,
        ]}
      >
        <Display style={{ fontSize: 64, lineHeight: 62 }}>SIGNAL</Display>
      </View>
      <View style={{ gap: 8 }}>
        <Label muted>◆ RETURNING VOICE</Label>
        <Display style={{ fontSize: 36, lineHeight: 38 }}>WELCOME BACK</Display>
        <Body muted style={{ fontSize: 18 }}>
          Pick up where you left off.
        </Body>
      </View>
    </View>
  );
}
