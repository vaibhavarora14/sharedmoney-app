import { useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { InteractionManager, Platform, ScrollView, StyleSheet, TouchableOpacity, useWindowDimensions, View } from "react-native";
import {
  ActivityIndicator,
  Appbar,
  Button,
  Icon,
  Surface,
  Text,
  TouchableRipple,
  useTheme,
} from "react-native-paper";
import { Skeleton, SkeletonGroup } from "../components/Skeleton";
import { GROUP_BALANCE_SLOT_WIDTH } from "../constants/layout";
import { GroupBalanceBadge } from "../components/GroupBalanceBadge";
import { NotificationBell } from "../components/NotificationBell";
import { useAuth } from "../contexts/AuthContext";
import { useBalances } from "../hooks/useBalances";
import { useGroups } from "../hooks/useGroups";
import {
  setCachedNotificationPreference,
  useNotifications,
  useUpdateNotificationPreference,
} from "../hooks/useNotifications";
import { enablePushNotifications } from "../services/pushNotifications";
import { Group } from "../types";
import { showErrorAlert } from "../utils/errorHandling";
import {
  getUserFriendlyErrorMessage,
  isSessionExpiredError,
} from "../utils/errorMessages";
import { isTransactionNotificationsEnabled } from "../utils/featureFlags";
import { shouldShowNotificationPrimer } from "../utils/notificationPermission";
import { logError } from "../utils/logger";
import { captureIdentifiedAnalyticsEvent } from "../utils/posthogAnalytics";
import { ANALYTICS_EVENTS } from "../utils/posthogEvents";
import { getSeenGroupIds, markGroupSeen } from "../utils/seenGroups";
import { partitionGroupsBySection } from "../utils/groupListSections";
import { recordSentryListCounts } from "../utils/sentryTelemetry";
import { balanceAmountColor, groupListBalanceWords } from "../utils/balanceRowLabels";
import { formatCurrency } from "../utils/currency";
import {
  listRecentBillSplits,
  summarizeUnsettledOneTimeBills,
  type OneTimeBillsHomeSummary,
  type RecentBillSplit,
} from "../utils/recentBillSplits";
import { CreateGroupScreen } from "./CreateGroupScreen";
import { SplitBillScreen } from "./SplitBillScreen";

interface GroupsListScreenProps {
  onGroupPress: (group: Group) => void;
  onCreateGroup: (groupData: {
    name: string;
    description?: string;
  }) => Promise<void>;
  onLogout?: () => void;
  onRefetchReady?: (refetch: () => Promise<any>) => void;
  refetchTrigger?: number; // Added to trigger refetch from parent
  onNotificationsPress: () => void;
}

export const GroupsListScreen: React.FC<GroupsListScreenProps> = ({
  onGroupPress,
  onCreateGroup,
  onRefetchReady,
  refetchTrigger,
  onNotificationsPress,
}) => {
  const [showCreateGroup, setShowCreateGroup] = useState<boolean>(false);
  const [showSplitBill, setShowSplitBill] = useState(false);
  const [splitBillToken, setSplitBillToken] = useState<string | undefined>();
  const [recentBills, setRecentBills] = useState<RecentBillSplit[]>([]);
  const [formerGroupsExpanded, setFormerGroupsExpanded] = useState<boolean>(false);
  const [archivedGroupsExpanded, setArchivedGroupsExpanded] = useState<boolean>(false);
  const [seenGroupIds, setSeenGroupIds] = useState<Set<string> | null>(null);
  const [balancesEnabled, setBalancesEnabled] = useState(false);
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const expandedText = fontScale > 1;
  const queryClient = useQueryClient();
  const { signOut, user } = useAuth();
  const notifications = useNotifications();
  const notificationsEnabled =
    isTransactionNotificationsEnabled(notifications.data);
  const preferenceMutation = useUpdateNotificationPreference();
  const [pushError, setPushError] = useState<string | null>(null);
  const [enablingPush, setEnablingPush] = useState(false);
  const { data: groups, isLoading: loading, error, refetch } = useGroups();
  // Share App's deferred all-balances enablement: wait for list paint, then badges.
  useEffect(() => {
    if (loading && groups.length === 0) return;
    const task = InteractionManager.runAfterInteractions(() => {
      setBalancesEnabled(true);
    });
    return () => task.cancel();
  }, [loading, groups.length]);
  const {
    data: balancesData,
    isLoading: balancesLoading,
    refetch: refetchBalances,
  } = useBalances(undefined, { enabled: balancesEnabled });
  // Deferred all-balances: do not paint "Even" until the query has resolved.
  const balancesReady = balancesEnabled && !balancesLoading;

  const homeLoadedLoggedRef = React.useRef(false);
  const homeStartedAtRef = React.useRef(Date.now());
  useEffect(() => {
    homeStartedAtRef.current = Date.now();
    homeLoadedLoggedRef.current = false;
  }, [user?.id]);
  useEffect(() => {
    if (homeLoadedLoggedRef.current) return;
    if (loading && groups.length === 0) return;
    if (error) return;
    homeLoadedLoggedRef.current = true;
    captureIdentifiedAnalyticsEvent(
      user?.id,
      ANALYTICS_EVENTS.GROUPS_HOME_LOADED,
      {
        duration_ms: Date.now() - homeStartedAtRef.current,
        group_count: groups.length,
      }
    );
  }, [loading, groups.length, error, user?.id]);
  // Load which groups the user has already opened (for the NEW badge).
  // First run baselines all current groups so existing members see no badges
  // (an empty list stores an empty baseline, so a user's first joined group
  // still gets the badge).
  useEffect(() => {
    if (!user?.id || loading) return;
    let mounted = true;
    getSeenGroupIds(
      user.id,
      groups.map((g) => g.id)
    ).then((ids) => {
      if (mounted) setSeenGroupIds(ids);
    });
    return () => {
      mounted = false;
    };
  }, [user?.id, loading, groups]);

  // Recent one-time bills so closing a bill still leaves a reopen path on Home.
  useEffect(() => {
    if (!user?.id) {
      setRecentBills([]);
      return;
    }
    let mounted = true;
    listRecentBillSplits(user.id).then((rows) => {
      if (mounted) setRecentBills(rows);
    });
    return () => {
      mounted = false;
    };
  }, [user?.id, showSplitBill]);

  const openSplitBill = (token?: string) => {
    setSplitBillToken(token);
    setShowSplitBill(true);
  };
  const oneTimeSummary: OneTimeBillsHomeSummary | null = summarizeUnsettledOneTimeBills(recentBills);

  const handleGroupPress = (group: Group) => {
    if (user?.id) {
      // Clear the NEW badge as soon as the group is opened.
      setSeenGroupIds((prev) => {
        if (!prev || prev.has(group.id)) return prev;
        const next = new Set(prev);
        next.add(group.id);
        return next;
      });
      markGroupSeen(user.id, group.id);
    }
    onGroupPress(group);
  };

  // Expose refetch functions to parent component
  React.useEffect(() => {
    if (onRefetchReady) {
      onRefetchReady(async () => {
        await Promise.all([refetch(), refetchBalances()]);
      });
    }
  }, [onRefetchReady, refetch, refetchBalances]);

  // Handle manual trigger from parent
  React.useEffect(() => {
    if (refetchTrigger) {
      refetch();
      refetchBalances();
    }
  }, [refetchTrigger, refetch, refetchBalances]);

  // Auto sign-out on session expiration with alert
  useEffect(() => {
    if (error && isSessionExpiredError(error)) {
      showErrorAlert(error, signOut, "Session Expired");
    }
  }, [error, signOut]);

  const isInitialLoading = loading && groups.length === 0;

  const { activeGroups, archivedGroups, formerGroups } =
    partitionGroupsBySection(groups);
  const hasAnyVisibleGroups =
    activeGroups.length > 0 ||
    archivedGroups.length > 0 ||
    formerGroups.length > 0;

  useEffect(() => {
    if (loading) return;
    recordSentryListCounts("groups", {
      itemCount: groups.length,
    });
  }, [loading, groups.length]);

  // Helper function to render a group item.
  // nested=true: Archived/Former children — indented hairline rows (not active cards).
  const renderGroupItem = (group: Group, options?: { nested?: boolean }) => {
    const nested = Boolean(options?.nested);
    const isNew =
      seenGroupIds !== null &&
      !seenGroupIds.has(group.id) &&
      group.user_status !== "left" &&
      !group.archived_at;
    const unreadActivityCount = notificationsEnabled
      ? notifications.data?.unread_by_group[group.id] ?? 0
      : 0;
    const hasUnreadActivity = unreadActivityCount > 0;
    const description = group.description?.trim();

    const row = (
      <TouchableOpacity
        testID={`group-card-${group.id}`}
        style={[
          nested ? styles.nestedGroupTouchable : styles.groupTouchable,
          expandedText && styles.groupTouchableExpanded,
        ]}
        onPress={() => handleGroupPress(group)}
        activeOpacity={0.7}
        accessibilityLabel={`${group.name}${isNew ? ", new group" : ""}${hasUnreadActivity ? `, ${unreadActivityCount} unread ${unreadActivityCount === 1 ? "notification" : "notifications"}` : ""}${group.archived_at ? ", archived" : ""}${group.user_status === "left" ? ", former member" : ""}`}
      >
        <View style={[styles.groupMainContent, expandedText && styles.groupMainContentExpanded]}>
          <View style={styles.groupInfo}>
            <View style={styles.groupNameRow}>
              <Text
                variant="titleMedium"
                style={[
                  nested ? styles.nestedGroupName : styles.groupName,
                  {
                    color: nested
                      ? theme.colors.onSurfaceVariant
                      : theme.colors.onSurface,
                  },
                  !nested &&
                    group.user_status === "left" && {
                      color: theme.colors.onSurfaceVariant,
                    },
                ]}
                numberOfLines={expandedText ? undefined : 1}
              >
                {group.name}
              </Text>
              {isNew && (
                <Text
                  variant="labelSmall"
                  style={[styles.newBadgeText, { color: theme.colors.primary }]}
                  testID={`new-badge-${group.id}`}
                >
                  NEW
                </Text>
              )}
              {hasUnreadActivity ? (
                <View
                  style={[styles.activityDot, { backgroundColor: theme.colors.primary }]}
                  testID={`notification-dot-${group.id}`}
                  accessibilityElementsHidden
                />
              ) : null}
            </View>
            {description ? (
              <Text
                variant="bodySmall"
                style={[
                  styles.groupSubtitle,
                  { color: theme.colors.onSurfaceVariant },
                ]}
                numberOfLines={expandedText ? undefined : 1}
                ellipsizeMode="tail"
              >
                {description}
              </Text>
            ) : nested ? null : (
              // Keep every top-level card at the skeleton's name + description height.
              <View testID={`group-subtitle-spacer-${group.id}`} accessible={false}
                style={[styles.groupSubtitle, { height: theme.fonts.bodySmall.lineHeight * fontScale }]} />
            )}
          </View>
        </View>

        {/* Balance status — color + label, no badge soup; never optimistic Even */}
        <GroupBalanceBadge
          style={expandedText ? styles.balanceBadgeExpanded : undefined}
          balanceData={balancesData?.group_balances?.find(gb => gb.group_id === group.id)}
          currentUserId={user?.id}
          loading={!balancesReady}
        />
      </TouchableOpacity>
    );

    if (nested) {
      return (
        <View
          key={group.id}
          style={[
            styles.nestedGroupRow,
            { borderBottomColor: theme.colors.outlineVariant },
          ]}
          testID={`nested-group-row-${group.id}`}
        >
          {row}
        </View>
      );
    }

    return (
      <Surface
        key={group.id}
        style={[
          styles.groupItem,
          { backgroundColor: theme.colors.surface },
        ]}
        elevation={0}
      >
        {row}
      </Surface>
    );
  };

  if (error) {
    // Don't show Retry button for session expiration - user will be signed out automatically
    if (isSessionExpiredError(error)) {
      return (
        <View
          style={[
            styles.centerContainer,
            { backgroundColor: theme.colors.background },
          ]}
        >
          <Text
            variant="headlineSmall"
            style={{ color: theme.colors.error, marginBottom: 16 }}
          >
            Session Expired
          </Text>
          <Text
            variant="bodyMedium"
            style={{ marginBottom: 24, textAlign: "center" }}
          >
            {getUserFriendlyErrorMessage(error)}
          </Text>
          <ActivityIndicator size="small" />
        </View>
      );
    }

    return (
      <View
        style={[
          styles.centerContainer,
          { backgroundColor: theme.colors.background },
        ]}
      >
        <Text
          variant="headlineSmall"
          style={{ color: theme.colors.error, marginBottom: 16 }}
        >
          Error
        </Text>
        <Text
          variant="bodyMedium"
          style={{ marginBottom: 24, textAlign: "center" }}
        >
          {getUserFriendlyErrorMessage(error)}
        </Text>
        <Button mode="contained" onPress={() => refetch()}>
          Retry
        </Button>
      </View>
    );
  }

  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <Appbar.Header style={{ backgroundColor: theme.colors.background }}>
        <Appbar.Content
          title="Your Groups"
          titleStyle={{ fontWeight: "bold" }}
        />
        {notificationsEnabled ? (
          <NotificationBell
            unreadCount={notifications.data?.unread_count ?? 0}
            onPress={onNotificationsPress}
          />
        ) : null}
      </Appbar.Header>

      {isInitialLoading ? (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          testID="groups-loading-placeholders"
        >
          <GroupsHomeSkeletonRows embedded />
        </ScrollView>
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {notificationsEnabled && shouldShowNotificationPrimer({
            platform: Platform.OS,
            activeGroupCount: activeGroups.length,
            preference: notifications.data?.preference,
          }) ? (
            <Surface style={[styles.permissionCard, { backgroundColor: theme.colors.primaryContainer }]} elevation={0}>
              <Text variant="titleMedium" style={styles.permissionTitle}>Know when an expense affects you</Text>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                Get a notification when someone adds, changes, or removes an expense involving you.
              </Text>
              {pushError ? <Text variant="bodySmall" style={{ color: theme.colors.error, marginTop: 8 }}>{pushError}</Text> : null}
              <View style={styles.permissionActions}>
                <Button
                  mode="contained"
                  loading={enablingPush}
                  disabled={enablingPush}
                  onPress={async () => {
                    setEnablingPush(true);
                    setPushError(null);
                    try {
                      const preference = await enablePushNotifications();
                      if (user?.id) {
                        setCachedNotificationPreference(queryClient, user.id, preference);
                      }
                    } catch (error) {
                      logError(error, {
                        context: "enable push notifications",
                        platform: Platform.OS,
                        surface: "groups primer",
                      });
                      setPushError("We couldn’t turn on notifications. You can try again in Profile.");
                    } finally {
                      setEnablingPush(false);
                    }
                  }}
                >
                  Turn on notifications
                </Button>
                <Button
                  mode="text"
                  onPress={() => preferenceMutation.mutate({ action: "dismiss_nudge" })}
                >
                  Not now
                </Button>
              </View>
            </Surface>
          ) : null}
          {!hasAnyVisibleGroups ? (
            <View style={styles.emptyContainer} testID="groups-empty-state">
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
              <Button
                mode="contained"
                onPress={() => setShowCreateGroup(true)}
                testID="groups-empty-create"
                style={styles.emptyCreateGroup}
                contentStyle={{ minHeight: 48 }}
              >
                Create a group
              </Button>
              <Button
                mode="text"
                compact
                onPress={() => openSplitBill()}
                testID="home-empty-one-time-split"
                style={{ marginTop: 8 }}
                labelStyle={{ fontWeight: "500" }}
              >
                Just one bill? Split it without a group
              </Button>
            </View>
          ) : (
            <>
              <View style={styles.groupsSectionHeader} testID="groups-section-header">
                <Text variant="labelLarge" style={[styles.sectionHeaderLabel, { color: theme.colors.onSurfaceVariant }]}>
                  Groups
                </Text>
                <Button
                  mode="text"
                  compact
                  testID="new-group-action"
                  onPress={() => setShowCreateGroup(true)}
                  accessibilityLabel="New group"
                >
                  New group
                </Button>
              </View>

              {/* Active Groups */}
              {activeGroups.map((group) => renderGroupItem(group))}

              {/* Quiet one-time bills row — after active groups, above Archived/Former. */}
              {oneTimeSummary ? (
                <Surface
                  style={[styles.groupItem, { backgroundColor: theme.colors.surface, marginTop: 4 }]}
                  elevation={0}
                >
                  <TouchableOpacity
                    testID="one-time-bills-row"
                    style={[styles.groupTouchable, expandedText && styles.groupTouchableExpanded]}
                    onPress={() => openSplitBill()}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`One-time bills, ${
                      oneTimeSummary.unsettled_count === 1
                        ? "1 unsettled"
                        : `${oneTimeSummary.unsettled_count} unsettled`
                    }, ${groupListBalanceWords(
                      oneTimeSummary.net_minor / 100,
                      formatCurrency(Math.abs(oneTimeSummary.net_minor) / 100, oneTimeSummary.currency),
                    )}`}
                  >
                    <View style={[styles.groupMainContent, expandedText && styles.groupMainContentExpanded]}>
                      <View style={styles.groupInfo}>
                        <Text
                          variant="titleMedium"
                          style={[styles.groupName, { color: theme.colors.onSurface }]}
                          numberOfLines={1}
                        >
                          One-time bills
                        </Text>
                        <Text
                          variant="bodySmall"
                          style={[styles.groupSubtitle, { color: theme.colors.onSurfaceVariant }]}
                          numberOfLines={1}
                        >
                          {oneTimeSummary.unsettled_count === 1
                            ? "1 unsettled"
                            : `${oneTimeSummary.unsettled_count} unsettled`}
                        </Text>
                      </View>
                    </View>
                    <View
                      style={[
                        styles.oneTimeBalanceSlot,
                        expandedText && styles.balanceBadgeExpanded,
                      ]}
                    >
                      <Text
                        style={{
                          fontSize: 13,
                          lineHeight: 16,
                          fontWeight: "700",
                          textAlign: "right",
                          color: balanceAmountColor(
                            oneTimeSummary.net_minor / 100,
                            theme.colors,
                            { dark: theme.dark },
                          ),
                        }}
                        numberOfLines={2}
                      >
                        {groupListBalanceWords(
                          oneTimeSummary.net_minor / 100,
                          formatCurrency(
                            Math.abs(oneTimeSummary.net_minor) / 100,
                            oneTimeSummary.currency,
                          ),
                        )}
                      </Text>
                    </View>
                  </TouchableOpacity>
                </Surface>
              ) : null}

              {/* Archived + Former share one disclosure: header card, inset icon,
                  compact divider children (not active Surface cards). */}
              {archivedGroups.length > 0 ? (
                <View
                  style={[styles.sectionAccordion, { backgroundColor: theme.colors.surface }]}
                  testID="archived-groups-accordion"
                >
                  <TouchableRipple
                    onPress={() => setArchivedGroupsExpanded(!archivedGroupsExpanded)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: archivedGroupsExpanded }}
                    accessibilityLabel={`Archived, ${archivedGroups.length} groups`}
                    style={styles.sectionDisclosureHeader}
                  >
                    <View style={styles.sectionDisclosureHeaderRow}>
                      <Icon
                        source="archive-outline"
                        size={20}
                        color={theme.colors.onSurfaceVariant}
                      />
                      <Text
                        style={[
                          styles.sectionAccordionTitle,
                          { color: theme.colors.onSurfaceVariant, flex: 1 },
                        ]}
                      >
                        {`Archived (${archivedGroups.length})`}
                      </Text>
                      <Icon
                        source={archivedGroupsExpanded ? "chevron-up" : "chevron-down"}
                        size={20}
                        color={theme.colors.onSurfaceVariant}
                      />
                    </View>
                  </TouchableRipple>
                  {archivedGroupsExpanded ? (
                    <View
                      style={[styles.sectionDisclosureContent, { backgroundColor: theme.colors.background }]}
                    >
                      {archivedGroups.map((group) => renderGroupItem(group, { nested: true }))}
                    </View>
                  ) : null}
                </View>
              ) : null}

              {formerGroups.length > 0 ? (
                <View
                  style={[styles.sectionAccordion, { backgroundColor: theme.colors.surface }]}
                  testID="former-groups-accordion"
                >
                  <TouchableRipple
                    onPress={() => setFormerGroupsExpanded(!formerGroupsExpanded)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: formerGroupsExpanded }}
                    accessibilityLabel={`Former, ${formerGroups.length} groups`}
                    style={styles.sectionDisclosureHeader}
                  >
                    <View style={styles.sectionDisclosureHeaderRow}>
                      <Icon
                        source="history"
                        size={20}
                        color={theme.colors.onSurfaceVariant}
                      />
                      <Text
                        style={[
                          styles.sectionAccordionTitle,
                          { color: theme.colors.onSurfaceVariant, flex: 1 },
                        ]}
                      >
                        {`Former (${formerGroups.length})`}
                      </Text>
                      <Icon
                        source={formerGroupsExpanded ? "chevron-up" : "chevron-down"}
                        size={20}
                        color={theme.colors.onSurfaceVariant}
                      />
                    </View>
                  </TouchableRipple>
                  {formerGroupsExpanded ? (
                    <View
                      style={[styles.sectionDisclosureContent, { backgroundColor: theme.colors.background }]}
                    >
                      {formerGroups.map((group) => renderGroupItem(group, { nested: true }))}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </>
          )}

          {/* Bottom padding so Archived / Former never sit under chrome. */}
          <View testID="home-list-clearance" style={{ height: 32 }} />
        </ScrollView>
      )}

      {showSplitBill ? (
        <SplitBillScreen
          key={splitBillToken ?? "new-bill"}
          token={splitBillToken}
          onDismiss={() => {
            setShowSplitBill(false);
            setSplitBillToken(undefined);
          }}
        />
      ) : null}
      <CreateGroupScreen
        visible={showCreateGroup}
        onCreateGroup={async (groupData) => {
          await onCreateGroup(groupData);
          setShowCreateGroup(false);
        }}
        onDismiss={() => setShowCreateGroup(false)}
      />
    </View>
  );
};

/** Shared by the groups query and the auth/profile bootstrap gate. */
export function GroupsHomeSkeletonRows({ embedded = false }: { embedded?: boolean } = {}) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const expandedText = fontScale > 1;
  const rows = (
    <SkeletonGroup>
      {[0, 1, 2, 3, 4, 5].map((key) => (
        <Surface key={key} style={[styles.groupItem, { backgroundColor: theme.colors.surface }]} elevation={0}>
          <View style={[styles.groupTouchable, expandedText && styles.groupTouchableExpanded]}>
            <View style={[styles.groupMainContent, expandedText && styles.groupMainContentExpanded]}>
              <View style={styles.groupInfo}>
                <View style={{ height: theme.fonts.titleMedium.lineHeight * fontScale, justifyContent: "center" }}>
                  <Skeleton width={key % 2 ? "80%" : "60%"} height={16} />
                </View>
                {/* Uncached first paint: assume the common row with a description line. */}
                <View testID="group-skeleton-subtitle" style={[styles.groupSubtitle,
                  { height: theme.fonts.bodySmall.lineHeight * fontScale, justifyContent: "center" }]}>
                  <Skeleton width={key % 2 ? "45%" : "35%"} height={10} />
                </View>
              </View>
            </View>
            <View style={[{ width: GROUP_BALANCE_SLOT_WIDTH, paddingHorizontal: 2, paddingVertical: 2 }, expandedText && styles.balanceBadgeExpanded]}>
              <Skeleton width="100%" height={12} />
            </View>
          </View>
        </Surface>
      ))}
    </SkeletonGroup>
  );
  if (embedded) return rows;
  return (
    <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false} testID="groups-loading-placeholders">
      {rows}
    </ScrollView>
  );
}

export function GroupsHomeSkeleton() {
  const theme = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header style={{ backgroundColor: theme.colors.background }}>
        <Appbar.Content title="Your Groups" titleStyle={{ fontWeight: "bold" }} />
      </Appbar.Header>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        testID="groups-loading-placeholders"
      >
        <GroupsHomeSkeletonRows embedded />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  sectionHeaderLabel: {
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  groupsSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
    marginBottom: 8,
  },
  emptyContainer: {
    paddingVertical: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyCreateGroup: {
    alignSelf: "stretch",
    maxWidth: 320,
  },
  oneTimeBalanceSlot: {
    width: GROUP_BALANCE_SLOT_WIDTH,
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "center",
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  groupItem: {
    marginBottom: 9,
    borderRadius: 14,
    overflow: "hidden",
  },
  groupTouchable: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 14,
    gap: 12,
  },
  groupContent: {
    flex: 1,
    justifyContent: "center",
  },
  groupNameRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  groupName: {
    fontWeight: "700",
    flexShrink: 1,
    letterSpacing: -0.2,
  },
  newBadgeText: {
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  activityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  permissionCard: {
    borderRadius: 12,
    padding: 18,
    marginBottom: 16,
  },
  permissionTitle: {
    fontWeight: "700",
    marginBottom: 6,
  },
  permissionActions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 16,
  },
  // New Styles
  groupSubtitle: {
    marginTop: 2,
  },
  groupMainContent: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  groupInfo: {
    flex: 1,
    paddingRight: 8,
    minWidth: 0,
  },
  // Give enlarged text the row width instead of competing with the balance.
  groupTouchableExpanded: {
    flexDirection: "column",
    alignItems: "stretch",
  },
  groupMainContentExpanded: {
    flex: 0,
    width: "100%",
  },
  balanceBadgeExpanded: {
    alignSelf: "flex-start",
    marginTop: 12,
    maxWidth: "100%",
  },
  // Secondary Home sections (Archived / Former): one disclosure card, inset icons,
  // compact divider children for both.
  sectionAccordion: {
    marginTop: 20,
    marginBottom: 8,
    borderRadius: 12,
    // Expand/collapse hit target ≥44pt (Design soft note from #351/#357).
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
    // Match active group row content inset (groupTouchable paddingHorizontal).
    paddingHorizontal: 14,
    gap: 10,
  },
  sectionDisclosureContent: {
    paddingTop: 0,
    paddingBottom: 4,
  },
  // Nested Archived/Former children: same horizontal inset as header / active rows.
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
