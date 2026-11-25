import React from "react";
import { StyleSheet, View } from "react-native";
import { Appbar, Provider as PaperProvider, Text, useTheme } from "react-native-paper";
import { GroupDashboard } from "../components/GroupDashboard";
import { darkTheme, lightTheme } from "../theme";
import type { Balance, Participant, Settlement, Transaction } from "../types";
import { calculateEqualSplits } from "../utils/splits";
import { BalanceBreakdownScreen } from "./BalanceBreakdownScreen";

export type BalanceBreakdownShot = "row" | "sheet";

export function readBalanceBreakdownShot(url: string | null | undefined): BalanceBreakdownShot {
  const match = /[?&#]shot=(row|sheet)/i.exec(url || "");
  return match?.[1]?.toLowerCase() === "sheet" ? "sheet" : "row";
}

const VIEWER = "u-asha";

const participants: Participant[] = [
  { id: "p-asha", group_id: "g-flat", user_id: VIEWER, type: "member", full_name: "Asha Rao" },
  { id: "p-priya", group_id: "g-flat", user_id: "u-priya", type: "member", full_name: "Priya Shah" },
];

function expense(
  id: number,
  description: string,
  date: string,
  amount: number,
  payer: string,
  among: string[],
): Transaction {
  return {
    id,
    description,
    date,
    amount,
    type: "expense",
    currency: "INR",
    paid_by_participant_id: payer,
    splits: calculateEqualSplits(amount, among).map((share) => ({
      participant_id: share.participant_id,
      amount: share.amount,
    })),
  };
}

const expenses: Transaction[] = [
  expense(1, "Dinner at Thalassa", "2026-11-08", 1600, "p-asha", ["p-asha", "p-priya"]),
  expense(2, "Airport taxi", "2026-11-09", 600, "p-priya", ["p-asha", "p-priya"]),
  expense(3, "Weekly groceries", "2026-11-10", 1800, "p-asha", ["p-asha", "p-priya"]),
];

const settlements: Settlement[] = [
  {
    id: "s-upi",
    group_id: "g-flat",
    from_user_id: "u-priya",
    to_user_id: VIEWER,
    from_participant_id: "p-priya",
    to_participant_id: "p-asha",
    amount: 160,
    currency: "INR",
    notes: "UPI",
    created_by: "u-priya",
    created_at: "2026-11-12T08:00:00.000Z",
  },
];

const balances: Balance[] = [
  {
    user_id: VIEWER,
    participant_id: "p-asha",
    full_name: "Asha Rao",
    amount: 1240,
    currency: "INR",
  },
  {
    user_id: "u-priya",
    participant_id: "p-priya",
    full_name: "Priya Shah",
    amount: -1240,
    currency: "INR",
  },
];

const priyaRow: Balance = balances[1];

function GroupFrame({ shot }: { shot: BalanceBreakdownShot }) {
  const theme = useTheme();
  return (
    <View style={[styles.phone, { backgroundColor: theme.colors.background }]} testID={`balance-breakdown-${shot}`}>
      <Appbar.Header style={{ backgroundColor: theme.colors.background }}>
        <Appbar.BackAction />
        <Appbar.Content title="Flat 4B" titleStyle={{ fontWeight: "bold" }} />
        <Appbar.Action icon="dots-vertical" accessibilityLabel="Group options" />
      </Appbar.Header>
      <View style={styles.body}>
        <GroupDashboard
          groupName="Flat 4B"
          balances={balances}
          currentUserId={VIEWER}
          currentUserParticipantId="p-asha"
          loading={false}
          settleListOpen
          onOpenSettle={() => undefined}
          onBalancePress={() => undefined}
          onSettlePress={() => undefined}
          activeMemberCount={2}
          membersKnown
          hasNonZeroBalance
          participants={participants}
          defaultCurrency="INR"
        />
        <Text
          variant="labelSmall"
          style={{ color: theme.colors.onSurfaceVariant, marginTop: 24, marginHorizontal: 16 }}
        >
          TODAY
        </Text>
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, marginHorizontal: 16, marginTop: 8 }}>
          You added Weekly groceries
        </Text>
      </View>
      {shot === "sheet" ? (
        <View style={styles.sheet} testID="balance-breakdown-preview-sheet">
          <BalanceBreakdownScreen
            visible
            embedded
            balance={{ ...priyaRow, amount: 1240 }}
            expenses={expenses}
            settlements={settlements}
            participants={participants}
            currentUserId={VIEWER}
            currentUserParticipantId="p-asha"
            defaultCurrency="INR"
            onDismiss={() => undefined}
            onSettleUp={() => undefined}
          />
        </View>
      ) : null}
    </View>
  );
}

export function BalanceBreakdownPreviewScreen({
  shot,
  dark,
}: {
  shot: BalanceBreakdownShot;
  dark: boolean;
}) {
  const theme = dark ? darkTheme : lightTheme;
  return (
    <PaperProvider theme={theme}>
      <GroupFrame shot={shot} />
    </PaperProvider>
  );
}

const styles = StyleSheet.create({
  phone: {
    flex: 1,
    maxWidth: 390,
    alignSelf: "center",
    width: "100%",
  },
  body: {
    flex: 1,
  },
  sheet: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
});
