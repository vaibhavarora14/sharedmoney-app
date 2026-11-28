import { Balance } from "../types";
import {
  formatUnifiedHeadline,
  unifyBalances,
  type RateBook,
} from "./currencyMerge";
import { formatShareCurrency } from "./settleShareMessage";

export type GroupListBalanceDisplay =
  | { kind: "loading" }
  | { kind: "even" }
  | {
    kind: "amount";
    signedAmount: number;
    headline: string;
    multiCurrency: boolean;
  };

const MATERIAL = 0.01;

/**
 * Same even/amount decision as the Home group-row badge, without rendering.
 * Missing balances after load still read as even (matches GroupBalanceBadge).
 */
export function resolveGroupListBalanceDisplay(input: {
  loading?: boolean;
  balances?: Balance[] | null;
  currentUserId?: string | null;
  unifyEnabled?: boolean;
  settlementCurrency?: string | null;
  rateBook?: RateBook | null;
}): GroupListBalanceDisplay {
  if (input.loading) return { kind: "loading" };
  const balances = input.balances;
  if (!balances || balances.length === 0) return { kind: "even" };

  const displayBalances = input.currentUserId
    ? balances.filter((row) => row.user_id === input.currentUserId)
    : balances;
  const nonZeroBalances = displayBalances.filter((row) => Math.abs(row.amount) >= MATERIAL);
  if (nonZeroBalances.length === 0) return { kind: "even" };

  const netBalancesMap = nonZeroBalances.reduce((acc, row) => {
    acc[row.currency] = (acc[row.currency] || 0) + row.amount;
    return acc;
  }, {} as Record<string, number>);
  const netBalances = Object.entries(netBalancesMap)
    .map(([currency, amount]) => ({ currency, amount }))
    .filter((row) => Math.abs(row.amount) >= MATERIAL);
  if (netBalances.length === 0) return { kind: "even" };

  if (input.unifyEnabled && input.settlementCurrency && input.rateBook) {
    const unified = unifyBalances(
      nonZeroBalances,
      input.settlementCurrency,
      input.rateBook,
    );
    const leftover = unified.leftover.filter((part) => Math.abs(part.original) >= MATERIAL);
    if (Math.abs(unified.amount) < MATERIAL && leftover.length === 0) {
      return { kind: "even" };
    }
    const signedAmount = Math.abs(unified.amount) >= MATERIAL
      ? unified.amount
      : leftover.every((part) => part.original > 0)
        ? 1
        : -1;
    return {
      kind: "amount",
      signedAmount,
      headline: formatUnifiedHeadline(unified),
      multiCurrency: leftover.length > 0,
    };
  }

  netBalances.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const mainBalance = netBalances[0];
  return {
    kind: "amount",
    signedAmount: mainBalance.amount,
    headline: formatShareCurrency(Math.abs(mainBalance.amount), mainBalance.currency),
    multiCurrency: netBalances.length > 1,
  };
}

export type GroupListDenseSubline = "You're owed" | "You owe" | "Settled" | "";

export function groupListDenseSubline(
  display: GroupListBalanceDisplay,
): GroupListDenseSubline {
  switch (display.kind) {
    case "loading":
      return "";
    case "even":
      return "Settled";
    case "amount":
      return display.signedAmount > 0 ? "You're owed" : "You owe";
    default: {
      const _never: never = display;
      return _never;
    }
  }
}

export function groupListDenseAmountText(display: GroupListBalanceDisplay): string {
  switch (display.kind) {
    case "loading":
    case "even":
      return "";
    case "amount":
      return display.multiCurrency ? `${display.headline} (+)` : display.headline;
    default: {
      const _never: never = display;
      return _never;
    }
  }
}

/**
 * Fold rule for Home: after balances resolve, viewer-net-zero groups sit under
 * "Settled · N". Until then every group stays in the open list. A group missing
 * from the balances payload after ready is treated as settled.
 */
export function isViewerGroupSettled(
  balances: Balance[] | undefined,
  currentUserId: string | undefined,
): boolean {
  if (!balances) return true;
  const mine = currentUserId
    ? balances.filter((row) => row.user_id === currentUserId)
    : balances;
  return mine.every((row) => Math.abs(row.amount) < MATERIAL);
}

export function partitionActiveGroupsBySettlement<T extends { id: string }>(
  groups: T[],
  groupBalances: Array<{ group_id: string; balances: Balance[] }> | undefined,
  currentUserId: string | undefined,
  balancesReady: boolean,
): { openGroups: T[]; settledGroups: T[] } {
  if (!balancesReady) {
    return { openGroups: groups, settledGroups: [] };
  }
  const byId = new Map(
    (groupBalances ?? []).map((entry) => [entry.group_id, entry.balances]),
  );
  const openGroups: T[] = [];
  const settledGroups: T[] = [];
  for (const group of groups) {
    if (isViewerGroupSettled(byId.get(group.id), currentUserId)) {
      settledGroups.push(group);
    } else {
      openGroups.push(group);
    }
  }
  return { openGroups, settledGroups };
}
