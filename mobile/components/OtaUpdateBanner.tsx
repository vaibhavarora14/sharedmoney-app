import * as Updates from "expo-updates";
import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { ActivityIndicator, Icon, Text, useTheme } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WEB_MAX_WIDTH } from "../constants/layout";
import { logError } from "../utils/logger";
import { otaUpdateMessage, otaUpdateNotice } from "../utils/otaUpdateNotice";

/**
 * Non-blocking OTA status. Native already downloads on launch; this only
 * tells the user when that work is happening or when a restart will apply it.
 * Hidden when no compatible OTA can apply — store upgrades use ForceUpdateModal.
 */
export const OtaUpdateBanner: React.FC = () => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const updates = Updates.useUpdates();
  const [restarting, setRestarting] = useState(false);
  const [reloadFailed, setReloadFailed] = useState(false);

  const notice = otaUpdateNotice({
    isEnabled: Updates.isEnabled,
    platform: Platform.OS,
    isDownloading: updates.isDownloading,
    isUpdatePending: updates.isUpdatePending,
    downloadProgress: updates.downloadProgress,
    checkError: updates.checkError,
    downloadError: updates.downloadError,
    isUpdateAvailable: updates.isUpdateAvailable,
    lastCheckForUpdateTimeSinceRestart:
      updates.lastCheckForUpdateTimeSinceRestart,
    restartCount: updates.restartCount,
    reloadFailed,
    isEmergencyLaunch: updates.currentlyRunning?.isEmergencyLaunch,
  });
  const message = otaUpdateMessage(notice);

  if (!message) return null;

  const foreground = theme.colors.onSecondaryContainer;
  const canRestart = notice.kind === "ready" && !restarting;

  const handlePress = async () => {
    if (!canRestart) return;
    try {
      setRestarting(true);
      await Updates.reloadAsync();
    } catch (error) {
      setRestarting(false);
      setReloadFailed(true);
      logError(error, { context: "OtaUpdateBanner.reloadAsync" });
    }
  };

  return (
    <View
      pointerEvents="box-none"
      style={[styles.overlay, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}
    >
      <Pressable
        onPress={handlePress}
        disabled={!canRestart}
        style={[
          styles.banner,
          { backgroundColor: theme.colors.secondaryContainer },
        ]}
        accessibilityRole={canRestart ? "button" : "text"}
        accessibilityLabel={message}
        testID="ota-update-banner"
      >
        {notice.kind === "downloading" || restarting ? (
          <ActivityIndicator size={16} color={foreground} />
        ) : (
          <Icon source="cellphone-arrow-down" size={18} color={foreground} />
        )}
        <Text
          variant="bodyMedium"
          style={[styles.message, { color: foreground }]}
          numberOfLines={2}
        >
          {restarting ? "Restarting…" : message}
        </Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    alignItems: "center",
    zIndex: 900,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    width: "92%",
    maxWidth: Math.min(WEB_MAX_WIDTH - 32, 520),
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  message: {
    flex: 1,
  },
});
