import * as Updates from "expo-updates";
import React, { useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, View } from "react-native";
import { ActivityIndicator, Icon, Text, useTheme } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WEB_MAX_WIDTH } from "../constants/layout";
import { storeUrlForPlatform } from "../constants/storeUrls";
import { logError } from "../utils/logger";
import { otaUpdateMessage, otaUpdateNotice } from "../utils/otaUpdateNotice";

/**
 * Non-blocking OTA status. Native already downloads on launch; this only
 * tells the user when that work is happening, when a restart will apply it,
 * or when they need a store binary instead of another OTA retry.
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
  const message = otaUpdateMessage(notice, Platform.OS);

  if (!message) return null;

  const isStoreRequired = notice.kind === "storeRequired";
  const foreground = isStoreRequired
    ? theme.colors.onErrorContainer
    : theme.colors.onSecondaryContainer;
  const background = isStoreRequired
    ? theme.colors.errorContainer
    : theme.colors.secondaryContainer;
  const canRestart = notice.kind === "ready" && !restarting;
  const canOpenStore = isStoreRequired;

  const handlePress = async () => {
    if (canOpenStore) {
      try {
        await Linking.openURL(storeUrlForPlatform(Platform.OS));
      } catch (error) {
        logError(error, { context: "OtaUpdateBanner.openStore" });
      }
      return;
    }

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

  const showSpinner = notice.kind === "downloading" || restarting;
  const iconSource = isStoreRequired
    ? "storefront-outline"
    : "cellphone-arrow-down";

  return (
    <View
      pointerEvents="box-none"
      style={[styles.overlay, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}
    >
      <Pressable
        onPress={handlePress}
        disabled={!canRestart && !canOpenStore}
        style={[styles.banner, { backgroundColor: background }]}
        accessibilityRole={canRestart || canOpenStore ? "button" : "text"}
        accessibilityLabel={message}
        testID={
          isStoreRequired ? "ota-update-banner-store" : "ota-update-banner"
        }
      >
        {showSpinner ? (
          <ActivityIndicator size={16} color={foreground} />
        ) : (
          <Icon source={iconSource} size={18} color={foreground} />
        )}
        <Text
          variant="bodyMedium"
          style={[styles.message, { color: foreground }]}
          numberOfLines={3}
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
