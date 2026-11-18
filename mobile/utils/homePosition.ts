/**
 * Home position from `GET /balances` `overall_balances`.
 *
 * The balances API already sums the viewer per currency. This helper displays
 * that one row when it is the only row. It does not add rows together, convert
 * currencies, or pick a currency when the response has none.
 */
import type { Balance } from "../types";
import { formatShareCurrency } from "./settleShareMessage";

const MATERIAL = 0.01;

export type HomePositionLabel = "You're owed" | "You owe" | "You're even";

export type HomePosition =
  | { kind: "unknown" }
  | {
      kind: "amount";
      label: HomePositionLabel;
      /**
       * The single overall_balances figure. Absent when that response is empty:
       * even has a label and a muted line, and no number in any currency.
       */
      numberText?: string;
      mutedLine: string;
    }
  | {
      kind: "split";
      /** Second currency, or that the rows do not combine. No number. */
      mutedLine: string;
    };

export function countGroupsWithViewerBalance(
  groupBalances: Array<{ group_id: string; balances: Array<{ user_id?: string; amount: number }> }>,
  activeGroupIds: readonly string[],
  userId?: string,
): number {
  const active = new Set(activeGroupIds);
  let count = 0;
  for (const group of groupBalances) {
    if (!active.has(group.group_id)) continue;
    const mine = userId
      ? group.balances.filter((row) => row.user_id === userId)
      : group.balances;
    if (mine.some((row) => Math.abs(row.amount) >= MATERIAL)) count += 1;
  }
  return count;
}

function acrossLine(count: number): string {
  const n = count > 0 ? count : 1;
  return n === 1 ? "Across 1 group" : `Across ${n} groups`;
}

export function homeMutedLine(
  groupCount: number,
  direct?: { count: number; name?: string },
): string {
  const people = direct?.count ?? 0;
  if (people <= 0) return acrossLine(groupCount);
  if (groupCount <= 0) {
    if (people === 1 && direct?.name) return `With ${direct.name}`;
    return people === 1 ? "Across 1 person" : `Across ${people} people`;
  }
  const base = acrossLine(groupCount);
  if (people === 1 && direct?.name) return `${base} and ${direct.name}`;
  return `${base} and ${people} people`;
}

function splitLine(rows: Balance[]): string {
  const first = rows[0]?.currency?.toUpperCase() ?? "";
  const second = rows.find((row) => row.currency.toUpperCase() !== first);
  if (second) return `Also ${second.currency.toUpperCase()} · they don’t combine`;
  return "They don’t combine";
}

export function homePosition(input: {
  hasBalances: boolean;
  overallBalances: Balance[];
  groupsWithBalance: number;
  activeGroupCount: number;
  /** Direct people already included in overall_balances. Never summed here. */
  directPeople?: { count: number; name?: string };
}): HomePosition {
  if (!input.hasBalances) return { kind: "unknown" };

  const rows = input.overallBalances.filter((row) => row.currency.trim().length > 0);
  if (rows.length >= 2) {
    return { kind: "split", mutedLine: splitLine(rows) };
  }

  if (rows.length === 1) {
    const row = rows[0];
    const amount = row.amount;
    const mutedCount = Math.abs(amount) >= MATERIAL
      ? input.groupsWithBalance
      : input.activeGroupCount;
    const mutedLine = homeMutedLine(mutedCount, input.directPeople);
    if (amount > MATERIAL) {
      return {
        kind: "amount",
        label: "You're owed",
        numberText: formatShareCurrency(amount, row.currency),
        mutedLine,
      };
    }
    if (amount < -MATERIAL) {
      return {
        kind: "amount",
        label: "You owe",
        numberText: formatShareCurrency(Math.abs(amount), row.currency),
        mutedLine,
      };
    }
    return {
      kind: "amount",
      label: "You're even",
      numberText: formatShareCurrency(0, row.currency),
      mutedLine: homeMutedLine(input.activeGroupCount, input.directPeople),
    };
  }

  return {
    kind: "amount",
    label: "You're even",
    mutedLine: homeMutedLine(input.activeGroupCount, input.directPeople),
  };
}
