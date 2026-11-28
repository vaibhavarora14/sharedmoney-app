import React from "react";
import { View } from "react-native";
import {
    ActivityIndicator,
    Avatar,
    IconButton,
    Text,
    useTheme,
} from "react-native-paper";
import { GroupInvitation } from "../types";
import { formatDate } from "../utils/date";
import { DENSE_CARD_GAP } from "../utils/denseListTokens";
import { DenseListCard } from "./DenseListCard";
import { PersonAvatar } from "./PersonAvatar";
import { styles } from "./InvitationsList.styles";

interface InvitationsListProps {
  invitations: GroupInvitation[];
  loading: boolean;
  canManageInvites: boolean;
  /** Keep cancel in the remove column when member rows also show an overflow menu. */
  reserveMenuColumn?: boolean;
  cancellingInvitationId: string | null;
  onCancel: (invitationId: string) => void;
}

export const InvitationsList: React.FC<InvitationsListProps> = ({
  invitations,
  loading,
  canManageInvites,
  reserveMenuColumn = false,
  cancellingInvitationId,
  onCancel,
}) => {
  const theme = useTheme();

  if (invitations.length === 0) {
    return null;
  }

  if (loading) {
    return (
      <ActivityIndicator size="small" style={{ marginVertical: 16 }} />
    );
  }

  const markFor = (invitation: GroupInvitation):
    | { kind: "initials"; label: string }
    | { kind: "icon"; icon: "phone" | "link-variant" } => {
    if (invitation.email) {
      return { kind: "initials", label: invitation.email.substring(0, 2).toUpperCase() };
    }
    if (invitation.phone) return { kind: "icon", icon: "phone" };
    return { kind: "icon", icon: "link-variant" };
  };

  return (
    <View style={{ gap: DENSE_CARD_GAP, marginTop: 8 }}>
      <Text variant="titleSmall" style={{ paddingHorizontal: 4, color: theme.colors.onSurfaceVariant }}>
        Pending Invitations
      </Text>
      {invitations.map((invitation) => {
        const isCancelling = cancellingInvitationId === invitation.id;
        const expiresDate = new Date(invitation.expires_at);
        const isExpired = expiresDate < new Date();
        const mark = markFor(invitation);
        const identified = !!(invitation.email || invitation.phone);
        const avatarStyle = {
          backgroundColor: identified
            ? theme.colors.surfaceVariant
            : theme.colors.primaryContainer,
          marginRight: 16,
          flexShrink: 0,
        };
        const foreground = identified
          ? theme.colors.onSurfaceVariant
          : theme.colors.onPrimaryContainer;

        return (
          <DenseListCard
            key={invitation.id}
            style={[
              isCancelling && styles.memberCardRemoving,
              isExpired ? { opacity: 0.6 } : null,
            ]}
          >
            <View style={styles.memberContent}>
              {mark.kind === "initials" ? (
                <PersonAvatar
                  name={invitation.email || mark.label}
                  personKey={invitation.id}
                  style={avatarStyle}
                />
              ) : (
                <Avatar.Icon
                  size={40}
                  icon={mark.icon}
                  style={avatarStyle}
                  color={foreground}
                />
              )}
              <View style={styles.memberLeft}>
                <Text
                  variant="titleMedium"
                  style={[
                    styles.memberName,
                    isCancelling && { opacity: 0.6 },
                  ]}
                >
                  {invitation.email ||
                    invitation.phone ||
                    (() => {
                      const remaining = Math.max(
                        (invitation.max_uses ?? 1) - (invitation.uses_count ?? 0),
                        0
                      );
                      return `Invite link (${remaining} ${
                        remaining === 1 ? "use" : "uses"
                      } left)`;
                    })()}
                </Text>
                <Text
                  variant="bodyMedium"
                  style={{
                    color: theme.colors.onSurfaceVariant,
                    opacity: isCancelling ? 0.6 : 1,
                  }}
                >
                  {isExpired
                    ? "Expired"
                    : `Expires ${formatDate(invitation.expires_at)}`}
                </Text>
              </View>
              <View style={styles.memberRight}>
                {canManageInvites ? (
                  <View style={styles.actionSlot}>
                    {isCancelling ? (
                      <ActivityIndicator
                        size="small"
                        color={theme.colors.primary}
                      />
                    ) : (
                      <IconButton
                        icon="close-circle-outline"
                        size={24}
                        iconColor={theme.colors.error}
                        onPress={() => onCancel(invitation.id)}
                        style={styles.removeMemberButton}
                        disabled={cancellingInvitationId !== null}
                      />
                    )}
                  </View>
                ) : null}
                {canManageInvites && reserveMenuColumn ? <View style={styles.actionSlot} /> : null}
              </View>
            </View>
          </DenseListCard>
        );
      })}
    </View>
  );
};
