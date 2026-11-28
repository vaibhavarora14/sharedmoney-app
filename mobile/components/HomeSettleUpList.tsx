import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Appbar, Text, useTheme } from "react-native-paper";
import { WEB_MAX_WIDTH } from "../constants/layout";
import { DENSE_CARD_GAP } from "../utils/denseListTokens";
import { formatShareCurrency, settleFirstName } from "../utils/settleShareMessage";
import type { SettlementPayment } from "../utils/simplestSettlementPlan";
import { DenseListCard } from "./DenseListCard";
import { PersonAvatar } from "./PersonAvatar";

export type HomeSettleGroupRow = {
  groupId: string;
  groupName: string;
  payment: SettlementPayment;
};

interface HomeSettleUpListProps {
  rows: HomeSettleGroupRow[];
  onBack: () => void;
  onOpenGroup: (groupId: string) => void;
}

export const HomeSettleUpList: React.FC<HomeSettleUpListProps> = ({
  rows,
  onBack,
  onOpenGroup,
}) => {
  const theme = useTheme();

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]} testID="home-settle-up-list">
      <Appbar.Header style={{ backgroundColor: theme.colors.background }}>
        <Appbar.BackAction onPress={onBack} />
        <Appbar.Content title="Settle up" titleStyle={{ fontWeight: "bold" }} />
      </Appbar.Header>
      <ScrollView contentContainerStyle={styles.body}>
        {rows.length === 0 ? (
          <Text
            variant="bodyMedium"
            style={{ color: theme.colors.onSurfaceVariant, paddingHorizontal: 16 }}
          >
            No groups need settling.
          </Text>
        ) : (
          <View style={styles.list}>
            {rows.map((row) => {
              const payment = row.payment;
              const title = row.groupName;
              const subline = `${settleFirstName(payment.from.name)} → ${settleFirstName(payment.to.name)}`;
              const amount = formatShareCurrency(payment.amount, payment.currency);
              return (
                <DenseListCard
                  key={row.groupId}
                  testID={`home-settle-group-${row.groupId}`}
                  onPress={() => onOpenGroup(row.groupId)}
                  accessibilityRole="button"
                  accessibilityLabel={`${title}, ${subline}, ${amount}`}
                >
                  <PersonAvatar
                    name={payment.from.name}
                    uri={payment.from.avatarUrl}
                    personKey={payment.from.key}
                  />
                  <PersonAvatar
                    name={payment.to.name}
                    uri={payment.to.avatarUrl}
                    personKey={payment.to.key}
                  />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="titleMedium" numberOfLines={1} style={{ color: theme.colors.onSurface }}>
                      {title}
                    </Text>
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
                      {subline}
                    </Text>
                  </View>
                  <Text variant="titleSmall" style={{ color: theme.colors.onSurface, fontWeight: "700" }}>
                    {amount}
                  </Text>
                </DenseListCard>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: {
    paddingBottom: 48,
    width: "100%",
    maxWidth: WEB_MAX_WIDTH,
    alignSelf: "center",
  },
  list: {
    gap: DENSE_CARD_GAP,
    paddingHorizontal: 16,
  },
});
