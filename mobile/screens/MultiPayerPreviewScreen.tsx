import React, { useEffect, useMemo, useState } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import {
  Appbar,
  Button,
  Card,
  Chip,
  Divider,
  IconButton,
  Surface,
  Text,
  TextInput,
  useTheme,
} from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { GroupDashboard } from "../components/GroupDashboard";
import { SplitAmongEditor } from "../components/SplitAmongEditor";
import { LedgerDateLabel, LedgerRow } from "../components/TransactionsSection";
import { WEB_MAX_WIDTH } from "../constants/layout";
import { useThemePreference } from "../contexts/ThemePreferenceContext";
import type { Balance, Participant, Transaction } from "../types";
import { getCurrencySymbol } from "../utils/currency";
import { DENSE_CARD_GAP } from "../utils/denseListTokens";
import { groupByLedgerDateSection } from "../utils/ledgerDateSections";
import { readMultiPayerShot, type MultiPayerShot } from "../utils/multiPayerShots";
import { buildExpenseDetailModel } from "../utils/transactionDetail";
import { buildTransactionsLedger } from "../utils/transactionsLedger";
import { TransactionDetailView } from "./TransactionDetailScreen";

export type { MultiPayerShot };
export { readMultiPayerShot };

const VIEWER = "u-you";
const NOW = new Date(2026, 10, 12, 15, 0, 0);
const YOU = "p-you";
const ASHA = "p-asha";
const ROHAN = "p-rohan";
const MEERA = "p-meera";
const GROUP = "g-goa";

const PEOPLE: Participant[] = [
  { id: YOU, group_id: GROUP, user_id: VIEWER, type: "member", full_name: "You", email: "you@example.com" },
  { id: ASHA, group_id: GROUP, user_id: "u-asha", type: "member", full_name: "Asha", email: "asha@example.com" },
  { id: ROHAN, group_id: GROUP, user_id: "u-rohan", type: "member", full_name: "Rohan", email: "rohan@example.com" },
  { id: MEERA, group_id: GROUP, user_id: "u-meera", type: "member", full_name: "Meera", email: "meera@example.com" },
];

const dinner: Transaction = {
  id: 1,
  description: "Dinner at Thalassa",
  date: "2026-11-12",
  amount: 4800,
  type: "expense",
  category: "Food",
  currency: "INR",
  paid_by: "u-asha",
  paid_by_participant_id: ASHA,
  payers: [
    { participant_id: ASHA, user_id: "u-asha", amount: 3000, full_name: "Asha" },
    { participant_id: ROHAN, user_id: "u-rohan", amount: 1800, full_name: "Rohan" },
  ],
  splits: [
    { participant_id: YOU, user_id: VIEWER, amount: 1200, full_name: "You" },
    { participant_id: ASHA, user_id: "u-asha", amount: 1200, full_name: "Asha" },
    { participant_id: ROHAN, user_id: "u-rohan", amount: 1200, full_name: "Rohan" },
    { participant_id: MEERA, user_id: "u-meera", amount: 1200, full_name: "Meera" },
  ],
};

const goaBalances: Balance[] = [
  { user_id: VIEWER, participant_id: YOU, full_name: "You", amount: -1200, currency: "INR" },
  { user_id: "u-asha", participant_id: ASHA, full_name: "Asha", amount: 1800, currency: "INR" },
  { user_id: "u-rohan", participant_id: ROHAN, full_name: "Rohan", amount: 600, currency: "INR" },
  { user_id: "u-meera", participant_id: MEERA, full_name: "Meera", amount: -1200, currency: "INR" },
];

export function MultiPayerPreviewScreen({ shot }: { shot: MultiPayerShot }) {
  const { setThemePreference } = useThemePreference();

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const scheme = params.get("colorScheme")
      ?? (/[?&#]theme=dark/i.test(window.location.href) ? "dark" : null);
    if (scheme === "light" || scheme === "dark") {
      void setThemePreference(scheme);
    }
  }, [setThemePreference]);

  switch (shot) {
    case "list":
      return <ListPreview />;
    case "detail":
      return <DetailPreview />;
    case "balances":
      return <BalancesPreview />;
    case "add-single":
    case "add-amount":
    case "add-shares":
      return <AddPreview shot={shot} />;
    default: {
      const _exhaustive: never = shot;
      return _exhaustive;
    }
  }
}

function AddPreview({ shot }: { shot: "add-single" | "add-amount" | "add-shares" }) {
  const theme = useTheme();
  const multiple = shot !== "add-single";
  const sharesMode = shot === "add-shares";
  const [amounts, setAmounts] = useState<Record<string, string>>(
    shot === "add-amount" ? { [ASHA]: "3000.00", [ROHAN]: "" } : {},
  );
  const [shares, setShares] = useState<Record<string, number>>(
    sharesMode ? { [ASHA]: 2, [ROHAN]: 1 } : { [ASHA]: 1, [ROHAN]: 1 },
  );
  const selectedIds = useMemo(
    () => (multiple ? [ASHA, ROHAN] : [YOU]),
    [multiple],
  );

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.colors.background }]} edges={["top", "left", "right"]}>
      <View style={styles.column} testID={`multi-payer-shot-${shot}`}>
        <Appbar.Header style={{ backgroundColor: theme.colors.background }} elevated={false}>
          <IconButton icon="arrow-left" iconColor={theme.colors.onSurface} accessibilityLabel="Navigate back" />
          <Appbar.Content title="Add Expense" titleStyle={{ fontWeight: "600" }} />
        </Appbar.Header>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.hero}>
            <Text variant="displayMedium" style={{ color: theme.colors.onSurface, fontWeight: "300" }}>
              {getCurrencySymbol("INR")}4,800
            </Text>
            <Chip mode="outlined" style={{ marginTop: 12 }}>INR</Chip>
          </View>

          <Card mode="outlined" style={styles.card}>
            <Card.Content>
              <TextInput
                label="Description"
                value="Dinner at Thalassa"
                mode="flat"
                onChangeText={() => {}}
                left={<TextInput.Icon icon="pencil-outline" />}
              />
              <Divider style={styles.divider} />
              <View style={styles.row}>
                <IconButton icon="calendar-outline" size={24} />
                <View>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>Date</Text>
                  <Text variant="bodyLarge">Wed, Nov 12</Text>
                </View>
              </View>
            </Card.Content>
          </Card>

          <Card mode="outlined" style={styles.card}>
            <Card.Content>
              <View style={styles.headerRow}>
                <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant }}>
                  Paid by
                </Text>
                <Button mode="text" compact testID="paid-by-mode-toggle">
                  {multiple ? "One person" : "Multiple people"}
                </Button>
              </View>
              {multiple ? (
                <SplitAmongEditor
                  title=""
                  hideEqual
                  editorTestID="paid-by-editor"
                  remainingTestID="paid-by-remaining-label"
                  leftoverTestID="paid-by-leftover-button"
                  chipTestIDPrefix="paid-by-chip"
                  amountTestIDPrefix="paid-by-amount-input"
                  modeTestID="paid-by-mode-dropdown"
                  exactLabel="Payers add up: "
                  leftLabel="Left to assign: "
                  overLabel="Over by: "
                  participants={PEOPLE}
                  selectedIds={selectedIds}
                  amounts={amounts}
                  shares={shares}
                  mode={sharesMode ? "shares" : "unequal"}
                  totalAmount={4800}
                  currency="INR"
                  areAllSelected={false}
                  onToggleMember={() => {}}
                  onToggleAll={() => {}}
                  onModeChange={() => {}}
                  onAmountChange={(participantId, text) => {
                    setAmounts((current) => ({ ...current, [participantId]: text }));
                  }}
                  onShareChange={(participantId, next) => {
                    setShares((current) => ({ ...current, [participantId]: next }));
                  }}
                  onSplitRemaining={() => {}}
                />
              ) : (
                <View style={styles.chips}>
                  {PEOPLE.map((person) => (
                    <Chip
                      key={person.id}
                      selected={person.id === YOU}
                      showSelectedCheck
                      testID={`paid-by-chip-${person.email || person.id}`}
                    >
                      {person.full_name}
                    </Chip>
                  ))}
                </View>
              )}
              <Divider style={styles.divider} />
              <SplitAmongEditor
                participants={PEOPLE}
                selectedIds={PEOPLE.map((person) => person.id)}
                amounts={{}}
                shares={{ [YOU]: 1, [ASHA]: 1, [ROHAN]: 1, [MEERA]: 1 }}
                mode="equal"
                totalAmount={4800}
                currency="INR"
                areAllSelected
                onToggleMember={() => {}}
                onToggleAll={() => {}}
                onModeChange={() => {}}
                onAmountChange={() => {}}
                onShareChange={() => {}}
                onSplitRemaining={() => {}}
              />
            </Card.Content>
          </Card>
        </ScrollView>
        <Surface style={[styles.footer, { backgroundColor: theme.colors.elevation.level2 }]} elevation={2}>
          <Button mode="contained" testID="save-expense-button">Save expense</Button>
        </Surface>
      </View>
    </SafeAreaView>
  );
}

function ListPreview() {
  const theme = useTheme();
  const items = buildTransactionsLedger([dinner], [], "all");
  const sections = groupByLedgerDateSection(
    items,
    (item) => item.kind === "expense" ? item.transaction.date : item.settlement.created_at,
    NOW,
  );
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <View style={styles.column} testID="multi-payer-shot-list">
        <Appbar.Header style={{ backgroundColor: theme.colors.background }}>
          <Appbar.BackAction />
          <Appbar.Content title="Goa trip" titleStyle={{ fontWeight: "bold" }} />
        </Appbar.Header>
        <ScrollView contentContainerStyle={styles.body}>
          {sections.map((section) => (
            <View key={section.label}>
              <LedgerDateLabel label={section.label} />
              {section.items.map((item) => (
                <LedgerRow
                  key={item.key}
                  item={item}
                  participants={PEOPLE}
                  viewerUserId={VIEWER}
                  onEditExpense={() => {}}
                />
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function DetailPreview() {
  const theme = useTheme();
  const model = buildExpenseDetailModel({
    transaction: dinner,
    viewerUserId: VIEWER,
    viewerParticipantId: YOU,
    participants: PEOPLE,
    now: NOW,
  });
  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]} testID="multi-payer-shot-detail">
      <View style={styles.column}>
        <TransactionDetailView
          model={model}
          onBack={() => {}}
          historyOpen={false}
          onToggleHistory={() => {}}
          historyLines={[]}
          historyLoading={false}
        />
      </View>
    </View>
  );
}

function BalancesPreview() {
  const theme = useTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <View style={styles.column} testID="multi-payer-shot-balances">
        <Appbar.Header style={{ backgroundColor: theme.colors.background }}>
          <Appbar.BackAction />
          <Appbar.Content title="Goa trip" titleStyle={{ fontWeight: "bold" }} />
        </Appbar.Header>
        <ScrollView contentContainerStyle={styles.body}>
          <GroupDashboard
            groupName="Goa trip"
            balances={goaBalances}
            currentUserId={VIEWER}
            currentUserParticipantId={YOU}
            loading={false}
            settleListOpen
            activeMemberCount={4}
            membersKnown
            hasNonZeroBalance
            participants={PEOPLE}
            defaultCurrency="INR"
            onOpenSettle={() => {}}
          />
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  column: {
    flex: 1,
    width: "100%",
    maxWidth: WEB_MAX_WIDTH,
    alignSelf: "center",
  },
  content: {
    padding: 16,
    paddingBottom: 120,
  },
  body: {
    paddingBottom: 48,
    gap: DENSE_CARD_GAP,
  },
  hero: {
    alignItems: "center",
    paddingVertical: 24,
  },
  card: {
    marginBottom: 16,
    borderRadius: 16,
  },
  divider: {
    marginVertical: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
});
