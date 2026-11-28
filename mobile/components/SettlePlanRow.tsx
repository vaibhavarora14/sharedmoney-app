import React from "react";
import { View } from "react-native";
import { Button, Icon, Text, useTheme } from "react-native-paper";
import type { SettlementPayment, SettlePlanInvolvement } from "../utils/simplestSettlementPlan";
import {
  paymentArrowLabel,
  settlePlanActionLabel,
} from "../utils/simplestSettlementPlan";
import { formatShareCurrency, settleFirstName } from "../utils/settleShareMessage";
import { PersonAvatar } from "./PersonAvatar";
import { DenseListCard } from "./DenseListCard";

interface SettlePlanRowProps {
  payment: SettlementPayment;
  involvement: SettlePlanInvolvement;
  ticked?: boolean;
  actionPrimary?: boolean;
  onAction?: () => void;
  disabled?: boolean;
}

export const SettlePlanRow: React.FC<SettlePlanRowProps> = ({
  payment,
  involvement,
  ticked = false,
  actionPrimary = false,
  onAction,
  disabled = false,
}) => {
  const theme = useTheme();
  const fromLabel = settleFirstName(payment.from.name);
  const toLabel = settleFirstName(payment.to.name);
  const title = `${fromLabel} → ${toLabel}`;
  const amount = formatShareCurrency(payment.amount, payment.currency);
  const action = settlePlanActionLabel(involvement);

  return (
    <DenseListCard
      testID={`settle-plan-row-${payment.key}`}
      accessibilityLabel={ticked ? `${title}, ${amount}, done` : `${title}, ${amount}, ${action}`}
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
        <Text
          variant="titleMedium"
          numberOfLines={1}
          style={{ color: theme.colors.onSurface }}
        >
          {title}
        </Text>
        <Text
          variant="bodySmall"
          style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}
        >
          {amount}
        </Text>
      </View>
      {ticked ? (
        <Icon source="check-circle" size={24} color={theme.colors.tertiary} />
      ) : onAction ? (
        <Button
          mode={actionPrimary ? "contained" : "text"}
          compact
          onPress={onAction}
          disabled={disabled}
          testID={`settle-plan-action-${payment.key}`}
          accessibilityLabel={action}
          contentStyle={{ minHeight: 36 }}
        >
          {action}
        </Button>
      ) : null}
    </DenseListCard>
  );
};

export function settlePlanRowTitle(payment: SettlementPayment): string {
  return paymentArrowLabel(payment);
}
