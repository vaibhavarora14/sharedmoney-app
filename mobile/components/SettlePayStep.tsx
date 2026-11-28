import React from "react";
import { StyleSheet, View } from "react-native";
import { Appbar, Text, useTheme } from "react-native-paper";
import { WEB_MAX_WIDTH } from "../constants/layout";
import { DENSE_CARD_GAP } from "../utils/denseListTokens";
import { formatShareCurrency, settleFirstName } from "../utils/settleShareMessage";
import type { SettlementPayment, SettlePayMethod } from "../utils/simplestSettlementPlan";
import { settlePayMethodLabel } from "../utils/simplestSettlementPlan";
import { DenseListCard } from "./DenseListCard";
import { PersonAvatar } from "./PersonAvatar";

interface SettlePayStepProps {
  payment: SettlementPayment;
  busy?: boolean;
  onBack: () => void;
  onChoose: (method: SettlePayMethod) => void;
}

const METHODS: SettlePayMethod[] = ["upi", "cash", "already_paid"];

function methodSubline(method: SettlePayMethod): string {
  switch (method) {
    case "upi":
      return "Open your UPI app";
    case "cash":
      return "Record a cash payment";
    case "already_paid":
      return "Log a payment already made";
    default: {
      const _exhaustive: never = method;
      return _exhaustive;
    }
  }
}

export const SettlePayStep: React.FC<SettlePayStepProps> = ({
  payment,
  busy = false,
  onBack,
  onChoose,
}) => {
  const theme = useTheme();
  const title = `${settleFirstName(payment.from.name)} → ${settleFirstName(payment.to.name)}`;
  const amount = formatShareCurrency(payment.amount, payment.currency);

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]} testID="settle-pay-step">
      <Appbar.Header style={{ backgroundColor: theme.colors.background }}>
        <Appbar.BackAction onPress={onBack} />
        <Appbar.Content title="Pay" titleStyle={{ fontWeight: "bold" }} />
      </Appbar.Header>
      <View style={styles.body}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, marginBottom: 16 }}>
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
            <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>{title}</Text>
            <Text variant="headlineSmall" style={{ color: theme.colors.onSurface, fontWeight: "700" }}>
              {amount}
            </Text>
          </View>
        </View>
        <View style={styles.list}>
          {METHODS.map((method) => (
            <DenseListCard
              key={method}
              testID={`settle-pay-method-${method}`}
              onPress={() => onChoose(method)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={settlePayMethodLabel(method)}
            >
              <View style={{ flex: 1 }}>
                <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>
                  {settlePayMethodLabel(method)}
                </Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
                  {methodSubline(method)}
                </Text>
              </View>
            </DenseListCard>
          ))}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: {
    width: "100%",
    maxWidth: WEB_MAX_WIDTH,
    alignSelf: "center",
  },
  list: {
    gap: DENSE_CARD_GAP,
    paddingHorizontal: 16,
  },
});
