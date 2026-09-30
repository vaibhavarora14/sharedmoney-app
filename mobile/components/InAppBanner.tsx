import React, { useCallback, useEffect, useRef } from "react";
import { Animated, Platform, Pressable, StyleSheet, View } from "react-native";
import { Icon, IconButton, Text, useTheme } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WEB_MAX_WIDTH } from "../constants/layout";

export interface BannerNotice {
  type: "success" | "error";
  message: string;
  /** Optional action when the banner body is tapped (e.g. open the group). */
  onPress?: () => void;
}

interface InAppBannerProps {
  notice: BannerNotice | null;
  onDismiss: () => void;
  /** Auto-dismiss delay in ms (default 7000). */
  autoDismissMs?: number;
}

/**
 * Lightweight, non-blocking notification banner rendered at the top of the
 * screen. Slides in, auto-dismisses after a few seconds, and can be closed
 * manually. Pure RN Views + Animated, so it behaves identically on native
 * and react-native-web (no window.* APIs, no modals).
 */
export const InAppBanner: React.FC<InAppBannerProps> = ({
  notice,
  onDismiss,
  autoDismissMs = 7000,
}) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const useNativeDriver = Platform.OS !== "web";

  const dismiss = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 180,
      useNativeDriver,
    }).start(() => onDismiss());
  }, [onDismiss, slideAnim, useNativeDriver]);

  useEffect(() => {
    if (!notice) return;

    slideAnim.setValue(0);
    Animated.spring(slideAnim, {
      toValue: 1,
      useNativeDriver,
      tension: 70,
      friction: 12,
    }).start();

    timerRef.current = setTimeout(dismiss, autoDismissMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // Re-run when a new notice object arrives so the timer restarts.
  }, [notice, autoDismissMs, dismiss, slideAnim, useNativeDriver]);

  if (!notice) return null;

  const isError = notice.type === "error";
  const backgroundColor = isError
    ? theme.colors.errorContainer
    : theme.colors.primaryContainer;
  const foreground = isError
    ? theme.colors.onErrorContainer
    : theme.colors.onPrimaryContainer;

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-90, 0],
  });

  return (
    <View
      pointerEvents="box-none"
      style={[styles.overlay, { paddingTop: insets.top + 8 }]}
    >
      <Animated.View
        style={[
          styles.banner,
          {
            backgroundColor,
            transform: [{ translateY }],
            opacity: slideAnim,
          },
        ]}
        testID="in-app-banner"
      >
        <Pressable
          onPress={() => {
            if (notice.onPress) {
              dismiss();
              notice.onPress();
            }
          }}
          style={styles.content}
          disabled={!notice.onPress}
        >
          <Icon
            source={isError ? "alert-circle-outline" : "check-circle-outline"}
            size={22}
            color={foreground}
          />
          <Text
            variant="bodyMedium"
            style={[styles.message, { color: foreground }]}
            numberOfLines={3}
          >
            {notice.message}
          </Text>
        </Pressable>
        <IconButton
          icon="close"
          size={18}
          iconColor={foreground}
          onPress={dismiss}
          style={styles.close}
          accessibilityLabel="Dismiss notification"
        />
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    zIndex: 1000,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    marginHorizontal: 16,
    paddingLeft: 14,
    paddingRight: 2,
    paddingVertical: 4,
    width: "92%",
    maxWidth: Math.min(WEB_MAX_WIDTH - 32, 520),
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
  },
  content: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  message: {
    flex: 1,
    marginLeft: 10,
  },
  close: {
    margin: 0,
  },
});
