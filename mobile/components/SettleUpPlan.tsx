import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Appbar, Text, useTheme } from "react-native-paper";
import { WEB_MAX_WIDTH } from "../constants/layout";
import { DENSE_CARD_GAP } from "../utils/denseListTokens";
import type { SettlementPayment } from "../utils/simplestSettlementPlan";
import {
  partitionSettlePlan,
  paymentInvolvement,
} from "../utils/simplestSettlementPlan";
import { SettlePlanRow } from "./SettlePlanRow";

interface SettleUpPlanProps {
  groupName: string;
  payments: SettlementPayment[];
  currentUserId?: string;
  currentParticipantId?: string;
  tickedKeys?: ReadonlySet<string>;
  recordingKey?: string | null;
  embedded?: boolean;
  onBack: () => void;
  onAction: (payment: SettlementPayment) => void;
}

export const SettleUpPlan: React.FC<SettleUpPlanProps> = ({
  groupName,
  payments,
  currentUserId,
  currentParticipantId,
  tickedKeys,
  recordingKey,
  embedded = false,
  onBack,
  onAction,
}) => {
  const theme = useTheme();
  const { yours, others } = partitionSettlePlan(payments, currentUserId, currentParticipantId);
  const allTicked = payments.length > 0
    && payments.every((payment) => tickedKeys?.has(payment.key));

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]} testID="settle-up-plan">
      {embedded ? null : (
        <Appbar.Header style={{ backgroundColor: theme.colors.background }}>
          <Appbar.BackAction onPress={onBack} />
          <Appbar.Content title="Settle up" titleStyle={{ fontWeight: "bold" }} />
        </Appbar.Header>
      )}
      <ScrollView contentContainerStyle={styles.body}>
        <Text
          variant="titleMedium"
          style={{ color: theme.colors.onSurface, paddingHorizontal: 16, marginBottom: 8 }}
        >
          {groupName}
        </Text>
        {allTicked ? (
          <Text
            variant="bodyMedium"
            testID="settle-up-plan-settled"
            style={{ color: theme.colors.onSurfaceVariant, paddingHorizontal: 16, marginBottom: 12 }}
          >
            Settled
          </Text>
        ) : null}
        {yours.length > 0 ? (
          <View style={styles.list} testID="settle-up-plan-yours">
            {yours.map((payment) => {
              const involvement = paymentInvolvement(payment, currentUserId, currentParticipantId);
              return (
                <SettlePlanRow
                  key={payment.key}
                  payment={payment}
                  involvement={involvement}
                  ticked={tickedKeys?.has(payment.key)}
                  actionPrimary
                  disabled={recordingKey === payment.key}
                  onAction={() => onAction(payment)}
                />
              );
            })}
          </View>
        ) : null}
        {others.length > 0 ? (
          <>
            <Text
              variant="labelSmall"
              style={{
                color: theme.colors.onSurfaceVariant,
                paddingHorizontal: 16,
                marginTop: yours.length > 0 ? 16 : 0,
                marginBottom: 8,
                fontWeight: "600",
                letterSpacing: 0.5,
              }}
            >
              Others
            </Text>
            <View style={styles.list} testID="settle-up-plan-others">
              {others.map((payment) => (
                <SettlePlanRow
                  key={payment.key}
                  payment={payment}
                  involvement="other"
                  ticked={tickedKeys?.has(payment.key)}
                  disabled={recordingKey === payment.key}
                  onAction={() => onAction(payment)}
                />
              ))}
            </View>
          </>
        ) : null}
        {payments.length === 0 ? (
          <Text
            variant="bodyMedium"
            style={{ color: theme.colors.onSurfaceVariant, paddingHorizontal: 16 }}
          >
            This group is settled.
          </Text>
        ) : null}
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
