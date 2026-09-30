import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { Session } from "@supabase/supabase-js";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import * as Linking from "expo-linking";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import {
  AppState,
  InteractionManager,
  Platform,
  LogBox,
  Text as RNText,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import {
  ActivityIndicator,
  Button,
  Provider as PaperProvider,
  useTheme,
} from "react-native-paper";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BottomNavBar } from "./components/BottomNavBar";
import { ExpenseFormOverlay } from "./components/ExpenseFormOverlay";
import { ForceUpdateModal } from "./components/ForceUpdateModal";
import { BannerNotice, InAppBanner } from "./components/InAppBanner";
import { NotificationsPanel } from "./components/NotificationsPanel";
import { AUTH_TIMEOUTS } from "./constants/auth";
import {
  isAuthDesktopWebViewport,
  isDesktopWebViewport,
  WEB_MAX_WIDTH,
} from "./constants/layout";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import {
  ThemePreferenceProvider,
  useThemePreference,
} from "./contexts/ThemePreferenceContext";
import { UpgradeProvider, useUpgrade } from "./contexts/UpgradeContext";
import { queryKeys } from "./hooks/queryKeys";
import {
  clearNotificationLocalState,
  refreshNotificationReads,
  useNotifications,
} from "./hooks/useNotifications";
import { fetchActivityPage } from "./hooks/useActivity";
import { activityQueryOptions } from "./hooks/activityQuery";
import { fetchBalances } from "./hooks/useBalances";
import {
  fetchInvitationsForEmail,
  redeemGroupInviteLinkRPC,
} from "./hooks/useGroupInvitations";
import { supabase } from "./supabase";
import {
  useAddMember,
  useCreateGroup,
  useRemoveMember,
} from "./hooks/useGroupMutations";
import { fetchGroupDetails, useGroupDetails, useGroups } from "./hooks/useGroups";
import { useProfile } from "./hooks/useProfile";
import {
  fetchLatestGroupExpenseSplitAmong,
  fetchLatestGroupTransactionCurrency,
  fetchTransactionsPage,
  getGroupFormDefaultCurrency,
  getGroupFormDefaultSplitAmong,
  TransactionsCursor,
  TransactionsPageResponse,
  useCreateTransaction,
  useDeleteTransaction,
  useUpdateTransaction,
} from "./hooks/useTransactions";
import { usePeopleSettlements } from "./hooks/usePeopleSettlements";
import { AddMemberScreen } from "./screens/AddMemberScreen";
import { AllSettlementsScreen } from "./screens/AllSettlementsScreen";
import { AuthScreen } from "./screens/AuthScreen";
import { GroupDetailsScreen } from "./screens/GroupDetailsScreen";
import { GroupStatsMode, GroupStatsScreen } from "./screens/GroupStatsScreen";
import { GroupsListScreen } from "./screens/GroupsListScreen";
import { NotificationDetailScreen } from "./screens/NotificationDetailScreen";
import { NotificationsScreen } from "./screens/NotificationsScreen";
import { CurrencyMergePreviewScreen } from "./screens/CurrencyMergePreviewScreen";
import { HomePolishPreviewScreen } from "./screens/HomePolishPreviewScreen";
import { ProfileSetupScreen } from "./screens/ProfileSetupScreen";
import { SplitwiseImportScreen } from "./screens/SplitwiseImportScreen";
import { TermsAcceptanceScreen } from "./screens/TermsAcceptanceScreen";
import { TodayRefinedPreviewScreen } from "./screens/TodayRefinedPreviewScreen";
import { TransactionFormScreen } from "./screens/TransactionFormScreen";
import {
  getLastNotificationResponseData,
  syncEnabledPushRegistration,
  subscribeToNotificationResponses,
  subscribeToPushTokenChanges,
  subscribeToReceivedNotifications,
} from "./services/pushNotifications";
import { darkTheme, lightTheme } from "./theme";
import { Group, GroupWithMembers } from "./types";
import { getDefaultCurrency } from "./utils/currency";
import { isTransactionNotificationsEnabled } from "./utils/featureFlags";
import {
  isTransactionFormCoveringGroupDetails,
  shouldKeepGroupDetailsMounted,
} from "./utils/groupDetailsPersistence";
import {
  extractGroupDeepLinkId,
  extractInviteToken,
  getConfiguredWebAppPath,
  getInviteLinkErrorMessage,
} from "./utils/inviteLinks";
import { log, logError } from "./utils/logger";
import { needsTermsAcceptance } from "./utils/onboardingFlow";
import {
  NotificationGroupReference,
  openNotificationGroupImmediately,
} from "./utils/notificationGroupNavigation";
import { resolveNotificationRoute } from "./utils/notificationRouting";
import {
  buildGroupJoinedProperties,
  selectRecentEmailInviteJoins,
  shouldCaptureGroupJoinedFromRedeem,
} from "./utils/groupJoinedAnalytics";
import {
  captureIdentifiedAnalyticsEvent,
  captureScreenView,
  initializePostHog,
} from "./utils/posthogAnalytics";
import { ANALYTICS_EVENTS } from "./utils/posthogEvents";
import {
  getSentryRuntimeTags,
  isSentryDiagnosticUrl,
} from "./utils/sentryDiagnostics";
import {
  applySentryDeviceTriageContext,
  setSentryAppStateTag,
  setSentryRouteTag,
} from "./utils/sentryTelemetry";
import { resolveSentryReplaySampleRates } from "./utils/sentryTriagePolicy";

const SENTRY_DIAGNOSTICS_ENABLED =
  process.env.EXPO_PUBLIC_ENABLE_SENTRY_DIAGNOSTICS === "true";

function captureSentrySourceMapDiagnostic(): void {
  try {
    throw new Error("SharedMoney internal Sentry source-map diagnostic");
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        diagnostic: "source_map",
      },
    });
  }
}

const PENDING_INVITE_TOKEN_KEY = "pending_invite_token";
const REPORTED_EMAIL_INVITE_JOINS_KEY = "reported_email_invite_group_joins";
const PENDING_GROUP_DEEP_LINK_KEY = "pending_group_deep_link";

if (Platform.OS === "web") {
  const ignoredWebWarning =
    "Animated: `useNativeDriver` is not supported because the native animated module is missing.";

  LogBox.ignoreLogs([
    ignoredWebWarning,
  ]);

  if (typeof console !== "undefined") {
    const originalWarn = console.warn;
    console.warn = (...args) => {
      if (
        typeof args[0] === "string" &&
        args[0].startsWith(ignoredWebWarning)
      ) {
        return;
      }

      originalWarn(...args);
    };
  }
}

/** Removes the invite token path from the web URL after handling it. */
function clearJoinPathFromWebUrl() {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.history.replaceState({}, "", getConfiguredWebAppPath() || "/");
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: Platform.OS === "web",
      refetchOnReconnect: true,
    },
  },
});

// ... imports

function AppContent() {
  const { session, loading, signOut, user } = useAuth();
  const theme = useTheme();
  const dimensions = useWindowDimensions();
  const usesDesktopNotificationPanel = isDesktopWebViewport(Platform.OS, dimensions.width);
  const queryClientInstance = useQueryClient();
  const {
    data: profile,
    isLoading: profileLoading,
    error: profileError,
    refetch: refetchProfile,
  } = useProfile();
  const notificationInbox = useNotifications();
  const notificationFeatureResolved =
    notificationInbox.data?.feature_enabled !== undefined;
  const notificationFeatureEnabled =
    isTransactionNotificationsEnabled(notificationInbox.data);
  const hasAcceptedCurrentTerms =
    !!profile && !needsTermsAcceptance(profile);
  const [isSignUp, setIsSignUp] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [showAddMember, setShowAddMember] = useState(false);
  const [currentRoute, setCurrentRoute] = useState<string>("groups");
  /** Defer global /balances until groups list can paint first. */
  const { data: homeGroups, isLoading: homeGroupsLoading } = useGroups();
  const [homeBalancesEnabled, setHomeBalancesEnabled] = useState(false);
  useEffect(() => {
    if (!session?.user?.id) {
      setHomeBalancesEnabled(false);
      return;
    }
    // Wait for groups request to finish (or warm cache) before all-balances.
    if (homeGroupsLoading && homeGroups.length === 0) return;
    const task = InteractionManager.runAfterInteractions(() => {
      setHomeBalancesEnabled(true);
    });
    return () => task.cancel();
  }, [session?.user?.id, homeGroupsLoading, homeGroups.length]);
  const peopleSettlements = usePeopleSettlements({
    enabled: homeBalancesEnabled || currentRoute === "settlements",
  });
  const [selectedNotificationId, setSelectedNotificationId] = useState<string | null>(null);
  const [groupInitialListMode, setGroupInitialListMode] = useState<"transactions" | "activity">("transactions");
  const [highlightedTransactionId, setHighlightedTransactionId] = useState<number | null>(null);
  const [desktopNotificationRoute, setDesktopNotificationRoute] = useState<"closed" | "list" | "detail">("closed");
  const [invitationsRefreshTrigger, setInvitationsRefreshTrigger] =
    useState<number>(0);
  const [groupRefreshTrigger, setGroupRefreshTrigger] = useState<number>(0);
  const [editingTransaction, setEditingTransaction] = useState<any>(null);
  const [transactionReturnRoute, setTransactionReturnRoute] = useState<string>("group-details");
  const [transactionFormDefaultCurrency, setTransactionFormDefaultCurrency] =
    useState(() => getDefaultCurrency());
  const [transactionFormDefaultSplitAmong, setTransactionFormDefaultSplitAmong] =
    useState<string[] | undefined>(undefined);
  const [banner, setBanner] = useState<BannerNotice | null>(null);
  const dismissBanner = React.useCallback(() => setBanner(null), []);
  const [statsContext, setStatsContext] = useState<{
    groupId: string;
    mode: GroupStatsMode;
  } | null>(null);
  const prevSessionRef = React.useRef<Session | null>(null);
  const groupsListRefetchRef = React.useRef<(() => void) | null>(null);
  const lastLoggedStateRef = React.useRef<string | null>(null);
  const stuckTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const initialUrlHandledRef = React.useRef(false);
  const initialNotificationHandledRef = React.useRef(false);
  const pushRegistrationSyncedUserRef = React.useRef<string | null>(null);
  const redeemingTokenRef = React.useRef<string | null>(null);
  const openingGroupDeepLinkRef = React.useRef<string | null>(null);
  const openingNotificationGroupRef = React.useRef(false);
  const emailInviteJoinsReportedForUserRef = React.useRef<string | null>(null);
  /** Always-current auth user id for async redeem / invite analytics (avoids stale closure). */
  const authUserIdRef = React.useRef<string | null>(session?.user?.id ?? user?.id ?? null);
  authUserIdRef.current = session?.user?.id ?? user?.id ?? null;

  const resolveAnalyticsUserId = React.useCallback(async (): Promise<string | null> => {
    if (authUserIdRef.current) return authUserIdRef.current;
    try {
      const { data } = await supabase.auth.getSession();
      const id = data.session?.user?.id ?? null;
      if (id) authUserIdRef.current = id;
      return id;
    } catch {
      return null;
    }
  }, []);

  const prefetchGroupData = React.useCallback(
    async (groupId: string) => {
      await Promise.all([
        queryClientInstance.prefetchQuery({
          queryKey: queryKeys.group(groupId),
          queryFn: () => fetchGroupDetails(groupId),
        }),
        queryClientInstance.prefetchInfiniteQuery({
          queryKey: queryKeys.transactionsFeed(groupId),
          queryFn: ({ pageParam }) =>
            fetchTransactionsPage({ groupId, cursor: pageParam ?? null }),
          initialPageParam: null as TransactionsCursor | null,
          getNextPageParam: (lastPage: TransactionsPageResponse) =>
            lastPage.has_more ? lastPage.next_cursor : null,
        }),
        queryClientInstance.prefetchQuery({
          queryKey: queryKeys.lastGroupTransactionCurrency(groupId),
          queryFn: () => fetchLatestGroupTransactionCurrency(groupId),
        }),
        queryClientInstance.prefetchQuery({
          queryKey: queryKeys.lastGroupExpenseSplitAmong(groupId),
          queryFn: () => fetchLatestGroupExpenseSplitAmong(groupId),
        }),
        queryClientInstance.prefetchQuery({
          queryKey: queryKeys.balances(groupId),
          queryFn: () => fetchBalances(groupId),
        }),
        queryClientInstance.prefetchInfiniteQuery(
          activityQueryOptions(groupId, fetchActivityPage)
        ),
      ]);
    },
    [queryClientInstance]
  );

  // Clear and isolate cache on logout
  useEffect(() => {
    if (!session) {
      queryClientInstance.clear();
    }
  }, [queryClientInstance, session?.user?.id]);

  /**
   * Redeems an invite-link token for the signed-in user immediately — no
   * confirmation ceremony. The outcome is reported through the non-blocking
   * top banner on the groups screen instead of dialogs.
   */
  const redeemInviteToken = React.useCallback(async (token: string) => {
    // Guard against double-processing (initial URL + url event, re-renders)
    if (redeemingTokenRef.current === token) return;
    redeemingTokenRef.current = token;

    // Land on the groups screen, where the banner lives.
    setSelectedGroup(null);
    setStatsContext(null);
    setCurrentRoute("groups");

    try {
      const result = await redeemGroupInviteLinkRPC(token);
      groupsListRefetchRef.current?.();
      setGroupRefreshTrigger((prev) => prev + 1);

      if (result.status === "expired") {
        setBanner({
          type: "error",
          message: "This invite link has expired. Ask for a new one.",
        });
      } else if (shouldCaptureGroupJoinedFromRedeem(result.status)) {
        // Activation: join path users never fire group_created; emit group_joined
        // so funnels can attribute invite/share entry separately from create.
        // Resolve auth id at capture time (ref + session fallback) — do not rely
        // on a possibly-stale `user?.id` closure; captureIdentifiedAnalyticsEvent
        // silently no-ops when userId is null.
        const analyticsUserId = await resolveAnalyticsUserId();
        captureIdentifiedAnalyticsEvent(
          analyticsUserId,
          ANALYTICS_EVENTS.GROUP_JOINED,
          buildGroupJoinedProperties({
            groupId: result.group_id,
            joinMethod: "invite_link",
          }),
        );
      }
      // 'already_member' stays quiet: the group is already in their list.
    } catch (err) {
      logError(err, { context: "redeemInviteToken" });
      setBanner({ type: "error", message: getInviteLinkErrorMessage(err) });
    } finally {
      // Consume the token exactly once: clear storage and the URL so no
      // re-render, remount, or auth-state change can re-trigger a redeem.
      redeemingTokenRef.current = null;
      await AsyncStorage.removeItem(PENDING_INVITE_TOKEN_KEY).catch(() => {});
      clearJoinPathFromWebUrl();
    }
  }, [resolveAnalyticsUserId]);

  const openGroupDeepLink = React.useCallback(async (
    groupId: string,
    initialMode: "transactions" | "activity" = "transactions",
    transactionId: number | null = null,
  ) => {
    if (openingGroupDeepLinkRef.current === groupId) return;
    openingGroupDeepLinkRef.current = groupId;

    try {
      const group = await queryClientInstance.fetchQuery({
        queryKey: queryKeys.group(groupId),
        queryFn: () => fetchGroupDetails(groupId),
        staleTime: 60_000,
      });

      setBanner(null);
      setShowAddMember(false);
      setEditingTransaction(null);
      setStatsContext(null);
      setGroupInitialListMode(initialMode);
      setHighlightedTransactionId(initialMode === "transactions" ? transactionId : null);
      setSelectedGroup(group);
      setCurrentRoute("group-details");
    } catch (err) {
      logError(err, { context: "openGroupDeepLink", groupId });
      setSelectedGroup(null);
      setHighlightedTransactionId(null);
      setStatsContext(null);
      setCurrentRoute("groups");
      setBanner({
        type: "error",
        message: "We couldn't open that group. Make sure you have access.",
      });
    } finally {
      await AsyncStorage.removeItem(PENDING_GROUP_DEEP_LINK_KEY).catch(
        () => {}
      );
      openingGroupDeepLinkRef.current = null;
    }
  }, [queryClientInstance]);

  const openNotificationGroup = React.useCallback((
    groupReference: NotificationGroupReference,
    initialMode: "transactions" | "activity",
    transactionId: number | null,
  ): boolean => {
    const isAlreadyOpening = openingNotificationGroupRef.current;
    if (!isAlreadyOpening) openingNotificationGroupRef.current = true;

    const started = openNotificationGroupImmediately({
      reference: groupReference,
      cachedDetails: queryClientInstance.getQueryData<GroupWithMembers>(
        queryKeys.group(groupReference.id),
      ),
      cachedGroups: queryClientInstance.getQueryData<Group[]>(queryKeys.groups),
      isAlreadyOpening,
      navigate: (group) => {
        setBanner(null);
        setShowAddMember(false);
        setEditingTransaction(null);
        setStatsContext(null);
        setGroupInitialListMode(initialMode);
        setHighlightedTransactionId(initialMode === "transactions" ? transactionId : null);
        setSelectedGroup(group);
        setCurrentRoute("group-details");
      },
      refresh: async () => {
        await queryClientInstance.fetchQuery({
          queryKey: queryKeys.group(groupReference.id),
          queryFn: () => fetchGroupDetails(groupReference.id),
          staleTime: 0,
        });
      },
      onRefreshError: (error) => {
        logError(error, {
          context: "refresh notification group",
          groupId: groupReference.id,
        });
      },
    });

    if (started) openingNotificationGroupRef.current = false;
    return started;
  }, [queryClientInstance]);

  const openNotifications = React.useCallback(() => {
    if (!notificationFeatureEnabled) return;
    setSelectedNotificationId(null);
    if (usesDesktopNotificationPanel) {
      setDesktopNotificationRoute("list");
    } else {
      setCurrentRoute("notifications");
    }
  }, [notificationFeatureEnabled, usesDesktopNotificationPanel]);

  const handleTransactionHighlightShown = React.useCallback((transactionId: number) => {
    setHighlightedTransactionId((current) =>
      current === transactionId ? null : current
    );
  }, []);

  useEffect(() => {
    if (usesDesktopNotificationPanel || desktopNotificationRoute === "closed") return;
    const route = desktopNotificationRoute;
    setDesktopNotificationRoute("closed");
    setCurrentRoute(route === "detail" ? "notification-detail" : "notifications");
  }, [desktopNotificationRoute, usesDesktopNotificationPanel]);

  const handleNotificationResponse = React.useCallback((data: Record<string, unknown>) => {
    if (!notificationFeatureEnabled) return;
    const destination = resolveNotificationRoute(data);
    if (!destination) return;
    setSelectedGroup(null);
    if (destination.screen === "notification-detail") {
      setSelectedNotificationId(destination.notificationId);
      setCurrentRoute("notification-detail");
    } else {
      setSelectedNotificationId(null);
      setCurrentRoute("notifications");
    }
  }, [notificationFeatureEnabled]);

  useEffect(() => {
    if (!session?.user?.id || !hasAcceptedCurrentTerms || !notificationFeatureResolved) {
      initialNotificationHandledRef.current = false;
      return;
    }
    const unsubscribe = subscribeToNotificationResponses(handleNotificationResponse);
    if (!initialNotificationHandledRef.current) {
      initialNotificationHandledRef.current = true;
      getLastNotificationResponseData()
        .then((data) => {
          if (data) handleNotificationResponse(data);
        })
        .catch((error) => logError(error, { context: "initial notification response" }));
    }
    return unsubscribe;
  }, [
    session?.user?.id,
    hasAcceptedCurrentTerms,
    notificationFeatureResolved,
    handleNotificationResponse,
  ]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || !notificationFeatureEnabled) {
      pushRegistrationSyncedUserRef.current = null;
      return;
    }
    if (
      notificationInbox.data?.preference.push_enabled &&
      notificationInbox.data.preference.permission_status === "granted" &&
      pushRegistrationSyncedUserRef.current !== userId
    ) {
      pushRegistrationSyncedUserRef.current = userId;
      syncEnabledPushRegistration().catch((error) => {
        pushRegistrationSyncedUserRef.current = null;
        logError(error, { context: "sync push registration" });
      });
    }
  }, [
    session?.user?.id,
    notificationFeatureEnabled,
    notificationInbox.data?.preference,
  ]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || !hasAcceptedCurrentTerms || !notificationFeatureEnabled) return;

    const refreshInbox = () => {
      void queryClientInstance.invalidateQueries({ queryKey: queryKeys.notificationRoot });
    };
    const unsubscribeReceived = subscribeToReceivedNotifications(refreshInbox);
    const unsubscribeToken = notificationInbox.data?.preference.push_enabled
      ? subscribeToPushTokenChanges(refreshInbox, (error) => {
        logError(error, { context: "push token rotation" });
      })
      : () => {};
    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") return;
      void queryClientInstance.invalidateQueries({
        predicate: (query) => query.isStale(),
      });
      refreshNotificationReads(userId)
        .catch((error) => logError(error, { context: "flush notification reads on foreground" }))
        .finally(refreshInbox);
    });

    return () => {
      unsubscribeReceived();
      unsubscribeToken();
      appStateSubscription.remove();
    };
  }, [
    hasAcceptedCurrentTerms,
    notificationFeatureEnabled,
    notificationInbox.data?.preference.push_enabled,
    queryClientInstance,
    session?.user?.id,
  ]);

  useEffect(() => {
    if (!notificationFeatureResolved || notificationFeatureEnabled) return;
    if (currentRoute === "notifications" || currentRoute === "notification-detail") {
      setCurrentRoute("groups");
      setSelectedNotificationId(null);
    }
    if (desktopNotificationRoute !== "closed") {
      setDesktopNotificationRoute("closed");
    }
  }, [
    currentRoute,
    desktopNotificationRoute,
    notificationFeatureEnabled,
    notificationFeatureResolved,
  ]);

  // Handle deep links: initial URL (cold start / web navigation) + url events.
  useEffect(() => {
    const handleUrl = async (url: string | null) => {
      if (isSentryDiagnosticUrl(url, SENTRY_DIAGNOSTICS_ENABLED)) {
        captureSentrySourceMapDiagnostic();
        return;
      }

      const token = extractInviteToken(url);
      if (token) {
        if (session?.user?.id && hasAcceptedCurrentTerms) {
          await redeemInviteToken(token);
        } else {
          // Stash the token until authentication and onboarding are complete.
          // straight to the sign-in screen (no preview step). Clean the URL
          // immediately — leaving /join/<token> in the address bar during the
          // auth flow is what allowed re-processing (remounts, url events) to
          // yank users back to a join screen mid-sign-in.
          await AsyncStorage.setItem(PENDING_INVITE_TOKEN_KEY, token).catch(
            () => {}
          );
          clearJoinPathFromWebUrl();
        }
        return;
      }

      const groupId = extractGroupDeepLinkId(url);
      if (!groupId) return;

      if (session?.user?.id && hasAcceptedCurrentTerms) {
        await openGroupDeepLink(groupId);
      } else {
        await AsyncStorage.setItem(PENDING_GROUP_DEEP_LINK_KEY, groupId).catch(
          () => {}
        );
      }
    };

    const subscription = Linking.addEventListener("url", (event) =>
      handleUrl(event.url)
    );

    if (!initialUrlHandledRef.current) {
      initialUrlHandledRef.current = true;
      (async () => {
        try {
          let url = await Linking.getInitialURL();
          if (
            !url &&
            Platform.OS === "web" &&
            typeof window !== "undefined"
          ) {
            url = window.location.href;
          }
          await handleUrl(url);
        } catch (err) {
          logError(err, { context: "deep link initial URL" });
        }
      })();
    }

    return () => subscription.remove();
  }, [
    session?.user?.id,
    hasAcceptedCurrentTerms,
    redeemInviteToken,
    openGroupDeepLink,
  ]);

  // After authentication and onboarding, consume any saved invite token.
  useEffect(() => {
    if (!session?.user?.id || !hasAcceptedCurrentTerms) return;

    let cancelled = false;
    (async () => {
      try {
        const token = await AsyncStorage.getItem(PENDING_INVITE_TOKEN_KEY);
        if (!token || cancelled) return;
        await redeemInviteToken(token);
      } catch (err) {
        logError(err, { context: "pending invite token processing" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, hasAcceptedCurrentTerms, redeemInviteToken]);

  // Email invites are accepted server-side in handle_new_user() with no client
  // callback. After auth, attribute recent accepted email invitations once.
  useEffect(() => {
    const userId = session?.user?.id;
    const userEmail = session?.user?.email ?? user?.email;
    if (!userId || !userEmail || !hasAcceptedCurrentTerms) return;
    if (emailInviteJoinsReportedForUserRef.current === userId) return;

    let cancelled = false;
    emailInviteJoinsReportedForUserRef.current = userId;

    (async () => {
      try {
        const [invitations, reportedRaw] = await Promise.all([
          fetchInvitationsForEmail(userEmail),
          AsyncStorage.getItem(REPORTED_EMAIL_INVITE_JOINS_KEY).catch(() => null),
        ]);
        if (cancelled) return;

        let reportedIds = new Set<string>();
        if (reportedRaw) {
          try {
            const parsed = JSON.parse(reportedRaw) as unknown;
            if (Array.isArray(parsed)) {
              reportedIds = new Set(
                parsed.filter((id): id is string => typeof id === "string"),
              );
            }
          } catch {
            reportedIds = new Set();
          }
        }

        const joins = selectRecentEmailInviteJoins(invitations, {
          userEmail,
          alreadyReportedIds: reportedIds,
        });
        if (joins.length === 0) return;

        const analyticsUserId = await resolveAnalyticsUserId();
        if (cancelled || !analyticsUserId) return;

        for (const invitation of joins) {
          captureIdentifiedAnalyticsEvent(
            analyticsUserId,
            ANALYTICS_EVENTS.GROUP_JOINED,
            buildGroupJoinedProperties({
              groupId: invitation.group_id,
              joinMethod: "email_invite",
            }),
          );
          reportedIds.add(invitation.id);
        }

        // Cap stored ids so the key cannot grow without bound across years.
        const trimmed = Array.from(reportedIds).slice(-100);
        await AsyncStorage.setItem(
          REPORTED_EMAIL_INVITE_JOINS_KEY,
          JSON.stringify(trimmed),
        ).catch(() => {});
      } catch (err) {
        // Allow a retry on the next mount if this pass failed.
        if (emailInviteJoinsReportedForUserRef.current === userId) {
          emailInviteJoinsReportedForUserRef.current = null;
        }
        logError(err, { context: "email invite group_joined attribution" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    session?.user?.id,
    session?.user?.email,
    user?.email,
    hasAcceptedCurrentTerms,
    resolveAnalyticsUserId,
  ]);

  // After authentication and onboarding, open any saved group deep link.
  useEffect(() => {
    if (!session?.user?.id || !hasAcceptedCurrentTerms) return;

    let cancelled = false;
    (async () => {
      try {
        const groupId = await AsyncStorage.getItem(PENDING_GROUP_DEEP_LINK_KEY);
        if (!groupId || cancelled) return;
        await openGroupDeepLink(groupId);
      } catch (err) {
        logError(err, { context: "pending group deep link processing" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, hasAcceptedCurrentTerms, openGroupDeepLink]);

  // Debug routing / loading state to track "stuck on spinner" issues.
  // To avoid noisy duplicate breadcrumbs, only log when the state snapshot changes.
  useEffect(() => {
    const snapshot = JSON.stringify({
      currentRoute,
      hasSession: !!session,
      authLoading: loading,
      profileLoading,
      hasProfile: !!profile,
    });

    if (snapshot === lastLoggedStateRef.current) {
      return;
    }

    lastLoggedStateRef.current = snapshot;

    // Use debug level so these show up as low-priority breadcrumbs.
    log("[AppContent] State", JSON.parse(snapshot), "debug");
    setSentryRouteTag(currentRoute);
  }, [currentRoute, session, loading, profileLoading, profile]);

  // Persist AppState transitions for next-launch WatchdogTermination triage.
  useEffect(() => {
    setSentryAppStateTag(AppState.currentState);
    const subscription = AppState.addEventListener("change", (nextState) => {
      setSentryAppStateTag(nextState);
      if (nextState === "active") {
        applySentryDeviceTriageContext();
      }
    });
    return () => subscription.remove();
  }, []);

  // Detect if auth is stuck in loading state for 15+ seconds
  useEffect(() => {
    // Clear any existing timeout
    if (stuckTimeoutRef.current) {
      clearTimeout(stuckTimeoutRef.current);
    }

    stuckTimeoutRef.current = setTimeout(() => {
      if (loading) {
        Sentry.captureMessage("Auth stuck in loading state for 15+ seconds", {
          level: "warning",
          tags: {
            issue: "auth_loading_stuck",
          },
          extra: {
            hasSession: !!session,
            hasUser: !!user,
            profileLoading,
            hasProfile: !!profile,
          },
        });
      }
    }, AUTH_TIMEOUTS.STUCK_LOADING_DETECTION);

    return () => {
      if (stuckTimeoutRef.current) {
        clearTimeout(stuckTimeoutRef.current);
      }
    };
  }, [loading, session, user, profileLoading, profile]);

  // Fetch selected group details via query when selectedGroup changes
  const { data: selectedGroupDetails, refetch: refetchSelectedGroup } =
    useGroupDetails(selectedGroup?.id ?? null);

  // Mutations (declare in the scope where used)
  const createGroupMutation = useCreateGroup(refetchSelectedGroup);
  const addMemberMutation = useAddMember(refetchSelectedGroup);
  const removeMemberMutation = useRemoveMember(refetchSelectedGroup);

  // Transaction mutations
  const onTransactionSuccess = () => {
    setCurrentRoute(transactionReturnRoute || "group-details");
    setEditingTransaction(null);
  };

  const createTx = useCreateTransaction(onTransactionSuccess);
  const updateTx = useUpdateTransaction(onTransactionSuccess);
  const deleteTx = useDeleteTransaction(onTransactionSuccess);

  // Reset navigation state on logout and login (only when session state changes)
  useEffect(() => {
    const hadSession = prevSessionRef.current !== null;
    const hasSession = session !== null;
    const previousUserId = prevSessionRef.current?.user.id;
    const currentUserId = session?.user.id;

    if (previousUserId && previousUserId !== currentUserId) {
      clearNotificationLocalState(previousUserId).catch((error) => {
        logError(error, { context: "clear notification state on logout" });
      });
    }

    // Only reset when transitioning between logged in/out states
    if (hadSession !== hasSession) {
      setCurrentRoute("groups");
      setSelectedGroup(null);
      setShowAddMember(false);
      setEditingTransaction(null);
    }

    prevSessionRef.current = session;
  }, [session]);

  // Lightweight screen analytics for the custom (non-React-Navigation) router.
  useEffect(() => {
    captureScreenView(currentRoute);
  }, [currentRoute]);

  // All API calls now use React Query hooks or fetchWithAuth utility

  const handleCreateGroup = async (groupData: {
    name: string;
    description?: string;
  }) => {
    const createdGroup = await createGroupMutation.mutate(groupData);
    // Refetch groups list to show the newly created group
    if (groupsListRefetchRef.current) {
      groupsListRefetchRef.current();
    }

    // After create, open the new group and Add people so the create flow
    // continues into inviting/adding members (#267).
    // Defer navigation so CreateGroupScreen can dismiss cleanly first.
    if (createdGroup?.id) {
      setTimeout(() => {
        setSelectedGroup(createdGroup);
        setGroupInitialListMode("transactions");
        setHighlightedTransactionId(null);
        setStatsContext(null);
        setCurrentRoute("group-details");
        setShowAddMember(true);
      }, 0);
    }
  };

  const handleGroupUpdated = React.useCallback(
    (updatedGroup: Group) => {
      setSelectedGroup((prev) => {
        if (prev && prev.id === updatedGroup.id) {
          return {
            ...prev,
            name: updatedGroup.name,
            description: updatedGroup.description,
          };
        }
        return prev;
      });
      if (groupsListRefetchRef.current) {
        groupsListRefetchRef.current();
      }
      void refetchSelectedGroup();
    },
    [refetchSelectedGroup],
  );

  const handleAddMember = async (person: {
    fullName?: string;
    email?: string | null;
    sourceParticipantId?: string;
  }) => {
    if (!selectedGroup) {
      throw new Error("Invalid request");
    }

    const result = await addMemberMutation.mutate({
      groupId: selectedGroup.id,
      fullName: person.fullName,
      email: person.email || null,
      sourceParticipantId: person.sourceParticipantId,
    });

    // Always trigger invitations refresh after adding a member
    // This handles both cases:
    // 1. Invitation was created (need to show it)
    // 2. Member was added directly (need to remove any pending invitation for that user)
    setInvitationsRefreshTrigger((prev) => prev + 1);
    // Trigger group refresh to update members list
    setGroupRefreshTrigger((prev) => prev + 1);
    return result;
  };

  const handleRemoveMember = async (userId: string) => {
    if (!selectedGroup) {
      throw new Error("Invalid request");
    }
    await removeMemberMutation.mutate({
      groupId: selectedGroup.id,
      userId,
    });
  };

  const handleGroupPress = (group: Group) => {
    prefetchGroupData(group.id).catch((err) =>
      logError(err, { context: "prefetchGroupData", groupId: group.id })
    );
    setSelectedGroup(group);
    setGroupInitialListMode("transactions");
    setHighlightedTransactionId(null);
    setCurrentRoute("group-details");
    setStatsContext(null);
    // Group details will be fetched via useGroupDetails hook
  };

  const goToGroups = () => {
    setSelectedGroup(null);
    setStatsContext(null);
    setCurrentRoute("groups");
    setGroupRefreshTrigger((prev) => prev + 1);
  };

  const goToSettlements = () => {
    setSelectedGroup(null);
    setStatsContext(null);
    setCurrentRoute("settlements");
  };

  const handleSaveTransaction = async (transactionData: any) => {
    if (!selectedGroup) return;

    if (editingTransaction) {
      await updateTx.mutate({
        ...transactionData,
        id: editingTransaction.id,
        group_id: selectedGroup.id,
        currency: transactionData.currency || getDefaultCurrency(),
      });
    } else {
      await createTx.mutate({
        ...transactionData,
        group_id: selectedGroup.id,
        currency: transactionData.currency || getDefaultCurrency(),
      });
    }
  };

  const handleDeleteTransaction = async () => {
    if (!editingTransaction || !selectedGroup) return;
    await deleteTx.mutate({
      id: editingTransaction.id,
      group_id: selectedGroup.id,
    });
  };

  const desktopNotificationPanel = usesDesktopNotificationPanel && notificationFeatureEnabled ? (
    <NotificationsPanel
      visible={desktopNotificationRoute !== "closed"}
      onDismiss={() => setDesktopNotificationRoute("closed")}
    >
      {desktopNotificationRoute === "detail" && selectedNotificationId ? (
        <NotificationDetailScreen
          notificationId={selectedNotificationId}
          onBack={() => setDesktopNotificationRoute("list")}
          onViewGroup={(group, showActivity, transactionId) => {
            setDesktopNotificationRoute("closed");
            return openNotificationGroup(
              group,
              showActivity ? "activity" : "transactions",
              showActivity ? null : transactionId,
            );
          }}
        />
      ) : (
        <NotificationsScreen
          onBack={() => setDesktopNotificationRoute("closed")}
          isActive={desktopNotificationRoute === "list"}
          onOpenNotification={(notification) => {
            setSelectedNotificationId(notification.id);
            setDesktopNotificationRoute("detail");
          }}
          onViewGroups={() => {
            setDesktopNotificationRoute("closed");
            setSelectedGroup(null);
            setCurrentRoute("groups");
          }}
        />
      )}
    </NotificationsPanel>
  ) : null;

  const previewParam =
    Platform.OS === "web" && typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("preview")
      : null;
  const showCurrencyMergePreview = previewParam === "currency-merge";
  const showPeopleSettlementsPreview = previewParam === "people-settlements";
  const showTodayRefinedPreview = previewParam === "today-refined";
  const showHomePolishPreview = previewParam === "home-polish";

  if (showCurrencyMergePreview) {
    return (
      <>
        <CurrencyMergePreviewScreen onBack={() => setCurrentRoute("groups")} />
        <StatusBar style={theme.dark ? "light" : "dark"} />
      </>
    );
  }

  if (showPeopleSettlementsPreview) {
    return (
      <>
        <AllSettlementsScreen preview />
        <StatusBar style={theme.dark ? "light" : "dark"} />
      </>
    );
  }

  if (showTodayRefinedPreview) {
    return (
      <>
        <TodayRefinedPreviewScreen />
        <StatusBar style="dark" />
      </>
    );
  }

  if (showHomePolishPreview) {
    return (
      <>
        <HomePolishPreviewScreen />
        <StatusBar style="dark" />
      </>
    );
  }

  // One full-screen bootstrap spinner until auth is resolved and, when signed
  // in, profile has finished loading. Avoid stacking auth then profile gates.
  const bootstrapping = loading || (!!session && profileLoading);
  if (bootstrapping) {
    return (
      <View
        style={[
          styles.centerContainer,
          { backgroundColor: theme.colors.background },
        ]}
      >
        <ActivityIndicator size="large" />
        <StatusBar style={theme.dark ? "light" : "dark"} />
      </View>
    );
  }

  if (!session) {
    // Join links land here directly: the token is already stashed and will
    // be redeemed right after sign-in/sign-up (no preview step).
    return (
      <>
        <AuthScreen
          isSignUp={isSignUp}
          onToggleMode={() => setIsSignUp(!isSignUp)}
        />
        <StatusBar style={theme.dark ? "light" : "dark"} />
      </>
    );
  }

  if (profileError || !profile) {
    return (
      <View
        style={[
          styles.centerContainer,
          { backgroundColor: theme.colors.background },
        ]}
      >
        <RNText style={{ color: theme.colors.onBackground }}>
          We couldn't load your account setup.
        </RNText>
        <Button onPress={() => void refetchProfile()}>Try again</Button>
        <Button mode="text" onPress={() => void signOut()}>
          Sign out
        </Button>
        <StatusBar style={theme.dark ? "light" : "dark"} />
      </View>
    );
  }

  if (needsTermsAcceptance(profile)) {
    return (
      <>
        <TermsAcceptanceScreen />
        <StatusBar style={theme.dark ? "light" : "dark"} />
      </>
    );
  }

  if (currentRoute === "notifications" && notificationFeatureEnabled) {
    return (
      <>
        <NotificationsScreen
          onBack={() => setCurrentRoute("groups")}
          onOpenNotification={(notification) => {
            setSelectedNotificationId(notification.id);
            setCurrentRoute("notification-detail");
          }}
          onViewGroups={() => {
            setSelectedGroup(null);
            setCurrentRoute("groups");
          }}
        />
        <StatusBar style={theme.dark ? "light" : "dark"} />
      </>
    );
  }

  if (
    currentRoute === "notification-detail" &&
    selectedNotificationId &&
    notificationFeatureEnabled
  ) {
    return (
      <>
        <NotificationDetailScreen
          notificationId={selectedNotificationId}
          onBack={() => setCurrentRoute("notifications")}
          onViewGroup={(group, showActivity, transactionId) => {
            return openNotificationGroup(
              group,
              showActivity ? "activity" : "transactions",
              showActivity ? null : transactionId,
            );
          }}
        />
        <StatusBar style={theme.dark ? "light" : "dark"} />
      </>
    );
  }

  // Show profile screen
  if (currentRoute === "currency-merge-preview") {
    return (
      <>
        <CurrencyMergePreviewScreen
          onBack={() => setCurrentRoute("profile")}
        />
        <StatusBar style={theme.dark ? "light" : "dark"} />
      </>
    );
  }

  if (currentRoute === "settlements") {
    return (
      <>
        <AllSettlementsScreen onOpenGroup={handleGroupPress} />
        <BottomNavBar
          currentRoute={currentRoute}
          onGroupsPress={goToGroups}
          onSettlementsPress={goToSettlements}
          onProfilePress={() => setCurrentRoute("profile")}
          onLogoutPress={signOut}
          settlementsCount={peopleSettlements.summary.personCount}
        />
        <StatusBar style={theme.dark ? "light" : "dark"} />
      </>
    );
  }

  if (currentRoute === "profile") {
    return (
      <>
        <ProfileSetupScreen
          onComplete={() => {
            refetchProfile();
            setCurrentRoute("groups");
            setGroupRefreshTrigger((prev) => prev + 1);
          }}
          onOpenCurrencyPreview={() => setCurrentRoute("currency-merge-preview")}
        />
        <BottomNavBar
          currentRoute={currentRoute}
          onGroupsPress={goToGroups}
          onSettlementsPress={goToSettlements}
          onProfilePress={() => {
            setCurrentRoute("profile");
          }}
          onLogoutPress={signOut}
          settlementsCount={peopleSettlements.summary.personCount}
        />
        <StatusBar style={theme.dark ? "light" : "dark"} />
      </>
    );
  }

  // Show Splitwise import screen
  if (currentRoute === "splitwise-import" && selectedGroup) {
    return (
      <>
        <SplitwiseImportScreen
          groupId={selectedGroup.id}
          groupName={selectedGroup.name}
          onBack={() => setCurrentRoute("group-details")}
          onDone={() => setCurrentRoute("group-details")}
        />
        <StatusBar style={theme.dark ? "light" : "dark"} />
      </>
    );
  }

  if (currentRoute === "group-stats" && statsContext) {
    return (
      <>
        <GroupStatsScreen
          groupId={statsContext.groupId}
          mode={statsContext.mode}
          onBack={() => {
            setStatsContext(null);
            setCurrentRoute(selectedGroup ? "group-details" : "groups");
          }}
          onEditTransaction={(transaction) => {
            setEditingTransaction(transaction);
            setTransactionReturnRoute("group-stats");
            setCurrentRoute("transaction-form");
          }}
        />
        <StatusBar style={theme.dark ? "light" : "dark"} />
      </>
    );
  }

  // Show group details. Keep the screen mounted while a transaction is open so
  // going back lands on the same row instead of the top of the group.
  if (selectedGroup && shouldKeepGroupDetailsMounted(currentRoute)) {
    // Use fetched group details if available, otherwise use selectedGroup as initial data
    // GroupDetailsScreen will handle loading state while fetching full details
    const groupToDisplay: GroupWithMembers = selectedGroupDetails || {
      ...selectedGroup,
      members: [],
      invitations: [],
    };
    const transactionFormVisible = isTransactionFormCoveringGroupDetails(currentRoute);

    return (
      <>
        <View style={styles.container} collapsable={false}>
          <View
            style={styles.container}
            pointerEvents={transactionFormVisible ? "none" : "auto"}
            accessibilityElementsHidden={transactionFormVisible}
            importantForAccessibility={
              transactionFormVisible ? "no-hide-descendants" : "auto"
            }
            collapsable={false}
          >
            <GroupDetailsScreen
              group={groupToDisplay}
              refreshTrigger={invitationsRefreshTrigger}
              groupRefreshTrigger={groupRefreshTrigger}
              captureHardwareBack={!transactionFormVisible}
              onBack={() => {
                setSelectedGroup(null);
                setCurrentRoute("groups");
                setStatsContext(null);
                setGroupRefreshTrigger((prev) => prev + 1);
              }}
              onAddMember={() => setShowAddMember(true)}
              onRemoveMember={async (userId: string) => {
                await handleRemoveMember(userId);
              }}
              onLeaveGroup={() => {
                setSelectedGroup(null);
                setCurrentRoute("groups");
                setStatsContext(null);
                setGroupRefreshTrigger((prev) => prev + 1);
              }}
              onGroupUpdated={handleGroupUpdated}
              onAddTransaction={() => {
                setEditingTransaction(null);
                setTransactionReturnRoute("group-details");
                if (groupToDisplay.id) {
                  setTransactionFormDefaultCurrency(
                    getGroupFormDefaultCurrency(queryClientInstance, groupToDisplay.id)
                  );
                  setTransactionFormDefaultSplitAmong(
                    getGroupFormDefaultSplitAmong(queryClientInstance, groupToDisplay.id)
                  );
                } else {
                  setTransactionFormDefaultCurrency(getDefaultCurrency());
                  setTransactionFormDefaultSplitAmong(undefined);
                }
                setCurrentRoute("transaction-form");
              }}
              onEditTransaction={(transaction) => {
                setEditingTransaction(transaction);
                setTransactionReturnRoute("group-details");
                setCurrentRoute("transaction-form");
              }}
              onImportSplitwise={() => {
                setCurrentRoute("splitwise-import");
              }}
              onStatsPress={(mode) => {
                if (!groupToDisplay.id) return;
                setStatsContext({ groupId: groupToDisplay.id, mode });
                setCurrentRoute("group-stats");
              }}
              initialListMode={groupInitialListMode}
              highlightedTransactionId={highlightedTransactionId}
              onHighlightedTransactionShown={handleTransactionHighlightShown}
            />
            <BottomNavBar
              currentRoute="group-details"
              onGroupsPress={goToGroups}
              onSettlementsPress={goToSettlements}
              onLogoutPress={signOut}
              onProfilePress={() => setCurrentRoute("profile")}
              settlementsCount={peopleSettlements.summary.personCount}
            />
            {showAddMember && selectedGroup && (
              <AddMemberScreen
                visible={showAddMember}
                groupId={selectedGroup.id}
                onAddMember={async (person) => {
                  const result = await handleAddMember(person);
                  // Don't close modal automatically - let AddMemberScreen handle it
                  return result;
                }}
                onDismiss={() => {
                  setShowAddMember(false);
                }}
              />
            )}
            {desktopNotificationPanel}
          </View>
          {transactionFormVisible && (
            <ExpenseFormOverlay backgroundColor={theme.colors.background}>
              <TransactionFormScreen
                transaction={editingTransaction}
                onSave={handleSaveTransaction}
                onDismiss={() => {
                  setCurrentRoute(transactionReturnRoute || "group-details");
                  setEditingTransaction(null);
                }}
                onDelete={editingTransaction ? handleDeleteTransaction : undefined}
                defaultCurrency={transactionFormDefaultCurrency}
                defaultSplitAmong={transactionFormDefaultSplitAmong}
                groupId={selectedGroup.id}
              />
            </ExpenseFormOverlay>
          )}
        </View>
        <StatusBar style={theme.dark ? "light" : "dark"} />
      </>
    );
  }

  // Show groups list (with bottom nav)
  return (
    <>
      <GroupsListScreen
        onGroupPress={handleGroupPress}
        onCreateGroup={handleCreateGroup}
        onRefetchReady={(refetch: () => Promise<void>) => {
          groupsListRefetchRef.current = refetch;
        }}
        refetchTrigger={groupRefreshTrigger}
        onNotificationsPress={openNotifications}
      />
      <InAppBanner notice={banner} onDismiss={dismissBanner} />
      {desktopNotificationPanel}
      <BottomNavBar
        currentRoute={currentRoute}
        onGroupsPress={goToGroups}
        onSettlementsPress={goToSettlements}
        onProfilePress={() => setCurrentRoute("profile")}
        onLogoutPress={signOut}
        settlementsCount={peopleSettlements.summary.personCount}
      />
      <StatusBar style={theme.dark ? "light" : "dark"} />
    </>
  );
}

// Error Fallback Component
function ErrorFallback({
  error,
  resetErrorBoundary,
}: {
  error: unknown;
  resetErrorBoundary: () => void;
}) {
  const theme = useTheme();
  const err = error instanceof Error ? error : new Error(String(error));

  // Still log to console in dev via the centralized logger, and ensure
  // the error is captured by Sentry in all environments.
  logError(err, { source: "ErrorFallback" });

  return (
    <View
      style={[
        styles.errorContainer,
        { backgroundColor: theme.colors.background },
      ]}
    >
      <RNText style={[styles.errorTitle, { color: theme.colors.error }]}>
        Something went wrong
      </RNText>
      <RNText style={[styles.errorMessage, { color: theme.colors.onSurface }]}>
        {err.message}
      </RNText>
      <RNText
        style={[styles.errorStack, { color: theme.colors.onSurfaceVariant }]}
      >
        {err.stack}
      </RNText>
      <Button onPress={resetErrorBoundary} mode="contained">
        Try Again
      </Button>
    </View>
  );
}

// Initialize Sentry once at app startup. Guard against missing DSN so we
// fail safely in development and avoid noisy misconfiguration in production.
if (!process.env.EXPO_PUBLIC_SENTRY_DSN) {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.warn(
      "[Sentry] EXPO_PUBLIC_SENTRY_DSN is not set; Sentry will not be initialized."
    );
  }
} else {
  const replayRates = resolveSentryReplaySampleRates({
    platform: Platform.OS,
    env: process.env as Record<string, string | undefined>,
  });

  Sentry.init({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,

    // Explicit environment so dev vs prod are separated in Sentry
    environment:
      process.env.EXPO_PUBLIC_SENTRY_ENV ||
      (__DEV__ ? "development" : "production"),

    // Errors & sessions
    enableAutoSessionTracking: true,
    enableNative: true,
    enableNativeCrashHandling: true,
    // Explicit: Cocoa persists breadcrumbs for next-launch watchdog reports.
    // Volatile free-memory native contexts are still omitted by the SDK by design.
    enableWatchdogTerminationTracking: true,

    // Performance
    tracesSampleRate: Number(
      process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "0.1"
    ),
    integrations: [
      // Cast through `any` to avoid TypeScript issues with the
      // experimental mobile replay API typings.
      Sentry.mobileReplayIntegration({
        maskAllText: true,
        maskAllImages: true,
      }) as any,
    ],

    // Session Replay — keep 100% of error sessions; lower always-on sampling
    // (especially iOS) to reduce RAM / quota pressure vs the prior 10% default.
    replaysSessionSampleRate: replayRates.replaysSessionSampleRate,
    replaysOnErrorSampleRate: replayRates.replaysOnErrorSampleRate,
  });

  const buildNumber =
    Platform.OS === "ios"
      ? Constants.expoConfig?.ios?.buildNumber
      : Constants.expoConfig?.android?.versionCode?.toString();

  Sentry.setTags(
    getSentryRuntimeTags({
      isDevice: Device.isDevice,
      buildProfile: Constants.expoConfig?.extra?.buildProfile,
      release: Constants.expoConfig?.version,
      buildNumber,
      platform: Platform.OS,
    }),
  );

  applySentryDeviceTriageContext();
  setSentryAppStateTag(AppState.currentState);
}

// Initialize PostHog once at startup. Guard against a missing project key so
// local/dev builds stay quiet when SharedMoney Production analytics is unset.
initializePostHog();

export default function App() {
  const colorScheme = useColorScheme();

  return (
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onError={(error, errorInfo) => {
        logError(error, {
          source: "ErrorBoundary",
          info: errorInfo,
        });
      }}
      onReset={() => {
        // Error boundary reset
      }}
    >
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemePreferenceProvider systemColorScheme={colorScheme}>
            <ThemedAppShell />
          </ThemePreferenceProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

function ThemedAppShell() {
  const { resolvedTheme } = useThemePreference();
  const theme = resolvedTheme === "dark" ? darkTheme : lightTheme;

  return (
    <PaperProvider theme={theme}>
      <View
        style={[
          styles.mainContainer,
          { backgroundColor: theme.colors.background },
        ]}
      >
        <UpgradeProvider>
          <AuthProvider>
            <AppFrame />
          </AuthProvider>
        </UpgradeProvider>
      </View>
    </PaperProvider>
  );
}

function AppFrame() {
  const { loading, session } = useAuth();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const isAuthFrame = !loading && !session;
  const usesDesktopAuthLayout =
    isAuthFrame && isAuthDesktopWebViewport(Platform.OS, width);

  return (
    <View
      style={[
        styles.appWrapper,
        isAuthFrame && styles.authAppWrapper,
        usesDesktopAuthLayout && styles.desktopAuthAppWrapper,
        {
          backgroundColor: isAuthFrame
            ? theme.colors.background
            : theme.colors.surface,
          borderColor: theme.colors.outlineVariant,
        },
      ]}
    >
      <AppContent />
      <ForceUpdateOverlay />
    </View>
  );
}

// Force Update Overlay - shows modal when upgrade is required
function ForceUpdateOverlay() {
  const { isUpgradeRequired, upgradeMessage, upgradeDetails } = useUpgrade();

  return (
    <ForceUpdateModal
      visible={isUpgradeRequired}
      message={upgradeMessage || undefined}
      storeUrlIos={upgradeDetails?.storeUrlIos}
      storeUrlAndroid={upgradeDetails?.storeUrlAndroid}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mainContainer: {
    flex: 1,
    width: "100%",
  },
  transactionFormOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 20,
    elevation: 20,
  },
  appWrapper: {
    flex: 1,
    width: "100%",
    maxWidth: WEB_MAX_WIDTH,
    alignSelf: "center",
    zIndex: 1,
    // Border and shadow only on web for premium desktop experience
    ...(Platform.OS === "web" && {
      borderWidth: 1,
      shadowColor: "#000",
      shadowOffset: {
        width: 0,
        height: 4,
      },
      shadowOpacity: 0.1,
      shadowRadius: 12,
      elevation: 5,
    }),
  },
  authAppWrapper: {
    ...(Platform.OS === "web" && {
      maxWidth: 480,
      borderWidth: 0,
      shadowOpacity: 0,
      elevation: 0,
    }),
  },
  desktopAuthAppWrapper: {
    maxWidth: "100%",
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
  summarySurface: {
    margin: 16,
    marginBottom: 8,
    borderRadius: 12,
    padding: 16,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
  summaryItem: {
    flex: 1,
    alignItems: "center",
  },
  summaryDivider: {
    width: 1,
    height: 40,
    marginHorizontal: 8,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 60,
  },
  transactionCard: {
    marginBottom: 0,
  },
  cardContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 4,
  },
  transactionLeft: {
    flex: 1,
    marginRight: 16,
    minWidth: 0,
  },
  description: {
    marginBottom: 8,
    fontWeight: "600",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  transactionRight: {
    alignItems: "flex-end",
    minWidth: 100,
  },
  amount: {
    fontWeight: "bold",
    marginBottom: 8,
  },
  typeChip: {
    height: 24,
  },
  chipAndActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  actionButtons: {
    flexDirection: "row",
    marginLeft: 8,
  },
  fab: {
    position: "absolute",
    margin: 16,
    right: 0,
    bottom: 0,
  },
  groupsButton: {
    position: "absolute",
    margin: 16,
    left: 0,
    bottom: 0,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 10,
  },
  errorMessage: {
    fontSize: 14,
    marginBottom: 20,
    textAlign: "center",
  },
  errorStack: {
    fontSize: 12,
    marginBottom: 20,
    textAlign: "center",
  },
});
