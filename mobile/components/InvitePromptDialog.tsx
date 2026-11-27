import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import React from "react";
import { StyleSheet, View } from "react-native";
import { Button, Modal, Portal, Text, useTheme } from "react-native-paper";
import { WEB_MAX_WIDTH } from "../constants/layout";
import {
  INVITE_PROMPT_DISMISS_LABEL,
  INVITE_PROMPT_MESSAGE,
  INVITE_PROMPT_SHARE_LABEL,
  INVITE_PROMPT_TITLE,
} from "../utils/invitePromptEligibility";

export function InvitePromptDialog({
  visible,
  sharing,
  onShare,
  onDismiss,
}: {
  visible: boolean;
  sharing?: boolean;
  onShare: () => void;
  onDismiss: () => void;
}) {
  const theme = useTheme();

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        dismissable={!sharing}
        dismissableBackButton={!sharing}
        contentContainerStyle={[
          styles.container,
          { backgroundColor: theme.colors.surface },
        ]}
      >
        <View style={styles.content} testID="invite-prompt-dialog">
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
            {INVITE_PROMPT_TITLE}
          </Text>

          <Text
            variant="bodyLarge"
            style={[styles.message, { color: theme.colors.onSurfaceVariant }]}
          >
            {INVITE_PROMPT_MESSAGE}
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

          <Button
            mode="text"
            onPress={onDismiss}
            disabled={sharing}
            textColor={theme.colors.primary}
            testID="invite-prompt-dismiss"
          >
            {INVITE_PROMPT_DISMISS_LABEL}
          </Button>
        </View>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  container: {
    margin: 24,
    padding: 24,
    borderRadius: 28,
    maxWidth: WEB_MAX_WIDTH,
    alignSelf: "center",
    width: "100%",
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
    paddingVertical: 8,
  },
});
