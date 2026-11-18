import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Button, Text, useTheme } from "react-native-paper";

export function GuestSaveChip({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Save your data"
      onPress={onPress}
      testID="guest-save-chip"
      style={[styles.chip, { borderColor: theme.colors.outlineVariant }]}
    >
      <View style={[styles.dot, { backgroundColor: theme.colors.outline }]} />
      <Text style={{ color: theme.colors.onSurface, fontSize: 13, fontWeight: "600" }}>
        Save your data
      </Text>
    </Pressable>
  );
}

export function GuestDeviceLine() {
  const theme = useTheme();
  return (
    <Text
      testID="guest-device-line"
      style={{ color: theme.colors.onSurfaceVariant, fontSize: 13, marginTop: 28, textAlign: "center" }}
    >
      Saved on this phone only until you sign in.
    </Text>
  );
}

export function GuestSnackbar({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  const background = theme.dark ? "#E6ECF3" : "#2A3440";
  const foreground = theme.dark ? "#17202A" : "#F2F5FA";
  return (
    <View
      testID="guest-snackbar"
      style={[styles.snack, { backgroundColor: background }]}
    >
      <Text style={{ color: foreground, flex: 1, fontSize: 14 }}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction}>
          <Text style={{ color: theme.dark ? "#1F5EFF" : "#9DBBFF", fontWeight: "700" }}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function GuestCleanupBanner({
  title,
  body,
  onSignIn,
}: {
  title: string;
  body: string;
  onSignIn: () => void;
}) {
  const theme = useTheme();
  const background = theme.dark ? "#3A2E14" : "#FFF4E0";
  const ink = theme.dark ? "#FFE2A8" : "#6B4A00";
  return (
    <View testID="guest-cleanup-banner" style={[styles.warn, { backgroundColor: background }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: ink, fontWeight: "700", fontSize: 14 }}>{title}</Text>
        <Text style={{ color: ink, fontSize: 13, marginTop: 2 }}>{body}</Text>
      </View>
      <Pressable accessibilityRole="button" onPress={onSignIn}>
        <Text style={{ color: theme.colors.primary, fontWeight: "600" }}>Sign in</Text>
      </Pressable>
    </View>
  );
}

export interface GuestAuthMethods {
  appleAvailable: boolean;
  whatsAppAvailable: boolean;
  busy?: boolean;
  onGoogle: () => void;
  onApple: () => void;
  onEmail: () => void;
  onWhatsApp: () => void;
}

export function GuestAuthMethodStack({
  appleAvailable,
  whatsAppAvailable,
  busy,
  onGoogle,
  onApple,
  onEmail,
  onWhatsApp,
}: GuestAuthMethods) {
  return (
    <View style={{ gap: 12 }}>
      <Button mode="contained" icon="google" onPress={onGoogle} disabled={busy} testID="guest-continue-google">
        Continue with Google
      </Button>
      {appleAvailable ? (
        <Button mode="outlined" onPress={onApple} disabled={busy} testID="guest-continue-apple">
          Continue with Apple
        </Button>
      ) : null}
      <Button mode="outlined" icon="email" onPress={onEmail} disabled={busy} testID="guest-continue-email">
        Continue with email
      </Button>
      {whatsAppAvailable ? (
        <Button mode="outlined" icon="whatsapp" onPress={onWhatsApp} disabled={busy} testID="guest-continue-whatsapp">
          Continue with WhatsApp
        </Button>
      ) : null}
    </View>
  );
}

export function GuestSignInSheet({
  visible,
  title,
  body,
  onClose,
  methods,
}: {
  visible: boolean;
  title: string;
  body: string;
  onClose: () => void;
  methods: GuestAuthMethods;
}) {
  const theme = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Dismiss sign in" />
      <View style={[styles.sheet, { backgroundColor: theme.colors.surface }]} testID="guest-signin-sheet">
        <View style={[styles.handle, { backgroundColor: theme.colors.outline }]} />
        <Text variant="titleLarge" style={{ fontWeight: "700", marginBottom: 6 }}>{title}</Text>
        <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 18 }}>{body}</Text>
        <GuestAuthMethodStack {...methods} />
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.notNow}>
          <Text style={{ color: theme.colors.primary, fontWeight: "600", textAlign: "center" }}>Not now</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

export interface GuestMergeGroup {
  name: string;
  note?: string | null;
}

export function GuestMergeSheet({
  visible,
  groups,
  busy,
  failed,
  onBringIn,
  onDiscard,
  onRetry,
}: {
  visible: boolean;
  groups: GuestMergeGroup[];
  busy?: boolean;
  failed?: boolean;
  onBringIn: () => void;
  onDiscard: () => void;
  onRetry: () => void;
}) {
  const theme = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => undefined}>
      <View style={styles.scrim} />
      <View style={[styles.sheet, { backgroundColor: theme.colors.surface }]} testID="guest-merge-sheet">
        <View style={[styles.handle, { backgroundColor: theme.colors.outline }]} />
        <Text variant="titleLarge" style={{ fontWeight: "700", marginBottom: 6 }}>
          {failed ? "We couldn't move your guest data" : "You already have an account"}
        </Text>
        <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 16 }}>
          {failed
            ? "Nothing was lost. Your guest data is still here. Please try again."
            : "Bring this phone's data into it? Nothing in your account is changed or removed."}
        </Text>
        {failed ? null : (
          <ScrollView style={{ maxHeight: 180, marginBottom: 16 }}>
            <View style={[styles.list, { borderColor: theme.colors.outlineVariant }]}>
              {groups.map((group) => (
                <View key={group.name} style={[styles.listRow, { borderTopColor: theme.colors.outlineVariant }]}>
                  <Text style={{ fontWeight: "600", flex: 1 }}>{group.name}</Text>
                  {group.note ? (
                    <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12 }}>{group.note}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          </ScrollView>
        )}
        <Button
          mode="contained"
          onPress={failed ? onRetry : onBringIn}
          loading={busy}
          disabled={busy}
          testID="guest-bring-it-in"
        >
          {failed ? "Try again" : "Bring it in"}
        </Button>
        {failed ? null : (
          <Pressable accessibilityRole="button" onPress={onDiscard} disabled={busy} style={styles.notNow}>
            <Text style={{ color: theme.colors.error, fontWeight: "600", textAlign: "center" }}>
              Discard this phone's data
            </Text>
          </Pressable>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    marginRight: 8,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  snack: {
    marginHorizontal: 16,
    marginBottom: 12,
    minHeight: 48,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  warn: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 8,
    marginBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(17,23,29,0.32)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 28,
  },
  handle: {
    width: 32,
    height: 4,
    borderRadius: 2,
    opacity: 0.5,
    alignSelf: "center",
    marginBottom: 14,
  },
  notNow: { paddingVertical: 14 },
  list: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
