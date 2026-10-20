import React, { useState } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import {
  Appbar,
  Button,
  FAB,
  Icon,
  Provider as PaperProvider,
  SegmentedButtons,
  Surface,
  Text,
  TouchableRipple,
  useTheme,
} from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { BalancesSection } from "../components/BalancesSection";
import { GroupBalanceBadge } from "../components/GroupBalanceBadge";
import { GroupDashboard } from "../components/GroupDashboard";
import { TransactionsEmptyState } from "../components/TransactionsSection";
import { WEB_MAX_WIDTH } from "../constants/layout";
import { lightTheme } from "../theme";
import { Balance, GroupStatsResponse } from "../types";
import { formatCurrency } from "../utils/currency";
import { SplitBillFormPreview } from "./SplitBillScreen";

type SurfaceId =
  | "home-empty"
  | "home-list"
  | "home-no-bills"
  | "home-loading"
  | "group-home"
  | "group-loading"
  | "stats"
  | "split-loading"
  | "split-form"
  | "split-mode";

const SAMPLE_BALANCES: Balance[] = [
  {
    user_id: "u-maya",
    participant_id: "p-maya",
    amount: -24,
    currency: "USD",
    full_name: "Maya Patel",
    email: "maya@example.com",
  },
  {
    user_id: "u-you",
    participant_id: "p-you",
    amount: 24,
    currency: "USD",
    full_name: "You",
    email: "you@example.com",
  },
  {
    user_id: "u-alex",
    participant_id: "p-alex",
    amount: -18,
    currency: "USD",
    full_name: "Alex Rivera",
    email: "alex@example.com",
  },
  {
    user_id: "u-you",
    participant_id: "p-you",
    amount: 18,
    currency: "USD",
    full_name: "You",
    email: "you@example.com",
  },
];

const DETAIL_BALANCES: Balance[] = [
  { user_id: "u-alex", participant_id: "p-alex", amount: 85, currency: "USD", full_name: "Alex Rivera" },
  { user_id: "u-maya", participant_id: "p-maya", amount: -42, currency: "USD", full_name: "Maya Patel" },
  { user_id: "u-kai", participant_id: "p-kai", amount: 12, currency: "USD", full_name: "Kai Chen" },
];

const SAMPLE_GROUP_STATS: GroupStatsResponse = {
  member_breakdown: [],
  my_transactions: [],
  totals: {
    my_share: { USD: 43.21 },
    group_total: { USD: 129.63 },
    i_owe: { USD: 18 },
    im_owed: { USD: 24 },
  },
  settlement_plan: [],
};

const GROUPS = [
  {
    id: "g-roommates",
    name: "Roommates",
    description: "Utilities and groceries",
    balances: [
      { user_id: "u-you", amount: 24, currency: "USD", full_name: "You" },
    ],
  },
  {
    id: "g-trip",
    name: "Phuket trip",
    description: "Flights and dinners",
    balances: [
      {
        user_id: "u-you",
        amount: -86.4,
        currency: "USD",
        full_name: "You",
      },
    ],
  },
  {
    id: "g-even",
    name: "Book club",
    description: undefined as string | undefined,
    balances: [] as Balance[],
  },
];

function PreviewShell({
  title,
  children,
  fab,
}: {
  title: string;
  children: React.ReactNode;
  fab?: React.ReactNode;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const maxWidth = Math.min(width, WEB_MAX_WIDTH);
  return (
    <View
      style={[
        styles.shell,
        {
          backgroundColor: theme.colors.background,
          maxWidth,
          alignSelf: "center",
          width: "100%",
        },
      ]}
    >
      <Appbar.Header style={{ backgroundColor: theme.colors.background }}>
        <Appbar.Content title={title} titleStyle={{ fontWeight: "700" }} />
      </Appbar.Header>
      <ScrollView contentContainerStyle={{ paddingBottom: fab ? 96 : 32 }}>
        {children}
      </ScrollView>
      {fab}
    </View>
  );
}

function HomeEmptyPreview() {
  const theme = useTheme();
  return (
    <PreviewShell title="Your Groups">
      <View style={styles.empty} testID="preview-home-empty">
        <Text
          variant="bodyLarge"
          style={{
            color: theme.colors.onSurfaceVariant,
            textAlign: "center",
            marginBottom: 20,
            maxWidth: 280,
          }}
        >
          Start with a one-time bill, or create a group for ongoing expenses.
        </Text>
        <Button mode="contained" icon="call-split" style={{ alignSelf: "stretch", maxWidth: 320, marginBottom: 8 }}>
          Split a bill
        </Button>
        <Button mode="text">Create a group</Button>
      </View>
    </PreviewShell>
  );
}

const FORMER_GROUPS = [
  {
    id: "g-old-flat",
    name: "Old flatmates",
    description: "You left this group",
  },
  {
    id: "g-notif-test",
    name: "Notification Test",
    description: "You left this group",
  },
  {
    id: "g-sushma",
    name: "Sushma Cloth press",
    description: "You left this group",
  },
  {
    id: "g-weekend",
    name: "Weekend",
    description: "You left this group",
  },
];

const ARCHIVED_GROUPS = [
  {
    id: "g-archive",
    name: "College trip 2022",
    description: "Archived",
  },
];

function HomeListPreview({
  balancesLoading = false,
  showRecentBills = true,
}: {
  balancesLoading?: boolean;
  showRecentBills?: boolean;
}) {
  const theme = useTheme();
  const [formerExpanded, setFormerExpanded] = useState(true);
  const [archivedExpanded, setArchivedExpanded] = useState(true);
  // Newest first: Today → Yesterday → 2d ago → older.
  const recentBills = [
    { identity: "Dinner at Nora", amount: formatCurrency(42, "USD"), people: "3 people", when: "Today" },
    { identity: "Cabin weekend", amount: formatCurrency(120, "USD"), people: "4 people", when: "Yesterday" },
    { identity: "With Maya Patel", amount: formatCurrency(28.5, "EUR"), people: "2 people", when: "2d ago" },
    { identity: "Taxi home", amount: formatCurrency(18, "USD"), people: "2 people", when: "5d ago" },
  ];
  const testID = balancesLoading
    ? "preview-home-loading"
    : showRecentBills
      ? "preview-home-list"
      : "preview-home-no-bills";
  return (
    <PreviewShell title="Your Groups">
      <View style={{ paddingHorizontal: 16 }} testID={testID}>
        {/* Split a bill is always first on Home, including when Recent bills is empty. */}
        <Button
          mode="contained"
          icon="call-split"
          testID="preview-split-bill-entry"
          style={{ marginBottom: 12, alignSelf: "stretch" }}
          contentStyle={{ minHeight: 48 }}
        >
          Split a bill
        </Button>
        {showRecentBills ? (
          <View style={{ marginBottom: 16 }} testID="preview-recent-bills">
            <Text
              variant="labelLarge"
              style={{ color: theme.colors.onSurfaceVariant, marginBottom: 4, fontWeight: "700" }}
            >
              Recent bills
            </Text>
            {recentBills.slice(0, 3).map((bill) => (
              <TouchableRipple
                key={bill.identity}
                style={[styles.recentBillRow, { borderBottomColor: theme.colors.outlineVariant }]}
              >
                <View style={styles.recentBillContent}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="bodyLarge" numberOfLines={1} style={{ fontWeight: "600" }}>
                      {bill.identity}
                    </Text>
                    <Text variant="bodySmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant }}>
                      {bill.amount} · {bill.people} · {bill.when}
                    </Text>
                  </View>
                  <Icon source="chevron-right" size={20} color={theme.colors.onSurfaceVariant} />
                </View>
              </TouchableRipple>
            ))}
            <Button mode="text" compact style={{ alignSelf: "flex-start", marginTop: 4 }}>
              See all
            </Button>
          </View>
        ) : null}
        <View style={styles.groupsSectionHeader} testID="preview-groups-header">
          <Text
            variant="labelLarge"
            style={{ color: theme.colors.onSurfaceVariant, fontWeight: "700" }}
          >
            Groups
          </Text>
          <Button mode="text" compact testID="preview-new-group">
            New group
          </Button>
        </View>
        {GROUPS.map((group) => (
          <Surface
            key={group.id}
            style={[styles.groupRow, { backgroundColor: theme.colors.surface }]}
            elevation={0}
          >
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text
                variant="titleMedium"
                style={{ fontWeight: "700", color: theme.colors.onSurface, letterSpacing: -0.2 }}
              >
                {group.name}
              </Text>
              {group.description ? (
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
                  {group.description}
                </Text>
              ) : null}
            </View>
            <GroupBalanceBadge
              loading={balancesLoading}
              balanceData={balancesLoading ? undefined : { group_id: group.id, balances: group.balances }}
              currentUserId="u-you"
            />
          </Surface>
        ))}

        <View
          style={[styles.sectionAccordion, { backgroundColor: theme.colors.surface }]}
          testID="preview-archived-accordion"
        >
          <TouchableRipple
            onPress={() => setArchivedExpanded(!archivedExpanded)}
            accessibilityRole="button"
            accessibilityState={{ expanded: archivedExpanded }}
            style={styles.sectionDisclosureHeader}
          >
            <View style={styles.sectionDisclosureHeaderRow}>
              <Icon source="archive-outline" size={20} color={theme.colors.onSurfaceVariant} />
              <Text
                style={[styles.sectionAccordionTitle, { color: theme.colors.onSurfaceVariant, flex: 1 }]}
              >
                {`Archived (${ARCHIVED_GROUPS.length})`}
              </Text>
              <Icon
                source={archivedExpanded ? "chevron-up" : "chevron-down"}
                size={20}
                color={theme.colors.onSurfaceVariant}
              />
            </View>
          </TouchableRipple>
          {archivedExpanded ? (
            <View style={[styles.sectionDisclosureContent, { backgroundColor: theme.colors.background }]}>
              {ARCHIVED_GROUPS.map((group) => (
                <View
                  key={group.id}
                  style={[styles.nestedGroupRow, { borderBottomColor: theme.colors.outlineVariant }]}
                  testID={`preview-nested-${group.id}`}
                >
                  <View style={styles.nestedGroupTouchable}>
                    <View style={{ flex: 1 }}>
                      <Text
                        variant="titleMedium"
                        style={{
                          fontWeight: "600",
                          color: theme.colors.onSurfaceVariant,
                          letterSpacing: -0.2,
                        }}
                      >
                        {group.name}
                      </Text>
                      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
                        {group.description}
                      </Text>
                    </View>
                    <GroupBalanceBadge
                      balanceData={{ group_id: group.id, balances: [] }}
                      currentUserId="u-you"
                    />
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <View
          style={[styles.sectionAccordion, { backgroundColor: theme.colors.surface }]}
          testID="preview-former-accordion"
        >
          <TouchableRipple
            onPress={() => setFormerExpanded(!formerExpanded)}
            accessibilityRole="button"
            accessibilityState={{ expanded: formerExpanded }}
            style={styles.sectionDisclosureHeader}
          >
            <View style={styles.sectionDisclosureHeaderRow}>
              <Icon source="history" size={20} color={theme.colors.onSurfaceVariant} />
              <Text
                style={[styles.sectionAccordionTitle, { color: theme.colors.onSurfaceVariant, flex: 1 }]}
              >
                {`Former (${FORMER_GROUPS.length})`}
              </Text>
              <Icon
                source={formerExpanded ? "chevron-up" : "chevron-down"}
                size={20}
                color={theme.colors.onSurfaceVariant}
              />
            </View>
          </TouchableRipple>
          {formerExpanded ? (
            <View style={[styles.sectionDisclosureContent, { backgroundColor: theme.colors.background }]}>
              {FORMER_GROUPS.map((group) => (
                <View
                  key={group.id}
                  style={[styles.nestedGroupRow, { borderBottomColor: theme.colors.outlineVariant }]}
                  testID={`preview-nested-former-${group.id}`}
                >
                  <View style={styles.nestedGroupTouchable}>
                    <View style={{ flex: 1 }}>
                      <Text
                        variant="titleMedium"
                        style={{
                          fontWeight: "600",
                          color: theme.colors.onSurfaceVariant,
                          letterSpacing: -0.2,
                        }}
                      >
                        {group.name}
                      </Text>
                      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
                        {group.description}
                      </Text>
                    </View>
                    <GroupBalanceBadge
                      balanceData={{
                        group_id: group.id,
                        balances: [{ user_id: "u-you", amount: -12, currency: "USD", full_name: "You" }],
                      }}
                      currentUserId="u-you"
                    />
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </View>
        <View testID="home-list-clearance" style={{ height: 32 }} />
      </View>
    </PreviewShell>
  );
}

function GroupHomePreview({ loading = false }: { loading?: boolean }) {
  const theme = useTheme();
  return (
    <PreviewShell
      title="Roommates"
      fab={
        loading ? null : (
          <FAB
            icon="plus"
            label="Add expense"
            style={[styles.fab, { backgroundColor: theme.colors.primary }]}
            color={theme.colors.onPrimary}
            onPress={() => {}}
          />
        )
      }
    >
      <View testID={loading ? "preview-group-loading" : "preview-group-home"}>
        <GroupDashboard
          balances={SAMPLE_BALANCES}
          groupStats={loading ? null : SAMPLE_GROUP_STATS}
          currentUserId="u-you"
          currentUserParticipantId="p-you"
          loading={loading}
          activeMemberCount={3}
          defaultCurrency="USD"
        />
        <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
          <Text variant="titleMedium" style={{ fontWeight: "700", marginBottom: 12 }}>
            Recent expenses
          </Text>
          <TransactionsEmptyState
            filter="all"
            members={[
              { status: "active" },
              { status: "active" },
              { status: "active" },
            ]}
            canAct
            onAddExpense={() => {}}
          />
        </View>
      </View>
    </PreviewShell>
  );
}

function StatsPreview() {
  return (
    <PreviewShell title="Balances">
      <View style={{ padding: 16 }} testID="preview-stats">
        <BalancesSection
          groupBalances={[]}
          overallBalances={DETAIL_BALANCES}
          loading={false}
          showOverallBalances
          currentUserId="u-you"
          participants={[
            {
              id: "p-alex",
              group_id: "g1",
              user_id: "u-alex",
              full_name: "Alex Rivera",
              type: "member",
            },
            {
              id: "p-maya",
              group_id: "g1",
              user_id: "u-maya",
              full_name: "Maya Patel",
              type: "member",
            },
            {
              id: "p-kai",
              group_id: "g1",
              user_id: "u-kai",
              full_name: "Kai Chen",
              type: "member",
            },
          ]}
        />
      </View>
    </PreviewShell>
  );
}

export const HomePolishPreviewScreen: React.FC = () => {
  const [surface, setSurface] = useState<SurfaceId>(() => {
    if (typeof window === "undefined") return "home-list";
    const requested = new URLSearchParams(window.location.search).get("surface");
    const allowed: SurfaceId[] = [
      "home-empty",
      "home-list",
      "home-no-bills",
      "home-loading",
      "group-home",
      "group-loading",
      "stats",
      "split-loading",
      "split-form",
      "split-mode",
    ];
    return allowed.includes(requested as SurfaceId) ? (requested as SurfaceId) : "home-list";
  });

  return (
    <PaperProvider theme={lightTheme}>
      <SafeAreaView
        style={{ flex: 1, backgroundColor: lightTheme.colors.background }}
        edges={["top", "bottom"]}
      >
        <View
          style={{
            paddingHorizontal: 12,
            paddingTop: 8,
            paddingBottom: 4,
            maxWidth: WEB_MAX_WIDTH,
            width: "100%",
            alignSelf: "center",
          }}
        >
          <Text variant="labelLarge" style={{ marginBottom: 8, fontWeight: "700" }}>
            Home polish preview — Groups header, compact bills, split form
          </Text>
          <SegmentedButtons
            value={surface}
            onValueChange={(v) => setSurface(v as SurfaceId)}
            buttons={[
              { value: "home-no-bills", label: "CTA" },
              { value: "home-list", label: "Bills" },
              { value: "split-form", label: "Split" },
              { value: "split-loading", label: "Load" },
              { value: "split-mode", label: "Mode" },
            ]}
          />
        </View>
        {surface === "home-empty" ? <HomeEmptyPreview /> : null}
        {surface === "home-list" ? <HomeListPreview /> : null}
        {surface === "home-no-bills" ? <HomeListPreview showRecentBills={false} /> : null}
        {surface === "home-loading" ? <HomeListPreview balancesLoading /> : null}
        {surface === "group-loading" ? <GroupHomePreview loading /> : null}
        {surface === "group-home" ? <GroupHomePreview /> : null}
        {surface === "stats" ? <StatsPreview /> : null}
        {surface === "split-loading" ? <SplitBillFormPreview loadingPeople disabledCreate /> : null}
        {surface === "split-form" ? <SplitBillFormPreview /> : null}
        {surface === "split-mode" ? <SplitBillFormPreview modeMenuOpen /> : null}
      </SafeAreaView>
    </PaperProvider>
  );
};

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  empty: {
    paddingVertical: 64,
    alignItems: "center",
    paddingHorizontal: 24,
  },
  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 14,
    marginBottom: 9,
    borderRadius: 14,
    overflow: "hidden",
  },
  fab: {
    position: "absolute",
    right: 16,
    bottom: 24,
    borderRadius: 28,
  },
  groupsSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
    marginBottom: 8,
  },
  recentBillRow: {
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  recentBillContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 2,
    gap: 8,
  },
  sectionAccordion: {
    marginTop: 20,
    marginBottom: 8,
    borderRadius: 12,
    minHeight: 44,
    overflow: "hidden",
  },
  sectionAccordionTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  sectionDisclosureHeader: {
    minHeight: 44,
    justifyContent: "center",
  },
  sectionDisclosureHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    paddingHorizontal: 14,
    gap: 10,
  },
  sectionDisclosureContent: {
    paddingTop: 0,
    paddingBottom: 4,
  },
  nestedGroupRow: {
    marginLeft: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  nestedGroupTouchable: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
    gap: 8,
  },
});
