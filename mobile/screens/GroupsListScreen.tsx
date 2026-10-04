import { useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { InteractionManager, Platform, ScrollView, StyleSheet, TouchableOpacity, useWindowDimensions, View } from "react-native";
import {
  ActivityIndicator,
  Appbar,
  Button,
  Icon,
  List,
  Surface,
  Text,
  TouchableRipple,
  useTheme,
} from "react-native-paper";
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
  const [newGroupHeight, setNewGroupHeight] = useState(56);
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
  // nested=true: Archived children — indented hairline rows (not twin active cards).
  // Former uses the same non-nested Surface cards as active (marginBottom 9).
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
            ) : null}
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

      <Button mode="outlined" icon="call-split" testID="split-bill-entry"
        style={{ marginHorizontal: 16, marginTop: 12, marginBottom: 4 }}
        onPress={() => setShowSplitBill(true)}>Split a bill</Button>

      {isInitialLoading ? (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          testID="groups-loading-placeholders"
        >
          {[0, 1, 2, 3].map((key) => (
            <Surface
              key={key}
              style={[
                styles.groupItem,
                styles.placeholderRow,
                { backgroundColor: theme.colors.surface },
              ]}
              elevation={0}
            >
              <View style={styles.placeholderCopy}>
                <View
                  style={[
                    styles.placeholderLineWide,
                    { backgroundColor: theme.colors.surfaceVariant },
                  ]}
                />
                <View
                  style={[
                    styles.placeholderLine,
                    { backgroundColor: theme.colors.surfaceVariant },
                  ]}
                />
              </View>
              <View
                style={[
                  styles.placeholderBadge,
                  { backgroundColor: theme.colors.surfaceVariant },
                ]}
              />
            </Surface>
          ))}
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
                Split a one-time bill, or create a group for ongoing expenses.
              </Text>
              <Button
                mode="contained"
                onPress={() => setShowCreateGroup(true)}
                testID="groups-empty-create"
              >
                Create group
              </Button>
            </View>
          ) : (
            <>
              {/* Active Groups */}
              {activeGroups.map((group) => renderGroupItem(group))}

              {/* Archived Groups — mute chip + demoted nested hairline children */}
              {archivedGroups.length > 0 && (
                <List.Accordion
                  title={`Archived (${archivedGroups.length})`}
                  titleStyle={[
                    styles.sectionAccordionTitle,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                  style={[
                    styles.sectionAccordion,
                    { backgroundColor: theme.colors.surface },
                  ]}
                  left={(props) => (
                    <List.Icon
                      {...props}
                      icon="archive-outline"
                      color={theme.colors.onSurfaceVariant}
                      style={styles.sectionAccordionIcon}
                    />
                  )}
                  expanded={archivedGroupsExpanded}
                  onPress={() => setArchivedGroupsExpanded(!archivedGroupsExpanded)}
                  testID="archived-groups-accordion"
                >
                  <View
                    style={[
                      styles.accordionContent,
                      { backgroundColor: theme.colors.background },
                    ]}
                  >
                    {archivedGroups.map((group) =>
                      renderGroupItem(group, { nested: true })
                    )}
                  </View>
                </List.Accordion>
              )}

              {/* Former Groups — mute chip header (not List.Accordion): Paper
                  Accordion clones children and collapses card gaps on web.
                  Flat Surface cards with the same padding/gap as active. */}
              {formerGroups.length > 0 && (
                <View
                  style={[
                    styles.sectionAccordion,
                    { backgroundColor: theme.colors.surface },
                  ]}
                  testID="former-groups-accordion"
                >
                  <TouchableRipple
                    onPress={() =>
                      setFormerGroupsExpanded(!formerGroupsExpanded)
                    }
                    accessibilityRole="button"
                    accessibilityState={{ expanded: formerGroupsExpanded }}
                    accessibilityLabel={`Former, ${formerGroups.length} groups`}
                    style={styles.formerAccordionHeader}
                  >
                    <View style={styles.formerAccordionHeaderRow}>
                      <List.Icon
                        icon="history"
                        color={theme.colors.onSurfaceVariant}
                        style={styles.sectionAccordionIcon}
                      />
                      <Text
                        style={[
                          styles.sectionAccordionTitle,
                          { color: theme.colors.onSurfaceVariant, flex: 1 },
                        ]}
                      >
                        {`Former (${formerGroups.length})`}
                      </Text>
                      <List.Icon
                        icon={
                          formerGroupsExpanded ? "chevron-up" : "chevron-down"
                        }
                        color={theme.colors.onSurfaceVariant}
                      />
                    </View>
                  </TouchableRipple>
                  {formerGroupsExpanded ? (
                    <View
                      style={[
                        styles.formerAccordionContent,
                        { backgroundColor: theme.colors.background },
                      ]}
                    >
                      {formerGroups.map((group) => renderGroupItem(group))}
                    </View>
                  ) : null}
                </View>
              )}
            </>
          )}

          {/* Bottom padding for FAB when present */}
          <View
            testID="new-group-clearance"
            style={{ height: hasAnyVisibleGroups ? newGroupHeight + 24 : 24 }}
          />
        </ScrollView>
      )}

      {/* Single primary CTA — solid action when groups exist; empty state owns Create group alone. */}
      {hasAnyVisibleGroups ? (
        <View style={styles.fab} pointerEvents="box-none">
          <Surface
            testID="new-group-surface"
            style={[styles.fabSurface, { backgroundColor: theme.colors.primary }]}
            elevation={2}
            onLayout={({ nativeEvent }) => setNewGroupHeight(nativeEvent.layout.height)}
          >
            <TouchableRipple
              testID="new-group-action"
              style={styles.fabRipple}
              onPress={() => setShowCreateGroup(true)}
              accessibilityRole="button"
              accessibilityLabel="New Group"
            >
              <View style={styles.fabContent} pointerEvents="none">
                <Icon source="plus" size={24} color={theme.colors.onPrimary} />
                <Text variant="labelLarge" style={[styles.fabLabel, { color: theme.colors.onPrimary }]}>
                  New Group
                </Text>
              </View>
            </TouchableRipple>
          </Surface>
        </View>
      ) : null}

      {showSplitBill ? <SplitBillScreen onDismiss={() => setShowSplitBill(false)} /> : null}
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
  emptyContainer: {
    paddingVertical: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    paddingHorizontal: 14,
    gap: 12,
  },
  placeholderCopy: {
    flex: 1,
    gap: 8,
    paddingRight: 8,
  },
  placeholderLineWide: {
    width: "70%",
    height: 14,
    borderRadius: 7,
  },
  placeholderLine: {
    width: "42%",
    height: 12,
    borderRadius: 6,
  },
  placeholderBadge: {
    width: 72,
    height: 28,
    borderRadius: 8,
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
  fab: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 26,
    alignItems: "flex-end",
  },
  fabSurface: {
    maxWidth: "100%",
    borderRadius: 8,
  },
  fabRipple: {
    borderRadius: 8,
    overflow: "hidden",
  },
  fabContent: {
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  fabLabel: {
    marginHorizontal: 8,
    flexShrink: 1,
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
  // Secondary Home sections (Former / Archived): mute 13/600 labels + light
  // surface chip. Archived expands to indented hairlines; Former expands to
  // the same flat surface cards as active (comfortable padding, not crushed).
  sectionAccordion: {
    marginTop: 20,
    marginBottom: 8,
    borderRadius: 12,
    paddingVertical: 2,
    paddingHorizontal: 4,
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
  sectionAccordionIcon: {
    marginLeft: 0,
    marginRight: 0,
  },
  accordionContent: {
    paddingHorizontal: 0,
    paddingLeft: 0,
    marginLeft: 0,
    marginRight: 0,
    paddingTop: 4,
    // Pull nested rows onto page canvas under the mute chip.
    marginHorizontal: -4,
  },
  // Former: custom expand (not List.Accordion) so Surface card margins paint.
  formerAccordionHeader: {
    minHeight: 44,
    justifyContent: "center",
  },
  formerAccordionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    paddingRight: 4,
  },
  formerAccordionContent: {
    paddingTop: 8,
    // Pull cards onto page canvas under the mute chip (same as #357).
    marginHorizontal: -4,
  },
  // Nested Archived children: indent + hairline on canvas (no surface/r14 cards).
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
  nestedGroupName: {
    fontWeight: "600",
    flexShrink: 1,
    letterSpacing: -0.2,
  },
});
