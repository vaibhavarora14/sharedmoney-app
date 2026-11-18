import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Appbar, Button, Text, TextInput, useTheme } from "react-native-paper";
import { useAuth } from "../contexts/AuthContext";
import { useProfile } from "../hooks/useProfile";
import { openAppExternalUrl } from "../utils/openAppExternalUrl";

const TERMS_URL = "https://sharedmoney.app/terms";
const PRIVACY_URL = "https://sharedmoney.app/privacy";

export function GuestNameScreen({
  previewName,
  onPreviewContinue,
}: {
  previewName?: string;
  onPreviewContinue?: () => void;
} = {}) {
  const theme = useTheme();
  const { signOut } = useAuth();
  const { updateProfile, updateProfileLoading } = useProfile();
  const [name, setName] = useState(previewName ?? "");
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  const continueOn = async () => {
    if (trimmed.length < 1) {
      setError("Enter the name your friends use.");
      return;
    }
    if (onPreviewContinue) {
      onPreviewContinue();
      return;
    }
    try {
      await updateProfile({
        full_name: trimmed,
        accept_terms: true,
        profile_completed: true,
      });
    } catch {
      setError("Couldn't save your name. Please try again.");
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header style={{ backgroundColor: theme.colors.background }}>
        <Appbar.BackAction accessibilityLabel="Back" onPress={() => { void signOut(); }} />
      </Appbar.Header>
      <View style={styles.body}>
        <Text variant="headlineSmall" style={styles.title}>
          What should your friends call you?
        </Text>
        <TextInput
          label="Your name"
          value={name}
          onChangeText={(value) => {
            setName(value);
            setError(null);
          }}
          mode="outlined"
          autoCapitalize="words"
          autoFocus
          testID="guest-name-input"
        />
        <Text style={[styles.terms, { color: theme.colors.onSurfaceVariant }]}>
          By continuing you agree to the{" "}
          <Text style={{ color: theme.colors.primary, fontWeight: "600" }} onPress={() => { void openAppExternalUrl(TERMS_URL); }}>
            Terms
          </Text>
          {" "}and{" "}
          <Text style={{ color: theme.colors.primary, fontWeight: "600" }} onPress={() => { void openAppExternalUrl(PRIVACY_URL); }}>
            Privacy Policy
          </Text>
          .
        </Text>
        {error ? <Text style={{ color: theme.colors.error, marginBottom: 8 }}>{error}</Text> : null}
        <Button
          mode="contained"
          onPress={() => { void continueOn(); }}
          loading={updateProfileLoading}
          disabled={updateProfileLoading || trimmed.length < 1}
          testID="guest-name-continue"
        >
          Continue
        </Button>
        <Pressable accessibilityRole="button" onPress={() => { void signOut(); }} style={{ marginTop: 8 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 12 },
  title: { fontWeight: "700", marginBottom: 24 },
  terms: { fontSize: 13, lineHeight: 18, marginTop: 4, marginBottom: 20 },
});
