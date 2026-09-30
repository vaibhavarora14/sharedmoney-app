import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import React, { useEffect, useMemo, useState } from "react";
import { BackHandler, ScrollView, StyleSheet, View } from "react-native";
import {
  ActivityIndicator,
  Appbar,
  Avatar,
  SegmentedButtons,
  Surface,
  Text,
  TouchableRipple,
  useTheme
} from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { BalancesSection } from "../components/BalancesSection";
import { useAuth } from "../contexts/AuthContext";
import { useCurrencyPreferences } from "../hooks/useCurrencyPreferences";
import { useBalances, useGroupStats } from "../hooks/useBalances";
import { useGroupDetails } from "../hooks/useGroups";
import { useParticipants } from "../hooks/useParticipants";
import { useCreateSettlement } from "../hooks/useSettlements";
import { Balance, GroupMember, Participant, Transaction } from "../types";
import {
  formatCurrency,
  getDefaultCurrency,
} from "../utils/currency";
import { formatBreakdown, formatDisplayTotals, simplifyUnifiedDebts, unifyPeopleNets, type ConvertedPart, type UnifiedPersonNet } from "../utils/currencyMerge";
import { SettlementFormScreen } from "./SettlementFormScreen";

export type GroupStatsMode = "my-costs" | "total-costs" | "settlement-plan" | "i-owe" | "im-owed";

interface GroupStatsScreenProps {
  groupId: string;
  mode: GroupStatsMode;
  onBack: () => void;
  onEditTransaction?: (transaction: Transaction) => void;
}

const MODE_COPY: Record<
  GroupStatsMode,
  { title: string; subtitle: string; summaryLabel: string }
> = {
  "my-costs": {
    title: "My Costs",
    subtitle: "Only expenses you’re part of or are owed for.",
    summaryLabel: "Your share",
  },
  "total-costs": {
    title: "Group Summary",
    subtitle: "Breakdown of every member’s share.",
    summaryLabel: "Group total",
  },
  "settlement-plan": {
    title: "Group Summary",
    subtitle: "Simplified plan to clear all group debts.",
    summaryLabel: "Total group debt",
  },
  "i-owe": {
    title: "People You Owe",
    subtitle: "All outstanding balances you need to settle.",
    summaryLabel: "Total to pay",
  },
  "im-owed": {
    title: "People Who Owe You",
    subtitle: "See who still needs to settle up.",
    summaryLabel: "Total receivable",
  },
};

export const GroupStatsScreen: React.FC<GroupStatsScreenProps> = ({
  groupId,
  mode,
  onBack,
  onEditTransaction,
}) => {
  const [activeMode, setActiveMode] = useState<GroupStatsMode>(mode);
  const theme = useTheme();
  const defaultCurrency = getDefaultCurrency();
  const { session } = useAuth();
  const { groupSettings, rateBook } = useCurrencyPreferences(groupId);
  const unifyEnabled = groupSettings?.enabled === true && !!groupSettings.settlementCurrency;
  const settlementCurrency = groupSettings?.settlementCurrency || defaultCurrency;
  const [settlingBalance, setSettlingBalance] = useState<Balance | null>(null);
  const [settlementInitialData, setSettlementInitialData] = useState<{
    fromParticipantId: string;
    toParticipantId: string;
    amount: number;
    currency: string;
  } | null>(null);
  const [showSettlementForm, setShowSettlementForm] = useState(false);

  const colorStyles = useMemo(
    () => ({
      container: { backgroundColor: theme.colors.background },
      appbar: { backgroundColor: theme.colors.background },
      summaryCard: {
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.outlineVariant,
        borderWidth: StyleSheet.hairlineWidth,
      },
      summaryLabel: { color: theme.colors.onSurfaceVariant },
      summaryValue: { color: theme.colors.onSurface },
      summaryHelpText: { color: theme.colors.onSurfaceVariant },
      divider: { backgroundColor: theme.colors.outlineVariant },
      sectionHeading: { color: theme.colors.onSurface },
      entryCard: {
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.outlineVariant,
        borderWidth: StyleSheet.hairlineWidth,
      },
      entrySubtext: { color: theme.colors.onSurfaceVariant },
      entryNote: { color: theme.colors.onSurfaceVariant },
      emptyState: { color: theme.colors.onSurfaceVariant },
    }),
    [theme]
  );

  const { data: groupData } = useGroupDetails(groupId);
  const {
    data: balancesData,
    isLoading: balancesLoading,
    refetch: refetchBalances,
  } = useBalances(groupId);
  const {
    data: groupStats,
    isLoading: groupStatsLoading,
    refetch: refetchGroupStats,
  } = useGroupStats(groupId);
  const createSettlement = useCreateSettlement(async () => {
    await Promise.all([refetchBalances(), refetchGroupStats()]);
  });

  // Handle Android hardware back button
  useEffect(() => {
    const handleHardwareBack = () => {
      onBack();
      return true; // Prevent default back behavior (exiting app)
    };

    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      handleHardwareBack
    );
    return () => subscription.remove();
  }, [onBack]);

  const { data: participantsData = [] } = useParticipants(groupId);
  const members = groupData?.members || [];
  const participants = participantsData || [];
  const currentUserId = session?.user?.id;
  
  const currentUserParticipantId = useMemo(() => {
    return participants.find((p: Participant) => p.user_id === currentUserId)?.id;
  }, [participants, currentUserId]);

  const memberLookup = useMemo(() => {
    const map = new Map<string, GroupMember>();
    members.forEach((member) => {
      map.set(member.user_id, member);
    });
    return map;
  }, [members]);

  const toMap = (source?: Record<string, number>) => {
    const map = new Map<string, number>();
    Object.entries(source || {}).forEach(([currency, amount]) => {
      map.set(currency, amount);
    });
    return map;
  };

  const costBreakdown = useMemo(() => {
    const entries = groupStats?.member_breakdown || [];
    return entries
      .map((entry) => {
        const member = entry.user_id ? memberLookup.get(entry.user_id) : null;
        const participant = participants.find((p) => p.id === entry.participant_id);
        const amounts = toMap(entry.share_totals);

        return {
          participantId: entry.participant_id,
          userId: entry.user_id,
          amounts,
          full_name: entry.full_name || participant?.full_name || member?.full_name || null,
          email: entry.email || participant?.email || member?.email || undefined,
          totalValue: Array.from(amounts.values()).reduce((a, b) => a + b, 0),
        };
      })
      .sort((a, b) => b.totalValue - a.totalValue);
  }, [groupStats, participants, memberLookup]);

  const paymentsBreakdown = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    (groupStats?.member_breakdown || []).forEach((entry) => {
      map.set(entry.participant_id, toMap(entry.paid_totals));
    });
    return map;
  }, [groupStats]);

  const totalCosts = useMemo(() => {
    return toMap(groupStats?.totals?.group_total);
  }, [groupStats]);

  const myShare = useMemo(() => {
    return toMap(groupStats?.totals?.my_share);
  }, [groupStats]);

  const myTransactionBreakdown = useMemo(() => {
    return (groupStats?.my_transactions || []).map((entry) => ({
      transaction: entry.transaction as Transaction,
      shareAmount: entry.share_amount,
      isPayer: entry.is_payer,
      netReceivable: entry.net_receivable,
    }));
  }, [groupStats]);

  const allGroupBalances = balancesData?.group_balances?.[0]?.balances || balancesData?.overall_balances || [];
  const unifiedNets = useMemo(
    () => unifyEnabled
      ? unifyPeopleNets(allGroupBalances, settlementCurrency, rateBook)
      : null,
    [unifyEnabled, allGroupBalances, settlementCurrency, rateBook]
  );

  const filteredBalances = useMemo(() => {
    const balances = unifiedNets || allGroupBalances;
    if (activeMode === "i-owe") {
      return balances.filter((balance) => balance.amount < 0);
    }
    if (activeMode === "im-owed") {
      return balances.filter((balance) => balance.amount > 0);
    }
    return balances;
  }, [allGroupBalances, unifiedNets, activeMode]);

  const balanceTotals = useMemo(() => {
    const totals = new Map<string, number>();
    filteredBalances.forEach((balance) => {
      const current = totals.get(balance.currency) || 0;
      totals.set(balance.currency, current + Math.abs(balance.amount));
    });
    return totals;
  }, [filteredBalances]);

  const settlementEdges = useMemo(() => {
    if (unifyEnabled) {
      return simplifyUnifiedDebts(
        allGroupBalances,
        settlementCurrency,
        rateBook,
        currentUserId,
        currentUserParticipantId
      );
    }
    return (groupStats?.settlement_plan || []).map((edge) => ({
      fromUser: {
        user_id: edge.from_user_id || "",
        participant_id: edge.from_participant_id,
        full_name: edge.from_full_name || null,
        email: edge.from_email || undefined,
        avatar_url: edge.from_avatar_url || null,
        amount: -Math.abs(edge.amount),
        currency: edge.currency,
      } as Balance,
      toUser: {
        user_id: edge.to_user_id || "",
        participant_id: edge.to_participant_id,
        full_name: edge.to_full_name || null,
        email: edge.to_email || undefined,
        avatar_url: edge.to_avatar_url || null,
        amount: Math.abs(edge.amount),
        currency: edge.currency,
      } as Balance,
      amount: edge.amount,
      currency: edge.currency,
    }));
  }, [groupStats, unifyEnabled, allGroupBalances, settlementCurrency, rateBook, currentUserId, currentUserParticipantId]);

  const resolveUserLabel = (userId: string | undefined, fallback?: string) => {
    if (userId) {
      const member = memberLookup.get(userId);
      if (member?.full_name) return member.full_name;
      if (member?.email) return member.email;
    }
    if (fallback) return fallback;
    return userId ? `User ${userId.substring(0, 8)}...` : "Member";
  };

  const balancesForMember = (entry: { participantId: string; userId?: string | null }) =>
    filteredBalances.filter((balance) =>
      (balance.participant_id && balance.participant_id === entry.participantId)
      || (balance.user_id && entry.userId && balance.user_id === entry.userId)
    );

  const originalPartsOf = (balance: Balance): ConvertedPart[] => {
    const parts = (balance as UnifiedPersonNet).originalParts;
    return Array.isArray(parts) ? parts : [];
  };

  const originalPartsOfEdge = (edge: object): ConvertedPart[] => {
    if (!("originalParts" in edge) || !Array.isArray(edge.originalParts)) return [];
    return edge.originalParts as ConvertedPart[];
  };

  const classifyMember = (userBals: Balance[]): "overpaid" | "underpaid" | "settled" => {
    if (unifyEnabled) {
      const settlementNet = userBals
        .filter((balance) => balance.currency === settlementCurrency)
        .reduce((sum, balance) => sum + balance.amount, 0);
      if (settlementNet > 0.01) return "overpaid";
      if (settlementNet < -0.01) return "underpaid";
    }
    const hasPositive = userBals.some((balance) => balance.amount > 0.01);
    const hasNegative = userBals.some((balance) => balance.amount < -0.01);
    if (hasPositive && !hasNegative) return "overpaid";
    if (hasNegative && !hasPositive) return "underpaid";
    return "settled";
  };

  const renderMemberBreakdown = () => {
    if (groupStatsLoading) {
      return <ActivityIndicator style={{ marginTop: 24 }} />;
    }

    if (costBreakdown.length === 0) {
      return (
        <Text style={styles.emptyState}>
          No expenses yet. Add a transaction to build this view.
        </Text>
      );
    }

    const overpaid: typeof costBreakdown = [];
    const underpaid: typeof costBreakdown = [];
    const settled: typeof costBreakdown = [];

    costBreakdown.forEach(entry => {
        const status = classifyMember(balancesForMember(entry));
        if (status === "overpaid") overpaid.push(entry);
        else if (status === "underpaid") underpaid.push(entry);
        else settled.push(entry);
    });

    const renderEntry = (entry: typeof costBreakdown[0], index: number) => {
        const isMe = entry.participantId === currentUserParticipantId || (entry.userId && entry.userId === currentUserId);
        return (
          <Surface
            key={entry.participantId}
            style={[
              styles.entryCard,
              colorStyles.entryCard,
            ]}
            elevation={1}
          >
            <View style={[styles.entryHeader, { alignItems: 'center' }]}>
              {/* 1. Avatar / Initials */}
              <Avatar.Text 
                size={40} 
                label={(entry.full_name || resolveUserLabel(entry.userId, entry.email)).substring(0, 2).toUpperCase()} 
                style={{ 
                    marginRight: 12, 
                    backgroundColor: isMe ? theme.colors.primaryContainer : theme.colors.elevation.level2 
                }}
              />
  
              <View style={{ flex: 1 }}>
                <Text variant="titleSmall" style={{ fontWeight: "bold", color: isMe ? theme.colors.primary : theme.colors.onSurface }}>
                  {entry.full_name || resolveUserLabel(entry.userId, entry.email)}
                  {isMe && " (YOU)"}
                </Text>
                
                {/* Paid vs Share Comparison */}
                {(() => {
                    const paidMap = paymentsBreakdown.get(entry.participantId) || new Map<string, number>();
                    const paidText = formatDisplayTotals(paidMap, {
                      unifyEnabled,
                      settlementCurrency,
                      rateBook,
                      defaultCurrency,
                    }).headline;
                    const shareText = formatDisplayTotals(entry.amounts, {
                      unifyEnabled,
                      settlementCurrency,
                      rateBook,
                      defaultCurrency,
                    }).headline;
                    
                    return (
                        <Text variant="labelSmall" style={{ opacity: 0.6, marginTop: 2 }}>
                            Paid {paidText} • Share {shareText}
                        </Text>
                    );
                })()}
              </View>
  
              {/* 2. Net Balance & Status */}
              <View style={{ alignItems: 'flex-end' }}>
                   {(() => {
                        const userBals = balancesForMember(entry);
                        const status = classifyMember(userBals);
  
                        return (
                            <>
                              {userBals.length > 0 ? (
                                  userBals.map((bal, i) => (
                                      <View key={`${bal.currency}-${i}`} style={{ alignItems: "flex-end" }}>
                                        <Text variant="titleMedium" style={{ 
                                            color: bal.amount >= 0
                                              ? theme.colors.onTertiaryContainer
                                              : theme.colors.onSecondaryContainer, 
                                            fontWeight: 'bold' 
                                        }}>
                                            {bal.amount >= 0 ? "+" : ""}{formatCurrency(bal.amount, bal.currency)}
                                        </Text>
                                        {originalPartsOf(bal).length > 0 ? (
                                          <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                            from {formatBreakdown(originalPartsOf(bal))}
                                          </Text>
                                        ) : null}
                                      </View>
                                  ))
                              ) : (
                                  <Text variant="titleMedium" style={{ opacity: 0.3, fontWeight: 'bold' }}>
                                      {formatCurrency(0, defaultCurrency)}
                                  </Text>
                              )}
  
                              <Text variant="labelSmall" style={{ 
                                  fontWeight: 'bold',
                                  color: status === "overpaid"
                                    ? theme.colors.onTertiaryContainer
                                    : status === "underpaid"
                                      ? theme.colors.onSecondaryContainer
                                      : theme.colors.onSurfaceVariant,
                                  opacity: status === "settled" ? 0.3 : 1,
                                  marginTop: 2
                              }}>
                                  {status === "overpaid" ? "GETS BACK" : status === "underpaid" ? "OWES" : "EVEN"}
                              </Text>
                            </>
                        );
                   })()}
              </View>
            </View>
          </Surface>
        );
    };

    return (
        <View style={{ gap: 24 }}>
            {overpaid.length > 0 && (
                <View style={{ gap: 8 }}>
                    <Text variant="labelLarge" style={{ opacity: 0.5, marginLeft: 4 }}>People to be Paid</Text>
                    {overpaid.map(renderEntry)}
                </View>
            )}
            
            {underpaid.length > 0 && (
                <View style={{ gap: 8 }}>
                    <Text variant="labelLarge" style={{ opacity: 0.5, marginLeft: 4 }}>People who Owe</Text>
                    {underpaid.map(renderEntry)}
                </View>
            )}

            {settled.length > 0 && (
                <View style={{ gap: 8 }}>
                    <Text variant="labelLarge" style={{ opacity: 0.5, marginLeft: 4 }}>Even</Text>
                    {settled.map(renderEntry)}
                </View>
            )}
        </View>
    );
  };

  const renderMyTransactions = () => {
    if (groupStatsLoading) {
      return <ActivityIndicator style={{ marginTop: 24 }} />;
    }

    if (myTransactionBreakdown.length === 0) {
      return (
        <Text style={[styles.emptyState, colorStyles.emptyState]}>
          No transactions involve you yet.
        </Text>
      );
    }

    return myTransactionBreakdown.map((entry, index) => {
      const currency = entry.transaction.currency || defaultCurrency;
      const transactionDate = new Date(
        entry.transaction.date
      ).toLocaleDateString();

      return (
        <Surface
          key={entry.transaction.id}
          style={[
            styles.entryCard,
            colorStyles.entryCard,
            index === 0 && { marginTop: 8 },
            { padding: 0, overflow: "hidden" },
          ]}
          elevation={1}
        >
          <TouchableRipple
            onPress={
              onEditTransaction
                ? () => onEditTransaction(entry.transaction)
                : undefined
            }
            disabled={!onEditTransaction}
            style={{ padding: 16 }}
            accessibilityRole="button"
            accessibilityLabel={`${entry.transaction.description || "Untitled expense"}, ${formatCurrency(entry.transaction.amount, currency)}`}
          >
            <View>
              <View style={styles.entryHeader}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text variant="titleSmall" style={{ fontWeight: "600" }}>
                    {entry.transaction.description || "Untitled expense"}
                  </Text>
                  <Text style={[styles.entrySubtext, colorStyles.entrySubtext]}>
                    {transactionDate}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text variant="titleMedium" style={{ fontWeight: "bold" }}>
                    {formatCurrency(entry.transaction.amount, currency)}
                  </Text>
                  {onEditTransaction && (
                    <MaterialCommunityIcons
                      name="chevron-right"
                      size={20}
                      color={theme.colors.onSurfaceVariant}
                      style={{ marginLeft: 4 }}
                    />
                  )}
                </View>
              </View>
              {entry.shareAmount !== null && (
                <Text style={[styles.entryNote, colorStyles.entryNote]}>
                  You owe {formatCurrency(entry.shareAmount, currency)} for this
                  expense.
                </Text>
              )}
              {entry.isPayer &&
                entry.netReceivable !== null &&
                entry.netReceivable > 0 && (
                  <Text style={[styles.entryNote, colorStyles.entryNote]}>
                    Others owe you {formatCurrency(entry.netReceivable, currency)}.
                  </Text>
                )}
            </View>
          </TouchableRipple>
        </Surface>
      );
    });

  };

  const renderSettlementPlan = () => {
     if (settlementEdges.length === 0) return null;

     return (
        <View style={{ marginTop: 24 }}>
            <Text
              variant="titleMedium"
              style={[styles.sectionHeading, colorStyles.sectionHeading, { marginBottom: 16 }]}
            >
              Recommended Settlements
            </Text>
            {settlementEdges.map((edge, index) => {
                const isFromMe = edge.fromUser.user_id === currentUserId;
                const isToMe = edge.toUser.user_id === currentUserId;
                const isInvolved = isFromMe || isToMe;

                const amountColor = isToMe
                  ? theme.colors.onTertiaryContainer
                  : isFromMe
                    ? theme.colors.onSecondaryContainer
                    : theme.colors.onSurface;

                const fromName = isFromMe ? "You" : (edge.fromUser.full_name || edge.fromUser.email?.split("@")[0] || "User");
                const toName = isToMe ? "You" : (edge.toUser.full_name || edge.toUser.email?.split("@")[0] || "User");

                // If involved, show the "other" person's avatar to match dashboard feel
                const otherUser = isToMe ? edge.fromUser : edge.toUser;
                const avatarUser = isInvolved ? otherUser : edge.fromUser;

                return (
                    <Surface
                        key={`${edge.currency}-${edge.fromUser.participant_id || edge.fromUser.user_id}-${edge.toUser.participant_id || edge.toUser.user_id}`}
                        style={styles.actionCard}
                        elevation={0}
                    >
                        <TouchableRipple 
                            onPress={() => {
                                const fromPid = edge.fromUser.participant_id || memberLookup.get(edge.fromUser.user_id)?.participant_id;
                                const toPid = edge.toUser.participant_id || memberLookup.get(edge.toUser.user_id)?.participant_id;
                                
                                if (fromPid && toPid) {
                                    setSettlementInitialData({
                                        fromParticipantId: fromPid,
                                        toParticipantId: toPid,
                                        amount: edge.amount,
                                        currency: edge.currency
                                    });
                                    setShowSettlementForm(true);
                                }
                            }}
                            style={{ paddingVertical: 4, paddingHorizontal: 4 }}
                        >
                            <View style={styles.actionRow}>
                                <Avatar.Text 
                                    size={40} 
                                    label={(avatarUser.full_name || resolveUserLabel(avatarUser.user_id, avatarUser.email)).substring(0, 2).toUpperCase()} 
                                    style={{ 
                                        backgroundColor: avatarUser.user_id === currentUserId ? theme.colors.primaryContainer : theme.colors.surfaceVariant 
                                    }}
                                    color={avatarUser.user_id === currentUserId ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant}
                                />
                                
                                <View style={styles.actionInfo}>
                                    <Text variant="bodyLarge" style={{ color: theme.colors.onSurface, fontWeight: '500' }}>
                                        {isInvolved ? (isToMe ? fromName : toName) : fromName}
                                    </Text>
                                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                        {isFromMe ? `you owe ${toName}` : isToMe ? `owes you` : `pays ${toName}`}
                                    </Text>
                                </View>

                                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                                    <Text variant="titleMedium" style={{ color: amountColor, fontWeight: "700" }}>
                                        {formatCurrency(edge.amount, edge.currency)}
                                    </Text>
                                    {originalPartsOfEdge(edge).length > 0 ? (
                                        <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                            from {formatBreakdown(originalPartsOfEdge(edge))}
                                        </Text>
                                    ) : null}
                                    <View style={[
                                        styles.actionChip, 
                                        { backgroundColor: isToMe ? theme.colors.surfaceVariant : isFromMe ? theme.colors.surfaceVariant : theme.colors.surfaceVariant } 
                                    ]}>
                                        <Text 
                                            variant="labelSmall" 
                                            style={{ 
                                                color: isToMe ? theme.colors.onTertiaryContainer : isFromMe ? theme.colors.onSecondaryContainer : theme.colors.onSurfaceVariant,
                                                fontWeight: '700',
                                                fontSize: 10,
                                                letterSpacing: 0.5
                                            }}
                                        >
                                            {isFromMe ? "PAY" : isToMe ? "RECEIVE" : "SETTLE"}
                                        </Text>
                                    </View>
                                </View>
                            </View>
                        </TouchableRipple>
                    </Surface>
                );
            })}
        </View>
     );
  };

  const renderCostContent = () => {
    const summaryValue = activeMode === "my-costs" ? myShare : totalCosts;
    const showTabs = activeMode === "total-costs" || activeMode === "settlement-plan";
    const summaryDisplay = formatDisplayTotals(summaryValue, {
      unifyEnabled,
      settlementCurrency,
      rateBook,
      defaultCurrency,
    });

    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Surface
          style={[styles.summaryCard, colorStyles.summaryCard]}
          elevation={2}
        >
          <Text
            variant="labelMedium"
            style={[styles.summaryLabel, colorStyles.summaryLabel]}
          >
            {MODE_COPY[activeMode].summaryLabel}
          </Text>
          <Text
            variant="headlineSmall"
            style={[styles.summaryValue, colorStyles.summaryValue]}
          >
            {groupStatsLoading ? "..." : summaryDisplay.headline}
          </Text>
          {unifyEnabled && !groupStatsLoading ? (
            <Text variant="bodySmall" style={[styles.summaryHelpText, colorStyles.summaryHelpText]}>
              from {summaryDisplay.breakdown || "original currencies"}
            </Text>
          ) : null}
          <Text style={[styles.summaryHelpText, colorStyles.summaryHelpText]}>
            {MODE_COPY[activeMode].subtitle}
          </Text>
        </Surface>

        {showTabs && (
            <SegmentedButtons
                value={activeMode}
                onValueChange={(val) => setActiveMode(val as GroupStatsMode)}
                style={{ marginBottom: 24 }}
                theme={{
                    colors: {
                        secondaryContainer: theme.colors.primaryContainer,
                        onSecondaryContainer: theme.colors.onPrimaryContainer,
                    },
                }}
                buttons={[
                    { value: 'total-costs', label: 'Totals', icon: 'account-group' },
                    { value: 'settlement-plan', label: 'Settle Up', icon: 'hand-coin' },
                ]}
            />
        )}

        <Text
          variant="titleMedium"
          style={[styles.sectionHeading, colorStyles.sectionHeading]}
        >
          {activeMode === "my-costs" ? "My transactions" : 
           activeMode === "total-costs" ? "Member breakdown" : "Settlement plan"}
        </Text>

        {activeMode === "my-costs" ? renderMyTransactions() : (
            <>
                {activeMode === "total-costs" && renderMemberBreakdown()}
                {activeMode === "settlement-plan" && renderSettlementPlan()}
            </>
        )}
      </ScrollView>
    );
  };

  const renderBalanceContent = () => {
    const balanceDisplay = formatDisplayTotals(balanceTotals, {
      unifyEnabled,
      settlementCurrency,
      rateBook,
      defaultCurrency,
    });
    return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <Surface
        style={[styles.summaryCard, colorStyles.summaryCard]}
        elevation={2}
      >
        <Text
          variant="labelMedium"
          style={[styles.summaryLabel, colorStyles.summaryLabel]}
        >
          {MODE_COPY[activeMode].summaryLabel}
        </Text>
          <Text
            variant="headlineMedium"
            style={[styles.summaryValue, colorStyles.summaryValue]}
          >
            {balancesLoading ? "..." : balanceDisplay.headline}
          </Text>
          {unifyEnabled && !balancesLoading ? (
            <Text variant="bodySmall" style={[styles.summaryHelpText, colorStyles.summaryHelpText]}>
              from {balanceDisplay.breakdown || "original currencies"}
            </Text>
          ) : null}
        <Text style={[styles.summaryHelpText, colorStyles.summaryHelpText]}>
          {MODE_COPY[activeMode].subtitle}
        </Text>
      </Surface>

      <BalancesSection
        groupBalances={[]}
        overallBalances={filteredBalances}
        loading={balancesLoading}
        defaultCurrency={defaultCurrency}
        showOverallBalances
        currentUserId={session?.user?.id}
        groupMembers={members}
        participants={participants}
        calmEmpty={filteredBalances.length === 0}
      />

      {!balancesLoading && filteredBalances.length === 0 && (
        <Text
          style={[styles.emptyState, colorStyles.emptyState, { marginTop: 24 }]}
        >
          {activeMode === "i-owe"
            ? "You’re all settled. No one to pay right now."
            : "Nice! Everyone has paid you back."}
        </Text>
      )}
    </ScrollView>
    );
  };

  const isCostMode = activeMode === "my-costs" || activeMode === "total-costs" || activeMode === "settlement-plan";

  return (
    <>
      <SafeAreaView style={[styles.container, colorStyles.container]}>
        <Appbar.Header style={colorStyles.appbar}>
          <Appbar.BackAction onPress={onBack} />
          <Appbar.Content title={MODE_COPY[activeMode].title} />
        </Appbar.Header>
        {isCostMode ? renderCostContent() : renderBalanceContent()}
      </SafeAreaView>

      <SettlementFormScreen
        visible={showSettlementForm}
        balance={settlingBalance}
        settlement={null}
        groupMembers={members}
        participants={participants}
        currentUserId={session?.user?.id || ""}
        groupId={groupId}
        defaultCurrency={defaultCurrency}
        onSave={async (data) => {
          await createSettlement.mutate(data);
          setShowSettlementForm(false);
          setSettlingBalance(null);
        }}
        onDismiss={() => {
          setShowSettlementForm(false);
          setSettlingBalance(null);
          setSettlementInitialData(null);
        }}
        fromParticipantId={settlementInitialData?.fromParticipantId}
        toParticipantId={settlementInitialData?.toParticipantId}
        initialAmount={settlementInitialData?.amount}
        initialCurrency={settlementInitialData?.currency}
      />
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  summaryCard: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
  },
  summaryLabel: {
    opacity: 0.7,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  summaryValue: {
    fontWeight: "bold",
    marginTop: 8,
  },
  summaryHelpText: {
    marginTop: 4,
    opacity: 0.7,
  },
  sectionHeading: {
    marginBottom: 12,
  },
  entryCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  entryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  entrySubtext: {
    opacity: 0.7,
    marginTop: 4,
  },
  entryNote: {
    opacity: 0.8,
  },
  emptyState: {
    textAlign: "center",
    opacity: 0.7,
  },
  actionCard: {
    backgroundColor: "transparent",
    borderRadius: 0,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingVertical: 4,
  },
  actionInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  actionChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    minWidth: 70,
    alignItems: 'center',
  },
});
