import React, { useEffect } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Appbar, Surface, Text, useTheme } from "react-native-paper";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { InvitePromptDialog } from "../components/InvitePromptDialog";
import { useThemePreference } from "../contexts/ThemePreferenceContext";

const PREVIEW_SAFE_AREA = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/**
 * Design-review frame for the first-expense invite prompt.
 * Open with /app?preview=invite-prompt&colorScheme=light (or dark).
 */
export function InvitePromptPreviewScreen() {
  const theme = useTheme();
  const { setThemePreference } = useThemePreference();

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const scheme = params.get("colorScheme") ??
      (/[?&#]theme=dark/i.test(window.location.href) ? "dark" : null);
    if (scheme === "light" || scheme === "dark") {
      void setThemePreference(scheme);
    }
  }, [setThemePreference]);

  return (
    <SafeAreaProvider initialMetrics={PREVIEW_SAFE_AREA}>
      <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
        <Appbar.Header style={{ backgroundColor: theme.colors.background }}>
          <Appbar.BackAction accessibilityLabel="Navigate back" />
          <Appbar.Content title="Flat 4B" titleStyle={{ fontWeight: "bold" }} />
        </Appbar.Header>
        <View style={styles.body}>
          <Surface
            style={[styles.card, { backgroundColor: theme.colors.surface }]}
            elevation={0}
          >
            <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>
              Groceries
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              You paid ₹840
            </Text>
          </Surface>
        </View>
        <InvitePromptDialog
          visible
          groupName="Flat 4B"
          amount={840}
          currency="INR"
          bottomInset={PREVIEW_SAFE_AREA.insets.bottom}
          onShare={() => undefined}
          onDismiss={() => undefined}
        />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  body: {
    padding: 16,
  },
  card: {
    borderRadius: 16,
    padding: 16,
    gap: 4,
  },
});
