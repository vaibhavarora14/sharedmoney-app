import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator as RNActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  ActivityIndicator,
  Appbar,
  Avatar,
  Button,
  Chip,
  Dialog,
  FAB,
  Menu,
  Portal,
  SegmentedButtons,
  Text,
  TextInput,
  useTheme
} from "react-native-paper";
import {
  ActivityDateHeader,
  ActivityFeedEmptyState,
  ActivityFeedRow,
} from "../components/ActivityFeed";
import { GroupDashboard } from "../components/GroupDashboard";
import { SettlementCurrencySheet } from "../components/SettlementCurrencySheet";
import { InvitationsList } from "../components/InvitationsList";
import { MembersList } from "../components/MembersList";
import { SafetyAction, SafetyActionModal } from "../components/SafetyActionModal";
import {
  LedgerRow,
  TransactionsEmptyState,
} from "../components/TransactionsSection";
import { useAuth } from "../contexts/AuthContext";
import { SCREEN_TRANSITION_MS } from "../constants/layout";
import { useActivity } from "../hooks/useActivity";
import { useBalances } from "../hooks/useBalances";
import {
  useCancelInvitation,
  useGroupInvitations,
} from "../hooks/useGroupInvitations";
import { useRemoveMember, useUpdateGroup, useArchiveGroup, useUnarchiveGroup, useHideGroupFromLists } from "../hooks/useGroupMutations";
import { useGroupDetails } from "../hooks/useGroups";
import { SafetyTarget, useModeration } from "../hooks/useModeration";
import {
  useConnectParticipant,
  useInviteParticipant,
  useParticipants,
  useRemoveParticipant,
} from "../hooks/useParticipants";
import {
  useCreateSettlement,
  useDeleteSettlement,
  useSettlements,
  useUpdateSettlement,
} from "../hooks/useSettlements";
import { useRealtimeGroupSync } from "../hooks/useRealtimeGroupSync";
import {
  useGroupLastExpenseSplitAmong,
  useGroupLastTransactionCurrency,
  useTransactions,
} from "../hooks/useTransactions";
import {
  Balance,
  ActivityItem,
  Group,
  GroupInvitation,
  GroupWithMembers,
  Participant,
  Settlement,
  Transaction,
} from "../types";
import { useCurrencyPreferences } from "../hooks/useCurrencyPreferences";
import { getDefaultCurrency } from "../utils/currency";
import { collectCurrencies } from "../utils/currencyMerge";
import { showErrorAlert } from "../utils/errorHandling";
import {
  getUserFriendlyErrorMessage,
  isSessionExpiredError,
} from "../utils/errorMessages";
import {
  createTransactionHighlightTimer,
  shouldClearTransactionHighlightOnScroll,
  type TransactionHighlightTimer,
} from "../utils/transactionHighlight";
import {
  buildTransactionsLedger,
  type LedgerFilter,
  type LedgerItem,
} from "../utils/transactionsLedger";
import { buildActivityFeedEntries, type ActivityFeedEntry } from "../utils/activityFeedRows";
import {
  countActiveMembers,
  shouldPreferAddPeopleFab,
} from "../utils/transactionsEmptyCopy";
import {
  ARCHIVE_GROUP_CONFIRM_MESSAGE,
  REMOVE_FROM_LISTS_CONFIRM_MESSAGE,
  buildLeaveGroupConfirmMessage,
} from "../utils/leaveBalanceCopy";
import { recordSentryListCounts } from "../utils/sentryTelemetry";
import {
  estimateActivityPageCount,
  estimateTransactionsPageCount,
} from "../utils/groupListPerf";
import {
  GroupListScrollPerfMonitor,
  recordGroupListScrollTelemetry,
  withGroupListFetchNextPageTelemetry,
} from "../utils/groupListPerfTelemetry";
import { captureIdentifiedAnalyticsEvent } from "../utils/posthogAnalytics";
import { ANALYTICS_EVENTS } from "../utils/posthogEvents";
import { GroupStatsMode } from "./GroupStatsScreen";
import { SettlementFormScreen } from "./SettlementFormScreen";

type GroupDetailsListRow =
  | { kind: "ledger"; key: string; item: LedgerItem }
  | { kind: "activity"; key: string; entry: ActivityFeedEntry };

interface GroupDetailsScreenProps {
  group: GroupWithMembers;
  onBack: () => void;
  onAddMember: () => void;
  onRemoveMember?: (userId: string) => Promise<void>;
  onLeaveGroup?: () => void;
  onGroupUpdated?: (group: Group) => void;
  onAddTransaction: () => void;
  onEditTransaction: (transaction: Transaction) => void;
  onImportSplitwise?: () => void;
  refreshTrigger?: number; // When this changes, refresh invitations
  groupRefreshTrigger?: number; // When this changes, refresh group data
  onStatsPress?: (mode: GroupStatsMode) => void;
  initialListMode?: "transactions" | "activity";
  highlightedTransactionId?: number | null;
  onHighlightedTransactionShown?: (transactionId: number) => void;
  captureHardwareBack?: boolean;
}

export const GroupDetailsScreen: React.FC<GroupDetailsScreenProps> = ({
  group: initialGroup,
  onBack,
  onAddMember,
  onRemoveMember,
  onLeaveGroup,
  onGroupUpdated,
  onAddTransaction,
  onEditTransaction,
  onImportSplitwise,
  refreshTrigger,
  groupRefreshTrigger,
  onStatsPress,
  initialListMode = "transactions",
  highlightedTransactionId = null,
  onHighlightedTransactionShown,
  captureHardwareBack = true,
}) => {
  const [leaving, setLeaving] = useState<boolean>(false);
  const [membershipActionLoading, setMembershipActionLoading] = useState<boolean>(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [workingParticipantId, setWorkingParticipantId] = useState<string | null>(null);
  const [menuVisible, setMenuVisible] = useState<boolean>(false);
  const [showSettlementForm, setShowSettlementForm] = useState<boolean>(false);
  const [settlingBalance, setSettlingBalance] = useState<Balance | null>(null);
  const [editingSettlement, setEditingSettlement] = useState<Settlement | null>(
    null
  );
  const [showMembers, setShowMembers] = useState<boolean>(false);
  const [showCurrencySettings, setShowCurrencySettings] = useState<boolean>(false);
  const [editDialogVisible, setEditDialogVisible] = useState(false);
  const [editName, setEditName] = useState(initialGroup.name);
  const [editDescription, setEditDescription] = useState(
    initialGroup.description || ""
  );
  const [listMode, setListMode] = useState<"transactions" | "activity">(
    initialListMode
  );
  const [transactionsFilter, setTransactionsFilter] = useState<LedgerFilter>("all");
  const [showActivityFilters, setShowActivityFilters] = useState(false);
  const [activityFilterType, setActivityFilterType] = useState<"all" | "expenses" | "settlements">("all");
  const [activityFilterParticipantId, setActivityFilterParticipantId] = useState<string>("all");
  const [safetyAction, setSafetyAction] = useState<SafetyAction | null>(null);
  const [safetyTarget, setSafetyTarget] = useState<SafetyTarget | null>(null);
  const mainListRef = React.useRef<FlatList<GroupDetailsListRow>>(null);
  const scrollPerfRef = React.useRef(new GroupListScrollPerfMonitor());
  const [listRefreshing, setListRefreshing] = useState(false);
  const [visibleHighlightedTransactionId, setVisibleHighlightedTransactionId] = useState<number | null>(
    highlightedTransactionId,
  );
  const highlightConsumedRef = React.useRef(false);
  const highlightTimerRef = React.useRef<TransactionHighlightTimer | null>(null);
  
  // Web-compatible confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    visible: boolean;
    title: string;
    message: string;
    confirmText: string;
    onConfirm: () => void;
    destructive?: boolean;
  } | null>(null);

  // Stable handler for closing menu
  const handleCloseMenu = () => {
    setMenuVisible(false);
  };

  // Stable handler for opening menu
  const handleOpenMenu = () => {
    setMenuVisible(true);
  };

  // Reset menu visibility when showMembers changes
  React.useEffect(() => {
    if (showMembers) {
      // Close menu when entering members view
      setMenuVisible(false);
    } else {
      // Reset menu state when coming back from members view
      // This ensures the menu can be opened again after returning
      setMenuVisible(false);
    }
  }, [showMembers]);

  // Real-time synchronization: listen for remote transactions/settlements
  useRealtimeGroupSync(initialGroup.id);

  // Fetch data with hooks
  const {
    data: groupData,
    isLoading: groupLoading,
    error: groupError,
    refetch: refetchGroup,
  } = useGroupDetails(initialGroup.id);
  const {
    data: txData,
    isLoading: txLoading,
    hasNextPage: txHasNextPage,
    isFetchingNextPage: txIsFetchingNextPage,
    fetchNextPage: fetchNextTransactionsPage,
    refetch: refetchTx,
  } = useTransactions(initialGroup.id);
  // Keep this group's latest-entered currency and split-among cached while the screen is open.
  useGroupLastTransactionCurrency(initialGroup.id);
  useGroupLastExpenseSplitAmong(initialGroup.id);
  const {
    data: invitations = [] as GroupInvitation[],
    isLoading: invitationsLoading,
    refetch: refetchInvites,
  } = useGroupInvitations(initialGroup.id, { enabled: showMembers });
  const {
    data: participants = [],
    refetch: refetchParticipants,
  } = useParticipants(initialGroup.id);
  // Single /balances?include_stats=true — avoids duplicate balances+stats fan-out
  const {
    data: balancesData,
    groupStats,
    isLoading: balancesLoading,
    error: balancesError,
    refetch: refetchBalances,
  } = useBalances(initialGroup.id, { includeStats: true });
  const groupStatsLoading = balancesLoading;
  const {
    data: settlementsData,
    isLoading: settlementsLoading,
    refetch: refetchSettlements,
  } = useSettlements(initialGroup.id);
  const {
    data: activityData,
    isLoading: activityLoading,
    isFetchingNextPage: activityFetchingNextPage,
    hasNextPage: activityHasNextPage,
    fetchNextPage: fetchNextActivityPage,
    refetch: refetchActivity,
  } = useActivity(initialGroup.id, {
    enabled: listMode === "activity",
  });
  const {
    report: reportContent,
    block: blockUser,
    isReporting,
    isBlocking,
  } = useModeration(initialGroup.id);
  const [cancellingInvitationId, setCancellingInvitationId] = useState<
    string | null
  >(null);
  const { session, signOut } = useAuth();
  const theme = useTheme();
  const {
    preferredCurrency,
    groupSettings,
    rateBook,
    setGroupSettings,
    setGroupRate,
    clearGroupRate,
  } = useCurrencyPreferences(initialGroup.id);

  // Critical-path ready telemetry (details + balances/stats)
  const groupOpenStartedAtRef = React.useRef(Date.now());
  const groupDetailsReadyLoggedRef = React.useRef(false);
  useEffect(() => {
    groupOpenStartedAtRef.current = Date.now();
    groupDetailsReadyLoggedRef.current = false;
  }, [initialGroup.id]);
  useEffect(() => {
    if (groupDetailsReadyLoggedRef.current) return;
    if (groupLoading || balancesLoading) return;
    if (groupError || balancesError) return;
    groupDetailsReadyLoggedRef.current = true;
    captureIdentifiedAnalyticsEvent(
      session?.user?.id,
      ANALYTICS_EVENTS.GROUP_DETAILS_READY,
      {
        group_id: initialGroup.id,
        duration_ms: Date.now() - groupOpenStartedAtRef.current,
      }
    );
  }, [
    groupLoading,
    balancesLoading,
    groupError,
    balancesError,
    initialGroup.id,
    session?.user?.id,
  ]);

  // Map user_id to participant_id for involvement filtering
  const userIdToParticipantId = useMemo(() => {
    const map = new Map<string, string>();
    participants.forEach(p => {
      if (p.user_id) map.set(p.user_id, p.id);
    });
    return map;
  }, [participants]);

  // Filter activity items
  const filteredActivities = useMemo(() => {
    let items = activityData?.activities || [];
    
    // Filter by type
    if (activityFilterType !== "all") {
      items = items.filter(item => {
        if (activityFilterType === "expenses") return item.type.startsWith("transaction");
        if (activityFilterType === "settlements") return item.type.startsWith("settlement");
        return true;
      });
    }
    
    // Filter by participant involvement
    if (activityFilterParticipantId !== "all") {
      items = items.filter(item => {
        // 1. Check if they are the actor (the one who made the change)
        const actorParticipantId = userIdToParticipantId.get(item.changed_by.id);
        if (actorParticipantId === activityFilterParticipantId) return true;

        // 2. Check transaction details
        if (item.details?.transaction) {
          const t = item.details.transaction;
          if (t.paid_by_participant_id === activityFilterParticipantId) return true;
          if (t.split_among_participant_ids?.includes(activityFilterParticipantId)) return true;
          if (t.splits?.some(s => s.participant_id === activityFilterParticipantId)) return true;
        }

        // 3. Check settlement details
        if (item.details?.settlement) {
          const s = item.details.settlement;
          if (s.from_participant_id === activityFilterParticipantId) return true;
          if (s.to_participant_id === activityFilterParticipantId) return true;
        }

        return false;
      });
    }
    
    return items;
  }, [activityData?.activities, activityFilterType, activityFilterParticipantId, userIdToParticipantId]);

  const openActivitySafetyAction = (
    action: SafetyAction,
    activity: ActivityItem,
  ) => {
    setSafetyTarget({
      targetUserId: activity.changed_by.id,
      targetName: activity.changed_by.full_name || activity.changed_by.email || "this user",
      contentType: "activity",
      contentId: activity.id,
    });
    setSafetyAction(action);
  };

  const openParticipantBlock = (participant: Participant) => {
    if (!participant.user_id) return;
    setSafetyTarget({
      targetUserId: participant.user_id,
      targetName: participant.full_name || participant.email || "this user",
      contentType: "profile",
      contentId: participant.user_id,
    });
    setSafetyAction("block");
  };

  const dismissSafetyAction = () => {
    if (isReporting || isBlocking) return;
    setSafetyAction(null);
    setSafetyTarget(null);
  };

  const handleReportContent = async (
    reason: Parameters<typeof reportContent>[0]["reason"],
    details: string,
  ) => {
    if (!safetyTarget) return;
    try {
      await reportContent({ ...safetyTarget, reason, details });
      setSafetyAction(null);
      setSafetyTarget(null);
      Alert.alert("Report submitted", "Thank you. The SharedMoney team will review this content.");
    } catch (error) {
      Alert.alert("Could not submit report", getUserFriendlyErrorMessage(error));
    }
  };

  const handleBlockUser = async () => {
    if (!safetyTarget) return;
    try {
      const blockedName = safetyTarget.targetName;
      await blockUser(safetyTarget);
      setSafetyAction(null);
      setSafetyTarget(null);
      Alert.alert("User blocked", `${blockedName}'s activity has been removed from your feed.`);
    } catch (error) {
      Alert.alert("Could not block user", getUserFriendlyErrorMessage(error));
    }
  };

  // Auto sign-out on session expiration with alert
  useEffect(() => {
    if (groupError && isSessionExpiredError(groupError)) {
      showErrorAlert(groupError, signOut, "Session Expired");
    }
  }, [groupError, signOut]);

  // Handle Android hardware back button. Skip while another screen is covering
  // this one so the overlay (e.g. transaction form) owns the back press.
  useEffect(() => {
    if (!captureHardwareBack) return;

    const handleHardwareBack = () => {
      if (showMembers) {
        setShowMembers(false);
        return true;
      }
      onBack();
      return true;
    };

    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      handleHardwareBack
    );
    return () => subscription.remove();
  }, [captureHardwareBack, onBack, showMembers]);

  // Refetch all data function
  const refetchAll = () => {
    console.log("[GroupDetailsScreen] refetchAll called");
    refetchTx();
    refetchActivity();
    refetchBalances();
    refetchSettlements();
  };

  // Mutations

  const removeMemberMutation = useRemoveMember(() => {
    refetchGroup();
    refetchInvites();
  });
  const archiveGroupMutation = useArchiveGroup(() => {
    void refetchGroup();
  });
  const unarchiveGroupMutation = useUnarchiveGroup(() => {
    void refetchGroup();
  });
  const hideGroupMutation = useHideGroupFromLists(() => {
    if (onLeaveGroup) {
      onLeaveGroup();
    } else {
      onBack();
    }
  });
  const updateGroupMutation = useUpdateGroup(() => {
    void refetchGroup();
  });
  const inviteParticipant = useInviteParticipant(() => {
    refetchParticipants();
    refetchInvites();
  });
  const connectParticipant = useConnectParticipant(() => {
    refetchGroup();
    refetchParticipants();
    refetchInvites();
  });
  const removeParticipant = useRemoveParticipant(() => {
    refetchGroup();
    refetchParticipants();
  });
  const cancelInvite = useCancelInvitation(refetchInvites);
  const createSettlement = useCreateSettlement(refetchAll);
  const updateSettlement = useUpdateSettlement(refetchAll);
  const deleteSettlement = useDeleteSettlement(refetchAll);

  // Use groupData directly, fallback to initialGroup while loading
  const group = groupData || initialGroup;

  useEffect(() => {
    if (!editDialogVisible) {
      setEditName(group.name);
      setEditDescription(group.description || "");
    }
  }, [group.name, group.description, editDialogVisible]);

  // API already filters by group_id, so no need for client-side filtering
  const transactions = txData;
  const settlements = settlementsData?.settlements ?? [];

  // Mixed ledger for the Transactions tab (expenses + payments). Spending cards
  // still use backend group_stats and intentionally ignore payment amounts.
  const ledgerItems = useMemo(
    () => buildTransactionsLedger(transactions, settlements, transactionsFilter),
    [transactions, settlements, transactionsFilter],
  );

  const activityEntries = useMemo(
    () => buildActivityFeedEntries(filteredActivities),
    [filteredActivities],
  );

  const listRows = useMemo<GroupDetailsListRow[]>(() => {
    if (listMode === "transactions") {
      return ledgerItems.map((item) => ({
        kind: "ledger" as const,
        key: item.key,
        item,
      }));
    }
    return activityEntries.map((entry) => ({
      kind: "activity" as const,
      key: entry.key,
      entry,
    }));
  }, [listMode, ledgerItems, activityEntries]);

  useEffect(() => {
    if (listMode !== "transactions" || txLoading) return;
    recordSentryListCounts("ledger", {
      itemCount: ledgerItems.length,
      hasNextPage: Boolean(txHasNextPage),
    });
  }, [listMode, txLoading, ledgerItems.length, txHasNextPage]);

  useEffect(() => {
    if (listMode !== "activity" || activityLoading) return;
    recordSentryListCounts("activity", {
      itemCount: activityData?.activities?.length ?? 0,
      hasNextPage: Boolean(activityHasNextPage),
    });
  }, [
    listMode,
    activityLoading,
    activityData?.activities?.length,
    activityHasNextPage,
  ]);

  useEffect(() => {
    if (!highlightedTransactionId || listMode !== "transactions") return;
    const targetLoaded = transactions.some((transaction) => transaction.id === highlightedTransactionId);
    if (!targetLoaded && txHasNextPage && !txIsFetchingNextPage) {
      void fetchNextTransactionsPage();
    }
  }, [
    fetchNextTransactionsPage,
    highlightedTransactionId,
    listMode,
    transactions,
    txHasNextPage,
    txIsFetchingNextPage,
  ]);

  useEffect(() => {
    if (highlightedTransactionId === null) return;
    setListMode("transactions");
    highlightTimerRef.current?.cancel();
    highlightTimerRef.current = createTransactionHighlightTimer(() => {
      setVisibleHighlightedTransactionId((currentTransactionId) =>
        currentTransactionId === highlightedTransactionId ? null : currentTransactionId
      );
    });
    highlightConsumedRef.current = false;
    setVisibleHighlightedTransactionId(highlightedTransactionId);
  }, [highlightedTransactionId]);

  useEffect(() => () => {
    highlightTimerRef.current?.cancel();
  }, []);

  useEffect(() => {
    if (
      highlightConsumedRef.current ||
      visibleHighlightedTransactionId === null ||
      listMode !== "transactions"
    ) {
      return;
    }

    const index = listRows.findIndex(
      (row) =>
        row.kind === "ledger" &&
        row.item.kind === "expense" &&
        row.item.transaction.id === visibleHighlightedTransactionId,
    );
    if (index < 0) return;

    const frame = requestAnimationFrame(() => {
      try {
        mainListRef.current?.scrollToIndex({
          index,
          animated: false,
          viewPosition: 0.15,
        });
      } catch {
        // FlatList may not be ready yet; onScrollToIndexFailed retries below.
      }
      highlightConsumedRef.current = true;
      onHighlightedTransactionShown?.(visibleHighlightedTransactionId);
      highlightTimerRef.current?.start();
    });

    return () => cancelAnimationFrame(frame);
  }, [
    listMode,
    listRows,
    onHighlightedTransactionShown,
    visibleHighlightedTransactionId,
  ]);

  const handleLoadMoreTransactions = React.useCallback(() => {
    if (!txHasNextPage || txIsFetchingNextPage) return;
    void withGroupListFetchNextPageTelemetry({
      userId: session?.user?.id,
      tab: "transactions",
      itemCountBefore: transactions.length,
      pageCountBefore: estimateTransactionsPageCount(transactions.length),
      fetch: () => fetchNextTransactionsPage(),
      resolveCounts: (result) => {
        const pages = result.data?.pages ?? [];
        const itemCount = pages.reduce(
          (sum, page) =>
            sum + (Array.isArray(page?.items) ? page.items.length : 0),
          0,
        );
        return { itemCount, pageCount: pages.length };
      },
    });
  }, [
    txHasNextPage,
    txIsFetchingNextPage,
    fetchNextTransactionsPage,
    session?.user?.id,
    transactions.length,
  ]);

  const handleLoadMoreActivity = React.useCallback(() => {
    if (!activityHasNextPage || activityFetchingNextPage) return;
    void withGroupListFetchNextPageTelemetry({
      userId: session?.user?.id,
      tab: "activity",
      itemCountBefore: activityData?.activities?.length ?? 0,
      pageCountBefore: estimateActivityPageCount(
        activityData?.activities?.length ?? 0,
      ),
      fetch: () => fetchNextActivityPage(),
      resolveCounts: (result) => {
        const pages = result.data?.pages ?? [];
        const itemCount = pages.reduce(
          (sum, page) =>
            sum + (Array.isArray(page?.activities) ? page.activities.length : 0),
          0,
        );
        return { itemCount, pageCount: pages.length };
      },
    });
  }, [
    activityHasNextPage,
    activityFetchingNextPage,
    fetchNextActivityPage,
    session?.user?.id,
    activityData?.activities?.length,
  ]);

  const clearVisibleTransactionHighlight = React.useCallback((transactionId: number) => {
    if (visibleHighlightedTransactionId !== transactionId) return;

    highlightTimerRef.current?.cancel();
    setVisibleHighlightedTransactionId(null);

    if (!highlightConsumedRef.current) {
      highlightConsumedRef.current = true;
      onHighlightedTransactionShown?.(transactionId);
    }
  }, [onHighlightedTransactionShown, visibleHighlightedTransactionId]);

  const finishScrollPerfSample = React.useCallback(() => {
    const sample = scrollPerfRef.current.stop();
    if (!sample) return;

    const itemCount =
      listMode === "transactions"
        ? ledgerItems.length
        : activityData?.activities?.length ?? 0;
    const pageCount =
      listMode === "transactions"
        ? estimateTransactionsPageCount(transactions.length)
        : estimateActivityPageCount(activityData?.activities?.length ?? 0);

    recordGroupListScrollTelemetry({
      userId: session?.user?.id,
      tab: listMode,
      itemCount,
      pageCount,
      durationMs: sample.durationMs,
      frameCount: sample.frameCount,
      maxFrameGapMs: sample.maxFrameGapMs,
      approxFps: sample.approxFps,
    });
  }, [
    activityData?.activities?.length,
    ledgerItems.length,
    listMode,
    session?.user?.id,
    transactions.length,
  ]);

  const handleMainScrollBeginDrag = React.useCallback(() => {
    scrollPerfRef.current.start();
    if (
      visibleHighlightedTransactionId === null ||
      !shouldClearTransactionHighlightOnScroll(visibleHighlightedTransactionId)
    ) {
      return;
    }
    clearVisibleTransactionHighlight(visibleHighlightedTransactionId);
  }, [clearVisibleTransactionHighlight, visibleHighlightedTransactionId]);

  const handleScrollEndDrag = React.useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const velocityY = event.nativeEvent.velocity?.y ?? 0;
      if (Math.abs(velocityY) < 0.02) {
        finishScrollPerfSample();
      }
    },
    [finishScrollPerfSample],
  );

  const handleMomentumScrollEnd = React.useCallback(() => {
    finishScrollPerfSample();
  }, [finishScrollPerfSample]);

  const handleEndReached = React.useCallback(() => {
    if (listMode === "transactions" && transactionsFilter !== "payments") {
      handleLoadMoreTransactions();
      return;
    }
    if (listMode === "activity") {
      handleLoadMoreActivity();
    }
  }, [
    listMode,
    transactionsFilter,
    handleLoadMoreTransactions,
    handleLoadMoreActivity,
  ]);

  const handlePullToRefresh = React.useCallback(async () => {
    setListRefreshing(true);
    try {
      await Promise.all([
        refetchGroup(),
        refetchTx(),
        refetchSettlements(),
        refetchActivity(),
        refetchBalances(),
        refetchParticipants(),
        refetchInvites(),
      ]);
    } finally {
      setListRefreshing(false);
    }
  }, [
    refetchActivity,
    refetchBalances,
    refetchGroup,
    refetchInvites,
    refetchParticipants,
    refetchSettlements,
    refetchTx,
  ]);

  const handleScrollToIndexFailed = React.useCallback(
    (info: { index: number; averageItemLength: number }) => {
      mainListRef.current?.scrollToOffset({
        offset: Math.max(0, info.averageItemLength * info.index),
        animated: false,
      });
      requestAnimationFrame(() => {
        mainListRef.current?.scrollToIndex({
          index: info.index,
          animated: false,
          viewPosition: 0.15,
        });
      });
    },
    [],
  );

  // Refresh invitations when refreshTrigger changes (e.g., after adding a member)
  useEffect(() => {
    if (refreshTrigger !== undefined && refreshTrigger > 0) {
      refetchInvites();
    }
  }, [refreshTrigger, refetchInvites]);

  // Refresh group data when groupRefreshTrigger changes (e.g., after adding/removing a member)
  useEffect(() => {
    if (groupRefreshTrigger !== undefined && groupRefreshTrigger > 0) {
      refetchGroup();
    }
  }, [groupRefreshTrigger, refetchGroup]);

  const handleLeaveGroup = async () => {
    const currentUserIdForLeave = session?.user?.id;
    if (!currentUserIdForLeave) {
      if (Platform.OS === "web") {
        setConfirmDialog({
          visible: true,
          title: "Error",
          message: "Unable to identify user",
          confirmText: "OK",
          onConfirm: () => setConfirmDialog(null),
        });
      } else {
        Alert.alert("Error", "Unable to identify user");
      }
      return;
    }

    const leaveMessage = buildLeaveGroupConfirmMessage(
      group.name,
      balancesData?.group_balances?.[0]?.balances,
      currentUserIdForLeave
    );

    const performLeave = async () => {
      try {
        setLeaving(true);
        await removeMemberMutation.mutate({
          groupId: group.id,
          userId: currentUserIdForLeave,
        });
        // Call the onLeaveGroup callback if provided, otherwise just go back
        if (onLeaveGroup) {
          onLeaveGroup();
        } else {
          onBack();
        }
      } catch (err) {
        if (Platform.OS === "web") {
          setConfirmDialog({
            visible: true,
            title: "Error",
            message: getUserFriendlyErrorMessage(err),
            confirmText: "OK",
            onConfirm: () => setConfirmDialog(null),
          });
        } else {
          Alert.alert("Error", getUserFriendlyErrorMessage(err));
        }
      } finally {
        setLeaving(false);
        setMenuVisible(false);
      }
    };

    if (Platform.OS === "web") {
      setConfirmDialog({
        visible: true,
        title: "Leave group",
        message: leaveMessage,
        confirmText: "Leave",
        destructive: true,
        onConfirm: () => {
          setConfirmDialog(null);
          void performLeave();
        },
      });
    } else {
      Alert.alert(
        "Leave group",
        leaveMessage,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Leave",
            style: "destructive",
            onPress: performLeave,
          },
        ]
      );
    }
  };

  const runMembershipVisibilityAction = async (
    title: string,
    message: string,
    confirmText: string,
    action: () => Promise<unknown>,
    options?: { leaveAfter?: boolean }
  ) => {
    const perform = async () => {
      try {
        setMembershipActionLoading(true);
        await action();
        if (options?.leaveAfter) {
          if (onLeaveGroup) {
            onLeaveGroup();
          } else {
            onBack();
          }
        }
      } catch (err) {
        if (Platform.OS === "web") {
          setConfirmDialog({
            visible: true,
            title: "Error",
            message: getUserFriendlyErrorMessage(err),
            confirmText: "OK",
            onConfirm: () => setConfirmDialog(null),
          });
        } else {
          Alert.alert("Error", getUserFriendlyErrorMessage(err));
        }
      } finally {
        setMembershipActionLoading(false);
        setMenuVisible(false);
      }
    };

    if (Platform.OS === "web") {
      setConfirmDialog({
        visible: true,
        title,
        message,
        confirmText,
        destructive: confirmText !== "Unarchive",
        onConfirm: () => {
          setConfirmDialog(null);
          void perform();
        },
      });
    } else {
      Alert.alert(title, message, [
        { text: "Cancel", style: "cancel" },
        {
          text: confirmText,
          style: confirmText === "Unarchive" ? "default" : "destructive",
          onPress: perform,
        },
      ]);
    }
  };

  const handleArchiveGroup = () => {
    void runMembershipVisibilityAction(
      "Archive",
      ARCHIVE_GROUP_CONFIRM_MESSAGE,
      "Archive",
      () => archiveGroupMutation.mutate(group.id),
      { leaveAfter: true }
    );
  };

  const handleUnarchiveGroup = () => {
    void runMembershipVisibilityAction(
      "Unarchive",
      "Show this group in your active list again.",
      "Unarchive",
      () => unarchiveGroupMutation.mutate(group.id)
    );
  };

  const handleRemoveFromMyLists = () => {
    void runMembershipVisibilityAction(
      "Remove from my lists",
      REMOVE_FROM_LISTS_CONFIRM_MESSAGE,
      "Remove",
      () => hideGroupMutation.mutate(group.id)
    );
  };

  const handleRemoveMember = async (participant: Participant) => {
    const memberName = participant.full_name || participant.email || "this person";
    const isRemovingSelf = participant.user_id === session?.user?.id;

    const performRemove = async () => {
      try {
        setRemovingMemberId(participant.id);
        await removeParticipant.mutate({
          groupId: group.id,
          participantId: participant.id,
        });
        // If removing self, navigate back
        if (isRemovingSelf && onLeaveGroup) {
          onLeaveGroup();
        }
      } catch (error) {
        if (Platform.OS === "web") {
          setConfirmDialog({
            visible: true,
            title: "Error",
            message: getUserFriendlyErrorMessage(error),
            confirmText: "OK",
            onConfirm: () => setConfirmDialog(null),
          });
        } else {
          Alert.alert("Error", getUserFriendlyErrorMessage(error));
        }
      } finally {
        setRemovingMemberId(null);
      }
    };

    if (Platform.OS === "web") {
      setConfirmDialog({
        visible: true,
        title: isRemovingSelf ? "Leave group" : "Remove Member",
        message: isRemovingSelf
          ? buildLeaveGroupConfirmMessage(
              group.name,
              balancesData?.group_balances?.[0]?.balances,
              session?.user?.id
            )
          : `Are you sure you want to remove "${memberName}" from this group?`,
        confirmText: isRemovingSelf ? "Leave" : "Remove",
        destructive: true,
        onConfirm: () => {
          setConfirmDialog(null);
          void performRemove();
        },
      });
    } else {
      Alert.alert(
        isRemovingSelf ? "Leave group" : "Remove Member",
        isRemovingSelf
          ? buildLeaveGroupConfirmMessage(
              group.name,
              balancesData?.group_balances?.[0]?.balances,
              session?.user?.id
            )
          : `Are you sure you want to remove "${memberName}" from this group?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: isRemovingSelf ? "Leave" : "Remove",
            style: "destructive",
            onPress: performRemove,
          },
        ]
      );
    }
  };

  const handleSettleUp = (balance: Balance) => {
    if (!isActiveMember || balancesError) return;
    setEditingSettlement(null);
    setSettlingBalance(balance);
    setShowSettlementForm(true);
  };

  const handleSettlementSave = async (settlementData: {
    group_id: string;
    from_participant_id: string;
    to_participant_id: string;
    amount: number;
    currency: string;
    notes?: string;
  }) => {
    await createSettlement.mutate(settlementData);
    setShowSettlementForm(false);
    setSettlingBalance(null);
  };

  const handleSettlementUpdate = async (updateData: {
    id: string;
    amount?: number;
    currency?: string;
    notes?: string;
    from_participant_id?: string;
    to_participant_id?: string;
    date?: string;
    group_id?: string;
  }) => {
    await updateSettlement.mutate({
      ...updateData,
      group_id: updateData.group_id || group.id,
    });
    setShowSettlementForm(false);
    setEditingSettlement(null);
    setSettlingBalance(null);
  };

  const handleSettlementDelete = async () => {
    if (!editingSettlement) return;
    await deleteSettlement.mutate({
      id: editingSettlement.id,
      groupId: editingSettlement.group_id || group.id,
    });
    setShowSettlementForm(false);
    setEditingSettlement(null);
    setSettlingBalance(null);
  };

  const handleEditSettlement = (settlement: Settlement) => {
    // Prefer live settlement row so edits use current amount/participants
    const liveSettlement = settlementsData?.settlements?.find(
      (item) => item.id === settlement.id
    );
    const settlementWithGroupId = {
      ...(liveSettlement || settlement),
      group_id:
        liveSettlement?.group_id || settlement.group_id || group.id,
    };

    // If activity snapshot is missing participants/amount, refresh list once
    if (
      !liveSettlement &&
      settlement.id &&
      (!settlement.from_participant_id || !settlement.to_participant_id)
    ) {
      void refetchSettlements().then((result) => {
        const refreshed = result.data?.settlements?.find(
          (item) => item.id === settlement.id
        );
        setSettlingBalance(null);
        setEditingSettlement({
          ...(refreshed || settlementWithGroupId),
          group_id:
            refreshed?.group_id || settlementWithGroupId.group_id || group.id,
        });
        setShowSettlementForm(true);
      });
      return;
    }

    setSettlingBalance(null);
    setEditingSettlement(settlementWithGroupId);
    setShowSettlementForm(true);
  };

  const currentUserId = session?.user?.id;
  // isMember checks if the user exists in the group list at all (includes active and left)
  const isMember =
    group.members?.some((m) => m.user_id === currentUserId) ?? false;
  
  // isActiveMember checks if the user is currently active
  const isActiveMember =
    group.members?.some((m) => m.user_id === currentUserId && m.status === 'active') ?? false;

  const myMembership = group.members?.find((m) => m.user_id === currentUserId);
  const isArchivedForMe = Boolean(
    (group.archived_at || myMembership?.archived_at) && isActiveMember
  );
  const isFormerMember = isMember && !isActiveMember;

  const isOwner =
    group.members?.some(
      (m) =>
        m.user_id === currentUserId &&
        m.status === "active" &&
        (m.role === "owner" || group.created_by === currentUserId)
    ) ?? false;

  const canManageMembers = isActiveMember;
  const canManageInvites = isActiveMember;
  const showGroupMenu = (isActiveMember || isFormerMember) && !showMembers;
  const activeMemberCount = countActiveMembers(group.members);
  const ledgerIsEmpty =
    !txLoading &&
    !settlementsLoading &&
    transactions.length === 0 &&
    settlements.length === 0;
  const preferAddPeopleFab = shouldPreferAddPeopleFab(
    activeMemberCount,
    ledgerIsEmpty,
  );

  const handleOpenEditGroup = () => {
    setEditName(group.name);
    setEditDescription(group.description || "");
    setEditDialogVisible(true);
  };

  const handleCloseEditGroup = () => {
    setEditDialogVisible(false);
  };

  const handleSaveGroupDetails = async () => {
    const trimmedName = editName.trim();
    if (!trimmedName) {
      Alert.alert("Validation", "Group name cannot be empty.");
      return;
    }

    const normalizedDescription = editDescription.trim();

    try {
      const updatedGroup = await updateGroupMutation.mutate({
        groupId: group.id,
        name: trimmedName,
        description: normalizedDescription.length > 0 ? normalizedDescription : null,
      });
      setEditDialogVisible(false);
      setMenuVisible(false);
      onGroupUpdated?.(updatedGroup);
    } catch (err) {
      Alert.alert("Error", getUserFriendlyErrorMessage(err));
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    const performCancel = async () => {
      try {
        setCancellingInvitationId(invitationId);
        await cancelInvite.mutate({
          invitationId,
          groupId: group.id,
        });
      } catch (err) {
        if (Platform.OS === "web") {
          setConfirmDialog({
            visible: true,
            title: "Error",
            message: getUserFriendlyErrorMessage(err),
            confirmText: "OK",
            onConfirm: () => setConfirmDialog(null),
          });
        } else {
          Alert.alert("Error", getUserFriendlyErrorMessage(err));
        }
      } finally {
        setCancellingInvitationId(null);
      }
    };

    if (Platform.OS === "web") {
      setConfirmDialog({
        visible: true,
        title: "Cancel Invitation",
        message: "Are you sure you want to cancel this invitation?",
        confirmText: "Yes",
        destructive: true,
        onConfirm: () => {
          setConfirmDialog(null);
          void performCancel();
        },
      });
    } else {
      Alert.alert(
        "Cancel Invitation",
        "Are you sure you want to cancel this invitation?",
        [
          { text: "No", style: "cancel" },
          {
            text: "Yes",
            style: "destructive",
            onPress: performCancel,
          },
        ]
      );
    }
  };

  const handleInviteParticipant = async (participant: Participant) => {
    try {
      setWorkingParticipantId(participant.id);
      const result = await inviteParticipant.mutate({
        groupId: group.id,
        participantId: participant.id,
        email: participant.email,
      });
      Alert.alert("Invitation", result?.message || "Invitation sent successfully.");
    } catch (error) {
      showErrorAlert(error, signOut, "Error");
    } finally {
      setWorkingParticipantId(null);
    }
  };

  const handleConnectParticipant = async (participant: Participant) => {
    try {
      setWorkingParticipantId(participant.id);
      await connectParticipant.mutate({
        groupId: group.id,
        participantId: participant.id,
        email: participant.email,
      });
      Alert.alert("Connected", "Their existing history is now connected to their account.");
    } catch (error) {
      showErrorAlert(error, signOut, "Error");
    } finally {
      setWorkingParticipantId(null);
    }
  };

  const handleStatNavigation = (mode: GroupStatsMode) => {
    if (onStatsPress) {
      onStatsPress(mode);
    }
  };

  if (groupLoading && !group.members) {
    return (
      <View
        style={[
          styles.centerContainer,
          { backgroundColor: theme.colors.background },
        ]}
      >
        <ActivityIndicator size="large" />
        <Text variant="bodyLarge" style={{ marginTop: 16 }}>
          Loading group details...
        </Text>
      </View>
    );
  }

  if (groupError) {
    // Don't show Retry button for session expiration - user will be signed out automatically
    if (isSessionExpiredError(groupError)) {
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
            {getUserFriendlyErrorMessage(groupError)}
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
          {getUserFriendlyErrorMessage(groupError)}
        </Text>
        <Button
          mode="contained"
          onPress={() => {
            void refetchGroup();
          }}
        >
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
        <Appbar.BackAction
          onPress={() => {
            if (showMembers) {
              setShowMembers(false);
            } else {
              onBack();
            }
          }}
          accessibilityLabel="Navigate back"
          testID="back-button"
        />
        <Appbar.Content
          title={showMembers ? "People" : group.name}
          titleStyle={{ fontWeight: "bold" }}
        />
        {/* Group options — active: Archive/Leave; archived: Unarchive/Leave/Remove; former: Remove */}
        {showGroupMenu && (
          <Menu
            visible={menuVisible && !showMembers}
            onDismiss={handleCloseMenu}
            anchor={
              !showMembers ? (
                <Appbar.Action
                  icon="dots-vertical"
                  onPress={handleOpenMenu}
                  accessibilityLabel="Group options"
                  testID="group-menu-button"
                />
              ) : (
                <View style={{ width: 0, height: 0 }} />
              )
            }
            contentStyle={{ minWidth: 200 }}
          >
            {isActiveMember && (
              <>
                <Menu.Item
                  onPress={() => {
                    handleCloseMenu();
                    setShowMembers(true);
                  }}
                  title="People"
                  leadingIcon="account-group"
                  testID="group-menu-people"
                />
                {isOwner && (
                  <Menu.Item
                    onPress={() => {
                      handleCloseMenu();
                      handleOpenEditGroup();
                    }}
                    title="Edit group details"
                    leadingIcon="pencil"
                    testID="group-menu-edit-details"
                  />
                )}
                <Menu.Item
                  onPress={() => {
                    handleCloseMenu();
                    setShowCurrencySettings(true);
                  }}
                  title="Settlement currency"
                  leadingIcon="cash-sync"
                  testID="group-menu-settlement-currency"
                />
                {onImportSplitwise && (
                  <Menu.Item
                    onPress={() => {
                      handleCloseMenu();
                      onImportSplitwise();
                    }}
                    title="Import from Splitwise"
                    leadingIcon="file-import-outline"
                    testID="group-menu-import-splitwise"
                  />
                )}
                {!isArchivedForMe ? (
                  <Menu.Item
                    onPress={() => {
                      handleCloseMenu();
                      handleArchiveGroup();
                    }}
                    title="Archive"
                    leadingIcon="archive-outline"
                    testID="group-menu-archive"
                    disabled={membershipActionLoading}
                  />
                ) : (
                  <Menu.Item
                    onPress={() => {
                      handleCloseMenu();
                      handleUnarchiveGroup();
                    }}
                    title="Unarchive"
                    leadingIcon="archive-off-outline"
                    testID="group-menu-unarchive"
                    disabled={membershipActionLoading}
                  />
                )}
                <Menu.Item
                  onPress={() => {
                    handleCloseMenu();
                    handleLeaveGroup();
                  }}
                  title="Leave group"
                  leadingIcon="exit-run"
                  titleStyle={{ color: theme.colors.error }}
                  testID="group-menu-leave"
                  disabled={leaving}
                />
              </>
            )}
            {(isArchivedForMe || isFormerMember) && (
              <Menu.Item
                onPress={() => {
                  handleCloseMenu();
                  handleRemoveFromMyLists();
                }}
                title="Remove from my lists"
                leadingIcon="eye-off-outline"
                titleStyle={{ color: theme.colors.error }}
                testID="group-menu-remove-from-lists"
                disabled={membershipActionLoading}
              />
            )}
          </Menu>
        )}
      </Appbar.Header>

      {/* Banner for former members */}
      {!isActiveMember && isMember && !showMembers && (
          <View style={{ backgroundColor: theme.colors.errorContainer, paddingHorizontal: 16, paddingVertical: 8, alignItems: 'center', width: '100%' }}>
            <Text style={{ color: theme.colors.onErrorContainer, fontSize: 12, fontWeight: 'bold' }}>
              You are viewing this group as a former member
            </Text>
          </View>
      )}

      {/* Banner for archived (still active) membership */}
      {isArchivedForMe && !showMembers && (
          <View style={{ backgroundColor: theme.colors.secondaryContainer, paddingHorizontal: 16, paddingVertical: 8, alignItems: 'center', width: '100%' }} testID="archived-banner">
            <Text style={{ color: theme.colors.onSecondaryContainer, fontSize: 12, fontWeight: 'bold' }}>
              Archived — hidden from your active groups
            </Text>
          </View>
      )}

      {showMembers ? (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.sectionContent}>
            <MembersList
              people={participants}
              currentUserId={session?.user?.id}
              canManageMembers={canManageMembers}
              removingMemberId={removingMemberId}
              workingParticipantId={workingParticipantId}
              onRemove={handleRemoveMember}
              onInvite={handleInviteParticipant}
              onConnect={handleConnectParticipant}
              onBlock={openParticipantBlock}
            />
            {participants.length > 0 &&
              invitations.length > 0 && <View style={{ height: 16 }} />}
            <InvitationsList
              invitations={invitations.filter((i) => i.status === "pending")}
              loading={invitationsLoading}
              canManageInvites={canManageInvites}
              cancellingInvitationId={cancellingInvitationId}
              onCancel={handleCancelInvitation}
            />
            {canManageMembers && (
              <Button
                mode="contained"
                onPress={onAddMember}
                icon="account-plus"
                style={{ marginTop: 24 }}
                testID="add-member-button"
              >
                Add person
              </Button>
            )}
          </View>
          <View style={{ height: 80 }} />
        </ScrollView>
      ) : (
        <FlatList
          ref={mainListRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          data={listRows}
          keyExtractor={(row) => row.key}
          showsVerticalScrollIndicator={false}
          onScrollBeginDrag={handleMainScrollBeginDrag}
          onScrollEndDrag={handleScrollEndDrag}
          onMomentumScrollEnd={handleMomentumScrollEnd}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.4}
          onScrollToIndexFailed={handleScrollToIndexFailed}
          ItemSeparatorComponent={
            listMode === "transactions"
              ? () => <View style={{ height: 8 }} />
              : undefined
          }
          refreshControl={
            <RefreshControl
              refreshing={listRefreshing}
              onRefresh={() => {
                void handlePullToRefresh();
              }}
            />
          }
          ListHeaderComponent={
            <View>
              <GroupDashboard
                groupId={group.id}
                balances={balancesData?.group_balances?.[0]?.balances || []}
                groupStats={groupStats}
                currentUserId={session?.user?.id}
                currentUserParticipantId={participants.find((p) => p.user_id === session?.user?.id)?.id}
                loading={balancesLoading}
                statsLoading={groupStatsLoading}
                quietLoading={
                  listMode === "transactions"
                    ? txLoading || settlementsLoading
                    : activityLoading
                }
                defaultCurrency={getDefaultCurrency()}
                activeMemberCount={activeMemberCount}
                balanceError={!!balancesError}
                onSettlePress={isActiveMember && !balancesError ? handleSettleUp : undefined}
                onMyCostsPress={() => handleStatNavigation("my-costs")}
                onTotalCostsPress={() => handleStatNavigation("total-costs")}
                onOpenCurrencySettings={() => setShowCurrencySettings(true)}
              />

              <View
                style={{
                  paddingHorizontal: 16,
                  marginTop: 8,
                  marginBottom: 4,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Text variant="titleMedium" style={{ fontWeight: "700", color: theme.colors.onSurface }}>
                  Recent expenses
                </Text>
              </View>
              <View style={{ paddingHorizontal: 16, marginBottom: 0 }}>
                <SegmentedButtons
                  value={listMode}
                  onValueChange={(val: string) =>
                    setListMode(val as "transactions" | "activity")
                  }
                  theme={{
                    colors: {
                      secondaryContainer: theme.colors.primaryContainer,
                      onSecondaryContainer: theme.colors.onPrimaryContainer,
                    },
                  }}
                  buttons={[
                    {
                      value: "transactions",
                      label: "Transactions",
                      icon: "format-list-bulleted",
                    },
                    {
                      value: "activity",
                      label: "Activity",
                      icon: "history",
                    },
                  ]}
                />
              </View>

              {listMode === "transactions" ? (
                <View style={styles.transactionsFilterRow}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <Chip
                      selected={transactionsFilter === "all"}
                      onPress={() => setTransactionsFilter("all")}
                      style={[
                        styles.filterChip,
                        transactionsFilter === "all" && {
                          backgroundColor: theme.colors.primaryContainer,
                        },
                      ]}
                      showSelectedCheck={true}
                      mode={transactionsFilter === "all" ? "flat" : "outlined"}
                      testID="transactions-filter-all"
                    >
                      All
                    </Chip>
                    <Chip
                      selected={transactionsFilter === "expenses"}
                      onPress={() => setTransactionsFilter("expenses")}
                      style={[
                        styles.filterChip,
                        transactionsFilter === "expenses" && {
                          backgroundColor: theme.colors.primaryContainer,
                        },
                      ]}
                      showSelectedCheck={true}
                      icon="format-list-bulleted"
                      mode={transactionsFilter === "expenses" ? "flat" : "outlined"}
                      testID="transactions-filter-expenses"
                    >
                      Expenses
                    </Chip>
                    <Chip
                      selected={transactionsFilter === "payments"}
                      onPress={() => setTransactionsFilter("payments")}
                      style={[
                        styles.filterChip,
                        transactionsFilter === "payments" && {
                          backgroundColor: theme.colors.primaryContainer,
                        },
                      ]}
                      showSelectedCheck={true}
                      icon="handshake-outline"
                      mode={transactionsFilter === "payments" ? "flat" : "outlined"}
                      testID="transactions-filter-payments"
                    >
                      Payments
                    </Chip>
                  </ScrollView>
                </View>
              ) : (
                <View style={[styles.sectionContent, styles.activitySection]}>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "flex-end",
                      alignItems: "center",
                      marginBottom: 0,
                      paddingHorizontal: 4,
                      marginTop: -8,
                    }}
                  >
                    <Button
                      mode={showActivityFilters ? "contained-tonal" : "text"}
                      onPress={() => setShowActivityFilters(!showActivityFilters)}
                      icon={showActivityFilters ? "filter-variant-remove" : "filter-variant"}
                      compact
                      style={{ borderRadius: 20 }}
                      contentStyle={{ flexDirection: "row-reverse" }}
                    >
                      Filters{" "}
                      {(activityFilterType !== "all" ||
                        activityFilterParticipantId !== "all") &&
                        "•"}
                    </Button>
                  </View>

                  {showActivityFilters && (
                    <View style={styles.filterContainer}>
                      <Text variant="labelLarge" style={styles.filterLabel}>
                        Filter by Type
                      </Text>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={styles.filterRow}
                      >
                        <Chip
                          selected={activityFilterType === "all"}
                          onPress={() => setActivityFilterType("all")}
                          style={[
                            styles.filterChip,
                            activityFilterType === "all" && {
                              backgroundColor: theme.colors.primaryContainer,
                            },
                          ]}
                          showSelectedCheck={true}
                          mode={activityFilterType === "all" ? "flat" : "outlined"}
                        >
                          All Types
                        </Chip>
                        <Chip
                          selected={activityFilterType === "expenses"}
                          onPress={() => setActivityFilterType("expenses")}
                          style={[
                            styles.filterChip,
                            activityFilterType === "expenses" && {
                              backgroundColor: theme.colors.primaryContainer,
                            },
                          ]}
                          showSelectedCheck={true}
                          icon="format-list-bulleted"
                          mode={activityFilterType === "expenses" ? "flat" : "outlined"}
                        >
                          Expenses
                        </Chip>
                        <Chip
                          selected={activityFilterType === "settlements"}
                          onPress={() => setActivityFilterType("settlements")}
                          style={[
                            styles.filterChip,
                            activityFilterType === "settlements" && {
                              backgroundColor: theme.colors.primaryContainer,
                            },
                          ]}
                          showSelectedCheck={true}
                          icon="hand-coin"
                          mode={
                            activityFilterType === "settlements" ? "flat" : "outlined"
                          }
                        >
                          Settlements
                        </Chip>
                      </ScrollView>

                      <Text
                        variant="labelLarge"
                        style={[styles.filterLabel, { marginTop: 4 }]}
                      >
                        Filter by Person
                      </Text>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={styles.filterRow}
                      >
                        <Chip
                          selected={activityFilterParticipantId === "all"}
                          onPress={() => setActivityFilterParticipantId("all")}
                          style={[
                            styles.filterChip,
                            activityFilterParticipantId === "all" && {
                              backgroundColor: theme.colors.primaryContainer,
                            },
                          ]}
                          showSelectedCheck={true}
                          mode={
                            activityFilterParticipantId === "all" ? "flat" : "outlined"
                          }
                        >
                          Everyone
                        </Chip>
                        {participants.map((participant) => (
                          <Chip
                            key={participant.id}
                            selected={activityFilterParticipantId === participant.id}
                            onPress={() =>
                              setActivityFilterParticipantId(participant.id)
                            }
                            style={[
                              styles.filterChip,
                              activityFilterParticipantId === participant.id && {
                                backgroundColor: theme.colors.primaryContainer,
                              },
                            ]}
                            showSelectedCheck={true}
                            avatar={
                              participant.avatar_url ? (
                                <Avatar.Image
                                  size={24}
                                  source={{ uri: participant.avatar_url }}
                                />
                              ) : undefined
                            }
                            mode={
                              activityFilterParticipantId === participant.id
                                ? "flat"
                                : "outlined"
                            }
                          >
                            {participant.full_name ||
                              participant.email?.split("@")[0] ||
                              "User"}
                          </Chip>
                        ))}
                      </ScrollView>
                    </View>
                  )}
                </View>
              )}
            </View>
          }
          renderItem={({ item: row, index }) => {
            if (row.kind === "ledger") {
              return (
                <View style={{ paddingTop: index === 0 ? 8 : 0 }}>
                  <LedgerRow
                    item={row.item}
                    members={group.members || []}
                    participants={participants}
                    highlightedTransactionId={visibleHighlightedTransactionId}
                    onHighlightedInteraction={clearVisibleTransactionHighlight}
                    onEditExpense={isActiveMember ? onEditTransaction : () => {}}
                    onEditPayment={
                      isActiveMember
                        ? (settlement) => handleEditSettlement(settlement)
                        : undefined
                    }
                  />
                </View>
              );
            }

            if (row.entry.kind === "header") {
              const isFirstHeader = !listRows
                .slice(0, index)
                .some((prior) => prior.kind === "activity" && prior.entry.kind === "header");
              return (
                <View style={{ paddingHorizontal: 16 }}>
                  <ActivityDateHeader title={row.entry.title} isFirst={isFirstHeader} />
                </View>
              );
            }

            return (
              <View style={{ paddingHorizontal: 16 }}>
                <ActivityFeedRow
                  activity={row.entry.activity}
                  onReport={(activity) => openActivitySafetyAction("report", activity)}
                  onBlock={(activity) => openActivitySafetyAction("block", activity)}
                  onPressSettlement={
                    isActiveMember
                      ? (settlement) => handleEditSettlement(settlement)
                      : undefined
                  }
                />
              </View>
            );
          }}
          ListEmptyComponent={
            listMode === "transactions" ? (
              txLoading || settlementsLoading ? (
                <ActivityIndicator size="small" style={{ marginVertical: 24 }} />
              ) : (
                <View style={{ paddingHorizontal: 16 }}>
                  <TransactionsEmptyState
                    filter={transactionsFilter}
                    members={group.members || []}
                    canAct={isActiveMember}
                    onAddPeople={onAddMember}
                    onAddExpense={onAddTransaction}
                  />
                </View>
              )
            ) : activityLoading ? (
              <ActivityIndicator size="small" style={{ marginVertical: 16 }} />
            ) : (
              <View style={{ paddingHorizontal: 16 }}>
                <ActivityFeedEmptyState
                  isFiltered={
                    activityFilterType !== "all" ||
                    activityFilterParticipantId !== "all"
                  }
                />
              </View>
            )
          }
          ListFooterComponent={
            <View style={{ alignItems: "center", paddingTop: 8, paddingBottom: 80 }}>
              {(listMode === "transactions"
                ? txIsFetchingNextPage
                : activityFetchingNextPage) ? (
                <RNActivityIndicator size="small" />
              ) : null}
            </View>
          }
        />
      )}

      {!showMembers && isActiveMember && (
        <FAB
          testID={preferAddPeopleFab ? "add-people-fab" : "add-expense-button"}
          icon={preferAddPeopleFab ? "account-plus" : "plus"}
          style={[
            styles.fab,
            { backgroundColor: theme.colors.primary },
          ]}
          color={theme.colors.onPrimary}
          onPress={preferAddPeopleFab ? onAddMember : onAddTransaction}
          label={preferAddPeopleFab ? "Add people" : "Add expense"}
          accessibilityLabel={preferAddPeopleFab ? "Add people" : "Add expense"}
        />
      )}

      <SafetyActionModal
        action={safetyAction}
        target={safetyTarget}
        submitting={isReporting || isBlocking}
        onDismiss={dismissSafetyAction}
        onReport={handleReportContent}
        onBlock={handleBlockUser}
      />

      {/* Settlement form modal */}
      <SettlementFormScreen
        visible={showSettlementForm}
        balance={settlingBalance}
        settlement={editingSettlement}
        groupMembers={group.members || []}
        participants={participants}
        currentUserId={session?.user?.id || ""}
        groupId={group.id}
        defaultCurrency={getDefaultCurrency()}
        onSave={async (data) => {
          if (editingSettlement) {
            await handleSettlementUpdate({
              id: editingSettlement.id,
              group_id: editingSettlement.group_id || group.id,
              amount: data.amount,
              currency: data.currency,
              notes: data.notes,
              from_participant_id: data.from_participant_id,
              to_participant_id: data.to_participant_id,
            });
          } else {
            await handleSettlementSave(data);
          }
        }}
        onUpdate={handleSettlementUpdate}
        onDelete={editingSettlement ? handleSettlementDelete : undefined}
        onDismiss={() => {
          // Hide first so the closing frame keeps edit chrome (avoids a
          // one-frame flash of the create "Select a member" UI).
          setShowSettlementForm(false);
          setTimeout(() => {
            setSettlingBalance(null);
            setEditingSettlement(null);
          }, SCREEN_TRANSITION_MS);
        }}
      />

      <SettlementCurrencySheet
        visible={showCurrencySettings}
        groupName={group.name}
        currencies={collectCurrencies([
          ...(balancesData?.group_balances?.[0]?.balances || []),
          ...(transactions || []),
        ])}
        settings={groupSettings}
        preferredCurrency={preferredCurrency}
        rateBook={rateBook}
        onDismiss={() => setShowCurrencySettings(false)}
        onToggle={(enabled, settlementCurrency) => {
          void setGroupSettings(group.id, { enabled, settlementCurrency });
        }}
        onChangeCurrency={(currency) => {
          void setGroupSettings(group.id, {
            enabled: true,
            settlementCurrency: currency,
          });
        }}
        onSaveRate={(from, to, rate) => {
          void setGroupRate(group.id, from, to, rate);
        }}
        onResetRate={(from, to) => {
          void clearGroupRate(group.id, from, to);
        }}
      />

      <Portal>
        <Dialog
          visible={editDialogVisible}
          onDismiss={handleCloseEditGroup}
          testID="edit-group-dialog"
        >
          <Dialog.Title>Edit group</Dialog.Title>
          <Dialog.Content>
            <TextInput
              label="Group name"
              value={editName}
              onChangeText={setEditName}
              mode="outlined"
              disabled={updateGroupMutation.isLoading}
              style={{ marginBottom: 16 }}
              left={<TextInput.Icon icon="account-group" />}
              testID="edit-group-name-input"
            />
            <TextInput
              label="Description (optional)"
              value={editDescription}
              onChangeText={setEditDescription}
              mode="outlined"
              disabled={updateGroupMutation.isLoading}
              multiline
              numberOfLines={3}
              left={<TextInput.Icon icon="text" />}
              testID="edit-group-description-input"
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button
              onPress={handleCloseEditGroup}
              disabled={updateGroupMutation.isLoading}
            >
              Cancel
            </Button>
            <Button
              mode="contained"
              onPress={() => {
                void handleSaveGroupDetails();
              }}
              loading={updateGroupMutation.isLoading}
              disabled={updateGroupMutation.isLoading}
              testID="edit-group-save-button"
            >
              Save
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* Web-compatible confirmation dialog */}
      {Platform.OS === "web" && confirmDialog && (
        <Portal>
          <Dialog
            visible={confirmDialog.visible}
            onDismiss={() => setConfirmDialog(null)}
          >
            <Dialog.Title>{confirmDialog.title}</Dialog.Title>
            <Dialog.Content>
              <Text variant="bodyMedium">{confirmDialog.message}</Text>
            </Dialog.Content>
            <Dialog.Actions>
              <Button onPress={() => setConfirmDialog(null)}>Cancel</Button>
              <Button
                onPress={confirmDialog.onConfirm}
                mode={confirmDialog.destructive ? "contained" : "text"}
                buttonColor={confirmDialog.destructive ? theme.colors.error : undefined}
                textColor={confirmDialog.destructive ? theme.colors.onError : undefined}
              >
                {confirmDialog.confirmText}
              </Button>
            </Dialog.Actions>
          </Dialog>
        </Portal>
      )}
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
    paddingHorizontal: 0,
    paddingBottom: 16,
  },
  sectionSurface: {
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 4,
  },
  transactionsHeader: {
    marginTop: 8,
  },
  sectionContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginLeft: 8,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "bold",
  },
  spacer: {
    height: 16,
  },
  settlementItem: {
    paddingVertical: 8,
    backgroundColor: "transparent",
  },
  settlementContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  settlementLeft: {
    flex: 1,
    marginRight: 16,
  },
  settlementRight: {
    alignItems: "flex-end",
  },
  settlementDescription: {
    fontWeight: "500",
  },
  settlementAmount: {
    fontWeight: "bold",
  },
  settlementActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 8,
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(0,0,0,0.05)",
    marginVertical: 8,
  },
  fab: {
    position: "absolute",
    margin: 16,
    right: 0,
    bottom: 10,
    borderRadius: 16,
  },
  transactionLeft: {
    flex: 1,
    marginRight: 16,
  },
  transactionRight: {
    alignItems: "flex-end",
  },
  description: {
    fontWeight: "500",
  },
  amount: {
    fontWeight: "bold",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  chipAndActions: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  typeChip: {
    height: 24,
    marginRight: 0,
  },
  actionButtons: {
    flexDirection: "row",
    marginLeft: 4,
  },
  addTransactionButton: {
    position: "absolute",
    margin: 16,
    right: 0,
    bottom: 0,
  },
  emptyStateCard: {
    marginBottom: 0,
    borderStyle: "dashed",
    backgroundColor: "transparent",
  },
  emptyStateContent: {
    alignItems: "center",
    paddingVertical: 24,
  },
  emptyStateIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontWeight: "600",
    marginBottom: 8,
    textAlign: "center",
  },
  emptyStateMessage: {
    textAlign: "center",
    lineHeight: 20,
  },
  activitySection: {
    paddingBottom: 16,
    paddingTop: 12, 
  },
  transactionsFilterRow: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  filterContainer: {
    marginBottom: 12, 
    paddingTop: 0,
  },
  filterLabel: {
    marginBottom: 2,
    opacity: 0.7,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  filterRow: {
    marginBottom: 0,
  },
  filterChip: {
    marginRight: 8,
    minHeight: 32,
  },
});
