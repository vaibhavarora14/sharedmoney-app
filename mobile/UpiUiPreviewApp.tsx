/**
 * Local design-review preview for Pay via UPI Profile + settle states.
 *
 *   EXPO_PUBLIC_UPI_UI_PREVIEW=profile-empty|profile-filled|profile-invalid|settle-with-upi|settle-no-upi|settle-confirm|settle-ios-picker|settle-desktop-qr \
 *   npx expo start --web --port 8081
 *
 * Never set in Production store/OTA builds.
 */
import React, { useMemo, useState } from "react";
import { Platform, useWindowDimensions, View } from "react-native";
import {
  PaperProvider,
  Text,
  TextInput,
  useTheme,
} from "react-native-paper";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettlementFormScreen } from "./screens/SettlementFormScreen";
import { lightTheme } from "./theme";
import {
  getOptionalUpiIdFormatError,
  UPI_APPS,
  UPI_ID_PROFILE_HELPER,
} from "./utils/upi";

type PreviewKind =
  | "profile-empty"
  | "profile-filled"
  | "profile-invalid"
  | "settle-with-upi"
  | "settle-no-upi"
  | "settle-confirm"
  | "settle-ios-picker"
  | "settle-desktop-qr";

const PREVIEW_KINDS: PreviewKind[] = [
  "profile-empty",
  "profile-filled",
  "profile-invalid",
  "settle-with-upi",
  "settle-no-upi",
  "settle-confirm",
  "settle-ios-picker",
  "settle-desktop-qr",
];

function resolvePreview(): PreviewKind {
  let raw = process.env.EXPO_PUBLIC_UPI_UI_PREVIEW?.trim() || "";
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const fromQuery = new URLSearchParams(window.location.search).get("upiPreview");
    if (fromQuery) raw = fromQuery;
  }
  if (!raw) raw = "settle-with-upi";
  return (PREVIEW_KINDS.includes(raw as PreviewKind) ? raw : "settle-with-upi") as PreviewKind;
}

function ProfileUpiPreview({ kind }: { kind: PreviewKind }) {
  const theme = useTheme();
  const initial =
    kind === "profile-filled"
      ? "maya@okhdfc"
      : kind === "profile-invalid"
        ? "not a vpa"
        : "";
  const [upiId, setUpiId] = useState(initial);
  const [upiIdError, setUpiIdError] = useState(
    kind === "profile-invalid" ? getOptionalUpiIdFormatError(initial) || "" : "",
  );

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.background,
        padding: 16,
        paddingTop: 48,
        maxWidth: 600,
        width: "100%",
        alignSelf: "center",
      }}
      testID="upi-profile-preview"
    >
      <Text
        variant="headlineSmall"
        style={{ fontWeight: "bold", marginBottom: 16, color: theme.colors.onSurface }}
      >
        Edit Profile
      </Text>
      <TextInput
        label="UPI ID"
        value={upiId}
        onChangeText={(value) => {
          setUpiId(value);
          setUpiIdError(getOptionalUpiIdFormatError(value) || "");
        }}
        mode="outlined"
        error={!!upiIdError}
        left={<TextInput.Icon icon="bank" />}
        autoCapitalize="none"
        autoCorrect={false}
        testID="profile-upi-id-input"
        accessibilityHint={UPI_ID_PROFILE_HELPER}
      />
      {upiIdError ? (
        <Text
          variant="bodySmall"
          style={{ color: theme.colors.error, marginTop: 8 }}
          testID="profile-upi-id-error"
        >
          {upiIdError}
        </Text>
      ) : (
        <Text
          variant="bodySmall"
          style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}
          testID="profile-upi-id-helper"
        >
          {UPI_ID_PROFILE_HELPER}
        </Text>
      )}
    </View>
  );
}

function SettlePreview({ kind }: { kind: PreviewKind }) {
  const hasUpi = kind !== "settle-no-upi";
  const balanceAmount = kind === "settle-no-upi" ? -40 : -120.5;
  const currency = "INR";

  return (
    <SettlementFormScreen
      visible
      balance={{
        user_id: "payee-user",
        participant_id: "payee-participant",
        full_name: "Maya Kapoor",
        amount: balanceAmount,
        currency,
      }}
      groupMembers={[
        {
          id: "gm-you",
          group_id: "preview-group",
          user_id: "you-user",
          participant_id: "you-participant",
          full_name: "You",
          email: "you@example.com",
          role: "member",
          status: "active",
          joined_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "gm-maya",
          group_id: "preview-group",
          user_id: "payee-user",
          participant_id: "payee-participant",
          full_name: "Maya Kapoor",
          email: "maya@example.com",
          role: "member",
          status: "active",
          joined_at: "2026-01-01T00:00:00.000Z",
        },
      ]}
      participants={[
        {
          id: "you-participant",
          group_id: "preview-group",
          user_id: "you-user",
          full_name: "You",
          email: "you@example.com",
          type: "member",
        },
        {
          id: "payee-participant",
          group_id: "preview-group",
          user_id: "payee-user",
          full_name: "Maya Kapoor",
          email: "maya@example.com",
          type: "member",
        },
      ]}
      currentUserId="you-user"
      groupId="preview-group"
      groupName="Goa Trip"
      defaultCurrency={currency}
      previewPayeeUpiId={hasUpi ? "maya@okhdfc" : null}
      previewUpiPhase={kind === "settle-confirm" ? "confirm" : undefined}
      previewShowUpiAppPicker={kind === "settle-ios-picker"}
      previewInstalledUpiApps={
        kind === "settle-ios-picker" ? [...UPI_APPS] : undefined
      }
      previewForceDesktopWeb={kind === "settle-desktop-qr"}
      onSave={async () => {}}
      onDismiss={() => {}}
    />
  );
}

export default function UpiUiPreviewApp() {
  const theme = useMemo(() => lightTheme, []);
  const kind = resolvePreview();
  const queryClient = useMemo(() => new QueryClient(), []);
  const { width } = useWindowDimensions();
  const isProfile = kind.startsWith("profile-");

  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <QueryClientProvider client={queryClient}>
          <View
            style={{
              flex: 1,
              backgroundColor: theme.colors.background,
              // Frame note for Design: Platform + width stamped in testID.
            }}
            testID={`upi-preview-${kind}-${Platform.OS}-${Math.round(width)}`}
          >
            {isProfile ? (
              <ProfileUpiPreview kind={kind} />
            ) : (
              <SettlePreview kind={kind} />
            )}
          </View>
        </QueryClientProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
