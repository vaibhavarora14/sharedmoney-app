import React from 'react';
import { Skeleton, SkeletonGroup } from './Skeleton';
import { GROUP_BALANCE_SLOT_WIDTH } from '../constants/layout';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import {
  GroupCurrencySettings,
  useCurrencyPreferences,
} from '../hooks/useCurrencyPreferences';
import { Balance } from '../types';
import { balanceAmountColor, GROUP_LIST_EVEN_LABEL } from '../utils/balanceRowLabels';
import { formatCurrency } from '../utils/currency';
import { formatUnifiedHeadline, unifyBalances } from '../utils/currencyMerge';
import { createPreviewRateBook } from '../utils/previewRates';

interface GroupBalanceData {
  group_id: string;
  balances: Balance[];
}

interface GroupBalanceBadgeProps {
  balanceData?: GroupBalanceData | null;
  currentUserId?: string | null;
  style?: ViewStyle;
  previewSettings?: GroupCurrencySettings | null;
  /**
   * When true (balances query still deferred/loading), show a neutral placeholder.
   * Never claim "Even" until balances have resolved — missing data ≠ zero.
   */
  loading?: boolean;
}

export const GroupBalanceBadge: React.FC<GroupBalanceBadgeProps> = ({ 
  balanceData,
  currentUserId,
  style,
  previewSettings,
  loading = false,
}) => {
  const theme = useTheme();
  const { groupSettings, rateBook: storedRateBook } = useCurrencyPreferences(
    previewSettings ? undefined : balanceData?.group_id
  );
  const settings = previewSettings ?? groupSettings;
  const rateBook = previewSettings
    ? createPreviewRateBook(previewSettings.customRates)
    : storedRateBook;

  const renderEven = () => (
    <View
      style={[styles.balanceStatus, style]}
      testID="group-balance-even"
      accessibilityLabel={GROUP_LIST_EVEN_LABEL}
    >
      <Text style={[styles.balanceText, { color: theme.colors.onSurfaceVariant }]}>
        {GROUP_LIST_EVEN_LABEL}
      </Text>
    </View>
  );

  const renderLoading = () => (
    <SkeletonGroup
      style={[styles.balanceStatus, style]}
      testID="group-balance-loading"
    >
      <Skeleton width="100%" height={12} />
    </SkeletonGroup>
  );

  // Cold Home paint: list rows appear before deferred all-balances finishes.
  // Missing/undefined balanceData must not read as Even until the query resolves.
  if (loading) {
    return renderLoading();
  }

  // Robust null checks — only after balances have resolved
  if (!balanceData || !balanceData.balances || balanceData.balances.length === 0) {
    return renderEven();
  }

  // Filter balances
  let displayBalances = balanceData.balances;
  
  if (currentUserId) {
    // If we have a current user, only show their personal balance in this group
    displayBalances = balanceData.balances.filter(b => b.user_id === currentUserId);
  }

  // Filter out zero residues
  const nonZeroBalances = displayBalances.filter(b => Math.abs(b.amount) >= 0.01);

  if (nonZeroBalances.length === 0) {
    return renderEven();
  }

  // Sum balances by currency (important if user has multiple residues, e.g. from invited state vs user state)
  const netBalancesMap = nonZeroBalances.reduce((acc, b) => {
    acc[b.currency] = (acc[b.currency] || 0) + b.amount;
    return acc;
  }, {} as Record<string, number>);

  const netBalances = Object.entries(netBalancesMap)
    .map(([currency, amount]) => ({ currency, amount }))
    .filter(b => Math.abs(b.amount) >= 0.01);

  if (netBalances.length === 0) {
    return renderEven();
  }

  if (settings?.enabled && settings.settlementCurrency) {
    const unified = unifyBalances(nonZeroBalances, settings.settlementCurrency, rateBook);
    const leftover = unified.leftover.filter((part) => Math.abs(part.original) >= 0.01);
    if (Math.abs(unified.amount) < 0.01 && leftover.length === 0) {
      return renderEven();
    }

    const signedAmount = Math.abs(unified.amount) >= 0.01
      ? unified.amount
      : leftover.every((part) => part.original > 0)
        ? 1
        : -1;
    const textColor = balanceAmountColor(signedAmount, theme.colors, { dark: theme.dark });
    return (
      <View style={[styles.balanceStatus, style]} testID="group-balance-amount">
        <Text style={[styles.balanceText, { color: textColor, fontWeight: '700' }]}>
          {signedAmount > 0 ? '+' : signedAmount < 0 ? '−' : ''}
          {formatUnifiedHeadline(unified)}
        </Text>
      </View>
    );
  }

  // Sort by absolute amount to show the most significant balance first
  netBalances.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  const mainBalance = netBalances[0];
  const isMultiCurrency = netBalances.length > 1;
  const textColor = balanceAmountColor(mainBalance.amount, theme.colors, { dark: theme.dark });

  return (
    <View style={[styles.balanceStatus, style]} testID="group-balance-amount">
      <Text style={[styles.balanceText, { color: textColor, fontWeight: '700' }]}>
        {mainBalance.amount > 0 ? '+' : mainBalance.amount < 0 ? '−' : ''}
        {formatCurrency(mainBalance.amount, mainBalance.currency)}
        {isMultiCurrency ? ' (+)' : ''}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  balanceStatus: {
    paddingHorizontal: 2,
    paddingVertical: 2,
    width: GROUP_BALANCE_SLOT_WIDTH,
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  balanceText: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: -0.1,
    textAlign: 'right',
  },
});
