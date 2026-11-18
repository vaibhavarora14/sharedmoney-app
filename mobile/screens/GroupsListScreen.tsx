import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { InteractionManager, Platform, ScrollView, StyleSheet, TouchableOpacity, useWindowDimensions, View } from "react-native";
import {
  ActivityIndicator,
  Appbar,
  Button,
  Text,
  useTheme,
} from "react-native-paper";
import {
  GuestCleanupBanner,
  GuestDeviceLine,
  GuestSaveChip,
  GuestSnackbar,
} from "../components/guest/GuestChrome";
import { GroupBalanceBadge } from "../components/GroupBalanceBadge";
import { NotificationBell } from "../components/NotificationBell";
import { useAuth } from "../contexts/AuthContext";
import { useGuestFlags } from "../hooks/useGuestFlags";
import { useProfile } from "../hooks/useProfile";
import { useBalances } from "../hooks/useBalances";
import { useGroups } from "../hooks/useGroups";
import {
  setCachedNotificationPreference,
  useNotifications,
  useUpdateNotificationPreference,
} from "../hooks/useNotifications";
import { enablePushNotifications } from "../services/pushNotifications";
import { supabase } from "../supabase";
import { Group } from "../types";
import { showErrorAlert } from "../utils/errorHandling";
import {
  getUserFriendlyErrorMessage,
  isSessionExpiredError,
} from "../utils/errorMessages";
import { requestGuestSignIn } from "../utils/guestGate";
import { guestCleanupBanner, guestSignInCopy, isGuestUser, keepDataCounts } from "../utils/guestMode";
import { isTransactionNotificationsEnabled } from "../utils/featureFlags";
import { shouldShowNotificationPrimer } from "../utils/notificationPermission";
import { logError } from "../utils/logger";
import { resolveGroupsHomeLoadedTiming } from "../utils/groupsHomeLoadedTelemetry";
import { captureIdentifiedAnalyticsEvent } from "../utils/posthogAnalytics";
import { ANALYTICS_EVENTS } from "../utils/posthogEvents";
import { getSeenGroupIds, markGroupSeen } from "../utils/seenGroups";
import { rememberAllBalances } from "../utils/groupOpenCache";
import { partitionGroupsBySection } from "../utils/groupListSections";
import { recordSentryListCounts } from "../utils/sentryTelemetry";
import { groupListBalanceWords } from "../utils/balanceRowLabels";
import { countGroupsWithViewerBalance, homePosition, viewerOverallBalances, type HomePosition } from "../utils/homePosition";
import { groupRecencyLine } from "../utils/groupRecency";
import { groupsListStatusLine } from "../utils/groupsListStatus";
import { isBenignConnectivityError } from "../utils/networkErrors";
import { formatShareCurrency } from "../utils/settleShareMessage";
import {
  listRecentBillSplits,
  summarizeUnsettledOneTimeBills,
  type OneTimeBillsHomeSummary,
  type RecentBillSplit,
} from "../utils/recentBillSplits";
import { QuickSettleSheet, type QuickSettleSource } from "../components/QuickSettleSheet";
import { buildDirectHomeRows, directPeopleForHome } from "../utils/quickSettle";
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
  /** When this home visit began (app open, sign-in, terms, or return). */
  homeLoadStartedAtMs: number;
  /** Groups query was in the empty loading state during this visit. */
  homeSawInitialLoading: boolean;
}

function spokenGroupBalance(
  balances: Array<{ user_id?: string; amount: number; currency: string }> | undefined,
  userId: string | undefined,
  ready: boolean,
): string {
  if (!ready || !balances) return "";
  const mine = userId ? balances.filter((row) => row.user_id === userId) : balances;
  const material = mine.filter((row) => Math.abs(row.amount) >= 0.01);
  if (material.length === 0) return "Even";
  const main = [...material].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
  const words = groupListBalanceWords(
    main.amount,
    formatShareCurrency(Math.abs(main.amount), main.currency),
  );
  return material.length > 1 ? `${words} (+)` : words;
}

export function HomePositionView({ position }: { position: HomePosition }) {
  const theme = useTheme();
  switch (position.kind) {
    case "unknown":
      return (
        <View testID="home-position-placeholder" style={styles.positionBlock}>
          <View style={[styles.numberPlaceholder, { backgroundColor: theme.colors.surfaceVariant }]} />
        </View>
      );
    case "split":
      return (
        <View testID="home-position-split" style={styles.positionBlock}>
          <Text
            variant="bodySmall"
            testID="home-position-muted"
            style={{ color: theme.colors.onSurfaceVariant }}
          >
            {position.mutedLine}
          </Text>
        </View>
      );
    case "amount":
      return (
        <View
          testID="home-position"
          accessibilityLabel={
            position.numberText
              ? `${position.label}, ${position.numberText}, ${position.mutedLine}`
              : `${position.label}, ${position.mutedLine}`
          }
          style={styles.positionBlock}
        >
          <Text
            variant="bodyMedium"
            testID="home-position-label"
            style={{ color: theme.colors.onSurfaceVariant }}
          >
            {position.label}
          </Text>
          {position.numberText ? (
            <Text
              testID="home-position-number"
              style={[styles.positionNumber, { color: theme.colors.onSurface }]}
            >
              {position.numberText}
            </Text>
          ) : null}
          <Text
            variant="bodySmall"
            testID="home-position-muted"
            style={{ color: theme.colors.onSurfaceVariant }}
          >
            {position.mutedLine}
          </Text>
        </View>
      );
    default: {
      const _never: never = position;
      return _never;
    }
  }
}

function useIsOffline(): boolean {
  const [offline, setOffline] = useState(
    () => typeof navigator !== "undefined" && navigator.onLine === false,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
      return;
    }
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return offline;
}

export const GroupsListScreen: React.FC<GroupsListScreenProps> = ({
  onGroupPress,
  onCreateGroup,
  onRefetchReady,
  refetchTrigger,
  onNotificationsPress,
  homeLoadStartedAtMs,
  homeSawInitialLoading,
}) => {
  const [showCreateGroup, setShowCreateGroup] = useState<boolean>(false);
  const [quickSettleOpen, setQuickSettleOpen] = useState(false);
  const [quickSettleSource, setQuickSettleSource] = useState<QuickSettleSource>("home_header");
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
  const isGuest = isGuestUser(user);
  const { cleanupEnabled } = useGuestFlags();
  const guestProfile = useProfile();
  const [guestDeviceSnack, setGuestDeviceSnack] = useState(false);
  const notifications = useNotifications();
  const notificationsEnabled =
    isTransactionNotificationsEnabled(notifications.data);
  const preferenceMutation = useUpdateNotificationPreference();
  const [pushError, setPushError] = useState<string | null>(null);
  const [enablingPush, setEnablingPush] = useState(false);
  const [showLoadingLine, setShowLoadingLine] = useState(false);
  const { data: groups, isLoading: loading, error, refetch } = useGroups();
  const deviceOffline = useIsOffline();
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
    hasData: balancesHaveData,
    refetch: refetchBalances,
  } = useBalances(undefined, { enabled: balancesEnabled });
  useEffect(() => {
    if (!user?.id || !balancesEnabled || !balancesHaveData) return;
    void rememberAllBalances(AsyncStorage, user.id, balancesData);
  }, [balancesData, balancesEnabled, balancesHaveData, user?.id]);
  // A disk-seeded response paints immediately. Missing data is not Even.
  const balancesReady = balancesHaveData;

  // Start time is the visit stamp from App, not Date.now() in this effect.
  // Resetting it here raced the ready effect and logged duration_ms 0 on cache.
  const homeLoadedForStartRef = React.useRef<number | null>(null);
  useEffect(() => {
    if (homeLoadedForStartRef.current === homeLoadStartedAtMs) return;
    if (!user?.id) return;
    if (loading && groups.length === 0) return;
    if (error) return;
    homeLoadedForStartRef.current = homeLoadStartedAtMs;
    const timing = resolveGroupsHomeLoadedTiming({
      startedAtMs: homeLoadStartedAtMs,
      renderedAtMs: Date.now(),
      sawInitialLoading: homeSawInitialLoading,
    });
    captureIdentifiedAnalyticsEvent(
      user.id,
      ANALYTICS_EVENTS.GROUPS_HOME_LOADED,
      {
        duration_ms: timing.duration_ms,
        group_count: groups.length,
        from_cache: timing.from_cache,
      }
    );
  }, [
    homeLoadStartedAtMs,
    homeSawInitialLoading,
    loading,
    groups.length,
    error,
    user?.id,
  ]);
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
  const sessionExpired = !!error && isSessionExpiredError(error);
  const offline = deviceOffline || (!!error && !sessionExpired && isBenignConnectivityError(error));
  const listStatus = groupsListStatusLine({
    offline,
    hasSavedGroups: groups.length > 0,
    hasError: !!error && !sessionExpired,
  });

  const standardGroups = groups.filter((group) => group.kind !== "direct");
  const { activeGroups, archivedGroups, formerGroups } =
    partitionGroupsBySection(standardGroups);
  const directRows = buildDirectHomeRows({
    groups,
    groupBalances: balancesData?.group_balances ?? [],
    userId: user?.id,
  });
  const hasAnyVisibleGroups =
    activeGroups.length > 0 ||
    archivedGroups.length > 0 ||
    formerGroups.length > 0 ||
    directRows.length > 0;

  const openQuickSettle = (source: QuickSettleSource) => {
    setQuickSettleSource(source);
    setQuickSettleOpen(true);
  };

  useEffect(() => {
    if (!isGuest || !user?.id || !hasAnyVisibleGroups) return;
    const key = `guest-device-warning-shown:${user.id}`;
    void AsyncStorage.getItem(key).then((seen) => {
      if (seen) return;
      setGuestDeviceSnack(true);
      void AsyncStorage.setItem(key, "1");
    });
  }, [hasAnyVisibleGroups, isGuest, user?.id]);
  const guestActivity = guestProfile.data?.last_guest_activity_at;
  const cleanupBanner = isGuest && cleanupEnabled && guestActivity
    ? guestCleanupBanner(new Date(guestActivity), new Date())
    : null;
  const openGuestSave = () => {
    void (async () => {
      let expenses = 0;
      if (user?.id) {
        const result = await supabase
          .from("transactions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id);
        expenses = result.count ?? 0;
      }
      requestGuestSignIn(guestSignInCopy("chip", keepDataCounts(activeGroups.length, expenses)));
    })();
  };

  useEffect(() => {
    if (loading) return;
    recordSentryListCounts("groups", {
      itemCount: groups.length,
    });
  }, [loading, groups.length]);

  const position = homePosition({
    hasBalances: balancesReady,
    overallBalances: (() => {
      const fromGroups = viewerOverallBalances(
        balancesData?.group_balances ?? [],
        user?.id,
      );
      return fromGroups.length > 0 ? fromGroups : (balancesData?.overall_balances ?? []);
    })(),
    groupsWithBalance: countGroupsWithViewerBalance(
      balancesData?.group_balances ?? [],
      activeGroups.map((group) => group.id),
      user?.id,
    ),
    activeGroupCount: activeGroups.length,
    directPeople: directPeopleForHome(directRows),
  });

  useEffect(() => {
    if (!isInitialLoading) {
      setShowLoadingLine(false);
      return;
    }
    const timer = setTimeout(() => setShowLoadingLine(true), 800);
    return () => clearTimeout(timer);
  }, [isInitialLoading]);

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
    const recency = groupRecencyLine(group, new Date());
    const groupBalance = balancesData?.group_balances?.find((entry) => entry.group_id === group.id);
    const spokenAmount = spokenGroupBalance(groupBalance?.balances, user?.id, balancesReady);

    const row = (
      <TouchableOpacity
        testID={`group-card-${group.id}`}
        style={[
          nested ? styles.nestedGroupTouchable : styles.groupTouchable,
          expandedText && styles.groupTouchableExpanded,
        ]}
        onPress={() => handleGroupPress(group)}
        activeOpacity={0.7}
        accessibilityLabel={`${group.name}${recency ? `, ${recency}` : ""}${spokenAmount ? `, ${spokenAmount}` : ""}${isNew ? ", new group" : ""}${hasUnreadActivity ? `, ${unreadActivityCount} unread ${unreadActivityCount === 1 ? "notification" : "notifications"}` : ""}${group.archived_at ? ", archived" : ""}${group.user_status === "left" ? ", former member" : ""}`}
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
            {recency ? (
              <Text
                variant="bodySmall"
                testID={`group-recency-${group.id}`}
                style={[
                  styles.groupSubtitle,
                  { color: theme.colors.onSurfaceVariant },
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {recency}
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
      <View
        key={group.id}
        style={[
          styles.groupItem,
          { borderBottomColor: theme.colors.outlineVariant },
        ]}
      >
        {row}
      </View>
    );
  };

  if (sessionExpired) {
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
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <Appbar.Header style={{ backgroundColor: theme.colors.background }}>
        <Appbar.Content
          title="Groups"
          titleStyle={{ fontWeight: "bold" }}
        />
        {isGuest ? <GuestSaveChip onPress={openGuestSave} /> : null}
        {notificationsEnabled && !isGuest ? (
          <NotificationBell
            unreadCount={notifications.data?.unread_count ?? 0}
            onPress={onNotificationsPress}
          />
        ) : null}
      </Appbar.Header>

      {listStatus ? (
        <Text
          variant="bodySmall"
          testID={listStatus.kind === "offline" ? "groups-offline-line" : "groups-refresh-error"}
          style={{ color: theme.colors.onSurfaceVariant, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}
        >
          {listStatus.kind === "offline" ? listStatus.text : (
            <>
              Couldn’t refresh ·{" "}
              <Text
                variant="bodySmall"
                onPress={() => {
                  void refetch();
                }}
                accessibilityRole="button"
                accessibilityLabel="Retry loading groups"
                testID="groups-refresh-retry"
                style={{ color: theme.colors.primary, fontWeight: "600" }}
              >
                Retry
              </Text>
            </>
          )}
        </Text>
      ) : null}

      {isInitialLoading ? (
        <View style={styles.scrollContent} testID="groups-loading-placeholders">
          <View testID="home-position-placeholder" style={styles.positionBlock}>
            <View style={[styles.numberPlaceholder, { backgroundColor: theme.colors.surfaceVariant }]} />
          </View>
          {showLoadingLine ? (
            <Text
              variant="bodySmall"
              testID="groups-loading-line"
              style={{ color: theme.colors.onSurfaceVariant, marginTop: 24 }}
            >
              Loading your groups…
            </Text>
          ) : null}
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {cleanupBanner?.show ? (
            <GuestCleanupBanner
              title={cleanupBanner.title}
              body={cleanupBanner.body}
              onSignIn={() => requestGuestSignIn(guestSignInCopy("cleanup_banner"))}
            />
          ) : null}
          {!hasAnyVisibleGroups && !listStatus ? (
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
                Create a group for shared expenses.
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
                mode="contained-tonal"
                buttonColor={theme.colors.primaryContainer}
                textColor={theme.colors.onPrimaryContainer}
                onPress={() => openQuickSettle("home_empty")}
                testID="home-empty-settle"
                style={{ marginTop: 12 }}
                contentStyle={{ minHeight: 44 }}
              >
                Settle up with someone
              </Button>
              <Text
                onPress={() => openSplitBill()}
                testID="home-empty-one-time-split"
                accessibilityRole="button"
                style={{ marginTop: 16, color: theme.colors.onSurfaceVariant, fontSize: 15 }}
              >
                Split one bill
              </Text>
              {isGuest ? <GuestDeviceLine /> : null}
            </View>
          ) : (
            <>
              <HomePositionView position={position} />
              <Button
                mode="contained-tonal"
                buttonColor={theme.colors.primaryContainer}
                textColor={theme.colors.onPrimaryContainer}
                onPress={() => openQuickSettle("home_header")}
                testID="home-settle-pill"
                style={styles.settlePill}
                contentStyle={{ minHeight: 44 }}
                labelStyle={{ fontWeight: "700" }}
              >
                Settle up with someone
              </Button>

              {activeGroups.map((group) => renderGroupItem(group))}

              {directRows.map((row) => {
                const words = row.tone === "mixed" || row.amount == null || !row.currency
                  ? "Mixed"
                  : groupListBalanceWords(
                    row.tone === "owe" ? -Math.abs(row.amount) : row.amount,
                    formatShareCurrency(Math.abs(row.amount), row.currency),
                  );
                const group = row.kind === "person"
                  ? groups.find((item) => item.id === row.groupIds[0])
                  : undefined;
                const amountColor = row.tone === "owed"
                  ? theme.colors.tertiary
                  : row.tone === "owe"
                    ? theme.colors.error
                    : theme.colors.onSurfaceVariant;
                return (
                  <TouchableOpacity
                    key={row.kind === "grouped" ? "direct-grouped" : row.groupIds[0]}
                    testID={row.kind === "grouped" ? "direct-grouped-row" : `direct-row-${row.groupIds[0]}`}
                    style={styles.groupTouchable}
                    onPress={() => {
                      if (group) handleGroupPress(group);
                      else openQuickSettle("home_header");
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`${row.title}${row.subtitle ? `, ${row.subtitle}` : ""}, ${words}`}
                  >
                    <View style={styles.groupMainContent}>
                      <View style={styles.groupInfo}>
                        <Text variant="titleMedium" style={[styles.groupName, { color: theme.colors.onSurface }]} numberOfLines={1}>
                          {row.title}
                        </Text>
                        {row.subtitle ? (
                          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                            {row.subtitle}
                          </Text>
                        ) : null}
                      </View>
                      <Text variant="bodyMedium" style={{ color: amountColor, fontWeight: "700" }}>{words}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}

              {oneTimeSummary ? (
                <TouchableOpacity
                  testID="one-time-bills-row"
                  style={[styles.textRow, { borderBottomColor: theme.colors.outlineVariant }]}
                  onPress={() => openSplitBill()}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`One-time bills, ${oneTimeSummary.unsettled_count} open`}
                >
                  <Text style={[styles.textRowLabel, { color: theme.colors.onSurface }]}>
                    {`One-time bills · ${oneTimeSummary.unsettled_count} open`}
                  </Text>
                </TouchableOpacity>
              ) : null}

              <View style={styles.footerLine} testID="groups-footer-line">
                <View style={styles.footerLinks}>
                  {archivedGroups.length > 0 ? (
                    <Text
                      onPress={() => setArchivedGroupsExpanded(!archivedGroupsExpanded)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: archivedGroupsExpanded }}
                      testID="archived-groups-accordion"
                      style={[styles.footerText, { color: theme.colors.onSurfaceVariant }]}
                    >
                      {`Archived ${archivedGroups.length}`}
                    </Text>
                  ) : null}
                  {archivedGroups.length > 0 && formerGroups.length > 0 ? (
                    <Text style={[styles.footerText, { color: theme.colors.onSurfaceVariant }]}>·</Text>
                  ) : null}
                  {formerGroups.length > 0 ? (
                    <Text
                      onPress={() => setFormerGroupsExpanded(!formerGroupsExpanded)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: formerGroupsExpanded }}
                      testID="former-groups-accordion"
                      style={[styles.footerText, { color: theme.colors.onSurfaceVariant }]}
                    >
                      {`Former ${formerGroups.length}`}
                    </Text>
                  ) : null}
                </View>
                <Text
                  onPress={() => setShowCreateGroup(true)}
                  accessibilityRole="button"
                  accessibilityLabel="New group"
                  testID="new-group-action"
                  style={[styles.footerText, { color: theme.colors.onSurfaceVariant }]}
                >
                  New group
                </Text>
              </View>

              {archivedGroupsExpanded
                ? archivedGroups.map((group) => renderGroupItem(group, { nested: true }))
                : null}
              {formerGroupsExpanded
                ? formerGroups.map((group) => renderGroupItem(group, { nested: true }))
                : null}

              {notificationsEnabled && shouldShowNotificationPrimer({
                platform: Platform.OS,
                activeGroupCount: activeGroups.length,
                preference: notifications.data?.preference,
              }) ? (
                <View testID="notifications-primer" style={styles.primerRow}>
                  <Text style={[styles.textRowLabel, { color: theme.colors.onSurfaceVariant, flex: 1 }]}>
                    Know when an expense affects you
                  </Text>
                  <Text
                    onPress={() => {
                      if (enablingPush) return;
                      setEnablingPush(true);
                      setPushError(null);
                      void enablePushNotifications()
                        .then((preference) => {
                          if (user?.id) {
                            setCachedNotificationPreference(queryClient, user.id, preference);
                          }
                        })
                        .catch((enableError) => {
                          logError(enableError, {
                            context: "enable push notifications",
                            platform: Platform.OS,
                            surface: "groups primer",
                          });
                          setPushError("We couldn’t turn on notifications. You can try again in Profile.");
                        })
                        .finally(() => setEnablingPush(false));
                    }}
                    accessibilityRole="button"
                    testID="notifications-primer-turn-on"
                    style={[styles.footerText, { color: theme.colors.primary }]}
                  >
                    {enablingPush ? "Turning on…" : "Turn on"}
                  </Text>
                  <Text
                    onPress={() => preferenceMutation.mutate({ action: "dismiss_nudge" })}
                    accessibilityRole="button"
                    testID="notifications-primer-dismiss"
                    style={[styles.footerText, { color: theme.colors.onSurfaceVariant }]}
                  >
                    Not now
                  </Text>
                  {pushError ? (
                    <Text variant="bodySmall" style={{ color: theme.colors.error, width: "100%" }}>{pushError}</Text>
                  ) : null}
                </View>
              ) : null}
            </>
          )}

          {/* Bottom padding so Archived / Former never sit under chrome. */}
          <View testID="home-list-clearance" style={{ height: 32 }} />
        </ScrollView>
      )}
      {guestDeviceSnack ? (
        <GuestSnackbar
          message="Saved on this phone only"
          actionLabel="Sign in"
          onAction={openGuestSave}
        />
      ) : null}

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
      <QuickSettleSheet
        visible={quickSettleOpen}
        source={quickSettleSource}
        onDismiss={() => setQuickSettleOpen(false)}
        onViewGroup={(groupId) => {
          const group = groups.find((item) => item.id === groupId);
          if (group) handleGroupPress(group);
        }}
      />
    </View>
  );
};

/** Shared by the groups query and the auth/profile bootstrap gate. */
export function GroupsHomeSkeleton() {
  const theme = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header style={{ backgroundColor: theme.colors.background }}>
        <Appbar.Content title="Groups" titleStyle={{ fontWeight: "bold" }} />
      </Appbar.Header>
      <View style={styles.scrollContent} testID="groups-loading-placeholders">
        <View testID="home-position-placeholder" style={styles.positionBlock}>
          <View style={[styles.numberPlaceholder, { backgroundColor: theme.colors.surfaceVariant }]} />
        </View>
      </View>
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
  positionBlock: {
    gap: 2,
    marginBottom: 12,
  },
  positionNumber: {
    fontSize: 40,
    lineHeight: 48,
    fontWeight: "700",
    letterSpacing: -0.8,
  },
  numberPlaceholder: {
    width: 148,
    height: 40,
    borderRadius: 8,
    marginTop: 8,
  },
  textRow: {
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "transparent",
  },
  textRowLabel: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "500",
  },
  footerLine: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 8,
  },
  footerLinks: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    gap: 8,
  },
  footerText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
  },
  primerRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 8,
  },
  emptyContainer: {
    paddingVertical: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  settlePill: {
    alignSelf: "flex-start",
    marginTop: 14,
    marginBottom: 6,
    borderRadius: 20,
  },
  emptyCreateGroup: {
    alignSelf: "stretch",
    maxWidth: 320,
  },
  groupItem: {
    borderBottomWidth: StyleSheet.hairlineWidth,
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
  // Expanded Archived / Former rows stay open hairlines, not cards.
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
