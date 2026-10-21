import Constants from "expo-constants";
import React, { useEffect, useRef, useState } from "react";
import {
  Clipboard,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import {
  Button,
  Text,
  useTheme,
} from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { recordCrash } from "../utils/crashSession";
import { logError } from "../utils/logger";
import { buildCrashSupportEmailUrl } from "../utils/supportEmail";

/**
 * Cleared crash screen for the root ErrorBoundary.
 *
 * Saved expenses live on the server — there is no offline write/outbox for
 * expense edits — so "Your saved expenses are safe" is literally true.
 * In-progress form typing is not "saved" and may need re-entering after Reload.
 *
 * Never render raw error messages or stack traces here.
 */
export type CrashErrorFallbackPreview = {
  supportReferenceId: string | null;
  copiedVisible?: boolean;
};

export function CrashErrorFallback({
  error,
  resetErrorBoundary,
  /** __DEV__ screenshot helper — skips Sentry/session recording. */
  preview,
}: {
  error: unknown;
  resetErrorBoundary: () => void;
  preview?: CrashErrorFallbackPreview;
}) {
  const theme = useTheme();
  const reportedRef = useRef(false);
  const [supportReferenceId, setSupportReferenceId] = useState<string | null>(
    preview?.supportReferenceId ?? null,
  );
  const [reloading, setReloading] = useState(false);
  const [copiedVisible, setCopiedVisible] = useState(
    preview?.copiedVisible ?? false,
  );

  useEffect(() => {
    if (preview) return;
    if (reportedRef.current) return;
    reportedRef.current = true;

    const record = recordCrash();
    setSupportReferenceId(record.supportReferenceId);

    const err = error instanceof Error ? error : new Error(String(error));
    logError(err, {
      source: "CrashErrorFallback",
      support_reference_id: record.supportReferenceId,
      crash_number: record.crashNumber,
      tags: record.supportReferenceId
        ? { support_reference_id: record.supportReferenceId }
        : undefined,
    });
  }, [error, preview]);

  const appVersion = Constants.expoConfig?.version ?? "unknown";
  const platform = Platform.OS;

  const handleReload = () => {
    if (reloading) return;
    setReloading(true);
    // Let the spinner paint before remounting the tree.
    requestAnimationFrame(() => {
      resetErrorBoundary();
    });
  };

  const handleCopyReference = async () => {
    if (!supportReferenceId) return;
    try {
      if (
        Platform.OS === "web" &&
        typeof navigator !== "undefined" &&
        navigator.clipboard?.writeText
      ) {
        await navigator.clipboard.writeText(supportReferenceId);
      } else {
        Clipboard.setString(supportReferenceId);
      }
      setCopiedVisible(true);
      setTimeout(() => setCopiedVisible(false), 2000);
    } catch {
      // Soft-fail: still show the ID on screen for manual copy.
    }
  };

  const handleContactSupport = async () => {
    if (!supportReferenceId) return;
    const mailtoUrl = buildCrashSupportEmailUrl({
      supportReferenceId,
      appVersion,
      platform,
    });
    try {
      await Linking.openURL(mailtoUrl);
    } catch {
      // Mail compose may be unavailable on some sims; ID stays on screen.
    }
  };

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: theme.colors.background }]}
      edges={["top", "bottom", "left", "right"]}
      testID="crash-error-fallback"
    >
      <View style={styles.content}>
        <Text
          variant="headlineSmall"
          style={[styles.wordmark, { color: theme.colors.onBackground }]}
          accessibilityRole="header"
          accessibilityLabel="SharedMoney"
        >
          SharedMoney
        </Text>

        <Text
          variant="titleLarge"
          style={[styles.title, { color: theme.colors.onBackground }]}
        >
          Something went wrong
        </Text>

        <Text
          variant="bodyLarge"
          style={[styles.body, { color: theme.colors.onSurfaceVariant }]}
        >
          Your saved expenses are safe. Reload to pick up where you left off.
        </Text>

        {supportReferenceId ? (
          <Pressable
            onPress={() => void handleCopyReference()}
            accessibilityRole="button"
            accessibilityLabel={`Support reference ${supportReferenceId}. Tap to copy.`}
            testID="crash-support-reference"
            style={[
              styles.referencePill,
              { backgroundColor: theme.colors.surfaceVariant },
            ]}
          >
            <Text
              style={[
                styles.referenceText,
                { color: theme.colors.onSurfaceVariant },
              ]}
            >
              {supportReferenceId}
            </Text>
          </Pressable>
        ) : null}

        <Button
          mode="contained"
          onPress={handleReload}
          disabled={reloading}
          loading={reloading}
          style={styles.reload}
          contentStyle={styles.reloadContent}
          testID="crash-reload"
          accessibilityLabel={reloading ? "Reloading" : "Reload"}
        >
          Reload
        </Button>

        {supportReferenceId ? (
          <Pressable
            onPress={() => void handleContactSupport()}
            accessibilityRole="link"
            accessibilityLabel="Contact support"
            testID="crash-contact-support"
            style={styles.contactLink}
          >
            <Text
              variant="bodyMedium"
              style={{ color: theme.colors.primary, textAlign: "center" }}
            >
              Contact support
            </Text>
          </Pressable>
        ) : null}
      </View>

      {copiedVisible ? (
        <View
          pointerEvents="none"
          style={[
            styles.copiedToast,
            { backgroundColor: theme.colors.inverseSurface },
          ]}
          testID="crash-copied-toast"
          accessibilityLiveRegion="polite"
        >
          <Text style={{ color: theme.colors.inverseOnSurface }}>Copied</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 28,
    gap: 12,
  },
  wordmark: {
    fontWeight: "700",
    letterSpacing: -0.3,
    marginBottom: 8,
    textAlign: "center",
  },
  title: {
    fontWeight: "600",
    textAlign: "center",
  },
  body: {
    textAlign: "center",
    lineHeight: 24,
    maxWidth: 340,
    marginBottom: 8,
  },
  referencePill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    marginTop: 4,
    marginBottom: 4,
  },
  referenceText: {
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace",
    }),
    fontSize: 15,
    letterSpacing: 0.5,
  },
  reload: {
    marginTop: 12,
    minWidth: 200,
    borderRadius: 24,
  },
  reloadContent: {
    height: 48,
  },
  contactLink: {
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  copiedToast: {
    position: "absolute",
    alignSelf: "center",
    bottom: 40,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
  },
});
