import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import React, { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { Button, Text, useTheme } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getDefaultCurrency } from "../utils/currency";
import {
  INVITE_PROMPT_DISMISS_LABEL,
  INVITE_PROMPT_SHARE_LABEL,
  invitePromptBody,
  invitePromptTitle,
} from "../utils/invitePromptEligibility";
import {
  INVITE_PROMPT_MIN_TAP_TARGET,
  INVITE_PROMPT_SCRIM,
  INVITE_PROMPT_WEB_MAX_WIDTH,
  invitePromptSheetPaddingBottom,
  isInvitePromptBottomSheet,
  shouldDismissInvitePromptSwipe,
} from "../utils/invitePromptLayout";
import { formatShareCurrency } from "../utils/settleShareMessage";

export function InvitePromptDialog({
  visible,
  sharing,
  groupName,
  amount,
  currency,
  bottomInset,
  onShare,
  onDismiss,
}: {
  visible: boolean;
  sharing?: boolean;
  groupName?: string;
  amount?: number;
  currency?: string;
  /** Preview/tests can pin the home-indicator inset. */
  bottomInset?: number;
  onShare: () => void;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const safeBottom = bottomInset ?? insets.bottom;
  const isSheet = isInvitePromptBottomSheet(Platform.OS, width);
  const translateY = useRef(new Animated.Value(0)).current;
  const sharingRef = useRef(!!sharing);
  const onDismissRef = useRef(onDismiss);
  sharingRef.current = !!sharing;
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (visible) translateY.setValue(0);
  }, [visible, translateY]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, gesture) => {
          if (!isSheet || sharingRef.current) return false;
          return gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx);
        },
        onPanResponderMove: (_evt, gesture) => {
          if (gesture.dy > 0) translateY.setValue(gesture.dy);
        },
        onPanResponderRelease: (_evt, gesture) => {
          if (shouldDismissInvitePromptSwipe(gesture.dy)) {
            onDismissRef.current();
            return;
          }
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: Platform.OS !== "web",
          }).start();
        },
      }),
    [isSheet, translateY],
  );

  const formattedAmount =
    typeof amount === "number" && Number.isFinite(amount)
      ? formatShareCurrency(amount, currency || getDefaultCurrency())
      : undefined;
  const title = invitePromptTitle(groupName);
  const message = invitePromptBody(formattedAmount);
  const surface = theme.dark
    ? theme.colors.elevation.level2
    : theme.colors.surface;
  const canDismiss = !sharing;

  const handleDismiss = () => {
    if (canDismiss) onDismiss();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType={isSheet ? "slide" : "fade"}
      statusBarTranslucent
      onRequestClose={handleDismiss}
    >
      <View
        style={[
          styles.root,
          {
            justifyContent: isSheet ? "flex-end" : "center",
            pointerEvents: "box-none",
          },
        ]}
      >
        <Pressable
          style={[styles.scrim, { backgroundColor: INVITE_PROMPT_SCRIM }]}
          onPress={handleDismiss}
          accessibilityRole="button"
          accessibilityLabel={INVITE_PROMPT_DISMISS_LABEL}
          testID="invite-prompt-scrim"
        />
        <Animated.View
          style={[
            styles.sheet,
            isSheet ? styles.sheetMobile : styles.sheetWeb,
            {
              backgroundColor: surface,
              borderColor: theme.colors.outlineVariant,
              alignSelf: isSheet ? "stretch" : "center",
              paddingBottom: isSheet
                ? invitePromptSheetPaddingBottom(safeBottom)
                : 24,
              ...(isSheet ? { transform: [{ translateY }] } : {}),
            },
          ]}
          testID="invite-prompt-dialog"
          {...(isSheet ? panResponder.panHandlers : {})}
        >
          {isSheet ? (
            <View
              style={[styles.handle, { backgroundColor: theme.colors.outline }]}
              testID="invite-prompt-handle"
            />
          ) : null}

          <View style={styles.content}>
            <View
              style={[
                styles.iconContainer,
                { backgroundColor: theme.colors.primaryContainer },
              ]}
            >
              <MaterialCommunityIcons
                name="account-plus"
                size={40}
                color={theme.colors.primary}
              />
            </View>

            <Text
              variant="headlineSmall"
              style={[styles.title, { color: theme.colors.onSurface }]}
            >
              {title}
            </Text>

            <Text
              variant="bodyLarge"
              style={[styles.message, { color: theme.colors.onSurfaceVariant }]}
            >
              {message}
            </Text>

            <Button
              mode="contained"
              onPress={onShare}
              loading={sharing}
              disabled={sharing}
              icon="share-variant"
              style={styles.shareButton}
              contentStyle={styles.shareButtonContent}
              testID="invite-prompt-share"
            >
              {INVITE_PROMPT_SHARE_LABEL}
            </Button>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={INVITE_PROMPT_DISMISS_LABEL}
              onPress={handleDismiss}
              disabled={!canDismiss}
              hitSlop={8}
              style={styles.notNow}
              testID="invite-prompt-dismiss"
            >
              <Text
                variant="labelLarge"
                style={{
                  color: theme.colors.primary,
                  fontWeight: "600",
                  textAlign: "center",
                }}
              >
                {INVITE_PROMPT_DISMISS_LABEL}
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
  },
  scrim: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    width: "100%",
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
    zIndex: 1,
  },
  sheetMobile: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomWidth: 0,
  },
  sheetWeb: {
    maxWidth: INVITE_PROMPT_WEB_MAX_WIDTH,
    marginHorizontal: 24,
    borderRadius: 28,
    paddingTop: 24,
  },
  handle: {
    width: 32,
    height: 4,
    borderRadius: 2,
    opacity: 0.5,
    alignSelf: "center",
    marginBottom: 14,
  },
  content: {
    alignItems: "center",
  },
  iconContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  title: {
    fontWeight: "600",
    marginBottom: 12,
    textAlign: "center",
  },
  message: {
    textAlign: "center",
    marginBottom: 24,
  },
  shareButton: {
    borderRadius: 24,
    width: "100%",
    marginBottom: 4,
  },
  shareButtonContent: {
    minHeight: INVITE_PROMPT_MIN_TAP_TARGET,
    paddingVertical: 8,
  },
  notNow: {
    minHeight: INVITE_PROMPT_MIN_TAP_TARGET,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 12,
  },
});
