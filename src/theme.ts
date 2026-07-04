// Signal design tokens — pulled from the Stitch "Signal Voice Aesthetic" design system.
// High-Contrast Minimalism + Modern Brutalism. One lime accent per screen.

export const colors = {
  ink: "#1a1c1c", // on-background / borders / typography
  signal: "#ccff00", // primary-container — the single lime accent
  canvas: "#ffffff", // surface-container-lowest — primary white canvas
  surface: "#f9f9f9", // background
  surfaceContainer: "#eeeeee",
  surfaceContainerHigh: "#e8e8e8",
  surfaceContainerHighest: "#e2e2e2",
  onSurfaceVariant: "#444933",
  outlineVariant: "#c4c9ac",
  error: "#ba1a1a",
  errorContainer: "#ffdad6",
  onErrorContainer: "#93000a",
  white: "#ffffff",
};

// Loaded font family keys (see useFonts in App.js)
export const fonts = {
  display: "Bricolage_800ExtraBold", // oversized headlines
  displayBold: "Bricolage_700Bold",
  body: "Hanken_400Regular",
  bodyMedium: "Hanken_500Medium",
  mono: "JetBrainsMono_600SemiBold", // timestamps, labels, durations
};

export const radius = {
  md: 12,
  lg: 16,
  full: 9999,
};

export const space = {
  unit: 8,
  elementGap: 24,
  containerPadding: 32,
  sectionMargin: 48,
};

// Brutalist offset shadow: solid ink block down-right, no blur.
export const brutalistShadow = {
  shadowColor: colors.ink,
  shadowOffset: { width: 4, height: 4 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 8,
};

// Same offset shadow, minus `elevation`. Use where the shadow toggles on an
// interactive/focused view: changing Android `elevation` recreates the native
// view (dropping TextInput focus + flickering the keyboard). iOS shadow props
// are safe to toggle; Android just shows no shadow, which is acceptable.
export const iosFocusShadow = {
  shadowColor: colors.ink,
  shadowOffset: { width: 4, height: 4 },
  shadowOpacity: 1,
  shadowRadius: 0,
};

// The 6 allowed reaction emojis (per spec). `as const` so the element type is a
// string-literal union (see ReactionEmoji in types.ts), not plain string.
export const REACTION_EMOJIS = ["🔥", "💙", "🤝", "😂", "💀", "🤯"] as const;
