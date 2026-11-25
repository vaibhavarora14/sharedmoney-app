/**
 * Per-person balance breakdown. Line items are the expenses and settlements
 * that moved the *displayed* viewer↔person edge, and the total is that edge
 * from `viewerSettlementRows` (the same helper as the group balances list).
 */

import type { Balance, Participant, Settlement, Transaction } from "../types";
import {
  applyExpenseToNets,
  applySettlementToNets,
  buildLedgerCanonicalId,
  emptyLedgerNets,
  ledgerNetsToBalances,
  type LedgerNetParticipant,
} from "./groupLedgerNets";
import { emptyRateBook, type RateBook } from "./currencyMerge";
import { viewerSettlementRows } from "./groupPosition";
import { getDefaultCurrency } from "./currency";

export type BalanceBreakdownKind = "expense" | "settlement";

export type BalanceBreakdownEntry = {
  id: string;
  kind: BalanceBreakdownKind;
  date: string;
  description: string;
  paidByName: string;
  shareLabel: string;
  shareAmount: number;
  effect: number;
  running: number;
  currency: string;
};

export type BalanceBreakdownResult = {
  entries: BalanceBreakdownEntry[];
  total: number;
  currency: string;
};

export type BalanceBreakdownPerson = {
  participantId?: string | null;
  userId?: string | null;
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function parseAmount(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseFloat(value);
  return Number.NaN;
}

function samePerson(
  candidate: { participantId?: string | null; userId?: string | null },
  person: BalanceBreakdownPerson,
): boolean {
  if (
    person.participantId
    && candidate.participantId
    && candidate.participantId === person.participantId
  ) {
    return true;
  }
  if (person.userId && candidate.userId && candidate.userId === person.userId) {
    return true;
  }
  return false;
}

function participantName(
  person: Participant | undefined,
  fallback: string,
): string {
  const full = person?.full_name?.trim();
  if (full) return full;
  const local = person?.email?.split("@")[0];
  if (local) return local;
  return fallback;
}

function findParticipant(
  participants: Participant[],
  id: string | null | undefined,
  canonical: (participantId: string) => string,
): Participant | undefined {
  if (!id) return undefined;
  const key = canonical(id);
  return participants.find((person) => canonical(person.id) === key)
    ?? participants.find((person) => person.id === id);
}

function splitAmountFor(
  expense: Transaction,
  participantId: string,
  canonical: (id: string) => string,
): number {
  const splits = expense.splits ?? [];
  const match = splits.find((split) => (
    split.participant_id && canonical(split.participant_id) === participantId
  ));
  const amount = parseAmount(match?.amount);
  return Number.isFinite(amount) ? amount : 0;
}

function eventStamp(date: string | null | undefined, createdAt: string | null | undefined): string {
  return (date && date.trim()) || (createdAt && createdAt.trim()) || "";
}

/** Calendar stamp for breakdown rows (date-only strings stay on that day). */
export function formatBreakdownDate(raw: string | null | undefined): string {
  if (!raw) return "";
  const dayPart = raw.includes("T") ? raw.slice(0, 10) : raw.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dayPart);
  if (!match) return raw;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return raw;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export function displayedBalanceBetween(input: {
  balances: Balance[];
  viewer: BalanceBreakdownPerson;
  other: BalanceBreakdownPerson;
  currency: string;
  unifyEnabled?: boolean;
  settlementCurrency?: string;
  defaultCurrency?: string;
  rateBook?: RateBook;
}): number {
  const currency = (input.currency || "").toUpperCase();
  const rows = viewerSettlementRows({
    balances: input.balances,
    currentUserId: input.viewer.userId || undefined,
    currentUserParticipantId: input.viewer.participantId || undefined,
    unifyEnabled: input.unifyEnabled === true,
    settlementCurrency: input.settlementCurrency || input.currency,
    defaultCurrency: input.defaultCurrency || getDefaultCurrency(),
    rateBook: input.rateBook ?? emptyRateBook(),
  });
  const row = rows.find((candidate) => (
    samePerson(
      { participantId: candidate.participant_id, userId: candidate.user_id },
      input.other,
    )
    && (candidate.currency || "").toUpperCase() === currency
  ));
  return row?.amount ?? 0;
}

type TimedEvent =
  | { kind: "expense"; sort: string; seq: number; expense: Transaction }
  | { kind: "settlement"; sort: string; seq: number; settlement: Settlement };

/**
 * Replay the group ledger through the existing net + `viewerSettlementRows`
 * pipeline. Each line's running total is the displayed viewer↔person edge
 * after that event, so the last running total is the row amount.
 */
export function buildBalanceBreakdown(input: {
  expenses: Transaction[];
  settlements: Settlement[];
  participants: Participant[];
  viewer: BalanceBreakdownPerson;
  other: BalanceBreakdownPerson;
  currency: string;
  viewerName?: string;
  otherName?: string;
  unifyEnabled?: boolean;
  settlementCurrency?: string;
  defaultCurrency?: string;
  rateBook?: RateBook;
}): BalanceBreakdownResult {
  const currency = (input.currency || input.defaultCurrency || getDefaultCurrency()).toUpperCase();
  const participants: LedgerNetParticipant[] = input.participants.map((person) => ({
    id: person.id,
    user_id: person.user_id,
    email: person.email,
    full_name: person.full_name,
    type: person.type,
  }));
  const canonical = buildLedgerCanonicalId(participants);
  const viewerId = input.viewer.participantId
    ? canonical(input.viewer.participantId)
    : input.participants.find((person) => (
      input.viewer.userId && person.user_id === input.viewer.userId
    ))?.id;
  const otherId = input.other.participantId
    ? canonical(input.other.participantId)
    : input.participants.find((person) => (
      input.other.userId && person.user_id === input.other.userId
    ))?.id;

  const viewerCanonical: BalanceBreakdownPerson = {
    participantId: viewerId || input.viewer.participantId,
    userId: input.viewer.userId,
  };
  const otherCanonical: BalanceBreakdownPerson = {
    participantId: otherId || input.other.participantId,
    userId: input.other.userId,
  };

  const viewerLabel = input.viewerName || "You";
  const otherLabel = input.otherName || participantName(
    findParticipant(input.participants, otherId, canonical),
    "Them",
  );

  const events: TimedEvent[] = [];
  input.expenses.forEach((expense, seq) => {
    if (expense.type && expense.type !== "expense") return;
    events.push({
      kind: "expense",
      sort: eventStamp(expense.date, expense.created_at),
      seq,
      expense,
    });
  });
  input.settlements.forEach((settlement, seq) => {
    events.push({
      kind: "settlement",
      sort: eventStamp(undefined, settlement.created_at),
      seq: 10_000 + seq,
      settlement,
    });
  });
  events.sort((a, b) => {
    if (a.sort !== b.sort) return a.sort.localeCompare(b.sort);
    if (a.kind !== b.kind) return a.kind === "expense" ? -1 : 1;
    return a.seq - b.seq;
  });

  const nets = emptyLedgerNets();
  const entries: BalanceBreakdownEntry[] = [];
  let running = 0;
  const rowOptions = {
    viewer: viewerCanonical,
    other: otherCanonical,
    currency,
    unifyEnabled: input.unifyEnabled === true,
    settlementCurrency: input.settlementCurrency || currency,
    defaultCurrency: input.defaultCurrency || getDefaultCurrency(),
    rateBook: input.rateBook ?? emptyRateBook(),
  };

  for (const event of events) {
    switch (event.kind) {
      case "expense":
        applyExpenseToNets(nets, event.expense, canonical);
        break;
      case "settlement":
        applySettlementToNets(nets, event.settlement, canonical);
        break;
      default: {
        const _exhaustive: never = event;
        throw new Error(`Unhandled breakdown event: ${_exhaustive}`);
      }
    }

    const balances = ledgerNetsToBalances(nets, participants, canonical);
    const next = displayedBalanceBetween({
      balances: balances as Balance[],
      ...rowOptions,
    });
    const effect = Math.round((next - running) * 100) / 100;
    if (Math.abs(effect) < 0.005) {
      running = next;
      continue;
    }

    if (event.kind === "expense") {
      const expense = event.expense;
      const payerId = expense.paid_by_participant_id
        ? canonical(expense.paid_by_participant_id)
        : "";
      const payer = findParticipant(input.participants, payerId, canonical);
      const payerIsViewer = viewerId ? payerId === viewerId : false;
      const payerIsOther = otherId ? payerId === otherId : false;
      const paidByName = payerIsViewer
        ? viewerLabel
        : participantName(payer, "Someone");
      const otherShare = otherId ? splitAmountFor(expense, otherId, canonical) : 0;
      const viewerShare = viewerId ? splitAmountFor(expense, viewerId, canonical) : 0;
      const shareAmount = payerIsViewer
        ? otherShare
        : payerIsOther
          ? viewerShare
          : otherShare;
      const shareLabel = payerIsViewer
        ? `${otherLabel}'s share`
        : payerIsOther
          ? "Your share"
          : `${otherLabel}'s share`;
      entries.push({
        id: `expense-${expense.id}`,
        kind: "expense",
        date: formatBreakdownDate(expense.date || expense.created_at),
        description: expense.description?.trim() || "Expense",
        paidByName,
        shareLabel,
        shareAmount,
        effect,
        running: next,
        currency,
      });
    } else {
      const settlement = event.settlement;
      const fromId = settlement.from_participant_id
        ? canonical(settlement.from_participant_id)
        : "";
      const fromIsViewer = viewerId ? fromId === viewerId : false;
      const from = findParticipant(input.participants, fromId, canonical);
      const paidByName = fromIsViewer
        ? viewerLabel
        : participantName(from, "Someone");
      const amount = parseAmount(settlement.amount);
      entries.push({
        id: `settlement-${settlement.id}`,
        kind: "settlement",
        date: formatBreakdownDate(settlement.created_at),
        description: settlement.notes?.trim() || "Payment",
        paidByName,
        shareLabel: "Payment",
        shareAmount: Number.isFinite(amount) ? amount : 0,
        effect,
        running: next,
        currency,
      });
    }
    running = next;
  }

  return {
    entries,
    total: running,
    currency,
  };
}
