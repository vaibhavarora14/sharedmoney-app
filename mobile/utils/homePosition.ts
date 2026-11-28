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

/**
 * Viewer total across every group the balances response returned, including
 * hidden direct ledgers. One currency stays one row. Two currencies are not added.
 */
export function viewerOverallBalances(
  groupBalances: ReadonlyArray<{
    balances: ReadonlyArray<{ user_id?: string; amount: number; currency: string }>;
  }>,
  userId?: string,
): Balance[] {
  const totals = new Map<string, number>();
  for (const group of groupBalances) {
    for (const row of group.balances) {
      if (userId && row.user_id !== userId) continue;
      const currency = row.currency.trim().toUpperCase();
      if (!currency || Math.abs(row.amount) < MATERIAL) continue;
      totals.set(currency, (totals.get(currency) ?? 0) + row.amount);
    }
  }
  return [...totals.entries()].map(([currency, amount]) => ({
    user_id: userId ?? "",
    currency,
    amount: Math.round(amount * 100) / 100,
  }));
}

/** Settle hero is the sum of the person rows on screen, direct people included. */
export function settleHeroFromPeople(
  people: ReadonlyArray<{ netsByCurrency: Record<string, number> }>,
): HomePosition {
  const totals = new Map<string, number>();
  let peopleWithNet = 0;
  for (const person of people) {
    const material = Object.entries(person.netsByCurrency).filter(([, amount]) => Math.abs(amount) >= MATERIAL);
    if (material.length === 0) continue;
    peopleWithNet += 1;
    for (const [currency, amount] of material) {
      const code = currency.trim().toUpperCase();
      if (!code) continue;
      totals.set(code, (totals.get(code) ?? 0) + amount);
    }
  }
  return homePosition({
    hasBalances: true,
    overallBalances: [...totals.entries()].map(([currency, amount]) => ({
      user_id: "",
      currency,
      amount: Math.round(amount * 100) / 100,
    })),
    groupsWithBalance: peopleWithNet,
    activeGroupCount: peopleWithNet,
    peopleCount: peopleWithNet,
  });
}

/**
 * Per-currency owed / owe parts from the same viewer rows the net uses.
 * Does not add currencies or change the net. Null when parts cannot share one code.
 */
export function homeDirectionParts(
  groupBalances: ReadonlyArray<{
    balances: ReadonlyArray<{ user_id?: string; amount: number; currency: string }>;
  }>,
  userId?: string,
): { currency: string; owed: number; owe: number } | null {
  const byCurrency = new Map<string, { owed: number; owe: number }>();
  for (const group of groupBalances) {
    for (const row of group.balances) {
      if (userId && row.user_id !== userId) continue;
      const currency = row.currency.trim().toUpperCase();
      if (!currency || Math.abs(row.amount) < MATERIAL) continue;
      const current = byCurrency.get(currency) ?? { owed: 0, owe: 0 };
      if (row.amount > 0) current.owed += row.amount;
      else current.owe += Math.abs(row.amount);
      byCurrency.set(currency, current);
    }
  }
  if (byCurrency.size !== 1) return null;
  const [currency, parts] = [...byCurrency.entries()][0];
  return {
    currency,
    owed: Math.round(parts.owed * 100) / 100,
    owe: Math.round(parts.owe * 100) / 100,
  };
}

/** Quiet both-parts subline when the net hides two directions. */
export function homeBothPartsMutedLine(
  parts: { currency: string; owed: number; owe: number } | null,
): string | null {
  if (!parts) return null;
  if (parts.owed < MATERIAL || parts.owe < MATERIAL) return null;
  return `${formatShareCurrency(parts.owed, parts.currency)} owed to you · ${formatShareCurrency(parts.owe, parts.currency)} you owe`;
}

export function homePosition(input: {
  hasBalances: boolean;
  overallBalances: Balance[];
  groupsWithBalance: number;
  activeGroupCount: number;
  /** Direct people already included in overall_balances. Never summed here. */
  directPeople?: { count: number; name?: string };
  /** Settle tab counts people, not groups. */
  peopleCount?: number;
  /**
   * Optional both-parts subline from per-group viewer amounts.
   * Does not change the net number.
   */
  bothPartsLine?: string | null;
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
    const acrossLine = input.peopleCount && input.peopleCount > 0
      ? (input.peopleCount === 1 ? "Across 1 person" : `Across ${input.peopleCount} people`)
      : homeMutedLine(mutedCount, input.directPeople);
    const bothParts = input.bothPartsLine?.trim() || "";
    const mutedLine = bothParts || acrossLine;
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
