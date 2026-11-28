import React, { useEffect, useState } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { Appbar, Text, useTheme } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { GroupDashboard } from "../components/GroupDashboard";
import { GroupDenseCard } from "../components/GroupDenseCard";
import { MembersList } from "../components/MembersList";
import { SettledFoldRow } from "../components/SettledFoldRow";
import { LedgerDateLabel, LedgerRow } from "../components/TransactionsSection";
import { WEB_MAX_WIDTH } from "../constants/layout";
import { useThemePreference } from "../contexts/ThemePreferenceContext";
import type { Balance, Group, Participant, Settlement, Transaction } from "../types";
import { DENSE_CARD_GAP } from "../utils/denseListTokens";
import { readDenseCardsFrame, type DenseCardsFrame } from "../utils/denseCardsShots";
import { groupByLedgerDateSection } from "../utils/ledgerDateSections";
import { buildTransactionsLedger } from "../utils/transactionsLedger";

export type { DenseCardsFrame };
export { readDenseCardsFrame };

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

const HOME_GROUPS: Array<{
  group: Group;
  balances: Balance[];
}> = [
  {
    group: {
      id: "g-goa",
      name: "Goa trip",
      created_by: VIEWER,
      created_at: "2026-11-01",
      updated_at: "2026-11-12",
      user_status: "active",
    },
    balances: goaBalances,
  },
  {
    group: {
      id: "g-flat",
      name: "Flat 4B",
      created_by: VIEWER,
      created_at: "2026-10-01",
      updated_at: "2026-11-10",
      user_status: "active",
    },
    balances: [
      { user_id: VIEWER, participant_id: "p-you", full_name: "You", amount: -640, currency: "INR" },
      { user_id: "u-asha", participant_id: "p-asha", full_name: "Asha Rao", amount: 640, currency: "INR" },
    ],
  },
  {
    group: {
      id: "g-settled",
      name: "Book club",
      created_by: VIEWER,
      created_at: "2026-09-01",
      updated_at: "2026-11-02",
      user_status: "active",
    },
    balances: [
      { user_id: VIEWER, participant_id: "p-you", full_name: "You", amount: 0, currency: "INR" },
      { user_id: "u-meera", participant_id: "p-meera", full_name: "Meera Shah", amount: 0, currency: "INR" },
    ],
  },
];

/**
 * __DEV__ fixture for #549 slice (a) screenshots. Demo names only, no network.
 * Open with /app?preview=dense-cards&frame=home|group|transactions&colorScheme=light
 */
export function DenseCardsPreviewScreen({ frame }: { frame: DenseCardsFrame }) {
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

  const title = frame === "home"
    ? "Groups"
    : frame === "transactions"
      ? "Goa trip"
      : "Goa trip";

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <View style={styles.column} testID={`dense-cards-frame-${frame}`}>
        <Appbar.Header style={{ backgroundColor: theme.colors.background }}>
          {frame === "home" ? null : <Appbar.BackAction />}
          <Appbar.Content title={title} titleStyle={{ fontWeight: "bold" }} />
        </Appbar.Header>
        <ScrollView contentContainerStyle={styles.body}>
          {frame === "home" ? <HomeFrame /> : null}
          {frame === "group" ? <GroupFrame /> : null}
          {frame === "transactions" ? <TransactionsFrame /> : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function HomeFrame() {
  const theme = useTheme();
  const [settledOpen, setSettledOpen] = useState(false);
  const open = HOME_GROUPS.filter((row) => row.group.id !== "g-settled");
  const settled = HOME_GROUPS.filter((row) => row.group.id === "g-settled");
  return (
    <View>
      <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>You're owed</Text>
        <Text style={{ fontSize: 40, lineHeight: 48, fontWeight: "700", color: theme.colors.onSurface }}>₹2,250</Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>Across 2 groups</Text>
      </View>
      <View style={styles.denseList}>
        {open.map((row) => (
          <GroupDenseCard
            key={row.group.id}
            group={row.group}
            currentUserId={VIEWER}
            balances={row.balances}
            loading={false}
            onPress={() => {}}
          />
        ))}
      </View>
      <SettledFoldRow
        count={settled.length}
        expanded={settledOpen}
        onPress={() => setSettledOpen((open) => !open)}
        style={styles.fold}
      />
      {settledOpen ? (
        <View style={styles.denseList}>
          {settled.map((row) => (
            <GroupDenseCard
              key={row.group.id}
              group={row.group}
              currentUserId={VIEWER}
              balances={row.balances}
              loading={false}
              onPress={() => {}}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function GroupFrame() {
  const theme = useTheme();
  return (
    <View>
      <GroupDashboard
        groupName="Goa trip"
        balances={goaBalances}
        currentUserId={VIEWER}
        currentUserParticipantId="p-you"
        loading={false}
        settleListOpen
        activeMemberCount={4}
        membersKnown
        hasNonZeroBalance
        participants={participants}
        defaultCurrency="INR"
        onOpenSettle={() => {}}
      />
      <Text
        variant="labelSmall"
        style={{
          color: theme.colors.onSurfaceVariant,
          paddingHorizontal: 16,
          marginTop: 20,
          marginBottom: 8,
          fontWeight: "600",
          letterSpacing: 0.5,
        }}
      >
        MEMBERS
      </Text>
      <View style={{ paddingHorizontal: 16 }}>
        <MembersList
          people={participants}
          currentUserId={VIEWER}
          canManageMembers={false}
          removingMemberId={null}
          onRemove={() => {}}
        />
      </View>
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
  body: {
    paddingBottom: 48,
  },
  denseList: {
    gap: DENSE_CARD_GAP,
    paddingHorizontal: 16,
  },
  fold: {
    paddingHorizontal: 16,
    marginTop: 4,
  },
});
