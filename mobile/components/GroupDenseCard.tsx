import React from "react";
import { StyleSheet, View } from "react-native";
import { Text, useTheme } from "react-native-paper";
import { Balance, Group } from "../types";
import { balanceAmountColor } from "../utils/balanceRowLabels";
import {
  densePeopleFromBalances,
  fallbackDensePerson,
} from "../utils/denseListPeople";
import {
  DENSE_AVATAR_SIZE,
  DENSE_SUBLINE_LINE_HEIGHT,
  DENSE_TITLE_LINE_HEIGHT,
  DENSE_TITLE_SUBLINE_GAP,
  DENSE_TX_STACK_MAX,
  denseStackReservedWidth,
} from "../utils/denseListTokens";
import {
  groupListDenseAmountText,
  groupListDenseSubline,
} from "../utils/groupListBalanceDisplay";
import { AvatarStack } from "./AvatarStack";
import { DenseListCard } from "./DenseListCard";
import { GroupListBalanceBits } from "./GroupBalanceBadge";
import { Skeleton } from "./Skeleton";

interface GroupDenseCardProps {
  group: Group;
  currentUserId?: string;
  balances?: Balance[];
  loading: boolean;
  isNew?: boolean;
  unreadActivityCount?: number;
  expandedText?: boolean;
  onPress: () => void;
  accessibilityExtra?: string;
}

export const GroupDenseCard: React.FC<GroupDenseCardProps> = ({
  group,
  currentUserId,
  balances,
  loading,
  isNew = false,
  unreadActivityCount = 0,
  expandedText = false,
  onPress,
  accessibilityExtra = "",
}) => {
  const theme = useTheme();
  const people = densePeopleFromBalances(balances, { excludeUserId: currentUserId });
  const stack = people.length > 0
    ? people
    : [fallbackDensePerson(group.id, group.name)];
  const hasUnreadActivity = unreadActivityCount > 0;

  return (
    <GroupListBalanceBits
      groupId={group.id}
      balanceData={balances ? { group_id: group.id, balances } : null}
      currentUserId={currentUserId}
      loading={loading}
    >
      {(display) => {
        const subline = groupListDenseSubline(display);
        const amountText = groupListDenseAmountText(display);
        const amountColor = display.kind === "amount"
          ? balanceAmountColor(display.signedAmount, theme.colors, { dark: theme.dark })
          : theme.colors.onSurfaceVariant;
        return (
          <DenseListCard
            testID={`group-card-${group.id}`}
            onPress={onPress}
            accessibilityLabel={`${group.name}${subline ? `, ${subline}` : ""}${amountText ? `, ${amountText}` : ""}${isNew ? ", new group" : ""}${hasUnreadActivity ? `, ${unreadActivityCount} unread ${unreadActivityCount === 1 ? "notification" : "notifications"}` : ""}${accessibilityExtra}`}
            style={expandedText ? styles.expandedCard : undefined}
          >
            <View style={{ width: denseStackReservedWidth(DENSE_AVATAR_SIZE), flexShrink: 0 }}>
              <AvatarStack people={stack} size={DENSE_AVATAR_SIZE} max={DENSE_TX_STACK_MAX} />
            </View>
            <View style={styles.info}>
              <View style={styles.titleRow}>
                <Text
                  variant="titleMedium"
                  numberOfLines={expandedText ? undefined : 1}
                  style={[styles.title, { color: theme.colors.onSurface }]}
                >
                  {group.name}
                </Text>
                {isNew ? (
                  <Text
                    variant="labelSmall"
                    style={[styles.newBadge, { color: theme.colors.primary }]}
                    testID={`new-badge-${group.id}`}
                  >
                    NEW
                  </Text>
                ) : null}
                {hasUnreadActivity ? (
                  <View
                    style={[styles.activityDot, { backgroundColor: theme.colors.primary }]}
                    testID={`notification-dot-${group.id}`}
                    accessibilityElementsHidden
                  />
                ) : null}
              </View>
              {subline ? (
                <Text
                  variant="bodySmall"
                  numberOfLines={1}
                  testID={`group-subline-${group.id}`}
                  style={{
                    color: theme.colors.onSurfaceVariant,
                    marginTop: DENSE_TITLE_SUBLINE_GAP,
                    lineHeight: DENSE_SUBLINE_LINE_HEIGHT,
                  }}
                >
                  {subline}
                </Text>
              ) : null}
            </View>
            <View style={styles.amountSlot}>
              {display.kind === "loading" ? (
                <Skeleton width={72} height={16} borderRadius={4} />
              ) : amountText ? (
                <Text
                  variant="titleSmall"
                  numberOfLines={2}
                  style={{ color: amountColor, fontWeight: "700", textAlign: "right" }}
                >
                  {amountText}
                </Text>
              ) : null}
            </View>
          </DenseListCard>
        );
      }}
    </GroupListBalanceBits>
  );
};

const styles = StyleSheet.create({
  info: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  title: {
    fontWeight: "700",
    flexShrink: 1,
    letterSpacing: -0.2,
    lineHeight: DENSE_TITLE_LINE_HEIGHT,
  },
  newBadge: {
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  activityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  amountSlot: {
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "center",
    minWidth: 72,
  },
  expandedCard: {
    alignSelf: "stretch",
  },
});
