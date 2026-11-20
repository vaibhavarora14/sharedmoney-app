import React from "react";
import { Alert, Clipboard, Share, View } from "react-native";
import { Button, Dialog, Portal, Text, useTheme } from "react-native-paper";
import { useBalanceShareLinks } from "../hooks/useBalanceShareLinks";

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function BalanceShareLinkSheet({
  visible,
  groupId,
  onDismiss,
}: {
  visible: boolean;
  groupId: string;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const { list, createLink, revokeLink } = useBalanceShareLinks(groupId, visible);
  const links = list.data || [];
  const active = links.filter((link) => !link.revoked_at && new Date(link.expires_at).getTime() > Date.now());

  const createAndShare = () => {
    void createLink.mutateAsync()
      .then(async (url) => {
        try {
          Clipboard.setString(url);
        } catch {
          // Sharing can still go ahead if the clipboard is unavailable.
        }
        try {
          await Share.share({ message: url, url });
        } catch {
          Alert.alert("Link copied", "The balance link is on your clipboard. It expires in 7 days.");
        }
      })
      .catch((error) => {
        Alert.alert("Couldn’t create link", error instanceof Error ? error.message : "Please try again.");
      });
  };

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} testID="balance-share-link-dialog">
        <Dialog.Title>Share a balance link</Dialog.Title>
        <Dialog.Content>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12 }}>
            The other person can open a page that shows only the open amount — no names, emails, or other personal details. Links expire in 7 days, and you can revoke them anytime.
          </Text>
          {active.length === 0 ? (
            <Text variant="bodyMedium">No active links.</Text>
          ) : (
            active.map((link) => (
              <View key={link.id} style={{ marginBottom: 8 }} testID={`balance-share-link-${link.id}`}>
                <Text variant="bodyMedium">Expires {formatWhen(link.expires_at)}</Text>
                <Button
                  compact
                  onPress={() => void revokeLink.mutateAsync(link.id).catch((error) => {
                    Alert.alert("Couldn’t revoke", error instanceof Error ? error.message : "Please try again.");
                  })}
                  disabled={revokeLink.isPending}
                >
                  Revoke
                </Button>
              </View>
            ))
          )}
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onDismiss}>Close</Button>
          <Button
            onPress={createAndShare}
            loading={createLink.isPending}
            disabled={createLink.isPending || active.length >= 3}
            testID="balance-share-link-create"
          >
            Create 7-day link
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}
