import React, { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Appbar, Text, useTheme } from "react-native-paper";
import type { ActivityItem, Participant, Settlement, Transaction } from "../types";
import type { LedgerNameMember } from "../utils/ledgerNames";
import type { RateBook } from "../utils/currencyMerge";
import {
  buildExpenseDetailModel,
  buildPaymentDetailModel,
  type TransactionDetailModel,
} from "../utils/transactionDetail";
import { ExpenseReceiptGallery } from "../components/ExpenseReceipts";
import { normalizeTransactionReceipts } from "../utils/expenseReceipts";
import { useActivity } from "../hooks/useActivity";

export function TransactionDetailView({
  model,
  onBack,
  onEdit,
  historyOpen,
  onToggleHistory,
  historyLines,
  historyLoading,
}: {
  model: TransactionDetailModel;
  onBack: () => void;
  onEdit?: () => void;
  historyOpen: boolean;
  onToggleHistory: () => void;
  historyLines: string[];
  historyLoading: boolean;
}) {
  const theme = useTheme();
  const muted = { color: theme.colors.onSurfaceVariant };
  const hairline = {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.outlineVariant,
  };
  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]} testID="transaction-detail">
      <Appbar.Header style={{ backgroundColor: theme.colors.background }}>
        <Appbar.BackAction onPress={onBack} accessibilityLabel="Navigate back" />
        <Appbar.Content title="" />
        {onEdit ? (
          <Text
            variant="titleMedium"
            onPress={onEdit}
            accessibilityRole="button"
            accessibilityLabel="Edit"
            testID="transaction-detail-edit"
            style={{ color: theme.colors.primary, fontWeight: "600", marginRight: 12 }}
          >
            Edit
          </Text>
        ) : null}
      </Appbar.Header>
      <ScrollView contentContainerStyle={styles.body}>
        <Text variant="titleMedium" style={styles.title}>{model.title}</Text>
        <Text testID="transaction-detail-amount" style={styles.amount}>{model.amountText}</Text>
        <Text variant="bodySmall" style={muted}>{model.metaLine}</Text>
        {model.rateLine ? (
          <Text variant="bodySmall" testID="transaction-detail-rate" style={[muted, styles.rate]}>
            {model.rateLine}
          </Text>
        ) : null}
        {model.yourLine ? (
          <Text variant="titleMedium" testID="transaction-detail-your-line" style={styles.yourLine}>
            {model.yourLine}
          </Text>
        ) : null}
        {model.receipts && model.receipts.length > 0 ? (
          <ExpenseReceiptGallery receipts={model.receipts} />
        ) : null}
        {model.paidBy ? (
          <View style={[styles.pair, hairline]}>
            <Text variant="bodySmall" style={muted}>Paid by</Text>
            <Text variant="bodyLarge">{model.paidBy}</Text>
          </View>
        ) : null}
        {model.paidTo ? (
          <View style={[styles.pair, hairline]}>
            <Text variant="bodySmall" style={muted}>Paid to</Text>
            <Text variant="bodyLarge">{model.paidTo}</Text>
          </View>
        ) : null}
        {model.split.mode === "equal" ? (
          <View style={styles.splitBlock}>
            <Text variant="bodyMedium" testID="transaction-detail-equal">{model.split.line}</Text>
            {model.split.names.map((name) => (
              <Text key={name} variant="bodyLarge" style={styles.splitName}>{name}</Text>
            ))}
          </View>
        ) : null}
        {model.split.mode === "unequal" ? (
          <View style={styles.splitBlock}>
            <Text variant="bodySmall" style={muted}>Split</Text>
            {model.split.people.map((person) => (
              <View key={`${person.name}-${person.amountText}`} style={styles.splitRow}>
                <Text variant="bodyLarge">{person.name}</Text>
                <Text variant="bodyLarge">{person.amountText}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <Text
          variant="bodySmall"
          testID="transaction-detail-history"
          onPress={onToggleHistory}
          accessibilityRole="button"
          style={[muted, styles.history]}
        >
          {model.historySummary} ›
        </Text>
        {historyOpen ? (
          <View testID="transaction-detail-history-body">
            {historyLoading ? (
              <Text variant="bodySmall" style={muted}>Loading history…</Text>
            ) : historyLines.length === 0 ? (
              <Text variant="bodySmall" style={muted}>No earlier edits</Text>
            ) : historyLines.map((line) => (
              <Text key={line} variant="bodySmall" style={[muted, styles.historyLine]}>{line}</Text>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function historyLinesFor(
  activities: ActivityItem[],
  transactionId?: number,
  settlementId?: string,
): string[] {
  return activities
    .filter((item) => (
      (transactionId != null && item.transaction_id === transactionId)
      || (settlementId != null && item.settlement_id === settlementId)
    ))
    .map((item) => item.description)
    .filter((line) => line.trim().length > 0);
}

export function TransactionDetailScreen({
  transaction,
  settlement,
  onBack,
  onEdit,
  viewerUserId,
  viewerParticipantId,
  participants,
  members,
  groupId,
  now,
  unifyEnabled,
  settlementCurrency,
  rateBook,
}: {
  transaction?: Transaction | null;
  settlement?: Settlement | null;
  onBack: () => void;
  onEdit?: () => void;
  viewerUserId?: string | null;
  viewerParticipantId?: string | null;
  participants?: Participant[];
  members?: LedgerNameMember[];
  groupId?: string | null;
  now?: Date;
  unifyEnabled?: boolean;
  settlementCurrency?: string | null;
  rateBook?: RateBook | null;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const activity = useActivity(groupId, { enabled: historyOpen });
  const shared = {
    viewerUserId,
    viewerParticipantId,
    participants,
    members,
    now,
    unifyEnabled,
    settlementCurrency,
    rateBook,
  };
  const model = transaction
    ? buildExpenseDetailModel({ transaction, ...shared })
    : settlement
      ? buildPaymentDetailModel({ settlement, ...shared })
      : null;
  if (!model) return null;
  const lines = historyLinesFor(
    activity.data.activities,
    transaction?.id,
    settlement?.id,
  );
  return (
    <TransactionDetailView
      model={model}
      onBack={onBack}
      onEdit={onEdit}
      historyOpen={historyOpen}
      onToggleHistory={() => setHistoryOpen((open) => !open)}
      historyLines={lines}
      historyLoading={historyOpen && activity.isLoading}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: 20, paddingBottom: 40 },
  title: { fontWeight: "600", marginTop: 8 },
  amount: { fontSize: 40, lineHeight: 48, fontWeight: "700", letterSpacing: -0.8, marginTop: 8 },
  rate: { marginTop: 4 },
  yourLine: { marginTop: 28, fontWeight: "500" },
  pair: {
    marginTop: 28,
    paddingBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  splitBlock: { marginTop: 28, gap: 10 },
  splitName: { marginTop: 4 },
  splitRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  history: { marginTop: 36 },
  historyLine: { marginTop: 8 },
});
