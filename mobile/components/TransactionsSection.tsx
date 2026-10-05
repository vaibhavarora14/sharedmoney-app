import React from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import {
  ActivityIndicator,
  Button,
  Icon,
  Surface,
  Text,
  useTheme,
} from "react-native-paper";
import { Skeleton, SkeletonGroup } from "./Skeleton";
import { useAuth } from "../contexts/AuthContext";
import { Participant, Settlement, Transaction } from "../types";
import { formatCurrency, getDefaultCurrency } from "../utils/currency";
import { isUnequalSplit } from "../utils/splits";
import { openTransactionWithHighlightConsumption } from "../utils/transactionHighlight";
import {
  countActiveMembers,
  getTransactionsEmptyCopy,
} from "../utils/transactionsEmptyCopy";
import type { LedgerItem } from "../utils/transactionsLedger";
import { styles } from "./TransactionsSection.styles";

function formatRelativeDate(raw: string): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === now.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getCategoryIcon(category: string) {
  const lowerCat = category?.toLowerCase() || "";
  if (!lowerCat.trim()) return "help-circle-outline";
  if (lowerCat.includes("food") || lowerCat.includes("restaurant")) return "silverware-fork-knife";
  if (lowerCat.includes("transport") || lowerCat.includes("taxi") || lowerCat.includes("uber")) return "taxi";
  if (lowerCat.includes("grocery") || lowerCat.includes("market")) return "cart-outline";
  if (lowerCat.includes("entertainment") || lowerCat.includes("movie")) return "movie-open-outline";
  if (lowerCat.includes("travel") || lowerCat.includes("flight")) return "airplane";
  if (lowerCat.includes("shopping")) return "shopping-outline";
  if (lowerCat.includes("rent")) return "home-outline";
  if (lowerCat.includes("utilities") || lowerCat.includes("utility")) return "lightning-bolt-outline";
  if (lowerCat.includes("health") || lowerCat.includes("medical")) return "medical-bag";
  return "tag-outline";
}

export interface LedgerRowProps {
  item: LedgerItem;
  members?: any[];
  participants?: Participant[];
  highlightedTransactionId?: number | null;
  onHighlightedLayout?: (y: number) => void;
  onHighlightedInteraction?: (transactionId: number) => void;
  onEditExpense: (t: Transaction) => void;
  onEditPayment?: (s: Settlement) => void;
}

export const LedgerRow: React.FC<LedgerRowProps> = ({
  item,
  members = [],
  participants = [],
  highlightedTransactionId = null,
  onHighlightedLayout,
  onHighlightedInteraction,
  onEditExpense,
  onEditPayment,
}) => {
  const theme = useTheme();
  const { session } = useAuth();
  const currentUserId = session?.user?.id;

  const participantMap = React.useMemo(
    () => new Map(participants.map((p) => [p.id, p])),
    [participants],
  );

  const memberParticipantMap = React.useMemo(() => {
    const map = new Map<string, any>();
    for (const m of members) {
      if (m.participant_id) map.set(m.participant_id, m);
      if (m.id) map.set(m.id, m);
    }
    return map;
  }, [members]);

  const memberUserMap = React.useMemo(
    () => new Map(members.map((m) => [m.user_id, m])),
    [members],
  );

  const resolveParticipantName = (participantId?: string | null, userId?: string | null) => {
    if (participantId) {
      const participant = participantMap.get(participantId);
      if (participant) {
        const baseName =
          participant.user_id === currentUserId
            ? "You"
            : participant.full_name ||
              participant.email?.split("@")[0] ||
              participant.email ||
              "Unknown";
        return participant.type === "former" ? `${baseName} (Former)` : baseName;
      }

      const member = memberParticipantMap.get(participantId);
      if (member) {
        const baseName =
          member.user_id === currentUserId
            ? "You"
            : member.full_name || member.email?.split("@")[0] || member.email || "Unknown";
        return member.status === "left" ? `${baseName} (Former)` : baseName;
      }
    }

    if (userId) {
      if (userId === currentUserId) return "You";
      const payer = memberUserMap.get(userId);
      if (payer) {
        return payer.full_name || payer.email?.split("@")[0] || payer.email || "Unknown";
      }
    }

    return "Unknown";
  };

  if (item.kind === "payment") {
    const settlement = item.settlement;
    const currency = settlement.currency || getDefaultCurrency();
    const dateString = formatRelativeDate(settlement.created_at);
    const fromName = resolveParticipantName(
      settlement.from_participant_id,
      settlement.from_user_id,
    );
    const toName = resolveParticipantName(
      settlement.to_participant_id,
      settlement.to_user_id,
    );
    const title = settlement.notes?.trim() || "Payment";
    const canEdit = !!onEditPayment;

    return (
      <Surface style={styles.card} elevation={0}>
        <Pressable
          onPress={() => onEditPayment?.(settlement)}
          disabled={!canEdit}
          accessibilityRole="button"
          accessibilityLabel={`Payment, ${fromName} paid ${toName}, ${formatCurrency(settlement.amount, currency)}`}
          testID={`ledger-payment-${settlement.id}`}
          style={({ pressed }) => [
            styles.pressable,
            pressed && canEdit && { backgroundColor: theme.colors.surfaceVariant },
          ]}
        >
          <View style={styles.row}>
            <View
              style={[
                styles.iconContainer,
                { backgroundColor: theme.colors.tertiaryContainer },
              ]}
            >
              <Icon
                source="handshake-outline"
                size={18}
                color={theme.colors.onTertiaryContainer}
              />
            </View>

            <View style={styles.content}>
              <View style={styles.headerRow}>
                <Text
                  variant="titleMedium"
                  numberOfLines={1}
                  style={[styles.title, { color: theme.colors.onSurface }]}
                >
                  {title}
                </Text>
                <Text
                  variant="titleMedium"
                  style={{
                    fontWeight: "bold",
                    color: theme.colors.onSurface,
                    flexShrink: 0,
                  }}
                >
                  {formatCurrency(settlement.amount, currency)}
                </Text>
              </View>

              <View style={styles.subRow}>
                <Text
                  variant="labelSmall"
                  style={[styles.typeLabel, { color: theme.colors.tertiary }]}
                >
                  Payment
                </Text>
                <Text
                  variant="bodySmall"
                  numberOfLines={1}
                  style={{ color: theme.colors.onSurfaceVariant, flex: 1 }}
                >
                  {" "}
                  • {dateString} • {fromName} → {toName}
                </Text>
              </View>
            </View>
          </View>
        </Pressable>
      </Surface>
    );
  }

  const transaction = item.transaction;
  const isHighlighted = transaction.id === highlightedTransactionId;
  const currency = transaction.currency || getDefaultCurrency();
  const categoryIcon = getCategoryIcon(transaction.category || "");
  const dateString = formatRelativeDate(transaction.date);
  const payerName = resolveParticipantName(
    transaction.paid_by_participant_id,
    transaction.paid_by,
  );
  const unequalSplit = transaction.splits
    ? isUnequalSplit(transaction.splits)
    : false;

  return (
    <Surface
      onLayout={
        isHighlighted
          ? (event) => onHighlightedLayout?.(event.nativeEvent.layout.y)
          : undefined
      }
      style={styles.card}
      elevation={0}
    >
      <View
        pointerEvents="none"
        style={[
          styles.highlightOverlay,
          {
            backgroundColor: isHighlighted
              ? theme.colors.primaryContainer
              : "transparent",
            borderColor: isHighlighted
              ? theme.colors.primary
              : "transparent",
          },
        ]}
      />
      <Pressable
        onPress={() =>
          openTransactionWithHighlightConsumption(
            highlightedTransactionId,
            onHighlightedInteraction,
            () => onEditExpense(transaction),
          )
        }
        accessibilityRole="button"
        accessibilityLabel={`Expense, ${transaction.description || "Untitled"}, ${formatCurrency(transaction.amount, currency)}${isHighlighted ? ", highlighted from notification" : ""}`}
        testID={`ledger-expense-${transaction.id}`}
        style={({ pressed }) => [
          styles.pressable,
          pressed && { backgroundColor: theme.colors.surfaceVariant },
        ]}
      >
        <View style={styles.row}>
          <View
            style={[
              styles.iconContainer,
              { backgroundColor: theme.colors.primaryContainer },
            ]}
          >
            <Icon
              source={categoryIcon}
              size={18}
              color={theme.colors.onPrimaryContainer}
            />
          </View>

          <View style={styles.content}>
            <View style={styles.headerRow}>
              <Text
                variant="titleMedium"
                numberOfLines={1}
                style={[styles.title, { color: theme.colors.onSurface }]}
              >
                {transaction.description || "Untitled"}
              </Text>
              <Text
                variant="titleMedium"
                style={{
                  fontWeight: "bold",
                  color: theme.colors.onSurface,
                  flexShrink: 0,
                }}
              >
                {formatCurrency(transaction.amount, currency)}
              </Text>
            </View>

            <View style={styles.subRow}>
              <Text
                variant="bodySmall"
                numberOfLines={1}
                style={{ color: theme.colors.onSurfaceVariant, flex: 1 }}
              >
                {payerName}
                {unequalSplit ? " · Unequal" : ""}
              </Text>
              {dateString ? (
                <Text
                  variant="bodySmall"
                  style={{ color: theme.colors.onSurfaceVariant, marginRight: 8 }}
                >
                  {dateString}
                </Text>
              ) : null}
              <Icon
                source="chevron-right"
                size={18}
                color={theme.colors.onSurfaceVariant}
              />
            </View>
          </View>
        </View>
      </Pressable>
    </Surface>
  );
};

/** Same row padding, icon, text line boxes and list gaps as the real ledger. */
export function LedgerSkeleton() {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  return (
    <SkeletonGroup style={{ paddingTop: 8, gap: 8 }} testID="ledger-skeleton">
      {[0, 1, 2, 3, 4].map((key) => (
        <View key={key} style={styles.pressable}>
          <View style={styles.row}>
            <View style={styles.iconContainer}>
              <Skeleton width={40} height={40} borderRadius={20} />
            </View>
            <View style={styles.content}>
              <View style={[styles.headerRow, { height: theme.fonts.titleMedium.lineHeight * fontScale }]}>
                <View style={styles.title}><Skeleton width="80%" height={16} /></View>
                <Skeleton width={80} height={16} />
              </View>
              <View style={[styles.subRow, { height: Math.max(18, theme.fonts.bodySmall.lineHeight * fontScale) }]}>
                <View style={{ flex: 1 }}><Skeleton width={64} height={12} /></View>
                <View style={{ marginRight: 26 }}><Skeleton width={40} height={12} /></View>
              </View>
            </View>
          </View>
        </View>
      ))}
    </SkeletonGroup>
  );
}

export interface TransactionsEmptyStateProps {
  filter?: "all" | "expenses" | "payments";
  members?: any[];
  canAct?: boolean;
  onAddPeople?: () => void;
  onAddExpense?: () => void;
}

export const TransactionsEmptyState: React.FC<TransactionsEmptyStateProps> = ({
  filter = "all",
  members = [],
  canAct = false,
  onAddPeople,
  onAddExpense,
}) => {
  const theme = useTheme();
  const activeMemberCount = countActiveMembers(members);
  const emptyCopy = getTransactionsEmptyCopy(filter, activeMemberCount);

  const runEmptyAction = (action?: "add_people" | "add_expense") => {
    if (action === "add_people") onAddPeople?.();
    if (action === "add_expense") onAddExpense?.();
  };

  if (
    emptyCopy.secondaryAction === "add_expense" &&
    emptyCopy.primaryAction === "add_people"
  ) {
    return (
      <View style={styles.emptyState} testID="transactions-empty-state">
        <Text
          variant="bodyLarge"
          style={{
            color: theme.colors.onSurfaceVariant,
            textAlign: "center",
            marginBottom: 20,
            maxWidth: 280,
          }}
        >
          {emptyCopy.body}
        </Text>
        {canAct && emptyCopy.primaryLabel ? (
          <Button
            mode="contained"
            icon="account-plus"
            onPress={() => runEmptyAction("add_people")}
            testID="empty-add-people"
            style={{ borderRadius: 8 }}
          >
            {emptyCopy.primaryLabel}
          </Button>
        ) : null}
        {canAct && emptyCopy.secondaryLabel ? (
          <Button
            mode="text"
            onPress={() => runEmptyAction("add_expense")}
            testID="empty-add-expense-anyway"
            accessibilityRole="button"
            accessibilityLabel={emptyCopy.secondaryLabel}
            style={styles.emptySecondaryButton}
            labelStyle={{ color: theme.colors.onSurfaceVariant }}
          >
            {emptyCopy.secondaryLabel}
          </Button>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.emptyState} testID="transactions-empty-state">
      <Text
        variant="bodyLarge"
        style={{
          color: theme.colors.onSurfaceVariant,
          textAlign: "center",
          maxWidth: 280,
        }}
      >
        {emptyCopy.body}
      </Text>
      {canAct && emptyCopy.primaryLabel && emptyCopy.primaryAction ? (
        <View style={styles.emptyActions}>
          <Button
            mode="contained"
            icon={
              emptyCopy.primaryAction === "add_people"
                ? "account-plus"
                : "plus"
            }
            onPress={() => runEmptyAction(emptyCopy.primaryAction)}
            testID={
              emptyCopy.primaryAction === "add_people"
                ? "empty-add-people"
                : "empty-add-expense"
            }
            style={{ borderRadius: 8 }}
          >
            {emptyCopy.primaryLabel}
          </Button>
        </View>
      ) : null}
    </View>
  );
};

interface TransactionsSectionProps {
  items: LedgerItem[];
  loading: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
  onEditExpense: (t: Transaction) => void;
  onEditPayment?: (s: Settlement) => void;
  members: any[];
  participants?: Participant[];
  highlightedTransactionId?: number | null;
  onHighlightedLayout?: (y: number) => void;
  onHighlightedInteraction?: (transactionId: number) => void;
  filter?: "all" | "expenses" | "payments";
  /** When true, empty-state CTAs (Add people / Add expense) are shown. */
  canAct?: boolean;
  onAddPeople?: () => void;
  onAddExpense?: () => void;
}

/**
 * Compact ledger host for previews / small lists.
 * GroupDetails virtualizes via FlatList + LedgerRow instead of nesting this
 * inside a ScrollView.
 */
export const TransactionsSection: React.FC<TransactionsSectionProps> = ({
  items,
  loading,
  hasNextPage = false,
  isFetchingNextPage = false,
  onLoadMore,
  onEditExpense,
  onEditPayment,
  members = [],
  participants = [],
  highlightedTransactionId = null,
  onHighlightedLayout,
  onHighlightedInteraction,
  filter = "all",
  canAct = false,
  onAddPeople,
  onAddExpense,
}) => {
  const theme = useTheme();

  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator size="small" style={{ marginVertical: 24 }} />
      ) : items.length > 0 ? (
        <View style={styles.list}>
          {items.map((item) => (
            <LedgerRow
              key={item.key}
              item={item}
              members={members}
              participants={participants}
              highlightedTransactionId={highlightedTransactionId}
              onHighlightedLayout={onHighlightedLayout}
              onHighlightedInteraction={onHighlightedInteraction}
              onEditExpense={onEditExpense}
              onEditPayment={onEditPayment}
            />
          ))}
          {(isFetchingNextPage || hasNextPage) && filter !== "payments" && (
            <View style={{ alignItems: "center", paddingVertical: 16 }}>
              {isFetchingNextPage ? (
                <ActivityIndicator size="small" />
              ) : (
                <Pressable
                  onPress={onLoadMore}
                  style={({ pressed }) => ({
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 18,
                    opacity: pressed ? 0.7 : 1,
                    backgroundColor: theme.colors.surfaceVariant,
                  })}
                >
                  <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                    Load more transactions
                  </Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      ) : (
        <TransactionsEmptyState
          filter={filter}
          members={members}
          canAct={canAct}
          onAddPeople={onAddPeople}
          onAddExpense={onAddExpense}
        />
      )}
    </View>
  );
};
