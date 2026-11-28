import React, { useMemo } from "react";
import { Modal, Platform, ScrollView, StyleSheet, View } from "react-native";
import {
  ActivityIndicator,
  Appbar,
  Text,
  TouchableRipple,
  useTheme,
} from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { WEB_MAX_WIDTH } from "../constants/layout";
import type { Balance, Participant, Settlement, Transaction } from "../types";
import {
  buildBalanceBreakdown,
  type BalanceBreakdownEntry,
} from "../utils/balanceBreakdown";
import { emptyRateBook, type RateBook } from "../utils/currencyMerge";
import { getDefaultCurrency } from "../utils/currency";
import { balanceAmountColor } from "../utils/balanceRowLabels";
import { formatShareCurrency } from "../utils/settleShareMessage";
import { settlementCounterpartyShortName } from "../utils/settlementPresence";

interface BalanceBreakdownScreenProps {
  visible: boolean;
  balance: Balance | null;
  expenses: Transaction[];
  settlements: Settlement[];
  participants: Participant[];
  currentUserId?: string;
  currentUserParticipantId?: string;
  loading?: boolean;
  unifyEnabled?: boolean;
  settlementCurrency?: string;
  defaultCurrency?: string;
  rateBook?: RateBook;
  onDismiss: () => void;
  onSettleUp?: (balance: Balance) => void;
  /** Preview shots render the sheet in the page instead of a modal. */
  embedded?: boolean;
}

function signedAmount(amount: number, currency: string): string {
  return formatShareCurrency(Math.abs(amount), currency);
}

function headline(name: string, amount: number): string {
  if (Math.abs(amount) < 0.005) return `You're even with ${name}`;
  return amount > 0 ? `${name} owes you` : `You owe ${name}`;
}

function EffectAmount({
  amount,
  currency,
  testID,
}: {
  amount: number;
  currency: string;
  testID?: string;
}) {
  const theme = useTheme();
  const color = balanceAmountColor(amount, theme.colors, { dark: theme.dark });
  return (
    <Text variant="titleSmall" testID={testID} style={{ color, fontWeight: "700" }}>
      {signedAmount(amount, currency)}
    </Text>
  );
}

function EntryRow({
  entry,
  isLast,
}: {
  entry: BalanceBreakdownEntry;
  isLast: boolean;
}) {
  const theme = useTheme();
  const hairline = {
    borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.outlineVariant,
  };

  const paidLine = (() => {
    switch (entry.kind) {
      case "expense":
        return `${entry.paidByName} paid`;
      case "settlement":
        return `${entry.paidByName} paid`;
      default: {
        const _exhaustive: never = entry.kind;
        return _exhaustive;
      }
    }
  })();

  return (
    <View
      style={[styles.entry, hairline]}
      testID={`balance-breakdown-entry-${entry.id}`}
    >
      <View style={styles.entryMain}>
        <Text variant="bodyLarge" style={{ color: theme.colors.onSurface }}>
          {entry.description}
        </Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
          {entry.date ? `${entry.date} · ${paidLine}` : paidLine}
        </Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
          {entry.shareLabel}{" "}
          {formatShareCurrency(Math.abs(entry.shareAmount), entry.currency)}
        </Text>
      </View>
      <View style={styles.entryAmounts}>
        <EffectAmount amount={entry.effect} currency={entry.currency} />
        <Text
          variant="labelSmall"
          style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}
          testID={`balance-breakdown-running-${entry.id}`}
        >
          {signedAmount(entry.running, entry.currency)}
        </Text>
      </View>
    </View>
  );
}

export function BalanceBreakdownView({
  balance,
  expenses,
  settlements,
  participants,
  currentUserId,
  currentUserParticipantId,
  loading = false,
  unifyEnabled = false,
  settlementCurrency,
  defaultCurrency = getDefaultCurrency(),
  rateBook,
  onDismiss,
  onSettleUp,
}: Omit<BalanceBreakdownScreenProps, "visible" | "embedded">) {
  const theme = useTheme();
  const name = balance
    ? settlementCounterpartyShortName(balance, participants, currentUserId)
    : "Them";
  const currency = (balance?.currency || settlementCurrency || defaultCurrency).toUpperCase();

  const result = useMemo(() => {
    if (!balance) {
      return { entries: [], total: 0, currency };
    }
    return buildBalanceBreakdown({
      expenses,
      settlements,
      participants,
      viewer: {
        participantId: currentUserParticipantId,
        userId: currentUserId,
      },
      other: {
        participantId: balance.participant_id,
        userId: balance.user_id,
      },
      currency,
      viewerName: "You",
      otherName: name,
      unifyEnabled,
      settlementCurrency: settlementCurrency || currency,
      defaultCurrency,
      rateBook: rateBook ?? emptyRateBook(),
    });
  }, [
    balance,
    currency,
    currentUserId,
    currentUserParticipantId,
    defaultCurrency,
    expenses,
    name,
    participants,
    rateBook,
    settlementCurrency,
    settlements,
    unifyEnabled,
  ]);

  const total = result.total;
  const settled = Math.abs(total) < 0.005;
  const amountColor = settled
    ? theme.colors.onSurface
    : balanceAmountColor(total, theme.colors, { dark: theme.dark });
  const showSettle = Boolean(onSettleUp && balance && !settled);

  return (
    <View
      style={[styles.screen, { backgroundColor: theme.colors.background }]}
      testID="balance-breakdown"
    >
      <Appbar.Header style={{ backgroundColor: theme.colors.background }}>
        <Appbar.BackAction
          onPress={onDismiss}
          accessibilityLabel="Close balance breakdown"
        />
        <Appbar.Content title={name} />
      </Appbar.Header>
      {loading ? (
        <View style={styles.loading} testID="balance-breakdown-loading">
          <ActivityIndicator />
          <Text
            variant="bodyMedium"
            style={{ color: theme.colors.onSurfaceVariant, marginTop: 12 }}
          >
            Loading expenses…
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <Text
            variant="bodyMedium"
            style={{ color: theme.colors.onSurfaceVariant }}
            testID="balance-breakdown-headline"
          >
            {headline(name, total)}
          </Text>
          <Text
            testID="balance-breakdown-total"
            style={[styles.hero, { color: amountColor }]}
          >
            {formatShareCurrency(Math.abs(total), result.currency)}
          </Text>

          {result.entries.length === 0 ? (
            <View style={styles.empty} testID="balance-breakdown-empty">
              <Text
                variant="bodyMedium"
                style={{ color: theme.colors.onSurfaceVariant, textAlign: "center" }}
              >
                {settled
                  ? `You're even with ${name}. Nothing to settle.`
                  : "No expenses or payments to show yet."}
              </Text>
            </View>
          ) : (
            <View
              style={[
                styles.list,
                {
                  borderColor: theme.colors.outlineVariant,
                  backgroundColor: theme.colors.surface,
                },
              ]}
              testID="balance-breakdown-list"
            >
              {result.entries.map((entry, index) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  isLast={index === result.entries.length - 1}
                />
              ))}
            </View>
          )}

          <View
            style={[styles.footer, { borderTopColor: theme.colors.outlineVariant }]}
            testID="balance-breakdown-footer"
          >
            <Text variant="titleSmall" style={{ color: theme.colors.onSurface }}>
              Total
            </Text>
            <EffectAmount
              amount={total}
              currency={result.currency}
              testID="balance-breakdown-footer-amount"
            />
          </View>

          {showSettle ? (
            <TouchableRipple
              testID="balance-breakdown-settle"
              onPress={() => balance && onSettleUp?.(balance)}
              accessibilityRole="button"
              accessibilityLabel="Settle up"
              style={[styles.settleButton, { backgroundColor: theme.colors.primary }]}
            >
              <Text style={{ color: theme.colors.onPrimary, fontWeight: "600" }}>
                Settle up
              </Text>
            </TouchableRipple>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

export function BalanceBreakdownScreen(props: BalanceBreakdownScreenProps) {
  const { visible, embedded, onDismiss } = props;
  const theme = useTheme();

  const body = (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.colors.background }]}
      edges={["bottom"]}
    >
      <View style={styles.frame}>
        <BalanceBreakdownView {...props} />
      </View>
    </SafeAreaView>
  );

  if (embedded) return body;
  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onDismiss}
      presentationStyle="pageSheet"
      testID="balance-breakdown-modal"
    >
      {body}
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  frame: {
    flex: 1,
    width: "100%",
    maxWidth: Platform.OS === "web" ? WEB_MAX_WIDTH : undefined,
    alignSelf: "center",
  },
  screen: { flex: 1 },
  body: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  hero: {
    fontSize: 40,
    lineHeight: 48,
    fontWeight: "700",
    letterSpacing: -0.8,
    marginTop: 4,
    marginBottom: 24,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  empty: {
    paddingVertical: 32,
    alignItems: "center",
  },
  list: {
    borderWidth: 1,
    borderRadius: 8,
    overflow: "hidden",
  },
  entry: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  entryMain: {
    flex: 1,
    minWidth: 0,
  },
  entryAmounts: {
    alignItems: "flex-end",
    flexShrink: 0,
  },
  footer: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  settleButton: {
    marginTop: 24,
    minHeight: 44,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
  },
});
