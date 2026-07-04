import {
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
  useFonts as useBricolage,
} from "@expo-google-fonts/bricolage-grotesque";
import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
} from "@expo-google-fonts/hanken-grotesk";
import { JetBrainsMono_600SemiBold } from "@expo-google-fonts/jetbrains-mono";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "../src/context/AuthContext";
import { colors } from "../src/theme";

// Keep the native splash screen visible until fonts and auth state are loaded.
SplashScreen.preventAutoHideAsync().catch(() => {});

// expo-router replaces the React Navigation containers/navigators. The root
// layout supplies the same providers App.js used, then renders a guarded Stack.
export default function RootLayout() {
  const [fontsLoaded] = useFonts();

  if (!fontsLoaded) return <Splash />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="dark" />
          <RootStack />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Auth-gated stack. Three mutually-exclusive guards mirror the old
// RootNavigator/AuthNavigator split. A screen lives in exactly one active group
// at a time; failing a guard redirects to the anchor (index), which re-routes.
function RootStack() {
  const { session, needsUsername, loading } = useAuth();

  useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [loading]);

  if (loading) return <Splash />;

  const isAuthed = !!session;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Anchor: always present, redirects to the correct group. */}
      <Stack.Screen name="index" />

      {/* Logged out → onboarding only. */}
      <Stack.Protected guard={!isAuthed}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>

      {/* Authed but no username → forced to username setup. */}
      <Stack.Protected guard={isAuthed && needsUsername}>
        <Stack.Screen name="username" />
      </Stack.Protected>

      {/* Authed with a username → the app. */}
      <Stack.Protected guard={isAuthed && !needsUsername}>
        <Stack.Screen name="feed" />
        <Stack.Screen name="search" />
        <Stack.Screen name="my-notes" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="user/[id]" />
        <Stack.Screen name="follows" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="settings" />
        <Stack.Screen
          name="record"
          options={{
            presentation: "fullScreenModal",
            animation: "slide_from_bottom",
          }}
        />
      </Stack.Protected>
    </Stack>
  );
}

function Splash() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.canvas,
      }}
    >
      <ActivityIndicator color={colors.ink} size="large" />
    </View>
  );
}

// Combine all three font families into one hook (unchanged from App.js).
function useFonts() {
  return useBricolage({
    // Register under the short names the theme already references.
    Bricolage_700Bold: BricolageGrotesque_700Bold,
    Bricolage_800ExtraBold: BricolageGrotesque_800ExtraBold,
    HankenGrotesk_400Regular,
    HankenGrotesk_500Medium,
    JetBrainsMono_600SemiBold,
  });
}
