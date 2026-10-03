import React from "react";
import { View } from "react-native";
import {
    ActivityIndicator,
    Avatar,
    Divider,
    IconButton,
    Surface,
    Text,
    useTheme,
} from "react-native-paper";
import { GroupInvitation } from "../types";
import { formatDate } from "../utils/date";
import { styles } from "./InvitationsList.styles";

interface InvitationsListProps {
  invitations: GroupInvitation[];
  loading: boolean;
  canManageInvites: boolean;
  cancellingInvitationId: string | null;
  onCancel: (invitationId: string) => void;
}

export const InvitationsList: React.FC<InvitationsListProps> = ({
  invitations,
  loading,
  canManageInvites,
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

  const getInitials = (invitation: GroupInvitation) => {
    if (invitation.email) return invitation.email.substring(0, 2).toUpperCase();
    if (invitation.phone) return "☎";
    return "🔗";
  };

  return (
    <Surface elevation={0} style={{ backgroundColor: theme.colors.surface, borderRadius: 12, marginTop: 8 }}>
      <Text variant="titleSmall" style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, color: theme.colors.onSurfaceVariant }}>
        Pending Invitations
      </Text>
      {invitations.map((invitation, index) => {
        const isCancelling = cancellingInvitationId === invitation.id;
        const expiresDate = new Date(invitation.expires_at);
        const isExpired = expiresDate < new Date();

        return (
          <React.Fragment key={invitation.id}>
            <View
              style={[
                styles.memberContent,
                isCancelling && styles.memberCardRemoving,
                isExpired && { opacity: 0.6 },
                { paddingHorizontal: 16, paddingVertical: 12 }
              ]}
            >
              <Avatar.Text 
                size={40} 
                label={getInitials(invitation)}
                style={{ 
	                  backgroundColor: invitation.email || invitation.phone
	                    ? theme.colors.surfaceVariant
	                    : theme.colors.primaryContainer,
                  marginRight: 16,
                  opacity: 0.7
                }}
                color={
	                  invitation.email || invitation.phone
	                    ? theme.colors.onSurfaceVariant
	                    : theme.colors.onPrimaryContainer
                }
              />
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
                {canManageInvites &&
                  (isCancelling ? (
                      <ActivityIndicator
                        size="small"
                        color={theme.colors.primary}
                        style={styles.removingIndicator}
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
                  ))}
              </View>
            </View>
            {index < invitations.length - 1 && <Divider />}
          </React.Fragment>
        );
      })}
    </Surface>
  );
};
