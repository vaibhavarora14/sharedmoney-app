import React, { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
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
import { balanceAmountColor, groupListBalanceWords } from "../utils/balanceRowLabels";
import { formatCurrency } from "../utils/currency";
import { SplitBillFormPreview } from "./SplitBillScreen";

type SurfaceId =
  | "home-empty"
  | "home-list"
  | "home-unsettled"
  | "home-loading"
  | "profile-one-time"
  | "add-expense"
  | "group-home"
  | "group-loading"
  | "stats"
  | "split-loading"
  | "split-form"
  | "split-carry"
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
];

const DETAIL_BALANCES: Balance[] = [
  {
    user_id: "u-alex",
    participant_id: "p-alex",
    amount: 18,
    currency: "USD",
    full_name: "Alex Rivera",
  },
  {
    user_id: "u-maya",
    participant_id: "p-maya",
    amount: -12,
    currency: "USD",
    full_name: "Maya Patel",
  },
  {
    user_id: "u-kai",
    participant_id: "p-kai",
    amount: -6,
    currency: "USD",
    full_name: "Kai Chen",
  },
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
    description: "Utilities & groceries",
    balance: 42,
  },
  {
    id: "g-trip",
    name: "Barcelona trip",
    description: "Flights and Airbnb",
    balance: -18.5,
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
  return (
    <View style={[styles.shell, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header elevated style={{ backgroundColor: theme.colors.surface }}>
        <Appbar.Content title={title} titleStyle={{ fontWeight: "bold" }} />
      </Appbar.Header>
      <ScrollView contentContainerStyle={{ paddingBottom: 96 }}>{children}</ScrollView>
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
          Create a group for ongoing shared expenses with friends or roommates.
        </Text>
        <Button mode="contained" style={{ alignSelf: "stretch", maxWidth: 320 }} contentStyle={{ minHeight: 48 }}>
          Create a group
        </Button>
        <Button mode="text" compact testID="preview-home-empty-one-time" style={{ marginTop: 8 }} labelStyle={{ fontWeight: "500" }}>
          Just one bill? Split it without a group
        </Button>
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
  showOneTimeRow = false,
}: {
  balancesLoading?: boolean;
  showOneTimeRow?: boolean;
}) {
  const theme = useTheme();
  const [formerExpanded, setFormerExpanded] = useState(true);
  const [archivedExpanded, setArchivedExpanded] = useState(true);
  const testID = balancesLoading
    ? "preview-home-loading"
    : showOneTimeRow
      ? "preview-home-unsettled"
      : "preview-home-list";
  const oneTimeNet = 42;
  return (
    <PreviewShell title="Your Groups">
      <View style={{ paddingHorizontal: 16 }} testID={testID}>
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
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {group.description}
              </Text>
            </View>
            {balancesLoading ? (
              <View style={{ width: 96, height: 28, borderRadius: 8, backgroundColor: theme.colors.surfaceVariant }} />
            ) : (
              <GroupBalanceBadge
                balanceData={{
                  group_id: group.id,
                  balances: [{ user_id: "u-you", amount: group.balance, currency: "USD", full_name: "You" }],
                }}
                currentUserId="u-you"
              />
            )}
          </Surface>
        ))}

        {showOneTimeRow ? (
          <Surface
            style={[styles.groupRow, { backgroundColor: theme.colors.surface, marginTop: 4 }]}
            elevation={0}
            testID="preview-one-time-bills-row"
          >
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text
                variant="titleMedium"
                style={{ fontWeight: "700", color: theme.colors.onSurface, letterSpacing: -0.2 }}
              >
                One-time bills
              </Text>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                2 unsettled
              </Text>
            </View>
            <Text
              style={{
                fontSize: 13,
                lineHeight: 16,
                fontWeight: "700",
                textAlign: "right",
                color: balanceAmountColor(oneTimeNet, theme.colors, { dark: theme.dark }),
              }}
            >
              {groupListBalanceWords(oneTimeNet, formatCurrency(oneTimeNet, "USD"))}
            </Text>
          </Surface>
        ) : null}

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
              <Text style={[styles.sectionAccordionTitle, { color: theme.colors.onSurfaceVariant, flex: 1 }]}>
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
                  testID={`preview-nested-group-${group.id}`}
                >
                  <View style={styles.nestedGroupTouchable}>
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyLarge" style={styles.nestedGroupName}>
                        {group.name}
                      </Text>
                      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                        {group.description}
                      </Text>
                    </View>
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
              <Text style={[styles.sectionAccordionTitle, { color: theme.colors.onSurfaceVariant, flex: 1 }]}>
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
                >
                  <View style={styles.nestedGroupTouchable}>
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyLarge" style={styles.nestedGroupName}>
                        {group.name}
                      </Text>
                      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
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

function ProfileOneTimePreview() {
  const theme = useTheme();
  return (
    <PreviewShell title="Profile">
      <View style={{ padding: 16 }} testID="preview-profile-one-time">
        <Surface style={[styles.profileCard, { backgroundColor: theme.colors.surface }]} elevation={2}>
          <TouchableRipple
            testID="preview-profile-one-time-row"
            style={styles.profileRow}
          >
            <View style={styles.profileRowInner}>
              <View style={{ flex: 1 }}>
                <Text variant="titleSmall" style={{ color: theme.colors.onSurface, fontWeight: "700" }}>
                  One-time bills
                </Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  Split a bill without a group.
                </Text>
              </View>
              <Icon source="chevron-right" size={20} color={theme.colors.onSurfaceVariant} />
            </View>
          </TouchableRipple>
        </Surface>
      </View>
    </PreviewShell>
  );
}

function AddExpenseGlobalPreview() {
  const theme = useTheme();
  return (
    <PreviewShell title="Add Expense">
      <View style={{ padding: 16 }} testID="preview-add-expense-global">
        <Text
          variant="displayMedium"
          style={{ textAlign: "center", fontWeight: "300", marginVertical: 24, color: theme.colors.onSurface }}
        >
          $36.00
        </Text>
        <Surface style={[styles.profileCard, { backgroundColor: theme.colors.surface }]} elevation={0}>
          <View style={styles.profileRowInner}>
            <View style={{ flex: 1 }}>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                Group
              </Text>
              <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant }}>
                Choose a group
              </Text>
            </View>
            <Icon source="chevron-down" size={20} color={theme.colors.onSurfaceVariant} />
          </View>
          <Button
            mode="text"
            compact
            testID="preview-split-once-link"
            style={{ alignSelf: "flex-start", marginTop: 4 }}
            labelStyle={{ fontWeight: "500" }}
          >
            Not in a group? Split once
          </Button>
        </Surface>
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
      "home-unsettled",
      "home-loading",
      "profile-one-time",
      "add-expense",
      "group-home",
      "group-loading",
      "stats",
      "split-loading",
      "split-form",
      "split-carry",
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
            Home polish preview — demoted split, one-time bills
          </Text>
          <SegmentedButtons
            value={surface}
            onValueChange={(v) => setSurface(v as SurfaceId)}
            buttons={[
              { value: "home-list", label: "Home" },
              { value: "home-unsettled", label: "Owe" },
              { value: "home-empty", label: "Empty" },
              { value: "split-form", label: "Split" },
              { value: "add-expense", label: "Add" },
            ]}
          />
        </View>
        {surface === "home-empty" ? <HomeEmptyPreview /> : null}
        {surface === "home-list" ? <HomeListPreview /> : null}
        {surface === "home-unsettled" ? <HomeListPreview showOneTimeRow /> : null}
        {surface === "home-loading" ? <HomeListPreview balancesLoading /> : null}
        {surface === "profile-one-time" ? <ProfileOneTimePreview /> : null}
        {surface === "add-expense" ? <AddExpenseGlobalPreview /> : null}
        {surface === "group-loading" ? <GroupHomePreview loading /> : null}
        {surface === "group-home" ? <GroupHomePreview /> : null}
        {surface === "stats" ? <StatsPreview /> : null}
        {surface === "split-loading" ? <SplitBillFormPreview loadingPeople disabledCreate /> : null}
        {surface === "split-form" ? <SplitBillFormPreview /> : null}
        {surface === "split-carry" ? (
          <SplitBillFormPreview draft={{ amount: "36.00", currency: "USD" }} showRecentBills={false} />
        ) : null}
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
  profileCard: {
    borderRadius: 16,
    padding: 16,
  },
  profileRow: {
    // No top hairline — matches Profile One-time bills row.
    marginTop: 0,
    paddingTop: 0,
  },
  profileRowInner: {
    flexDirection: "row",
    alignItems: "center",
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
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  nestedGroupTouchable: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 8,
  },
  nestedGroupName: {
    fontWeight: "600",
    flexShrink: 1,
    letterSpacing: -0.2,
  },
});
