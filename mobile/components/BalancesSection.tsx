import React, { useMemo } from "react";
import { View } from "react-native";
import {
    ActivityIndicator,
    Surface,
    Text,
    useTheme,
} from "react-native-paper";
import { Balance, GroupBalance, Participant } from "../types";
import { balanceAmountColor, balancePolarityLabel } from "../utils/balanceRowLabels";
import { getDefaultCurrency } from "../utils/currency";
import { formatShareCurrency } from "../utils/settleShareMessage";
import { formatBreakdown } from "../utils/currencyMerge";
import { DENSE_CARD_GAP } from "../utils/denseListTokens";
import { DenseListCard } from "./DenseListCard";
import { PersonAvatar } from "./PersonAvatar";
import { styles } from "./BalancesSection.styles";

interface BalancesSectionProps {
  groupBalances: GroupBalance[];
  overallBalances?: Balance[];
  loading: boolean;
  defaultCurrency?: string;
  showOverallBalances?: boolean;
  /** @deprecated Balance rows are informational — settle only via Settle tab/screens. */
  onSettleUp?: (balance: Balance) => void;
  currentUserId?: string;
  groupMembers?: Array<{
    user_id: string;
    email?: string;
    full_name?: string | null;
    avatar_url?: string | null;
  }>;
  participants?: Participant[];
  /** When true, hide the dual summary + rows chrome (solo / all-zero). */
  calmEmpty?: boolean;
}

export const BalancesSection: React.FC<BalancesSectionProps> = ({
  groupBalances,
  overallBalances = [],
  loading,
  defaultCurrency = getDefaultCurrency(),
  showOverallBalances = true,
  currentUserId,
  groupMembers = [],
  participants = [],
  calmEmpty = false,
}) => {
  const theme = useTheme();

  const personRows = useMemo(() => {
    const source =
      showOverallBalances && overallBalances.length > 0
        ? overallBalances
        : groupBalances.flatMap((g) => g.balances);

    // Merge same person across currencies for display when single-currency common;
    // otherwise keep per-currency rows.
    return [...source]
      .filter((b) => Math.abs(b.amount) >= 0.005)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  }, [groupBalances, overallBalances, showOverallBalances]);

  const { owedTotal, oweTotal } = useMemo(() => {
    const owed = new Map<string, number>();
    const owe = new Map<string, number>();
    for (const balance of personRows) {
      const totals = balance.amount > 0 ? owed : owe;
      const currency = balance.currency || defaultCurrency;
      totals.set(currency, (totals.get(currency) || 0) + Math.abs(balance.amount));
    }
    // Inputs may already be unified upstream; otherwise keep currencies separate.
    const formatTotals = (totals: Map<string, number>) => totals.size > 0
      ? Array.from(totals, ([currency, amount]) => formatShareCurrency(amount, currency)).join("\n")
      : formatShareCurrency(0, defaultCurrency);
    return { owedTotal: formatTotals(owed), oweTotal: formatTotals(owe) };
  }, [personRows, defaultCurrency]);

  const polaritySubline = (
    polarity: ReturnType<typeof balancePolarityLabel>,
  ): "You're owed" | "You owe" | "Settled" => {
    switch (polarity) {
      case "owed":
        return "You're owed";
      case "you owe":
        return "You owe";
      case "settled":
        return "Settled";
      default: {
        const _never: never = polarity;
        return _never;
      }
    }
  };

  const getUserDisplayName = (balance: Balance): string => {
    const participant = participants.find(
      (p: Participant) =>
        p.id === balance.participant_id ||
        (p.user_id && p.user_id === balance.user_id),
    );

    if (participant?.full_name) return participant.full_name;
    if (participant?.email) return participant.email;
    if (balance.full_name) return balance.full_name;
    if (balance.email) return balance.email;

    const member = groupMembers.find((m) => m.user_id === balance.user_id);
    if (member?.full_name) return member.full_name;
    if (member?.email) return member.email;

    const id = balance.user_id || balance.participant_id || "???";
    return `User ${id.substring(0, 8)}...`;
  };

  const getUserAvatar = (balance: Balance): string | null => {
    if (balance.avatar_url) return balance.avatar_url;
    const participant = participants.find(
      (p: Participant) =>
        p.id === balance.participant_id ||
        (p.user_id && p.user_id === balance.user_id),
    );
    if (participant?.avatar_url) return participant.avatar_url;
    const member = groupMembers.find((m) => m.user_id === balance.user_id);
    return member?.avatar_url || null;
  };

  const renderOriginalParts = (balance: Balance) => {
    const parts =
      "originalParts" in balance &&
      Array.isArray((balance as { originalParts?: unknown }).originalParts)
        ? (balance as { originalParts: Parameters<typeof formatBreakdown>[0] })
            .originalParts
        : [];
    if (parts.length === 0) return null;
    return (
      <Text variant="bodySmall" style={{ opacity: 0.6, marginTop: 2 }}>
        from {formatBreakdown(parts)}
      </Text>
    );
  };

  if (loading) {
    return <ActivityIndicator size="small" style={{ marginVertical: 16 }} />;
  }

  if (calmEmpty || personRows.length === 0) {
    return (
      <View style={styles.emptyStateContent} testID="balances-calm-empty">
        <Text
          variant="bodyMedium"
          style={{
            color: theme.colors.onSurfaceVariant,
            textAlign: "center",
          }}
        >
          {calmEmpty || (currentUserId && personRows.length === 0)
            ? "Nothing to balance yet."
            : "No balances yet"}
        </Text>
      </View>
    );
  }

  return (
    <View>
      <Surface
        elevation={0}
        style={[
          styles.summaryStrip,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.outlineVariant,
          },
        ]}
        testID="balances-summary-strip"
      >
        <View style={styles.summaryHalf}>
          <View
            style={[
              styles.summaryIcon,
              { backgroundColor: theme.colors.surfaceVariant },
            ]}
          >
            <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 16 }}>↓$</Text>
          </View>
          <Text
            variant="labelSmall"
            style={{
              color: theme.colors.onSurfaceVariant,
              letterSpacing: 0.6,
              fontWeight: "600",
            }}
          >
            YOU ARE OWED
          </Text>
          <Text
            variant="headlineSmall"
            style={{ color: theme.colors.tertiary, fontWeight: "700" }}
            testID="balances-summary-owed"
          >
            {owedTotal}
          </Text>
        </View>
        <View
          style={[
            styles.summaryDivider,
            { backgroundColor: theme.colors.outlineVariant },
          ]}
        />
        <View style={styles.summaryHalf}>
          <View
            style={[
              styles.summaryIcon,
              { backgroundColor: theme.colors.surfaceVariant },
            ]}
          >
            <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 16 }}>↑$</Text>
          </View>
          <Text
            variant="labelSmall"
            style={{
              color: theme.colors.onSurfaceVariant,
              letterSpacing: 0.6,
              fontWeight: "600",
            }}
          >
            YOU OWE
          </Text>
          <Text
            variant="headlineSmall"
            style={{ color: theme.colors.onSecondaryContainer, fontWeight: "700" }}
            testID="balances-summary-owe"
          >
            {oweTotal}
          </Text>
        </View>
      </Surface>

      <Text
        variant="labelSmall"
        style={[
          styles.balanceGroupTitle,
          { color: theme.colors.onSurfaceVariant, marginTop: 20 },
        ]}
      >
        BALANCES
      </Text>

      <View style={{ gap: DENSE_CARD_GAP }} testID="balances-person-list">
        {personRows.map((balance, index) => {
          const name = getUserDisplayName(balance);
          const polarity = balancePolarityLabel(balance.amount);
          const amountColor = balanceAmountColor(balance.amount, theme.colors, {
            dark: theme.dark,
          });
          const key =
            balance.participant_id ||
            balance.user_id ||
            `${name}-${balance.currency}`;
          const subline = polaritySubline(polarity);

          return (
            <DenseListCard
              key={`${key}-${balance.currency}-${index}`}
              testID={`balance-row-${key}`}
              accessibilityLabel={`${name}, ${formatShareCurrency(Math.abs(balance.amount), balance.currency)} ${polarity}`}
            >
              <PersonAvatar
                name={name}
                uri={getUserAvatar(balance)}
                personKey={key}
                size={36}
              />
              <View style={styles.balanceLeft}>
                <Text variant="bodyLarge" style={{ color: theme.colors.onSurface }}>
                  {name}
                </Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
                  {subline}
                </Text>
              </View>
              <View style={styles.balanceRight}>
                <Text
                  variant="titleSmall"
                  style={{ color: amountColor, fontWeight: "700" }}
                >
                  {formatShareCurrency(Math.abs(balance.amount), balance.currency)}
                  <Text
                    variant="bodySmall"
                    style={{ color: amountColor, fontWeight: "500" }}
                  >
                    {` ${polarity}`}
                  </Text>
                </Text>
                {renderOriginalParts(balance)}
              </View>
            </DenseListCard>
          );
        })}
      </View>
    </View>
  );
};
