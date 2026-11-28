import type { Balance } from "../types";
import {
  simplestSettlementPlan,
  viewerPlanLine,
  type SettlementPayment,
} from "./simplestSettlementPlan";

export type HomeSettleGroupInput = {
  groupId: string;
  groupName: string;
  balances: Balance[];
};

export type HomeSettleGroupPlan = {
  groupId: string;
  groupName: string;
  payment: SettlementPayment;
  payments: SettlementPayment[];
};

export function homeSettleGroups(
  groups: HomeSettleGroupInput[],
  userId?: string,
  participantId?: string,
): HomeSettleGroupPlan[] {
  const rows: HomeSettleGroupPlan[] = [];
  for (const group of groups) {
    const payments = simplestSettlementPlan(group.balances);
    const payment = viewerPlanLine(payments, userId, participantId);
    if (!payment) continue;
    rows.push({
      groupId: group.groupId,
      groupName: group.groupName,
      payment,
      payments,
    });
  }
  return rows;
}
