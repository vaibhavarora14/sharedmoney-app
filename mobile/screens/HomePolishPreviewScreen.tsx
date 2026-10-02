import React, { useState } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import {
  Appbar,
  Button,
  FAB,
  List,
  Provider as PaperProvider,
  SegmentedButtons,
  Surface,
  Text,
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

type SurfaceId = "home-empty" | "home-list" | "group-home" | "stats";

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
          Create a group to start splitting expenses.
        </Text>
        <Button mode="contained">Create group</Button>
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
];

const ARCHIVED_GROUPS = [
  {
    id: "g-archive",
    name: "College trip 2022",
    description: "Archived",
  },
];

function HomeListPreview() {
  const theme = useTheme();
  // Expand Former by default so Design can re-score nested demoted chrome.
  const [formerExpanded, setFormerExpanded] = useState(true);
  const [archivedExpanded, setArchivedExpanded] = useState(true);
  return (
    <PreviewShell
      title="Your Groups"
      fab={
        <Surface
          style={[styles.fabSurface, { backgroundColor: theme.colors.primary }]}
          elevation={2}
        >
          <View style={styles.fabContent}>
            <Text variant="labelLarge" style={{ color: theme.colors.onPrimary }}>
              + New Group
            </Text>
          </View>
        </Surface>
      }
    >
      <View style={{ paddingHorizontal: 16 }} testID="preview-home-list">
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
              balanceData={{ group_id: group.id, balances: group.balances }}
              currentUserId="u-you"
            />
          </Surface>
        ))}

        {/* Loading badge sample — cold paint must not claim Even */}
        <Surface
          style={[styles.groupRow, { backgroundColor: theme.colors.surface }]}
          elevation={0}
          testID="preview-balance-loading-row"
        >
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text
              variant="titleMedium"
              style={{ fontWeight: "700", color: theme.colors.onSurface, letterSpacing: -0.2 }}
            >
              Loading balances…
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
              Placeholder until all-balances resolves
            </Text>
          </View>
          <GroupBalanceBadge loading balanceData={undefined} currentUserId="u-you" />
        </Surface>

        <List.Accordion
          title={`Archived (${ARCHIVED_GROUPS.length})`}
          titleStyle={[styles.sectionAccordionTitle, { color: theme.colors.onSurfaceVariant }]}
          style={[styles.sectionAccordion, { backgroundColor: theme.colors.surface }]}
          left={(props) => (
            <List.Icon
              {...props}
              icon="archive-outline"
              color={theme.colors.onSurfaceVariant}
              style={styles.sectionAccordionIcon}
            />
          )}
          expanded={archivedExpanded}
          onPress={() => setArchivedExpanded(!archivedExpanded)}
        >
          <View style={[styles.accordionContent, { backgroundColor: theme.colors.background }]}>
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
        </List.Accordion>

        <List.Accordion
          title={`Former (${FORMER_GROUPS.length})`}
          titleStyle={[styles.sectionAccordionTitle, { color: theme.colors.onSurfaceVariant }]}
          style={[styles.sectionAccordion, { backgroundColor: theme.colors.surface }]}
          left={(props) => (
            <List.Icon
              {...props}
              icon="history"
              color={theme.colors.onSurfaceVariant}
              style={styles.sectionAccordionIcon}
            />
          )}
          expanded={formerExpanded}
          onPress={() => setFormerExpanded(!formerExpanded)}
          testID="preview-former-accordion"
        >
          <View style={[styles.accordionContent, { backgroundColor: theme.colors.background }]}>
            {FORMER_GROUPS.map((group) => (
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
        </List.Accordion>
      </View>
    </PreviewShell>
  );
}

function GroupHomePreview() {
  const theme = useTheme();
  return (
    <PreviewShell
      title="Roommates"
      fab={
        <FAB
          icon="plus"
          label="Add expense"
          style={[styles.fab, { backgroundColor: theme.colors.primary }]}
          color={theme.colors.onPrimary}
          onPress={() => {}}
        />
      }
    >
      <View testID="preview-group-home">
        <GroupDashboard
          balances={SAMPLE_BALANCES}
          groupStats={SAMPLE_GROUP_STATS}
          currentUserId="u-you"
          currentUserParticipantId="p-you"
          loading={false}
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
  const [surface, setSurface] = useState<SurfaceId>("home-list");

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
            Home polish preview — nested Former + loading badge
          </Text>
          <SegmentedButtons
            value={surface}
            onValueChange={(v) => setSurface(v as SurfaceId)}
            buttons={[
              { value: "home-empty", label: "Empty" },
              { value: "home-list", label: "Home" },
              { value: "group-home", label: "Group" },
              { value: "stats", label: "Stats" },
            ]}
          />
        </View>
        {surface === "home-empty" ? <HomeEmptyPreview /> : null}
        {surface === "home-list" ? <HomeListPreview /> : null}
        {surface === "group-home" ? <GroupHomePreview /> : null}
        {surface === "stats" ? <StatsPreview /> : null}
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
  fabSurface: {
    position: "absolute",
    right: 16,
    bottom: 24,
    borderRadius: 8,
  },
  fabContent: {
    minHeight: 56,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionAccordion: {
    marginTop: 20,
    marginBottom: 8,
    borderRadius: 12,
    paddingVertical: 2,
    paddingHorizontal: 4,
    minHeight: 44,
    overflow: "hidden",
  },
  sectionAccordionTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  sectionAccordionIcon: {
    marginLeft: 0,
    marginRight: 0,
  },
  accordionContent: {
    paddingTop: 4,
    marginHorizontal: -4,
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
