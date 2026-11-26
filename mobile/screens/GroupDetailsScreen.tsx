import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  BackHandler,
  FlatList,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
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
  RadioButton,
  Switch,
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
import { GroupDefaultSplitSheet } from "../components/GroupDefaultSplitSheet";
import { RecurringDueBanners, RecurringTemplatesSheet } from "../components/RecurringTemplatesSheet";
import { BalanceShareLinkSheet } from "../components/BalanceShareLinkSheet";
import { GroupExportSheet } from "../components/GroupExportSheet";
import { SettlementCurrencySheet } from "../components/SettlementCurrencySheet";
import { InvitationsList } from "../components/InvitationsList";
import { MembersList } from "../components/MembersList";
import { memberRowShowsMenu } from "../utils/peoplePicker";
import { SafetyAction, SafetyActionModal } from "../components/SafetyActionModal";
import {
  LedgerDateLabel,
  LedgerRow,
  TransactionsEmptyState,
} from "../components/TransactionsSection";
import { useAuth } from "../contexts/AuthContext";
import { requestGuestSignIn } from "../utils/guestGate";
import { guestSignInCopy, isGuestUser, stripShareLinks } from "../utils/guestMode";
import { useProfile } from "../hooks/useProfile";
import { SCREEN_TRANSITION_MS } from "../constants/layout";
import { useActivity } from "../hooks/useActivity";
import { useKeyboardOverlap } from "../hooks/useKeyboardOverlap";
import { useBalances } from "../hooks/useBalances";
import { queryKeys } from "../hooks/queryKeys";
import {
  useCancelInvitation,
  useGroupInvitations,
} from "../hooks/useGroupInvitations";
import { useRemoveMember, useUpdateGroup, useUpdateGroupBalanceNudges, useUpdateGroupDefaultSplit, useArchiveGroup, useUnarchiveGroup, useHideGroupFromLists } from "../hooks/useGroupMutations";
import { useRecurringTemplates } from "../hooks/useRecurringTemplates";
import { usePublicYouOweFlag } from "../hooks/useBalanceShareLinks";
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
import {
  buildGroupCsvDocument,
  groupExportFilename,
  participantsForExport,
} from "../utils/groupExportCsv";
import {
  deliverGroupCsv,
  deliverGroupPdf,
  isExportCancel,
  nativePdfExportAvailable,
} from "../utils/groupExportDelivery";
import { fetchAllGroupTransactions, loadGroupExportSource } from "../utils/groupExportLoad";
import { resolveSettlementPerson } from "../utils/groupExportNames";
import {
  buildGroupExportPdfHtml,
  formatExportDate,
  memberTotalsForExport,
} from "../utils/groupExportPdf";
import { collectCurrencies } from "../utils/currencyMerge";
import { showErrorAlert } from "../utils/errorHandling";
import { getGroupLinkUrl, getInviteLinkUrl } from "../utils/inviteLinks";
import {
  openSettleRemind,
  settleRemindLabel,
  type SettleRemindChannel,
} from "../utils/openSettleRemind";
import {
  buildSettleRemindMessage,
  settleModalPersonName,
  settleSharePersonName,
} from "../utils/settleShareMessage";
import { disambiguatedShortNames } from "../utils/disambiguatedShortNames";
import {
  resolveSettlementPresence,
  settleRemindAudienceFromPresence,
} from "../utils/settlementPresence";
import { shareSettleDraft } from "../utils/shareSettleDraft";
import type { GroupShareSummaryPayload } from "../components/GroupDashboard";
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
  type LedgerItem,
} from "../utils/transactionsLedger";
import { TransactionSearchField } from "../components/TransactionSearchField";
import { groupByLedgerDateSection } from "../utils/ledgerDateSections";
import { resolveLedgerParticipantName } from "../utils/ledgerNames";
import {
  buildExpenseRowModel,
  paymentAmountText,
  paymentInvolvesViewer,
  paymentRowTitle,
} from "../utils/transactionRowImpact";
import { isOptimisticTransactionId } from "../utils/transactionOptimisticCache";
import {
  involvingMeFilterLabel,
  ledgerRowMatchesSearch,
  LOADED_ROWS_SEARCH_NOTE,
  SEARCHING_TRANSACTIONS_LINE,
  transactionSearchEmptyMessage,
  transactionSearchTerm,
  type LedgerSearchFields,
  type TransactionSearchFilter,
} from "../utils/transactionSearch";
import { buildActivityFeedEntries, type ActivityFeedEntry } from "../utils/activityFeedRows";
import { normalizeGroupDefaultSplit } from "../utils/groupSplit";
import {
  countActiveMembers,
  countNonFormerParticipants,
  shouldPreferAddPeopleFab,
  shouldShowGroupDetailsFab,
} from "../utils/transactionsEmptyCopy";
import { resolveGroupDetailsLoadingTreatment } from "../utils/groupDetailsLoadingTreatment";
import {
  resolveGroupDetailsReadyTiming,
  resolveGroupLedgerReadyTiming,
} from "../utils/groupDetailsReadyTelemetry";
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
import { BalanceBreakdownScreen } from "./BalanceBreakdownScreen";
import { SettlementFormScreen } from "./SettlementFormScreen";
import { TransactionDetailScreen } from "./TransactionDetailScreen";
import { resolveGroupPosition } from "../utils/groupPosition";
import { hydrateGroupOpenCache, rememberGroupOpen, seedGroupOpenQueries } from "../utils/groupOpenCache";

type GroupDetailsListRow =
  | { kind: "section"; key: string; label: string }
  | { kind: "ledger"; key: string; item: LedgerItem }
  | { kind: "activity"; key: string; entry: ActivityFeedEntry };

/**
 * Room under the last row so the Add expense pill never covers it.
 * Tall enough that a settle list can scroll Dinner and the day header clear.
 */
const LEDGER_FAB_INSET = 176;

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
  /** Epoch ms when the user started opening this group (tap / deep link). */
  openStartedAtMs?: number;
  /** Open the settle list after balances load (balance nudge deep link). */
  openSettleOnMount?: boolean;
  onSettleOpened?: () => void;
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
  openStartedAtMs,
  openSettleOnMount = false,
  onSettleOpened,
}) => {
  const [leaving, setLeaving] = useState<boolean>(false);
  const [membershipActionLoading, setMembershipActionLoading] = useState<boolean>(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [workingParticipantId, setWorkingParticipantId] = useState<string | null>(null);
  const [menuVisible, setMenuVisible] = useState<boolean>(false);
  const [showExport, setShowExport] = useState(false);
  const [exportBusy, setExportBusy] = useState<"csv" | "pdf" | null>(null);
  const [pdfExportAvailable, setPdfExportAvailable] = useState(Platform.OS === "web");
  const [shareSummary, setShareSummary] = useState<GroupShareSummaryPayload | null>(null);
  const [whatsAppInstalled, setWhatsAppInstalled] = useState(false);
  const [showSettlementForm, setShowSettlementForm] = useState<boolean>(false);
  const [settlingBalance, setSettlingBalance] = useState<Balance | null>(null);
  const [breakdownBalance, setBreakdownBalance] = useState<Balance | null>(null);
  const [breakdownExpenses, setBreakdownExpenses] = useState<Transaction[]>([]);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [editingSettlement, setEditingSettlement] = useState<Settlement | null>(
    null
  );
  const [showMembers, setShowMembers] = useState<boolean>(false);
  const [showCurrencySettings, setShowCurrencySettings] = useState<boolean>(false);
  const [showDefaultSplit, setShowDefaultSplit] = useState(false);
  const [defaultSplitError, setDefaultSplitError] = useState<string | null>(null);
  const [editDialogVisible, setEditDialogVisible] = useState(false);
  const [editName, setEditName] = useState(initialGroup.name);
  const [editDescription, setEditDescription] = useState(
    initialGroup.description || ""
  );
  const [listMode, setListMode] = useState<"transactions" | "activity">(
    initialListMode
  );
  const [historyFromMenu, setHistoryFromMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFilter, setSearchFilter] = useState<TransactionSearchFilter>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [settleListOpen, setSettleListOpen] = useState(false);
  const [showBalanceNudges, setShowBalanceNudges] = useState(false);
  const [showRecurringTemplates, setShowRecurringTemplates] = useState(false);
  const [showBalanceShareLinks, setShowBalanceShareLinks] = useState(false);
  const [draftNudgeCadence, setDraftNudgeCadence] = useState<"off" | "weekly" | "monthly">("off");
  const [draftNudgeMuted, setDraftNudgeMuted] = useState(false);
  const settleOpenedFromNudgeRef = useRef(false);
  const [compactHeader, setCompactHeader] = useState(false);
  const [detailItem, setDetailItem] = useState<
    | { kind: "expense"; transaction: Transaction }
    | { kind: "payment"; settlement: Settlement }
    | null
  >(null);
  const [calmReady, setCalmReady] = useState(false);
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

  useEffect(() => {
    if (Platform.OS === "web") return;
    let cancelled = false;
    void nativePdfExportAvailable().then((available) => {
      if (!cancelled) setPdfExportAvailable(available);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const { session, signOut, user } = useAuth();
  const guest = isGuestUser(user);
  const queryClient = useQueryClient();
  const seededGroupRef = React.useRef<string | null>(null);
  if (session?.user?.id && seededGroupRef.current !== initialGroup.id) {
    seededGroupRef.current = initialGroup.id;
    seedGroupOpenQueries(queryClient, session.user.id, initialGroup.id);
  }

  const {
    data: groupData,
    isLoading: groupLoading,
    error: groupError,
    refetch: refetchGroup,
  } = useGroupDetails(initialGroup.id);
  const {
    data: balancesData,
    hasData: balancesHasData,
    isLoading: balancesLoading,
    error: balancesError,
    refetch: refetchBalances,
  } = useBalances(initialGroup.id);
  const {
    data: txData,
    isLoading: txLoading,
    isFetched: txFetched,
    error: txError,
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
  } = useGroupInvitations(initialGroup.id, {
    // Needed for Remind invite links (pending invite / no-account counterparties),
    // not only when the People sheet is open.
    enabled: true,
  });
  const {
    data: participants = [],
    isLoading: participantsLoading,
    refetch: refetchParticipants,
  } = useParticipants(initialGroup.id);
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
  const { data: profile } = useProfile();
  const viewerShareName = settleSharePersonName({
    full_name: profile?.full_name,
    email: session?.user?.email,
  });
  const theme = useTheme();
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const {
    preferredCurrency,
    groupSettings,
    rateBook,
    setGroupSettings,
    setGroupRate,
    clearGroupRate,
  } = useCurrencyPreferences(initialGroup.id);

  // Critical-path ready telemetry (details + balances/stats).
  // Start time comes from navigation intent so warm-cache opens do not report
  // duration_ms ≈ 0 from a mount-effect timer reset racing the ready effect.
  const groupOpenStartedAtRef = React.useRef(openStartedAtMs ?? Date.now());
  const trackedReadyGroupIdRef = React.useRef(initialGroup.id);
  const groupDetailsReadyLoggedRef = React.useRef(false);
  const groupLedgerReadyLoggedRef = React.useRef(false);
  const sawGroupLoadingRef = React.useRef(false);
  const sawBalancesLoadingRef = React.useRef(false);
  if (trackedReadyGroupIdRef.current !== initialGroup.id) {
    trackedReadyGroupIdRef.current = initialGroup.id;
    groupOpenStartedAtRef.current = openStartedAtMs ?? Date.now();
    groupDetailsReadyLoggedRef.current = false;
    groupLedgerReadyLoggedRef.current = false;
    sawGroupLoadingRef.current = false;
    sawBalancesLoadingRef.current = false;
  } else if (
    openStartedAtMs != null &&
    openStartedAtMs < groupOpenStartedAtRef.current
  ) {
    // Parent stamped the tap time after first paint; keep the earlier intent.
    groupOpenStartedAtRef.current = openStartedAtMs;
  }
  if (groupLoading) sawGroupLoadingRef.current = true;
  if (balancesLoading) sawBalancesLoadingRef.current = true;
  useEffect(() => {
    if (groupDetailsReadyLoggedRef.current) return;
    if (groupLoading || balancesLoading) return;
    if (groupError || balancesError) return;
    groupDetailsReadyLoggedRef.current = true;
    const timing = resolveGroupDetailsReadyTiming({
      openStartedAtMs: groupOpenStartedAtRef.current,
      nowMs: Date.now(),
      sawGroupLoading: sawGroupLoadingRef.current,
      sawBalancesLoading: sawBalancesLoadingRef.current,
    });
    captureIdentifiedAnalyticsEvent(
      session?.user?.id,
      ANALYTICS_EVENTS.GROUP_DETAILS_READY,
      {
        group_id: initialGroup.id,
        duration_ms: timing.duration_ms,
        from_cache: timing.from_cache,
        cache_status: timing.cache_status,
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

  useEffect(() => {
    if (groupLedgerReadyLoggedRef.current) return;
    if (!txFetched || txLoading) return;
    if (txError) return;
    groupLedgerReadyLoggedRef.current = true;
    const timing = resolveGroupLedgerReadyTiming({
      openStartedAtMs: groupOpenStartedAtRef.current,
      nowMs: Date.now(),
    });
    captureIdentifiedAnalyticsEvent(
      session?.user?.id,
      ANALYTICS_EVENTS.GROUP_LEDGER_READY,
      {
        group_id: initialGroup.id,
        duration_ms: timing.duration_ms,
      }
    );
  }, [txFetched, txLoading, txError, initialGroup.id, session?.user?.id]);

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

  // History opened from the overflow returns to the ledger. A notification
  // that opened History still leaves the group.
  const handleChromeBack = useCallback(() => {
    if (detailItem) {
      setDetailItem(null);
      return;
    }
    if (showMembers) {
      setShowMembers(false);
      return;
    }
    if (listMode === "activity" && historyFromMenu) {
      setHistoryFromMenu(false);
      setListMode("transactions");
      return;
    }
    onBack();
  }, [detailItem, historyFromMenu, listMode, onBack, showMembers]);

  // Handle Android hardware back button. Skip while another screen is covering
  // this one so the overlay (e.g. transaction form) owns the back press.
  useEffect(() => {
    if (!captureHardwareBack) return;

    const handleHardwareBack = () => {
      handleChromeBack();
      return true;
    };

    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      handleHardwareBack
    );
    return () => subscription.remove();
  }, [captureHardwareBack, handleChromeBack]);

  // Refetch all data function
  const refetchAll = () => {
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
  const updateDefaultSplitMutation = useUpdateGroupDefaultSplit();
  const updateGroupMutation = useUpdateGroup(() => {
    void refetchGroup();
  });
  const updateBalanceNudgesMutation = useUpdateGroupBalanceNudges(() => {
    void refetchGroup();
  });
  const recurringTemplates = useRecurringTemplates(initialGroup.id, () => {
    void refetchGroup();
  });
  const publicYouOwe = usePublicYouOweFlag();

  useEffect(() => {
    if (!openSettleOnMount || settleOpenedFromNudgeRef.current || balancesLoading) {
      return;
    }
    settleOpenedFromNudgeRef.current = true;
    setSettleListOpen(true);
    onSettleOpened?.();
  }, [openSettleOnMount, balancesLoading, onSettleOpened]);
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
  const ledgerPending = txLoading && transactions.length === 0;
  const viewerUserId = session?.user?.id ?? null;
  const viewerParticipantId = participants.find((person) => person.user_id === viewerUserId)?.id ?? null;
  const searchEngaged = searchOpen || searchQuery.trim().length > 0 || searchFilter !== "all";
  const keyboard = useKeyboardOverlap(listMode === "transactions" && searchEngaged);
  const searchKeyboardInset = listMode === "transactions" && searchEngaged
    ? keyboard.frame.height
    : 0;

  const cancelSearch = useCallback(() => {
    setSearchQuery("");
    setSearchFilter("all");
    setSearchOpen(false);
  }, []);

  const ledgerSearchFields = useCallback((item: LedgerItem): LedgerSearchFields => {
    if (item.kind === "payment") {
      const settlement = item.settlement;
      const fromName = resolveLedgerParticipantName({
        participantId: settlement.from_participant_id,
        userId: settlement.from_user_id,
        currentUserId: viewerUserId,
        participants,
        members: group.members,
      });
      const toName = resolveLedgerParticipantName({
        participantId: settlement.to_participant_id,
        userId: settlement.to_user_id,
        currentUserId: viewerUserId,
        participants,
        members: group.members,
      });
      return {
        kind: "payment",
        title: paymentRowTitle(fromName, toName),
        payerLine: "",
        amountText: paymentAmountText(settlement.amount, settlement.currency),
        amount: settlement.amount,
        involvesViewer: paymentInvolvesViewer({
          fromParticipantId: settlement.from_participant_id,
          fromUserId: settlement.from_user_id,
          toParticipantId: settlement.to_participant_id,
          toUserId: settlement.to_user_id,
          viewer: { userId: viewerUserId, participantId: viewerParticipantId },
        }),
      };
    }
    const transaction = item.transaction;
    const payerName = resolveLedgerParticipantName({
      participantId: transaction.paid_by_participant_id,
      userId: transaction.paid_by,
      currentUserId: viewerUserId,
      participants,
      members: group.members,
    });
    const model = buildExpenseRowModel({
      amount: transaction.amount,
      currency: transaction.currency || getDefaultCurrency(),
      payerName,
      paidByParticipantId: transaction.paid_by_participant_id,
      paidByUserId: transaction.paid_by,
      splits: transaction.splits,
      viewer: { userId: viewerUserId, participantId: viewerParticipantId },
      saving: isOptimisticTransactionId(transaction.id),
    });
    return {
      kind: "expense",
      title: transaction.description || "Untitled",
      payerLine: model.payerLine,
      amountText: model.impactText || String(transaction.amount),
      amount: transaction.amount,
      involvesViewer: model.involvesViewer,
    };
  }, [group.members, participants, viewerParticipantId, viewerUserId]);

  // Mixed ledger. Search runs over rows already loaded; older pages stay unloaded
  // until the list asks for them, and the field says so.
  const ledgerItems = useMemo(() => {
    const merged = buildTransactionsLedger(transactions, settlements, "all");
    if (!searchEngaged) return merged;
    return merged.filter((item) => ledgerRowMatchesSearch(
      ledgerSearchFields(item),
      searchQuery,
      searchFilter,
    ));
  }, [ledgerSearchFields, searchEngaged, searchFilter, searchQuery, settlements, transactions]);

  const activityEntries = useMemo(
    () => buildActivityFeedEntries(filteredActivities),
    [filteredActivities],
  );

  const listRows = useMemo<GroupDetailsListRow[]>(() => {
    if (listMode === "transactions") {
      const now = new Date();
      const sections = groupByLedgerDateSection(
        ledgerItems,
        (item) => item.kind === "expense" ? item.transaction.date : item.settlement.created_at,
        now,
      );
      const rows: GroupDetailsListRow[] = [];
      sections.forEach((section, index) => {
        rows.push({ kind: "section", key: `section-${index}-${section.label}`, label: section.label });
        for (const item of section.items) {
          rows.push({ kind: "ledger", key: item.key, item });
        }
      });
      return rows;
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
    setHistoryFromMenu(false);
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
    if (listMode === "transactions" && searchFilter !== "payments") {
      handleLoadMoreTransactions();
      return;
    }
    if (listMode === "activity") {
      handleLoadMoreActivity();
    }
  }, [
    listMode,
    searchFilter,
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

  const handleBalancePress = (balance: Balance) => {
    if (balancesError) return;
    setBreakdownBalance(balance);
    captureIdentifiedAnalyticsEvent(
      session?.user?.id,
      ANALYTICS_EVENTS.BALANCE_BREAKDOWN_OPENED,
      { platform: Platform.OS },
    );
    const ledgerComplete = !txLoading && !txHasNextPage;
    if (ledgerComplete) {
      setBreakdownExpenses(transactions);
      setBreakdownLoading(false);
      return;
    }
    setBreakdownLoading(true);
    void fetchAllGroupTransactions(group.id)
      .then((items) => {
        setBreakdownExpenses(items);
      })
      .catch(() => {
        setBreakdownExpenses(transactions);
      })
      .finally(() => {
        setBreakdownLoading(false);
      });
  };

  const handleSettleFromBreakdown = () => {
    const balance = breakdownBalance;
    setBreakdownBalance(null);
    if (balance) handleSettleUp(balance);
  };

  useEffect(() => {
    if (Platform.OS === "web") {
      setWhatsAppInstalled(false);
      return;
    }
    let cancelled = false;
    Linking.canOpenURL("whatsapp://send")
      .then((ok) => {
        if (!cancelled) setWhatsAppInstalled(ok);
      })
      .catch(() => {
        if (!cancelled) setWhatsAppInstalled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const participantForBalance = useCallback((balance: Balance) => {
    return participants.find((person) => {
      if (balance.participant_id && person.id === balance.participant_id) {
        return true;
      }
      if (balance.user_id && person.user_id === balance.user_id) return true;
      return false;
    });
  }, [participants]);

  const phoneForBalance = useCallback((balance: Balance): string | null => {
    return participantForBalance(balance)?.phone?.trim() || null;
  }, [participantForBalance]);

  /** Pending email/phone invite token for this person — opens group after joining. */
  const inviteLinkForBalance = useCallback((balance: Balance): string | null => {
    const person = participantForBalance(balance);
    const email = (person?.email || balance.email || "").trim().toLowerCase();
    const phone = (person?.phone || "").trim();
    const pending = invitations.filter((invite) => invite.status === "pending");
    const match = pending.find((invite) => {
      if (!invite.token) return false;
      // Shareable group links (no email/phone) are not person-specific.
      if (email && invite.email?.trim().toLowerCase() === email) return true;
      if (phone && invite.phone?.trim() === phone) return true;
      return false;
    });
    return match?.token ? getInviteLinkUrl(match.token) : null;
  }, [invitations, participantForBalance]);

  const buildRemindMessageForBalance = useCallback((balance: Balance) => {
    const person = participantForBalance(balance);
    const presence = resolveSettlementPresence(
      person ?? { user_id: balance.user_id || null, type: "member" },
    );
    const audience = settleRemindAudienceFromPresence(presence);
    const counterpartyName = settleModalPersonName({
      full_name: person?.full_name ?? balance.full_name,
      email: person?.email ?? balance.email,
      phone: person?.phone,
    });
    if (audience === "off_app") {
      return buildSettleRemindMessage({
        counterpartyName,
        amount: Math.abs(balance.amount),
        currency: balance.currency,
        groupName: group.name,
        audience: "off_app",
        inviteLink: inviteLinkForBalance(balance),
      });
    }
    return buildSettleRemindMessage({
      counterpartyName,
      amount: Math.abs(balance.amount),
      currency: balance.currency,
      groupName: group.name,
      audience: "app_member",
      // No web settle-with-prefill route yet — group link works after sign-in.
      settleLink: getGroupLinkUrl(group.id),
    });
  }, [group.id, group.name, inviteLinkForBalance, participantForBalance]);

  const resolveRemindChannelForBalance = useCallback((balance: Balance): SettleRemindChannel => {
    const phone = phoneForBalance(balance);
    if (!phone) return "share";
    if (Platform.OS === "web") return "whatsapp";
    return whatsAppInstalled ? "whatsapp" : "share";
  }, [phoneForBalance, whatsAppInstalled]);

  const handleRemindBalance = (balance: Balance) => {
    if (!isActiveMember || balancesError) return;
    if (!(balance.amount > 0)) return;
    if (guest) {
      const person = participantForBalance(balance);
      requestGuestSignIn(guestSignInCopy("remind", person?.full_name || balance.full_name || "them"));
      return;
    }
    const message = buildRemindMessageForBalance(balance);
    void openSettleRemind({
      message,
      phone: phoneForBalance(balance),
    }).catch((error) => {
      showErrorAlert(error, signOut, "Could not share settle message");
    });
  };

  const handleRemindShareAnotherWay = (balance: Balance) => {
    if (!isActiveMember || balancesError) return;
    if (!(balance.amount > 0)) return;
    if (guest) {
      const person = participantForBalance(balance);
      requestGuestSignIn(guestSignInCopy("remind", person?.full_name || balance.full_name || "them"));
      return;
    }
    const message = buildRemindMessageForBalance(balance);
    void openSettleRemind({
      message,
      phone: phoneForBalance(balance),
      forceShare: true,
    }).catch((error) => {
      showErrorAlert(error, signOut, "Could not share settle message");
    });
  };

  const getRemindPresentation = useCallback((balance: Balance) => {
    const channel = resolveRemindChannelForBalance(balance);
    const person = participantForBalance(balance);
    const labels = disambiguatedShortNames(
      participants.filter((member) => member.id),
      session?.user?.id,
    );
    const mapped = person?.id ? labels.get(person.id) : undefined;
    const firstName = mapped && mapped !== "You"
      ? mapped
      : settleSharePersonName({
        full_name: person?.full_name ?? balance.full_name,
        email: person?.email ?? balance.email,
        phone: person?.phone,
      });
    return {
      label: settleRemindLabel(channel, firstName, { asWritten: true }),
      shareAnotherWay: channel === "whatsapp",
    };
  }, [participantForBalance, participants, resolveRemindChannelForBalance, session?.user?.id]);

  const handleShareSummaryChange = useCallback((payload: GroupShareSummaryPayload | null) => {
    setShareSummary(payload);
  }, []);

  const handleShareSummary = () => {
    if (!shareSummary?.message || !isActiveMember || balancesError) return;
    const message = guest ? stripShareLinks(shareSummary.message) : shareSummary.message;
    if (!message) return;
    void shareSettleDraft(message).catch((error) => {
      showErrorAlert(error, signOut, "Could not share settle summary");
    });
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
  // Prefer members when loaded; fall back to list-row user_status so the first
  // paint after a group tap does not wait on GET /groups/:id for chrome.
  const isMember = group.members
    ? group.members.some((m) => m.user_id === currentUserId)
    : group.user_status === "active" ||
      group.user_status === "left" ||
      group.user_status === "invited";
  const isActiveMember = group.members
    ? group.members.some(
        (m) => m.user_id === currentUserId && m.status === "active"
      )
    : group.user_status === "active";

  const settlingCounterpartyPresence = useMemo(() => {
    if (!settlingBalance) return undefined;
    const person = participantForBalance(settlingBalance);
    return resolveSettlementPresence(
      person ?? {
        user_id: settlingBalance.user_id || null,
        type: "member",
      },
    );
  }, [participantForBalance, settlingBalance]);

  const settlementRemindProps = useMemo(() => {
    if (
      editingSettlement
      || !settlingBalance
      || !(settlingBalance.amount > 0)
      || !isActiveMember
      || balancesError
    ) {
      return {};
    }
    const presentation = getRemindPresentation(settlingBalance);
    return {
      remindLabel: presentation.label,
      remindShareAnotherWay: presentation.shareAnotherWay,
      onRemindPress: () => handleRemindBalance(settlingBalance),
      onRemindShareAnotherWay: presentation.shareAnotherWay
        ? () => handleRemindShareAnotherWay(settlingBalance)
        : undefined,
    };
  }, [
    editingSettlement,
    settlingBalance,
    isActiveMember,
    balancesError,
    getRemindPresentation,
  ]);

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
  const canManageInvites = isActiveMember && group.kind !== "direct";
  const showGroupMenu = (isActiveMember || isFormerMember) && !showMembers;
  // Empty-copy / FAB still use account members; settle chrome counts participants
  // (people without accounts + pending invites) so Sheeba-style groups show balances.
  const activeMemberCount = countActiveMembers(group.members);
  const settleAudienceCount = countNonFormerParticipants(participants);
  const groupBalances = balancesData?.group_balances?.[0]?.balances || [];
  const hasNonZeroBalance = groupBalances.some(
    (balance) => Math.abs(balance.amount) >= 0.005,
  );
  const position = useMemo(() => resolveGroupPosition({
    balances: groupBalances,
    currentUserId: session?.user?.id,
    currentUserParticipantId: participants.find((person) => person.user_id === session?.user?.id)?.id,
    participants,
    unifyEnabled: groupSettings?.enabled === true && !!groupSettings.settlementCurrency,
    settlementCurrency: groupSettings?.settlementCurrency || preferredCurrency || getDefaultCurrency(),
    defaultCurrency: getDefaultCurrency(),
    rateBook,
    activeMemberCount: settleAudienceCount,
    membersKnown: group.members !== undefined && (!participantsLoading || participants.length > 0),
    hasNonZeroBalance,
  }), [
    group.members,
    groupBalances,
    groupSettings,
    hasNonZeroBalance,
    participants,
    participantsLoading,
    preferredCurrency,
    rateBook,
    session?.user?.id,
    settleAudienceCount,
  ]);
  const positionKnown = balancesHasData && !balancesError;
  const settleVisible = positionKnown && position.kind === "ready" && position.showSettle;
  const remindBalance = position.kind === "ready"
    ? position.rows.find((row) => row.amount > 0.005) ?? null
    : null;

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;
    if (seedGroupOpenQueries(queryClient, userId, initialGroup.id)) return;
    let cancelled = false;
    void hydrateGroupOpenCache(userId, AsyncStorage).then(() => {
      if (!cancelled) seedGroupOpenQueries(queryClient, userId, initialGroup.id);
    });
    return () => {
      cancelled = true;
    };
  }, [initialGroup.id, queryClient, session?.user?.id]);

  useEffect(() => {
    setCalmReady(false);
    setSettleListOpen(false);
    setCompactHeader(false);
    setDetailItem(null);
    setBreakdownBalance(null);
    setBreakdownExpenses([]);
    const timer = setTimeout(() => setCalmReady(true), 800);
    return () => clearTimeout(timer);
  }, [initialGroup.id]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || balancesError || !balancesHasData) return;
    if (txLoading || settlementsLoading || participantsLoading) return;
    const feed = queryClient.getQueryData<{
      pages?: { items: Transaction[]; has_more: boolean; next_cursor: { date: string; id: number } | null }[];
    }>(queryKeys.transactionsFeed(initialGroup.id));
    const page = feed?.pages?.[0];
    if (!page) return;
    void rememberGroupOpen(AsyncStorage, userId, {
      groupId: initialGroup.id,
      savedAt: new Date().toISOString(),
      balances: balancesData,
      ledger: {
        transactions: {
          items: page.items,
          has_more: page.has_more === true,
          next_cursor: page.next_cursor ?? null,
        },
        settlements,
      },
      participants,
    });
  }, [
    balancesData,
    balancesError,
    balancesHasData,
    initialGroup.id,
    participants,
    participantsLoading,
    queryClient,
    session?.user?.id,
    settlements,
    settlementsLoading,
    txLoading,
  ]);
  const ledgerIsEmpty =
    !txLoading &&
    !settlementsLoading &&
    transactions.length === 0 &&
    settlements.length === 0;
  // List/dashboard readiness no longer waits on GET /groups/:id: the list row
  // (initialGroup) already has name/settings, and membership falls back to
  // user_status until members arrive.
  const listDataLoading =
    listMode === "transactions"
      ? ledgerPending || txLoading || settlementsLoading
      : activityLoading;
  const listContentEmpty = listRows.length === 0;
  const fetchingNextPage =
    listMode === "transactions" ? txIsFetchingNextPage : activityFetchingNextPage;
  const loadingTreatment = resolveGroupDetailsLoadingTreatment({
    balancesLoading,
    balancesError: !!balancesError,
    listDataLoading,
    listContentEmpty,
    listRefreshing,
    fetchingNextPage,
  });
  const groupOpenShellLoading = loadingTreatment.showListInitialLoader;
  const showBalanceLine = calmReady && !balancesHasData && balancesLoading && !balancesError;
  const showLedgerLine = calmReady
    && !showBalanceLine
    && groupOpenShellLoading
    && transactions.length === 0
    && listMode === "transactions";
  const preferAddPeopleFab = shouldPreferAddPeopleFab(
    activeMemberCount,
    ledgerIsEmpty,
  );
  const transactionsEmptyStateVisible =
    listMode === "transactions" &&
    !groupOpenShellLoading &&
    loadingTreatment.showListEmptyState;
  const showGroupFab = shouldShowGroupDetailsFab({
    isActiveMember,
    showMembers,
    transactionsEmptyStateVisible,
  }) && !(listMode === "transactions" && searchEngaged);

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

  const handleSaveDefaultSplit = async (
    mode: "equal" | "weights",
    weights: Record<string, number>,
  ) => {
    setDefaultSplitError(null);
    try {
      const updatedGroup = await updateDefaultSplitMutation.mutate({
        groupId: group.id,
        mode,
        weights,
      });
      setShowDefaultSplit(false);
      onGroupUpdated?.(updatedGroup);
    } catch (err) {
      setDefaultSplitError(getUserFriendlyErrorMessage(err));
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
    if (guest) {
      requestGuestSignIn(guestSignInCopy("invite", participant.full_name || "them"));
      return;
    }
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
    if (guest) {
      requestGuestSignIn(guestSignInCopy("invite", participant.full_name || "them"));
      return;
    }
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

  if (detailItem) {
    return (
      <TransactionDetailScreen
        transaction={detailItem.kind === "expense" ? detailItem.transaction : null}
        settlement={detailItem.kind === "payment" ? detailItem.settlement : null}
        groupId={group.id}
        viewerUserId={session?.user?.id}
        viewerParticipantId={participants.find((person) => person.user_id === session?.user?.id)?.id}
        participants={participants}
        members={group.members || []}
        unifyEnabled={groupSettings?.enabled === true && !!groupSettings.settlementCurrency}
        settlementCurrency={groupSettings?.settlementCurrency}
        rateBook={rateBook}
        onBack={() => setDetailItem(null)}
        onEdit={isActiveMember ? () => {
          if (detailItem.kind === "expense") onEditTransaction(detailItem.transaction);
          else handleEditSettlement(detailItem.settlement);
        } : undefined}
      />
    );
  }

  const handleExport = (kind: "csv" | "pdf") => {
    if (guest) {
      requestGuestSignIn(guestSignInCopy("export", group.name));
      return;
    }
    if (exportBusy) return;
    setExportBusy(kind);
    void (async () => {
      try {
        const source = await loadGroupExportSource(group.id);
        const people = participantsForExport(participants);
        const filename = groupExportFilename(group.name, kind);
        const currency = getDefaultCurrency();
        if (kind === "csv") {
          const csv = buildGroupCsvDocument({
            members: people,
            transactions: source.transactions,
            settlements: source.settlements,
            participants,
            defaultCurrency: currency,
          });
          await deliverGroupCsv(filename, csv);
        } else if (kind === "pdf") {
          const html = buildGroupExportPdfHtml({
            groupName: group.name,
            exportedOn: formatExportDate(new Date()),
            memberTotals: memberTotalsForExport({
              participants: people,
              breakdown: source.stats?.member_breakdown ?? [],
              defaultCurrency: currency,
            }),
            settlements: source.settlements.map((settlement) => ({
              from: resolveSettlementPerson(
                participants,
                settlement.from_participant_id,
                settlement.from_user_id,
              ),
              to: resolveSettlementPerson(
                participants,
                settlement.to_participant_id,
                settlement.to_user_id,
              ),
              amount: settlement.amount,
              currency: settlement.currency,
            })),
            balances: source.balances,
            currentUserId: session?.user?.id,
            currentUserParticipantId: viewerParticipantId ?? undefined,
            defaultCurrency: currency,
          });
          await deliverGroupPdf(filename, html);
        } else {
          const unexpected: never = kind;
          throw new Error(`Unexpected export ${unexpected}`);
        }
        setShowExport(false);
      } catch (error) {
        if (!isExportCancel(error)) {
          showErrorAlert(error, signOut, "Could not export this group");
        }
      } finally {
        setExportBusy(null);
      }
    })();
  };

  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <Appbar.Header style={{ backgroundColor: theme.colors.background }}>
        <Appbar.BackAction
          onPress={handleChromeBack}
          accessibilityLabel="Navigate back"
          testID="back-button"
        />
        <Appbar.Content
          title={showMembers ? "People" : listMode === "activity" ? "History" : group.kind === "direct" ? `Direct · ${group.name}` : group.name}
          titleStyle={{ fontWeight: "bold" }}
        />
        {/* Group options — back, name, one overflow. */}
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
            {listMode === "activity" ? (
              <Menu.Item
                onPress={() => {
                  handleCloseMenu();
                  setHistoryFromMenu(false);
                  setListMode("transactions");
                }}
                title="Transactions"
                leadingIcon="format-list-bulleted"
                testID="group-menu-transactions"
              />
            ) : (
              <Menu.Item
                onPress={() => {
                  handleCloseMenu();
                  setSearchQuery("");
                  setSearchFilter("all");
                  setSearchOpen(false);
                  setHistoryFromMenu(true);
                  setListMode("activity");
                }}
                title="History"
                leadingIcon="history"
                testID="group-menu-history"
              />
            )}
            <Menu.Item
              onPress={() => {
                handleCloseMenu();
                setShowExport(true);
              }}
              title="Export"
              leadingIcon="download"
              testID="group-menu-export"
            />
            {isActiveMember && (
              <>
                <Menu.Item
                  onPress={() => {
                    handleCloseMenu();
                    handleShareSummary();
                  }}
                  title="Share summary"
                  leadingIcon="share-variant"
                  disabled={!shareSummary || !!balancesError}
                  testID="group-menu-share-summary"
                />
                <Menu.Item
                  onPress={() => {
                    handleCloseMenu();
                    setShowMembers(true);
                  }}
                  title="People"
                  leadingIcon="account-group"
                  testID="group-menu-people"
                />
                <Menu.Item
                  onPress={() => {
                    handleCloseMenu();
                    handleStatNavigation("total-costs");
                  }}
                  title="Spending & stats"
                  leadingIcon="chart-pie"
                  testID="group-menu-spending"
                />
                <Menu.Item
                  onPress={() => {
                    handleCloseMenu();
                    setShowCurrencySettings(true);
                  }}
                  title="Rates"
                  leadingIcon="percent"
                  testID="group-menu-rates"
                />
                {isOwner && group.kind !== "direct" && (
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
                {group.kind !== "direct" ? (
                <Menu.Item
                  onPress={() => {
                    handleCloseMenu();
                    setDefaultSplitError(null);
                    setShowDefaultSplit(true);
                  }}
                  title="Default split"
                  leadingIcon="scale-balance"
                  testID="group-menu-default-split"
                />
                ) : null}
                {isActiveMember && group.kind !== "direct" ? (
                <Menu.Item
                  onPress={() => {
                    handleCloseMenu();
                    setDraftNudgeCadence(group.balance_nudge_cadence || "off");
                    setDraftNudgeMuted(group.balance_nudge_muted === true);
                    setShowBalanceNudges(true);
                  }}
                  title="Balance nudges"
                  leadingIcon="bell-outline"
                  testID="group-menu-balance-nudges"
                />
                ) : null}
                {isActiveMember && group.kind !== "direct" ? (
                <Menu.Item
                  onPress={() => {
                    handleCloseMenu();
                    setShowRecurringTemplates(true);
                  }}
                  title="Recurring"
                  leadingIcon="calendar-refresh"
                  testID="group-menu-recurring"
                />
                ) : null}
                <Menu.Item
                  onPress={() => {
                    handleCloseMenu();
                    setShowCurrencySettings(true);
                  }}
                  title="Settlement currency"
                  leadingIcon="cash-sync"
                  testID="group-menu-settlement-currency"
                />
                {isActiveMember && group.kind === "direct" && publicYouOwe.enabled ? (
                <Menu.Item
                  onPress={() => {
                    handleCloseMenu();
                    setShowBalanceShareLinks(true);
                  }}
                  title="Share balance link"
                  leadingIcon="link-variant"
                  testID="group-menu-share-balance-link"
                />
                ) : null}
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
      {!showMembers && listMode === "transactions" && compactHeader && !searchEngaged && positionKnown && position.kind === "ready" && position.compactLine ? (
        <Text
          variant="bodySmall"
          testID="group-compact-line"
          accessibilityRole={position.showSettle || position.showUnifyLine ? "button" : undefined}
          accessibilityLabel={position.compactLine}
          onPress={position.showUnifyLine
            ? () => setShowCurrencySettings(true)
            : position.showSettle
              ? () => {
                setSettleListOpen(true);
                mainListRef.current?.scrollToOffset({ offset: 0, animated: true });
              }
              : undefined}
          style={{ color: theme.colors.onSurfaceVariant, paddingHorizontal: 16, marginTop: -4, marginBottom: 4 }}
        >
          {position.compactLine}
        </Text>
      ) : null}

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
              reserveMenuColumn={participants.some((person) =>
                memberRowShowsMenu(person, {
                  canManageMembers,
                  currentUserId: session?.user?.id,
                  canBlock: true,
                }),
              )}
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
          contentContainerStyle={[
            styles.scrollContent,
            showGroupFab ? { paddingBottom: LEDGER_FAB_INSET } : null,
            searchKeyboardInset > 0 ? { paddingBottom: searchKeyboardInset + 16 } : null,
          ]}
          data={listRows}
          keyExtractor={(row) => row.key}
          showsVerticalScrollIndicator={false}
          onScroll={(event) => {
            const next = event.nativeEvent.contentOffset.y > 72;
            setCompactHeader((current) => (current === next ? current : next));
          }}
          scrollEventThrottle={16}
          onScrollBeginDrag={handleMainScrollBeginDrag}
          onScrollEndDrag={handleScrollEndDrag}
          onMomentumScrollEnd={handleMomentumScrollEnd}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.4}
          onScrollToIndexFailed={handleScrollToIndexFailed}
          ItemSeparatorComponent={
            listMode === "activity"
              ? () => <View style={{ height: 8 }} />
              : undefined
          }
          refreshControl={
            <RefreshControl
              refreshing={loadingTreatment.showRefreshControlLoader}
              onRefresh={() => {
                void handlePullToRefresh();
              }}
            />
          }
          ListHeaderComponent={
            <View>
              {listMode === "transactions" && searchEngaged ? null : (
              <>
              <RecurringDueBanners
                templates={group.recurring_templates || []}
                disabled={!isActiveMember || recurringTemplates.isWorking}
                onAdd={(template) => {
                  void recurringTemplates.addDueExpense(template).catch((error) => {
                    Alert.alert("Couldn’t add expense", error instanceof Error ? error.message : "Please try again.");
                  });
                }}
                onSkip={(template) => {
                  void recurringTemplates.recordCycle.mutateAsync({
                    template_id: template.id,
                    action: "skip",
                    period_key: template.current_period_key,
                  }).catch((error) => {
                    Alert.alert("Couldn’t skip", error instanceof Error ? error.message : "Please try again.");
                  });
                }}
              />
              <GroupDashboard
                key={group.id}
                groupId={group.id}
                groupName={group.name}
                groupLink={getGroupLinkUrl(group.id)}
                viewerShareName={viewerShareName}
                balances={groupBalances}
                currentUserId={session?.user?.id}
                currentUserParticipantId={participants.find((p) => p.user_id === session?.user?.id)?.id}
                loading={balancesLoading && !balancesHasData}
                defaultCurrency={getDefaultCurrency()}
                settleListOpen={settleListOpen}
                loadingLine={showBalanceLine ? "Loading balances…" : null}
                onOpenSettle={() => setSettleListOpen(true)}
                onRemind={remindBalance ? () => handleRemindBalance(remindBalance) : undefined}
                activeMemberCount={settleAudienceCount}
                membersKnown={
                  group.members !== undefined
                  && (!participantsLoading || participants.length > 0)
                }
                hasNonZeroBalance={hasNonZeroBalance}
                participants={participants}
                unifyBalances={group.unify_balances}
                balanceError={!!balancesError}
                onBalancePress={!balancesError ? handleBalancePress : undefined}
                onSettlePress={isActiveMember && !balancesError ? handleSettleUp : undefined}
                onShareSummaryChange={isActiveMember && !balancesError ? handleShareSummaryChange : undefined}
                onBalancesRetry={() => {
                  void refetchBalances();
                }}
                onOpenCurrencySettings={() => setShowCurrencySettings(true)}
              />
              </>
              )}

              {listMode === "transactions" ? (
                <TransactionSearchField
                  query={searchQuery}
                  onChangeQuery={setSearchQuery}
                  filter={searchFilter}
                  onChangeFilter={setSearchFilter}
                  open={searchEngaged}
                  onOpen={() => setSearchOpen(true)}
                  onCancel={cancelSearch}
                  scopeNote={searchEngaged && txHasNextPage ? LOADED_ROWS_SEARCH_NOTE : null}
                />
              ) : (
                <View style={[styles.sectionContent, styles.activitySection]}>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "flex-end",
                      alignItems: "center",
                      marginBottom: 0,
                      paddingHorizontal: 4,
                      marginTop: 8,
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
            if (row.kind === "section") {
              return <LedgerDateLabel label={row.label} />;
            }
            if (row.kind === "ledger") {
              return (
                <View>
                  <LedgerRow
                    item={row.item}
                    members={group.members || []}
                    participants={participants}
                    highlightedTransactionId={visibleHighlightedTransactionId}
                    onHighlightedInteraction={clearVisibleTransactionHighlight}
                    onOpenExpense={(transaction) => setDetailItem({ kind: "expense", transaction })}
                    onOpenPayment={(settlement) => setDetailItem({ kind: "payment", settlement })}
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
              (groupOpenShellLoading || (txLoading && transactions.length === 0))
                && (searchQuery.trim().length > 0 || searchFilter !== "all") ? (
                <Text
                  variant="bodyMedium"
                  testID="transaction-search-pending"
                  style={{ color: theme.colors.onSurfaceVariant, paddingHorizontal: 16, paddingVertical: 20 }}
                >
                  {SEARCHING_TRANSACTIONS_LINE}
                </Text>
              ) : showLedgerLine ? (
                <Text
                  variant="bodyMedium"
                  testID="group-ledger-loading-line"
                  style={{ color: theme.colors.onSurfaceVariant, paddingHorizontal: 16, paddingVertical: 20 }}
                >
                  Loading transactions…
                </Text>
              ) : groupOpenShellLoading ? null : searchEngaged && loadingTreatment.showListEmptyState ? (
                <View style={{ paddingHorizontal: 16, paddingVertical: 20, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  <Text variant="bodyMedium" style={{ color: theme.colors.onSurface }} testID="transaction-search-empty">
                    {transactionSearchEmptyMessage(transactionSearchTerm(
                      searchQuery,
                      searchFilter,
                      involvingMeFilterLabel(windowWidth, fontScale),
                    ))}
                  </Text>
                  <Button
                    mode="text"
                    compact
                    onPress={cancelSearch}
                    testID="transaction-search-clear"
                    accessibilityLabel="Clear search"
                  >
                    Clear
                  </Button>
                </View>
              ) : loadingTreatment.showListEmptyState ? (
                <View style={{ paddingHorizontal: 16 }}>
                  <TransactionsEmptyState
                    filter="all"
                    members={group.members || []}
                    canAct={isActiveMember}
                    onAddPeople={onAddMember}
                    onAddExpense={onAddTransaction}
                  />
                </View>
              ) : null
            ) : groupOpenShellLoading ? (
              <Text
                variant="bodyMedium"
                style={{ color: theme.colors.onSurfaceVariant, paddingHorizontal: 16, paddingVertical: 20 }}
              >
                Loading history…
              </Text>
            ) : loadingTreatment.showListEmptyState ? (
              <View style={{ paddingHorizontal: 16 }}>
                <ActivityFeedEmptyState
                  isFiltered={
                    activityFilterType !== "all" ||
                    activityFilterParticipantId !== "all"
                  }
                />
              </View>
            ) : null
          }
          ListFooterComponent={
            <View style={{ alignItems: "center", paddingTop: 8, paddingBottom: showGroupFab ? 8 : 24 }}>
              {loadingTreatment.showFooterLoader ? (
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  Loading earlier…
                </Text>
              ) : null}
            </View>
          }
        />
      )}

      {showGroupFab && (
        <FAB
          testID={preferAddPeopleFab ? "add-people-fab" : "add-expense-button"}
          icon={preferAddPeopleFab ? "account-plus" : "plus"}
          style={[
            styles.fab,
            {
              backgroundColor: settleVisible
                ? theme.colors.secondaryContainer
                : theme.colors.primary,
            },
          ]}
          color={settleVisible ? theme.colors.onSecondaryContainer : theme.colors.onPrimary}
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

      <BalanceBreakdownScreen
        visible={!!breakdownBalance}
        balance={breakdownBalance}
        expenses={breakdownExpenses}
        settlements={settlements}
        participants={participants}
        currentUserId={session?.user?.id}
        currentUserParticipantId={participants.find((person) => person.user_id === session?.user?.id)?.id}
        loading={breakdownLoading}
        unifyEnabled={groupSettings?.enabled === true && !!groupSettings.settlementCurrency}
        settlementCurrency={groupSettings?.settlementCurrency || getDefaultCurrency()}
        defaultCurrency={getDefaultCurrency()}
        rateBook={rateBook}
        onDismiss={() => setBreakdownBalance(null)}
        onSettleUp={isActiveMember && !balancesError ? handleSettleFromBreakdown : undefined}
      />

      {/* Settlement form modal — Remind lives here for owes-you creates only */}
      <SettlementFormScreen
        visible={showSettlementForm}
        balance={settlingBalance}
        settlement={editingSettlement}
        groupMembers={group.members || []}
        participants={participants}
        currentUserId={session?.user?.id || ""}
        groupId={group.id}
        groupName={group.name}
        defaultCurrency={getDefaultCurrency()}
        counterpartyPresence={settlingCounterpartyPresence}
        {...settlementRemindProps}
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


      <Portal>
        <Dialog
          visible={showBalanceNudges}
          onDismiss={() => setShowBalanceNudges(false)}
          testID="balance-nudges-dialog"
        >
          <Dialog.Title>Balance nudges</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={{ marginBottom: 12 }}>
              Members who owe more than a small amount get a push on a schedule. Default is off. Weekly is Mondays at 9:00 UTC. Monthly is the 1st at 9:00 UTC.
            </Text>
            {isOwner ? (
              <RadioButton.Group
                onValueChange={(value) => {
                  if (value === "off" || value === "weekly" || value === "monthly") {
                    setDraftNudgeCadence(value);
                  }
                }}
                value={draftNudgeCadence}
              >
                <RadioButton.Item label="Off" value="off" testID="balance-nudge-cadence-off" />
                <RadioButton.Item label="Weekly" value="weekly" testID="balance-nudge-cadence-weekly" />
                <RadioButton.Item label="Monthly" value="monthly" testID="balance-nudge-cadence-monthly" />
              </RadioButton.Group>
            ) : (
              <Text variant="bodySmall" style={{ marginBottom: 12 }}>
                Cadence is {group.balance_nudge_cadence || "off"}. Only owners can change it.
              </Text>
            )}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
              <Text variant="bodyMedium">Mute nudges for me</Text>
              <Switch
                value={draftNudgeMuted}
                onValueChange={setDraftNudgeMuted}
                testID="balance-nudge-mute-switch"
              />
            </View>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setShowBalanceNudges(false)}>Cancel</Button>
            <Button
              onPress={() => {
                void (async () => {
                  try {
                    const payload: {
                      groupId: string;
                      balance_nudge_cadence?: "off" | "weekly" | "monthly";
                      mute_balance_nudges?: boolean;
                    } = { groupId: group.id, mute_balance_nudges: draftNudgeMuted };
                    if (isOwner) {
                      payload.balance_nudge_cadence = draftNudgeCadence;
                    }
                    await updateBalanceNudgesMutation.mutate(payload);
                    setShowBalanceNudges(false);
                  } catch (error) {
                    Alert.alert(
                      "Couldn’t save balance nudges",
                      error instanceof Error ? error.message : "Please try again.",
                    );
                  }
                })();
              }}
              loading={updateBalanceNudgesMutation.isLoading}
              disabled={updateBalanceNudgesMutation.isLoading}
              testID="balance-nudge-save"
            >
              Save
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      <GroupDefaultSplitSheet
        visible={showDefaultSplit}
        groupName={group.name}
        participants={participants.filter((person) => person.type !== "former")}
        mode={normalizeGroupDefaultSplit(group).mode}
        weights={normalizeGroupDefaultSplit(group).weights}
        saving={updateDefaultSplitMutation.isLoading}
        error={defaultSplitError}
        onDismiss={() => {
          setShowDefaultSplit(false);
          setDefaultSplitError(null);
        }}
        onSave={(mode, weights) => {
          void handleSaveDefaultSplit(mode, weights);
        }}
      />

      <BalanceShareLinkSheet
        visible={showBalanceShareLinks}
        groupId={group.id}
        onDismiss={() => setShowBalanceShareLinks(false)}
      />

      <RecurringTemplatesSheet
        visible={showRecurringTemplates}
        groupId={group.id}
        groupName={group.name}
        templates={group.recurring_templates || []}
        participants={participants}
        defaultCurrency={preferredCurrency || getDefaultCurrency()}
        currentUserParticipantId={participants.find((person) => person.user_id === session?.user?.id)?.id}
        onDismiss={() => setShowRecurringTemplates(false)}
        onExpenseCreated={() => {
          void refetchGroup();
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

      <GroupExportSheet
        visible={showExport}
        pdfAvailable={pdfExportAvailable}
        busy={exportBusy}
        onDismiss={() => {
          if (exportBusy) return;
          setShowExport(false);
        }}
        onExport={handleExport}
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
    right: 16,
    bottom: 16,
    borderRadius: 28,
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
