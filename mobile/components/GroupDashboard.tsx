import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import React, { useMemo } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import {
    Surface,
    Text,
    TouchableRipple,
    useTheme
} from "react-native-paper";
import { Balance, GroupStatsResponse } from "../types";
import { UnifyPromptCard } from "./UnifyPromptCard";
import { useCurrencyPreferences } from "../hooks/useCurrencyPreferences";
import { formatCurrency, getDefaultCurrency } from "../utils/currency";
import {
  collectCurrencies,
  formatDisplayTotals,
  isMultiCurrency,
  unifyBalances,
  simplifyUnifiedDebts,
} from "../utils/currencyMerge";
import { simplifyDebts } from "../utils/debt";
import {
  currenciesFromGroupStats,
  spendingTotalsFromGroupStats,
} from "../utils/groupDashboardStats";

interface GroupDashboardProps {
  groupId?: string;
  balances: Balance[];
  /** Full-set backend stats — never derive spending totals from paginated transactions. */
  groupStats?: GroupStatsResponse | null;
  currentUserId?: string;
  currentUserParticipantId?: string;
  loading: boolean;
  statsLoading?: boolean;
  /** When true with loading, hide settlement + insight chrome (list shell spinner is the only loader). */
  quietLoading?: boolean;
  balanceError?: boolean;
  defaultCurrency?: string;
  /** Opens SettlementFormScreen for a viewer-involved settlement edge. Does not mutate data. */
  onSettlePress?: (balance: Balance) => void;
  onMyCostsPress?: () => void;
  onTotalCostsPress?: () => void;
  onOpenCurrencySettings?: () => void;
  /** Active members in the group (for calm solo/zero chrome). */
  activeMemberCount?: number;
}

function shortName(full?: string | null, email?: string | null): string {
  const base = full?.trim() || email?.split("@")[0] || email || "Someone";
  return base.split(/\s+/)[0] || base;
}

function initials(full?: string | null, email?: string | null): string {
  const name = full?.trim() || email?.split("@")[0] || email || "?";
  if (name.includes(" ")) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
  }
  const base = name.includes("@") ? name.split("@")[0] : name;
  if (base.length >= 2) return base.substring(0, 2).toUpperCase();
  return base.length > 0 ? (base[0] + base[0]).toUpperCase() : "??";
}

export const GroupDashboard: React.FC<GroupDashboardProps> = ({
  groupId,
  balances,
  groupStats,
  currentUserId,
  currentUserParticipantId,
  loading,
  statsLoading = false,
  quietLoading = false,
  balanceError = false,
  defaultCurrency = getDefaultCurrency(),
  onSettlePress,
  onMyCostsPress,
  onTotalCostsPress,
  onOpenCurrencySettings,
  activeMemberCount = 2,
}) => {
  const theme = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const stackInsights = width / fontScale < 300;
  const {
    preferredCurrency,
    groupSettings,
    rateBook,
    setGroupSettings,
  } = useCurrencyPreferences(groupId);
  const dashboardLoading = loading || statsLoading;

  const usedCurrencies = useMemo(
    () => collectCurrencies([...balances, ...currenciesFromGroupStats(groupStats)]),
    [balances, groupStats]
  );
  const hasMultipleCurrencies = isMultiCurrency(usedCurrencies);
  const unifyEnabled = groupSettings?.enabled === true && !!groupSettings.settlementCurrency;
  const settlementCurrency = groupSettings?.settlementCurrency || preferredCurrency || defaultCurrency;

  const debts = useMemo(() => {
    if (!currentUserId) return [];
    if (unifyEnabled) {
      return simplifyUnifiedDebts(
        balances,
        settlementCurrency,
        rateBook,
        currentUserId,
        currentUserParticipantId
      );
    }
    return simplifyDebts(balances, currentUserId, defaultCurrency, currentUserParticipantId);
  }, [balances, currentUserId, currentUserParticipantId, defaultCurrency, unifyEnabled, settlementCurrency, rateBook]);

  const myDebts = useMemo(() => {
    if (!currentUserId) return [];
    const filtered = debts.filter(
      (d) =>
        d.fromUser.user_id === currentUserId || d.toUser.user_id === currentUserId
        || (currentUserParticipantId && (
          d.fromUser.participant_id === currentUserParticipantId
          || d.toUser.participant_id === currentUserParticipantId
        ))
    );
    return [...filtered].sort((a, b) => {
      if (b.amount !== a.amount) return b.amount - a.amount;
      const aOtherId = a.fromUser.user_id === currentUserId ? a.toUser.user_id : a.fromUser.user_id;
      const bOtherId = b.fromUser.user_id === currentUserId ? b.toUser.user_id : b.fromUser.user_id;
      return (aOtherId || "").localeCompare(bOtherId || "");
    });
  }, [debts, currentUserId, currentUserParticipantId]);

  const myUnified = useMemo(() => {
    if (!currentUserId || !unifyEnabled) return null;
    const mine = balances.filter((balance) => (
      balance.user_id === currentUserId
      || (currentUserParticipantId && balance.participant_id === currentUserParticipantId)
    ));
    return unifyBalances(mine.length > 0 ? mine : myDebts.map((edge) => ({
      user_id: currentUserId,
      amount: edge.toUser.user_id === currentUserId ? edge.amount : -edge.amount,
      currency: edge.currency,
    })), settlementCurrency, rateBook);
  }, [balances, currentUserId, currentUserParticipantId, myDebts, unifyEnabled, settlementCurrency, rateBook]);

  const { myCostTotal, groupCostTotal } = useMemo(
    () => spendingTotalsFromGroupStats(groupStats),
    [groupStats]
  );

  const myCostDisplay = useMemo(
    () => formatDisplayTotals(myCostTotal, {
      unifyEnabled,
      settlementCurrency,
      rateBook,
      defaultCurrency,
    }),
    [myCostTotal, unifyEnabled, settlementCurrency, rateBook, defaultCurrency]
  );
  const groupCostDisplay = useMemo(
    () => formatDisplayTotals(groupCostTotal, {
      unifyEnabled,
      settlementCurrency,
      rateBook,
      defaultCurrency,
    }),
    [groupCostTotal, unifyEnabled, settlementCurrency, rateBook, defaultCurrency]
  );

  // Group net balances are not debts to the viewer. Use the same viewer-involved
  // settlement edges as the unified view, retaining each edge's currency/amount.
  const viewerBalances = useMemo(() => myDebts.map((edge): Balance => {
    const isOwed = edge.toUser.user_id === currentUserId
      || (!!currentUserParticipantId && edge.toUser.participant_id === currentUserParticipantId);
    return {
      ...(isOwed ? edge.fromUser : edge.toUser),
      amount: isOwed ? edge.amount : -edge.amount,
      currency: edge.currency,
    };
  }), [myDebts, currentUserId, currentUserParticipantId]);

  const settlementRows = useMemo(
    () => viewerBalances.filter((balance) => Math.abs(balance.amount) >= 0.005),
    [viewerBalances],
  );


  const formatSignedBalance = (amount: number, currency: string, isOwed: boolean) => {
    const raw = formatCurrency(Math.abs(amount), currency);
    const bare = raw.replace(/^[+-]/, "");
    return isOwed ? `+${bare}` : `-${bare}`;
  };

  const personShort = (balance: Balance) =>
    shortName(balance.full_name, balance.email);

  const isSettled = !balanceError && !dashboardLoading && Boolean(currentUserId)
    && settlementRows.length === 0
    && !(unifyEnabled && myUnified && myUnified.missing.length > 0);

  // While GroupDetails ListEmpty spinner is up, hide settlement + insight chrome
  // entirely so an empty Surface / "..." does not stack with the spinner.
  const deferChromeToShell = quietLoading && (dashboardLoading || !currentUserId);

  const renderSettlementRows = () => {
    if (balanceError) {
      return (
        <View style={styles.settlementStatus}>
          <Text accessibilityLiveRegion="polite" variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            Couldn't load balances. Reopen the group to try again.
          </Text>
        </View>
      );
    }
    if (dashboardLoading || !currentUserId) {
      return (
        <View style={styles.settlementStatus}>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            Updating balances...
          </Text>
        </View>
      );
    }

    if (settlementRows.length === 0) {
      if (unifyEnabled && myUnified && myUnified.missing.length > 0) {
        return (
          <View style={styles.settlementStatus}>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: "center" }}>
              {`No ${myUnified.missing.join(", ")} → ${settlementCurrency} rate. Original balances remain; this group is not all settled.`}
            </Text>
          </View>
        );
      }
      return (
        <View style={styles.settledInline} testID="group-settled-inline">
          <MaterialCommunityIcons name="check-circle-outline" size={16} color={theme.colors.onSurfaceVariant} accessible={false} />
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            All settled
          </Text>
        </View>
      );
    }

    return settlementRows.map((balance, index) => {
      const isOwed = balance.amount > 0;
      const name = personShort(balance);
      const rowKey =
        balance.participant_id || balance.user_id || `${name}-${balance.currency}`;
      const amountColor = isOwed
        ? theme.colors.onTertiaryContainer
        : theme.colors.onSecondaryContainer;
      const isConverted = !unifyEnabled || balance.currency.toUpperCase() === settlementCurrency.toUpperCase();
      const Row = onSettlePress ? TouchableRipple : View;
      return (
        <Row
          key={`${rowKey}-${balance.currency}-${index}`}
          testID={`settlement-row-${rowKey}-${balance.currency || defaultCurrency}`}
          onPress={onSettlePress ? () => onSettlePress(balance) : undefined}
          accessible
          accessibilityRole={onSettlePress ? "button" : undefined}
          accessibilityLabel={`${isOwed ? `${name} owes you` : `You owe ${name}`}, ${formatSignedBalance(balance.amount, balance.currency, isOwed)}`}
          accessibilityHint={onSettlePress ? "Opens the payment record form. No payment is recorded until confirmed." : undefined}
          style={styles.settlementRow}
        >
          <View style={styles.settlementRowContent}>
            <View
              accessible={false}
              style={[styles.settlementAvatar, { backgroundColor: theme.colors.primaryContainer }]}
            >
              <Text style={{ color: theme.colors.onPrimaryContainer, fontWeight: "600", fontSize: 13 }}>
                {initials(balance.full_name, balance.email)}
              </Text>
            </View>
            <View style={styles.settlementDetails}>
              <Text
                variant="bodyMedium"
                style={{ flexGrow: 1, flexShrink: 1, flexBasis: 80, color: theme.colors.onSurface }}
              >
                {isOwed ? `${name} owes you` : `You owe ${name}`}
              </Text>
              <Text
                variant="titleSmall"
                style={{ flexShrink: 1, color: amountColor, fontWeight: "700" }}
              >
                {formatSignedBalance(balance.amount, balance.currency, isOwed)}
              </Text>
              {!isConverted ? (
                <Text
                  variant="labelSmall"
                  style={{ width: "100%", color: theme.colors.onSurfaceVariant }}
                >
                  Not converted · {balance.currency}
                </Text>
              ) : null}
            </View>
            {onSettlePress ? <MaterialCommunityIcons
              name="chevron-right"
              size={22}
              color={theme.colors.onSurfaceVariant}
            /> : null}
          </View>
        </Row>
      );
    });
  };

  const renderCompactInsights = () => (
    <View style={[styles.compactStatsRow, stackInsights && styles.stackedStats]}>
      <Surface style={[styles.compactStat, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant }]} elevation={0}>
        <TouchableRipple onPress={onMyCostsPress} style={{ flex: 1 }}>
          <View style={styles.compactStatContent}>
            <View style={[styles.miniIcon, { backgroundColor: theme.colors.surfaceVariant }]}>
              <MaterialCommunityIcons name="wallet" size={18} color={theme.colors.onSurfaceVariant} />
            </View>
            <View style={{ flex: 1 }}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>My spending</Text>
                <Text variant="titleSmall" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>
                    {dashboardLoading ? "..." : myCostDisplay.headline}
                </Text>
                {!dashboardLoading && myCostDisplay.breakdown ? (
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    from {myCostDisplay.breakdown}
                  </Text>
                ) : null}
            </View>
          </View>
        </TouchableRipple>
      </Surface>

      <Surface style={[styles.compactStat, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant }]} elevation={0}>
        <TouchableRipple onPress={onTotalCostsPress} style={{ flex: 1 }}>
          <View style={styles.compactStatContent}>
             <View style={[styles.miniIcon, { backgroundColor: theme.colors.surfaceVariant }]}>
              <MaterialCommunityIcons name="chart-pie" size={18} color={theme.colors.onSurfaceVariant} />
            </View>
            <View style={{ flex: 1 }}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>Group summary</Text>
                <Text variant="titleSmall" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>
                    {dashboardLoading ? "..." : groupCostDisplay.headline}
                </Text>
                {!dashboardLoading && groupCostDisplay.breakdown ? (
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    from {groupCostDisplay.breakdown}
                  </Text>
                ) : null}
            </View>
          </View>
        </TouchableRipple>
      </Surface>
    </View>
  );

  return (
    <View style={styles.container}>
      {hasMultipleCurrencies && !unifyEnabled && !balanceError && !dashboardLoading && !deferChromeToShell ? (
        <UnifyPromptCard
          currencies={usedCurrencies}
          suggestedCurrency={settlementCurrency}
          onEnable={() => {
            if (!groupId) {
              onOpenCurrencySettings?.();
              return;
            }
            void setGroupSettings(groupId, {
              enabled: true,
              settlementCurrency,
            });
          }}
          onChooseCurrency={onOpenCurrencySettings}
        />
      ) : null}

      {unifyEnabled && !balanceError && !dashboardLoading && activeMemberCount > 1 && !deferChromeToShell ? (
        <View style={styles.unifiedSubhead}>
          <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            {`In one currency · ${settlementCurrency}`}
          </Text>
          {onOpenCurrencySettings ? (
            <TouchableRipple
              onPress={onOpenCurrencySettings}
              accessibilityRole="button"
              accessibilityLabel="Rates"
              testID="group-rates-button"
            >
              <Text variant="labelLarge" style={{ color: theme.colors.primary, fontWeight: "600" }}>
                Rates ›
              </Text>
            </TouchableRipple>
          ) : null}
        </View>
      ) : null}

      {!deferChromeToShell && (balanceError || dashboardLoading || activeMemberCount > 1) ? isSettled ? (
        <View testID="group-settlement-rows">{renderSettlementRows()}</View>
      ) : (
        <Surface
          style={[styles.settlementList, { borderColor: theme.colors.outlineVariant, backgroundColor: theme.colors.surface }]}
          elevation={0}
          testID="group-settlement-rows"
        >
          {renderSettlementRows()}
        </Surface>
      ) : null}

      {!deferChromeToShell && unifyEnabled && !balanceError && !dashboardLoading && activeMemberCount > 1 && myUnified && myUnified.missing.length > 0 && settlementRows.length > 0 ? (
        <Text
          variant="labelSmall"
          style={{ color: theme.colors.error, marginTop: -8, marginHorizontal: 4 }}
          testID="group-missing-rates-notice"
        >
          {settlementRows.every((r) => r.currency.toUpperCase() !== settlementCurrency.toUpperCase())
            ? `No ${myUnified.missing.join(", ")} → ${settlementCurrency} rate. Original balances remain; this group is not all settled.`
            : `No ${myUnified.missing.join(", ")} → ${settlementCurrency} rate. Original balances remain below the converted rows.`}
        </Text>
      ) : null}

      {/* One loading treatment: while balances/stats load, settlement shows
          "Updating balances..." alone — do not also paint insight "..." cards. */}
      {deferChromeToShell || dashboardLoading ? null : renderCompactInsights()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 16,
  },
  unifiedSubhead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: -4,
  },
  settlementList: {
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  settlementRow: {
    minHeight: 60,
  },
  settlementRowContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 60,
  },
  settlementDetails: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 8,
    rowGap: 4,
    alignItems: "center",
    marginRight: 4,
  },
  settlementAvatar: {
    minWidth: 36,
    minHeight: 36,
    padding: 8,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  settledInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 2,
  },
  settlementStatus: {
    paddingVertical: 16,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  compactStatsRow: {
      flexDirection: 'row',
      gap: 12,
  },
  stackedStats: {
      flexDirection: 'column',
  },
  compactStat: {
      flex: 1,
      borderRadius: 8,
      overflow: 'hidden',
      borderWidth: 1,
  },
  compactStatContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 14,
  },
  miniIcon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
  }
});
