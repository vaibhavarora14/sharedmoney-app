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
import { balanceAmountColor, GROUP_LIST_EVEN_LABEL, groupListBalanceWords } from '../utils/balanceRowLabels';
import {
  resolveGroupListBalanceDisplay,
  type GroupListBalanceDisplay,
} from '../utils/groupListBalanceDisplay';
import { createPreviewRateBook } from '../utils/previewRates';

/** Match final amount-line height so loading does not resize the row. */
const AMOUNT_TEXT_HEIGHT = 16;

interface GroupBalanceData {
  group_id: string;
  balances: Balance[];
}

interface GroupListBalanceSource {
  groupId?: string;
  balanceData?: GroupBalanceData | null;
  currentUserId?: string | null;
  previewSettings?: GroupCurrencySettings | null;
  loading?: boolean;
}

export function useGroupListBalanceDisplay({
  groupId,
  balanceData,
  currentUserId,
  previewSettings,
  loading = false,
}: GroupListBalanceSource): GroupListBalanceDisplay {
  const { groupSettings, rateBook: storedRateBook } = useCurrencyPreferences(
    previewSettings ? undefined : groupId ?? balanceData?.group_id
  );
  const settings = previewSettings ?? groupSettings;
  const rateBook = previewSettings
    ? createPreviewRateBook(previewSettings.customRates)
    : storedRateBook;

  return resolveGroupListBalanceDisplay({
    loading,
    balances: balanceData?.balances,
    currentUserId,
    unifyEnabled: settings?.enabled === true && !!settings?.settlementCurrency,
    settlementCurrency: settings?.settlementCurrency,
    rateBook,
  });
}

interface GroupBalanceBadgeProps extends GroupListBalanceSource {
  style?: ViewStyle;
}

export const GroupBalanceBadge: React.FC<GroupBalanceBadgeProps> = ({ 
  balanceData,
  currentUserId,
  style,
  previewSettings,
  loading = false,
  groupId,
}) => {
  const theme = useTheme();
  const display = useGroupListBalanceDisplay({
    groupId,
    balanceData,
    currentUserId,
    previewSettings,
    loading,
  });

  if (display.kind === "loading") {
    return (
      <SkeletonGroup
        style={[styles.balanceStatus, style]}
        testID="group-balance-loading"
      >
        <View style={styles.amountSkeletonSlot}>
          <Skeleton width="92%" height={AMOUNT_TEXT_HEIGHT} borderRadius={4} />
        </View>
      </SkeletonGroup>
    );
  }

  if (display.kind === "even") {
    return (
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
  }

  const textColor = balanceAmountColor(display.signedAmount, theme.colors, { dark: theme.dark });
  const label = groupListBalanceWords(display.signedAmount, display.headline)
    + (display.multiCurrency ? ' (+)' : '');

  return (
    <View style={[styles.balanceStatus, style]} testID="group-balance-amount">
      <Text
        style={[styles.balanceText, { color: textColor, fontWeight: '700' }]}
        numberOfLines={2}
      >
        {label}
      </Text>
    </View>
  );
};

export function GroupListBalanceBits({
  children,
  ...source
}: GroupListBalanceSource & {
  children: (display: GroupListBalanceDisplay) => React.ReactNode;
}) {
  const display = useGroupListBalanceDisplay(source);
  return <>{children(display)}</>;
}

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
    lineHeight: AMOUNT_TEXT_HEIGHT,
    fontWeight: '500',
    letterSpacing: -0.1,
    textAlign: 'right',
  },
  amountSkeletonSlot: {
    width: '100%',
    height: AMOUNT_TEXT_HEIGHT,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
});
