import React, { useEffect } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { Appbar, useTheme } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { GroupDashboard } from "../components/GroupDashboard";
import { HomeSettleUpList } from "../components/HomeSettleUpList";
import { SettlePayStep } from "../components/SettlePayStep";
import { SettleUpPlan } from "../components/SettleUpPlan";
import { LedgerDateLabel, LedgerRow } from "../components/TransactionsSection";
import { WEB_MAX_WIDTH } from "../constants/layout";
import { useThemePreference } from "../contexts/ThemePreferenceContext";
import type { Balance, Participant, Settlement, Transaction } from "../types";
import { homeSettleGroups } from "../utils/homeSettleGroups";
import { groupByLedgerDateSection } from "../utils/ledgerDateSections";
import { simplestSettlementPlan } from "../utils/simplestSettlementPlan";
import { readSettleUpFrame, type SettleUpFrame } from "../utils/settleUpShots";
import { buildTransactionsLedger } from "../utils/transactionsLedger";

export type { SettleUpFrame };
export { readSettleUpFrame };

const VIEWER = "u-you";
const NOW = new Date(2026, 10, 12, 15, 0, 0);

const participants: Participant[] = [
  { id: "p-you", group_id: "g-goa", user_id: VIEWER, type: "member", full_name: "You" },
  { id: "p-asha", group_id: "g-goa", user_id: "u-asha", type: "member", full_name: "Asha Rao" },
  { id: "p-rohan", group_id: "g-goa", user_id: "u-rohan", type: "member", full_name: "Rohan Iyer" },
  { id: "p-meera", group_id: "g-goa", user_id: "u-meera", type: "member", full_name: "Meera Shah" },
];

const goaBalances: Balance[] = [
  { user_id: VIEWER, participant_id: "p-you", full_name: "You", amount: 2250, currency: "INR" },
  { user_id: "u-asha", participant_id: "p-asha", full_name: "Asha Rao", amount: -2250, currency: "INR" },
  { user_id: "u-rohan", participant_id: "p-rohan", full_name: "Rohan Iyer", amount: 800, currency: "INR" },
  { user_id: "u-meera", participant_id: "p-meera", full_name: "Meera Shah", amount: -800, currency: "INR" },
];

const goaSettled: Balance[] = goaBalances.map((row) => ({ ...row, amount: 0 }));

const flatBalances: Balance[] = [
  { user_id: VIEWER, participant_id: "p-you", full_name: "You", amount: -640, currency: "INR" },
  { user_id: "u-asha", participant_id: "p-asha", full_name: "Asha Rao", amount: 640, currency: "INR" },
];

const dinner: Transaction = {
  id: 1,
  description: "Dinner at Thalassa",
  date: "2026-11-12",
  amount: 4800,
  type: "expense",
  currency: "INR",
  paid_by: "u-rohan",
  paid_by_participant_id: "p-rohan",
  splits: [
    { participant_id: "p-you", user_id: VIEWER, amount: 1200, full_name: "You" },
    { participant_id: "p-asha", user_id: "u-asha", amount: 1200, full_name: "Asha Rao" },
    { participant_id: "p-rohan", user_id: "u-rohan", amount: 1200, full_name: "Rohan Iyer" },
    { participant_id: "p-meera", user_id: "u-meera", amount: 1200, full_name: "Meera Shah" },
  ],
};

const scooter: Transaction = {
  id: 2,
  description: "Scooter rental",
  date: "2026-11-12",
  amount: 2100,
  type: "expense",
  currency: "INR",
  paid_by: VIEWER,
  paid_by_participant_id: "p-you",
  splits: [
    { participant_id: "p-you", user_id: VIEWER, amount: 700, full_name: "You" },
    { participant_id: "p-rohan", user_id: "u-rohan", amount: 700, full_name: "Rohan Iyer" },
    { participant_id: "p-meera", user_id: "u-meera", amount: 700, full_name: "Meera Shah" },
  ],
};

const taxi: Transaction = {
  id: 3,
  description: "Taxi to airport",
  date: "2026-11-11",
  amount: 900,
  type: "expense",
  currency: "INR",
  paid_by: "u-meera",
  paid_by_participant_id: "p-meera",
  splits: [
    { participant_id: "p-meera", user_id: "u-meera", amount: 450, full_name: "Meera Shah" },
    { participant_id: "p-rohan", user_id: "u-rohan", amount: 450, full_name: "Rohan Iyer" },
  ],
};

const payment: Settlement = {
  id: "pay-1",
  group_id: "g-goa",
  from_user_id: "u-rohan",
  to_user_id: VIEWER,
  from_participant_id: "p-rohan",
  to_participant_id: "p-you",
  amount: 1000,
  currency: "INR",
  created_by: "u-rohan",
  created_at: "2026-11-11T18:00:00.000Z",
};

const goaPayments = simplestSettlementPlan(goaBalances);
const flatPayments = simplestSettlementPlan(flatBalances);
const homeRows = homeSettleGroups([
  { groupId: "g-goa", groupName: "Goa trip", balances: goaBalances },
  { groupId: "g-flat", groupName: "Flat 4B", balances: flatBalances },
], VIEWER, "p-you");

/**
 * __DEV__ fixture for #549 slice (b) screenshots. Demo names only, no network.
 * Open with /?preview=settle-up&frame=plan|home|pay|after|transactions&colorScheme=light
 */
export function SettleUpPreviewScreen({ frame }: { frame: SettleUpFrame }) {
  const theme = useTheme();
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

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <View style={styles.column} testID={`settle-up-frame-${frame}`}>
        {frame === "plan" ? (
          <SettleUpPlan
            groupName="Goa trip"
            payments={goaPayments}
            currentUserId={VIEWER}
            currentParticipantId="p-you"
            onBack={() => {}}
            onAction={() => {}}
          />
        ) : null}
        {frame === "home" ? (
          <HomeSettleUpList
            rows={homeRows}
            onBack={() => {}}
            onOpenGroup={() => {}}
          />
        ) : null}
        {frame === "pay" ? (
          <SettlePayStep
            payment={flatPayments[0]}
            onBack={() => {}}
            onChoose={() => {}}
          />
        ) : null}
        {frame === "after" ? (
          <AfterSettleFrame />
        ) : null}
        {frame === "transactions" ? (
          <TransactionsFrame />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function AfterSettleFrame() {
  const theme = useTheme();
  const ticked = new Set(goaPayments.map((row) => row.key));
  return (
    <View style={{ flex: 1 }}>
      <Appbar.Header style={{ backgroundColor: theme.colors.background }}>
        <Appbar.BackAction />
        <Appbar.Content title="Goa trip" titleStyle={{ fontWeight: "bold" }} />
      </Appbar.Header>
      <ScrollView>
        <GroupDashboard
          groupName="Goa trip"
          balances={goaSettled}
          currentUserId={VIEWER}
          currentUserParticipantId="p-you"
          loading={false}
          settleListOpen
          activeMemberCount={4}
          membersKnown
          participants={participants}
          defaultCurrency="INR"
        />
        <SettleUpPlan
          groupName="Goa trip"
          payments={goaPayments}
          currentUserId={VIEWER}
          currentParticipantId="p-you"
          tickedKeys={ticked}
          embedded
          onBack={() => {}}
          onAction={() => {}}
        />
      </ScrollView>
    </View>
  );
}

function TransactionsFrame() {
  const items = buildTransactionsLedger([dinner, scooter, taxi], [payment], "all");
  const sections = groupByLedgerDateSection(
    items,
    (item) => item.kind === "expense" ? item.transaction.date : item.settlement.created_at,
    NOW,
  );
  return (
    <View>
      <Appbar.Header>
        <Appbar.BackAction />
        <Appbar.Content title="Goa trip" titleStyle={{ fontWeight: "bold" }} />
      </Appbar.Header>
      {sections.map((section) => (
        <View key={section.label}>
          <LedgerDateLabel label={section.label} />
          {section.items.map((item) => (
            <LedgerRow
              key={item.key}
              item={item}
              participants={participants}
              viewerUserId={VIEWER}
              onEditExpense={() => {}}
              onEditPayment={() => {}}
            />
          ))}
        </View>
      ))}
    </View>
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
});
