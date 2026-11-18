import type { Group, GroupBalance, GroupLastActivity } from "../types";
import { directActivitySubtitle } from "./groupRecency";
import type { GroupSettlementLine, PersonSettlement } from "./peopleSettlements";
import { formatShareCurrency, settleFirstName } from "./settleShareMessage";

const MATERIAL = 0.01;

export type QuickSettleDirection = "you_paid" | "they_paid" | "they_owe" | "you_owe";
export type QuickSettleMode = "payment" | "debt";

export type QuickSettleShare =
  | { kind: "text"; message: string }
  | { kind: "link"; url: string; message: string };

/**
 * Guest sessions from #524. This does not import that work.
 * Anonymous Supabase users and an explicit guest flag both count.
 */
export function isGuestAccount(user: {
  is_anonymous?: boolean;
  app_metadata?: { guest?: boolean; provider?: string } | null;
} | null | undefined): boolean {
  if (!user) return false;
  if (user.is_anonymous === true) return true;
  if (user.app_metadata?.guest === true) return true;
  if (user.app_metadata?.provider === "guest") return true;
  return false;
}

export function isDirectGroup(group: { kind?: string | null }): boolean {
  return group.kind === "direct";
}

export function localIsoDate(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function isFutureLocalDate(date: string, now = new Date()): boolean {
  return date > localIsoDate(now);
}

export function normalizeCurrencyCode(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/**
 * Profile currency, then the one currency already used with this person.
 * No history and no profile currency means the user has to pick. Never invent one.
 */
export function resolveQuickSettleCurrency(input: {
  preferredCurrency: string | null | undefined;
  currenciesWithPerson: readonly string[];
}): { currency: string | null; prefilled: boolean } {
  const preferred = normalizeCurrencyCode(input.preferredCurrency);
  if (preferred) return { currency: preferred, prefilled: true };
  const codes = [...new Set(
    input.currenciesWithPerson
      .map((code) => normalizeCurrencyCode(code))
      .filter((code): code is string => !!code),
  )];
  if (codes.length === 1) return { currency: codes[0], prefilled: true };
  return { currency: null, prefilled: false };
}

export function viewerBalanceDelta(direction: QuickSettleDirection, amount: number): number {
  if (direction === "you_paid" || direction === "they_owe") return amount;
  return -amount;
}

export function quickSettleMode(direction: QuickSettleDirection): QuickSettleMode {
  return direction === "you_paid" || direction === "they_paid" ? "payment" : "debt";
}

/** Payment: settlement from the payer. Debt: expense paid by the creditor, 100% on the debtor. */
export function quickSettleParties(input: {
  direction: QuickSettleDirection;
  youParticipantId: string;
  themParticipantId: string;
}): { payerParticipantId: string; debtorParticipantId: string } {
  const youPaid = input.direction === "you_paid" || input.direction === "they_owe";
  return youPaid
    ? { payerParticipantId: input.youParticipantId, debtorParticipantId: input.themParticipantId }
    : { payerParticipantId: input.themParticipantId, debtorParticipantId: input.youParticipantId };
}

export function quickSettleSuccessCopy(input: {
  name: string;
  direction: QuickSettleDirection;
  amount: number;
  currency: string;
  /** Signed direct balance before this record. Positive means they already owe you. */
  previousDirectBalance: number;
}): { title: string; body: string } {
  const money = formatShareCurrency(input.amount, input.currency);
  const name = input.name.trim() || "them";
  const title = input.direction === "you_paid"
    ? `You paid ${name} ${money}`
    : input.direction === "they_paid"
      ? `${name} paid you ${money}`
      : input.direction === "they_owe"
        ? `${name} owes you ${money}`
        : `You owe ${name} ${money}`;

  const next = input.previousDirectBalance + viewerBalanceDelta(input.direction, input.amount);
  const nextMoney = formatShareCurrency(Math.abs(next), input.currency);
  let body: string;
  if (Math.abs(next) < MATERIAL) {
    body = `You're even with ${name}`;
  } else if (next > 0) {
    body = input.previousDirectBalance < -MATERIAL
      ? `Now ${name} owes you ${nextMoney}`
      : `${name} owes you ${nextMoney}`;
  } else {
    body = input.previousDirectBalance > MATERIAL
      ? `Now you owe ${name} ${nextMoney}`
      : `You owe ${name} ${nextMoney}`;
  }
  return { title, body };
}

/**
 * Plain-text share for v1. #325 swaps this to `{ kind: "link" }` without
 * changing the success sheet's call site.
 */
export function quickSettleSharePayload(input: {
  counterpartyName: string;
  theyOweYou: boolean;
  amount: number;
  currency: string;
  note?: string | null;
}): QuickSettleShare {
  const name = settleFirstName(input.counterpartyName);
  const money = formatShareCurrency(Math.abs(input.amount), input.currency);
  const line = input.theyOweYou
    ? `${name}, you owe ${money}.`
    : `${name}, I owe you ${money}.`;
  const note = input.note?.trim();
  return { kind: "text", message: note ? `${line}\n${note}` : line };
}

function materialNets(nets: Record<string, number>): [string, number][] {
  return Object.entries(nets).filter(([, amount]) => Math.abs(amount) >= MATERIAL);
}

export function personListLabel(person: Pick<PersonSettlement, "lines">): string {
  const labels = [...new Set(person.lines.map((line) => (
    line.kind === "direct" ? "Direct" : line.groupName
  )))];
  return labels.join(" · ");
}

export function quickSettlePickerPeople(
  people: readonly PersonSettlement[],
  query: string,
): PersonSettlement[] {
  const needle = query.trim().toLocaleLowerCase();
  const matched = people.filter((person) => {
    if (!needle) return true;
    return person.displayName.toLocaleLowerCase().includes(needle)
      || (person.email ?? "").toLocaleLowerCase().includes(needle);
  });
  const visible = needle
    ? matched
    : matched.filter((person) => materialNets(person.netsByCurrency).length > 0);
  return [...visible].sort((left, right) => {
    const leftNet = materialNets(left.netsByCurrency).reduce((sum, [, amount]) => sum + Math.abs(amount), 0);
    const rightNet = materialNets(right.netsByCurrency).reduce((sum, [, amount]) => sum + Math.abs(amount), 0);
    return rightNet - leftNet;
  });
}

export type GroupDebtOffer = {
  headline: string;
  lines: GroupSettlementLine[];
  net: number;
  currency: string | null;
  canSum: boolean;
};

export function groupDebtOffer(person: PersonSettlement): GroupDebtOffer | null {
  const lines = person.lines.filter((line) => line.kind !== "direct" && line.amount >= MATERIAL);
  if (lines.length === 0) return null;
  const currencies = [...new Set(lines.map((line) => line.currency.toUpperCase()))];
  const canSum = currencies.length === 1;
  const currency = canSum ? currencies[0] : null;
  const net = canSum ? lines.reduce((sum, line) => sum + line.signedAmount, 0) : 0;
  const groups = new Set(lines.map((line) => line.groupId)).size;
  const groupWord = groups === 1 ? "group" : "groups";
  const name = person.displayName;
  let headline = `${name} has open balances across ${groups} ${groupWord}`;
  if (canSum && currency && net > MATERIAL) {
    headline = `${name} owes you ${formatShareCurrency(net, currency)} across ${groups} ${groupWord}`;
  } else if (canSum && currency && net < -MATERIAL) {
    headline = `You owe ${name} ${formatShareCurrency(Math.abs(net), currency)} across ${groups} ${groupWord}`;
  } else if (canSum && Math.abs(net) < MATERIAL) {
    headline = `${name} is even across ${groups} ${groupWord}`;
  }
  return { headline, lines, net, currency, canSum };
}

export type DirectBalanceTone = "owed" | "owe" | "even" | "mixed";

export type DirectHomeRow = {
  kind: "person" | "grouped";
  groupIds: string[];
  title: string;
  name: string;
  count: number;
  subtitle: string | null;
  amount: number | null;
  currency: string | null;
  tone: DirectBalanceTone;
};

function viewerAmounts(
  balances: GroupBalance["balances"],
  userId: string | undefined,
): { currency: string; amount: number }[] {
  const mine = userId ? balances.filter((row) => row.user_id === userId) : balances;
  return mine
    .filter((row) => Math.abs(row.amount) >= MATERIAL && row.currency.trim().length > 0)
    .map((row) => ({ currency: row.currency.toUpperCase(), amount: row.amount }));
}

function toneOf(amounts: { currency: string; amount: number }[]): {
  tone: DirectBalanceTone;
  amount: number | null;
  currency: string | null;
} {
  if (amounts.length === 0) return { tone: "even", amount: null, currency: null };
  const currencies = new Set(amounts.map((row) => row.currency));
  if (currencies.size > 1) return { tone: "mixed", amount: null, currency: null };
  const amount = amounts.reduce((sum, row) => sum + row.amount, 0);
  if (Math.abs(amount) < MATERIAL) return { tone: "even", amount: 0, currency: amounts[0].currency };
  return {
    tone: amount > 0 ? "owed" : "owe",
    amount,
    currency: amounts[0].currency,
  };
}

export function buildDirectHomeRows(input: {
  groups: readonly Group[];
  groupBalances: readonly GroupBalance[];
  userId?: string;
  now?: Date;
}): DirectHomeRow[] {
  const now = input.now ?? new Date();
  const balancesByGroup = new Map(input.groupBalances.map((group) => [group.group_id, group]));
  const people = input.groups
    .filter((group) => isDirectGroup(group) && group.user_status !== "left" && !group.hidden_at)
    .map((group) => {
      const balance = toneOf(viewerAmounts(balancesByGroup.get(group.id)?.balances ?? [], input.userId));
      const name = group.name.trim() || "Someone";
      return {
        group,
        name,
        ...balance,
        subtitle: directActivitySubtitle(group.last_activity, now),
      };
    })
    .filter((row) => row.tone !== "even");

  people.sort((left, right) => Math.abs(right.amount ?? 0) - Math.abs(left.amount ?? 0));
  if (people.length === 0) return [];

  if (people.length <= 3) {
    return people.map((row) => ({
      kind: "person" as const,
      groupIds: [row.group.id],
      title: `Direct · ${row.name}`,
      name: row.name,
      count: 1,
      subtitle: row.subtitle,
      amount: row.amount,
      currency: row.currency,
      tone: row.tone,
    }));
  }

  const combined = toneOf(people.flatMap((row) => (
    row.currency && row.amount != null ? [{ currency: row.currency, amount: row.amount }] : []
  )));
  const anyMixed = people.some((row) => row.tone === "mixed") || combined.tone === "mixed";
  return [{
    kind: "grouped",
    groupIds: people.map((row) => row.group.id),
    title: `Direct · ${people.length} people`,
    name: "",
    count: people.length,
    subtitle: null,
    amount: anyMixed ? null : combined.amount,
    currency: anyMixed ? null : combined.currency,
    tone: anyMixed ? "mixed" : combined.tone,
  }];
}

export function directPeopleForHome(rows: readonly DirectHomeRow[]): { count: number; name?: string } {
  if (rows.length === 0) return { count: 0 };
  if (rows.length === 1 && rows[0].kind === "person") {
    return { count: 1, name: rows[0].name };
  }
  const count = rows.length === 1 && rows[0].kind === "grouped" ? rows[0].count : rows.length;
  return { count };
}

export function directRecentTitle(name: string, activity: GroupLastActivity): string {
  if (activity.action === "settled") {
    if (activity.viewerPaid === true) return `You paid ${name}`;
    if (activity.viewerPaid === false) return `${name} paid you`;
    return `You settled with ${name}`;
  }
  if (activity.actor === "You" && activity.subject) return `You added ${activity.subject}`;
  return `${activity.actor} ${activity.action}`;
}

export function newPersonNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
