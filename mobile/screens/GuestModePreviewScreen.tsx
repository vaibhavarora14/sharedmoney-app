import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Appbar, Button, Text, useTheme } from "react-native-paper";
import {
  GuestCleanupBanner,
  GuestDeviceLine,
  GuestMergeSheet,
  GuestSaveChip,
  GuestSignInSheet,
  GuestSnackbar,
} from "../components/guest/GuestChrome";
import { useThemePreference } from "../contexts/ThemePreferenceContext";
import { AuthScreen } from "./AuthScreen";
import { GuestNameScreen } from "./GuestNameScreen";
import { guestCleanupBanner, guestSignInCopy } from "../utils/guestMode";

function HomeShell({
  chip,
  banner,
  snack,
  children,
}: {
  chip?: boolean;
  banner?: { title: string; body: string } | null;
  snack?: React.ReactNode;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header style={{ backgroundColor: theme.colors.background }}>
        <Appbar.Content title="Groups" titleStyle={{ fontWeight: "bold" }} />
        {chip ? <GuestSaveChip onPress={() => setOpen(true)} /> : null}
      </Appbar.Header>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {banner ? (
          <GuestCleanupBanner title={banner.title} body={banner.body} onSignIn={() => setOpen(true)} />
        ) : null}
        {children}
      </ScrollView>
      {snack}
      <GuestSignInSheet
        visible={open}
        title={guestSignInCopy("chip", "2 groups and 6 expenses").title}
        body={guestSignInCopy("chip", "2 groups and 6 expenses").body}
        onClose={() => setOpen(false)}
        methods={{
          appleAvailable: false,
          whatsAppAvailable: false,
          onGoogle: () => undefined,
          onApple: () => undefined,
          onEmail: () => undefined,
          onWhatsApp: () => undefined,
        }}
      />
    </View>
  );
}

function SettlePill({ centered = false }: { centered?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        alignSelf: centered ? "center" : "flex-start",
        backgroundColor: theme.colors.primaryContainer,
        borderRadius: 20,
        paddingHorizontal: 16,
        minHeight: 44,
        justifyContent: "center",
        marginTop: centered ? 12 : 14,
        marginBottom: centered ? 0 : 8,
      }}
    >
      <Text style={{ fontWeight: "700", color: theme.colors.onPrimaryContainer }}>
        Settle up with someone
      </Text>
    </View>
  );
}

function PositionBlock() {
  const theme = useTheme();
  return (
    <View>
      <Text style={{ color: theme.colors.onSurfaceVariant }}>You're owed</Text>
      <Text style={{ fontSize: 40, fontWeight: "700", color: theme.colors.onSurface }}>₹1,850</Text>
      <Text style={{ color: theme.colors.onSurfaceVariant }}>Across 2 groups</Text>
    </View>
  );
}

function GroupRows() {
  const theme = useTheme();
  return (
    <View>
      <Text style={{ fontWeight: "700", color: theme.colors.onSurface }}>Goa trip</Text>
      <Text style={{ color: "#0B6B58", marginBottom: 12 }}>You're owed ₹2,400</Text>
      <Text style={{ fontWeight: "700", color: theme.colors.onSurface }}>Flat 4B</Text>
      <Text style={{ color: "#8E2A45" }}>You owe ₹550</Text>
    </View>
  );
}

/**
 * Design-review frames for guest mode. Open with
 * /app?preview=guest-mode&frame=g1&colorScheme=light
 * and EXPO_PUBLIC_GUEST_MODE=true. Names here are fixtures, not a person.
 */
export function GuestModePreviewScreen({ frame }: { frame: string | null }) {
  const { setThemePreference } = useThemePreference();
  const theme = useTheme();
  const [sheet, setSheet] = useState<"invite" | "export" | "keep" | null>(
    frame === "g5" ? "invite" : frame === "g6" ? "export" : frame === "g7" ? "keep" : null,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const scheme = new URLSearchParams(window.location.search).get("colorScheme");
    if (scheme === "light" || scheme === "dark") {
      void setThemePreference(scheme);
    }
  }, [setThemePreference]);

  if (frame === "g1" || !frame) {
    return <AuthScreen isSignUp={false} onToggleMode={() => undefined} />;
  }
  if (frame === "g2") {
    return <GuestNameScreen previewName="Alex" onPreviewContinue={() => undefined} />;
  }

  const copy = frame === "g5"
    ? guestSignInCopy("invite", "Rahul")
    : frame === "g6"
      ? guestSignInCopy("export", "Goa trip")
      : guestSignInCopy("chip", "2 groups and 6 expenses");

  if (frame === "g10") {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: 16 }}>
        <Text variant="headlineSmall" style={{ fontWeight: "700", marginBottom: 16 }}>Profile</Text>
        <Text variant="titleMedium" style={{ fontWeight: "700" }}>Alex</Text>
        <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12 }}>Not signed in</Text>
        <View style={{ borderWidth: 1, borderColor: theme.colors.outlineVariant, borderRadius: 12, padding: 16 }}>
          <Text style={{ fontWeight: "700" }}>Saved on this phone only</Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, marginVertical: 8 }}>
            Uninstalling or clearing the app loses access to your data. Sign in to keep it.
          </Text>
          <Button mode="contained">Sign in</Button>
        </View>
        <Text style={{ marginTop: 16 }}>Appearance</Text>
        <Text style={{ color: theme.colors.onSurfaceVariant }}>System</Text>
        <Text style={{ marginTop: 12 }}>Default currency</Text>
        <Text style={{ color: theme.colors.onSurfaceVariant }}>INR</Text>
        <Text style={{ marginTop: 12 }}>Help</Text>
        <Text style={{ marginTop: 24, color: theme.colors.error, fontWeight: "600" }}>Delete guest data</Text>
      </View>
    );
  }

  const activity = new Date("2025-11-16T00:00:00.000Z");
  const banner = guestCleanupBanner(activity, new Date("2025-12-31T00:00:00.000Z"));

  return (
    <View style={styles.fill}>
      <HomeShell
        chip={frame !== "g8"}
        banner={frame === "g11" ? banner : null}
        snack={frame === "g4" ? (
          <GuestSnackbar message="Saved on this phone only" actionLabel="Sign in" onAction={() => setSheet("keep")} />
        ) : frame === "g8" ? (
          <GuestSnackbar message="Signed in. Everything is kept." />
        ) : null}
      >
        {frame === "g3" ? (
          <View style={{ alignItems: "center", paddingTop: 80 }}>
            <Text style={{ color: theme.colors.onSurfaceVariant, textAlign: "center", marginBottom: 16 }}>
              Create a group for shared expenses.
            </Text>
            <Button mode="contained">Create a group</Button>
            <SettlePill centered />
            <Text style={{ marginTop: 16, color: theme.colors.onSurfaceVariant }}>Split one bill</Text>
            <GuestDeviceLine />
          </View>
        ) : (
          <>
            <PositionBlock />
            <SettlePill />
            <GroupRows />
          </>
        )}
      </HomeShell>
      <GuestSignInSheet
        visible={sheet !== null && frame !== "g9"}
        title={copy.title}
        body={copy.body}
        onClose={() => setSheet(null)}
        methods={{
          appleAvailable: false,
          whatsAppAvailable: false,
          onGoogle: () => undefined,
          onApple: () => undefined,
          onEmail: () => undefined,
          onWhatsApp: () => undefined,
        }}
      />
      <GuestMergeSheet
        visible={frame === "g9"}
        groups={[
          { name: "Goa trip" },
          { name: "Flat 4B (guest)", note: "Same name, kept separate" },
        ]}
        onBringIn={() => undefined}
        onDiscard={() => undefined}
        onRetry={() => undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
