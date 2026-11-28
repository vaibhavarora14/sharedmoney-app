import React from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import {
  ActivityIndicator,
  Button,
  Text,
  useTheme,
} from "react-native-paper";
import { AvatarStack } from "./AvatarStack";
import { DenseListCard } from "./DenseListCard";
import { Skeleton, SkeletonGroup } from "./Skeleton";
import {
  densePeopleForExpense,
  densePeopleForPayment,
} from "../utils/denseListPeople";
import {
  DENSE_SECTION_HEADER_PADDING_BOTTOM,
  DENSE_SECTION_HEADER_PADDING_TOP,
  DENSE_STACK_AVATAR_SIZE,
  DENSE_TX_STACK_MAX,
} from "../utils/denseListTokens";
import { useAuth } from "../contexts/AuthContext";
import { Participant, Settlement, Transaction } from "../types";
import { balanceAmountColor } from "../utils/balanceRowLabels";
import { resolveLedgerParticipantName } from "../utils/ledgerNames";
import { isOptimisticTransactionId } from "../utils/transactionOptimisticCache";
import { openTransactionWithHighlightConsumption } from "../utils/transactionHighlight";
import {
  buildExpenseRowModel,
  paymentAmountText,
  paymentRowTitle,
} from "../utils/transactionRowImpact";
import {
  countActiveMembers,
  getTransactionsEmptyCopy,
} from "../utils/transactionsEmptyCopy";
import type { LedgerItem } from "../utils/transactionsLedger";
import { getDefaultCurrency } from "../utils/currency";
import { groupByLedgerDateSection } from "../utils/ledgerDateSections";
import { styles } from "./TransactionsSection.styles";

export interface LedgerRowProps {
  item: LedgerItem;
  members?: any[];
  participants?: Participant[];
  highlightedTransactionId?: number | null;
  onHighlightedLayout?: (y: number) => void;
  onHighlightedInteraction?: (transactionId: number) => void;
  onEditExpense: (t: Transaction) => void;
  onEditPayment?: (s: Settlement) => void;
  /** Opens the read-only detail. Edit stays on that screen. */
  onOpenExpense?: (t: Transaction) => void;
  onOpenPayment?: (s: Settlement) => void;
  /** Preview and tests can pin the viewer without a session. */
  viewerUserId?: string | null;
}

export function LedgerDateLabel({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <Text
      variant="labelSmall"
      accessibilityRole="header"
      style={{
        color: theme.colors.onSurfaceVariant,
        letterSpacing: 0.6,
        textTransform: "uppercase",
        fontWeight: "600",
        paddingHorizontal: 16,
        paddingTop: DENSE_SECTION_HEADER_PADDING_TOP,
        paddingBottom: DENSE_SECTION_HEADER_PADDING_BOTTOM,
      }}
    >
      {label}
    </Text>
  );
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
  onOpenExpense,
  onOpenPayment,
  viewerUserId,
}) => {
  const theme = useTheme();
  const { session } = useAuth();
  const currentUserId = viewerUserId ?? session?.user?.id;
  const viewerParticipantId = participants.find((person) => person.user_id === currentUserId)?.id;

  const resolveParticipantName = (participantId?: string | null, userId?: string | null) =>
    resolveLedgerParticipantName({
      participantId,
      userId,
      currentUserId,
      participants,
      members,
    });

  if (item.kind === "payment") {
    const settlement = item.settlement;
    const currency = settlement.currency || getDefaultCurrency();
    const fromName = resolveParticipantName(
      settlement.from_participant_id,
      settlement.from_user_id,
    );
    const toName = resolveParticipantName(
      settlement.to_participant_id,
      settlement.to_user_id,
    );
    const title = paymentRowTitle(fromName, toName);
    const amountText = paymentAmountText(settlement.amount, currency);
    const canEdit = !!onEditPayment;
    const people = densePeopleForPayment({
      fromName,
      toName,
      fromParticipantId: settlement.from_participant_id,
      fromUserId: settlement.from_user_id,
      toParticipantId: settlement.to_participant_id,
      toUserId: settlement.to_user_id,
      participants,
      members,
    });

    return (
      <View style={styles.cardWrap}>
        <DenseListCard
          onPress={() => (onOpenPayment ? onOpenPayment(settlement) : onEditPayment?.(settlement))}
          disabled={!canEdit && !onOpenPayment}
          accessibilityLabel={`${title}, ${amountText}`}
          testID={`ledger-payment-${settlement.id}`}
        >
          <AvatarStack people={people} size={DENSE_STACK_AVATAR_SIZE} max={DENSE_TX_STACK_MAX} />
          <View style={styles.content}>
            <Text
              variant="titleMedium"
              numberOfLines={1}
              style={[styles.title, { color: theme.colors.onSurface }]}
            >
              {title}
            </Text>
          </View>
          <Text
            variant="titleMedium"
            numberOfLines={1}
            testID={`ledger-payment-amount-${settlement.id}`}
            style={[styles.amountValue, { color: theme.colors.onSurface }]}
          >
            {amountText}
          </Text>
        </DenseListCard>
      </View>
    );
  }

  const transaction = item.transaction;
  const isHighlighted = transaction.id === highlightedTransactionId;
  const currency = transaction.currency || getDefaultCurrency();
  const payerName = resolveParticipantName(
    transaction.paid_by_participant_id,
    transaction.paid_by,
  );
  const model = buildExpenseRowModel({
    amount: transaction.amount,
    currency,
    payerName,
    paidByParticipantId: transaction.paid_by_participant_id,
    paidByUserId: transaction.paid_by,
    splits: transaction.splits,
    viewer: { userId: currentUserId, participantId: viewerParticipantId },
    saving: isOptimisticTransactionId(transaction.id),
  });
  const title = transaction.description || "Untitled";
  const impactColor = model.impactMuted || model.net == null
    ? theme.colors.onSurfaceVariant
    : balanceAmountColor(model.net, theme.colors, { dark: theme.dark });
  const people = densePeopleForExpense({
    payerName,
    paidByParticipantId: transaction.paid_by_participant_id,
    paidByUserId: transaction.paid_by,
    splits: transaction.splits,
    participants,
    members,
  });

  return (
    <View
      onLayout={
        isHighlighted
          ? (event) => onHighlightedLayout?.(event.nativeEvent.layout.y)
          : undefined
      }
      style={styles.cardWrap}
    >
      <View
        pointerEvents="none"
        style={[
          styles.highlightOverlay,
          {
            backgroundColor: isHighlighted
              ? theme.colors.primaryContainer
              : "transparent",
            borderColor: "transparent",
          },
        ]}
      />
      <DenseListCard
        onPress={() =>
          openTransactionWithHighlightConsumption(
            highlightedTransactionId,
            onHighlightedInteraction,
            () => (onOpenExpense ? onOpenExpense(transaction) : onEditExpense(transaction)),
          )
        }
        accessibilityLabel={`${title}. ${model.payerLine}. ${model.impactText}${isHighlighted ? ". Highlighted from notification" : ""}`}
        testID={`ledger-expense-${transaction.id}`}
      >
        <AvatarStack people={people} size={DENSE_STACK_AVATAR_SIZE} max={DENSE_TX_STACK_MAX} />
        <View style={styles.content}>
          <Text
            variant="titleMedium"
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[styles.title, { color: theme.colors.onSurface }]}
          >
            {title}
          </Text>
          {model.payerLine ? (
            <Text
              variant="bodySmall"
              numberOfLines={1}
              ellipsizeMode="tail"
              testID={`ledger-payer-${transaction.id}`}
              style={[styles.subline, { color: theme.colors.onSurfaceVariant }]}
            >
              {model.payerLine}
            </Text>
          ) : null}
        </View>
        {model.impactAmountText || model.impactDirectionText ? (
          <View style={styles.amountCol} testID={`ledger-impact-${transaction.id}`}>
            {model.impactAmountText ? (
              <Text
                variant="titleSmall"
                numberOfLines={1}
                style={{ color: impactColor, fontWeight: "700", textAlign: "right" }}
              >
                {model.impactAmountText}
              </Text>
            ) : null}
            {model.impactDirectionText ? (
              <Text
                variant="bodySmall"
                numberOfLines={1}
                style={{
                  color: theme.colors.onSurfaceVariant,
                  textAlign: "right",
                  marginTop: model.impactAmountText ? 2 : 0,
                }}
              >
                {model.impactDirectionText}
              </Text>
            ) : null}
          </View>
        ) : null}
      </DenseListCard>
    </View>
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
            <View style={styles.content}>
              <View style={[styles.headerRow, { height: theme.fonts.titleMedium.lineHeight * fontScale }]}>
                <View style={styles.titleSlot}><Skeleton width="80%" height={16} /></View>
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
          variant="titleMedium"
          style={{
            color: theme.colors.onSurface,
            textAlign: "center",
            fontWeight: "600",
            marginBottom: 8,
            maxWidth: 280,
          }}
        >
          {emptyCopy.title}
        </Text>
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
        variant="titleMedium"
        style={{
          color: theme.colors.onSurface,
          textAlign: "center",
          fontWeight: "600",
          marginBottom: 8,
          maxWidth: 280,
        }}
      >
        {emptyCopy.title}
      </Text>
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
          {groupByLedgerDateSection(
            items,
            (entry) => entry.kind === "expense"
              ? entry.transaction.date
              : entry.settlement.created_at,
            new Date(),
          ).map((section) => (
            <View key={section.label}>
              <LedgerDateLabel label={section.label} />
              {section.items.map((item) => (
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
            </View>
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
