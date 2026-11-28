/**
 * Read-only transaction detail. Amounts and the viewer's line come from the
 * tapped row (original currency). Equal splits name people once; unequal
 * splits keep each amount. A converted expense adds one rate line from the
 * existing rate book.
 */
import type { Participant, Settlement, Transaction, TransactionSplit } from "../types";
import { getDefaultCurrency } from "./currency";
import {
  convertAmount,
  resolveRate,
  roundMoney,
  type RateBook,
} from "./currencyMerge";
import { ledgerDateSectionLabel } from "./ledgerDateSections";
import { resolveLedgerParticipantName, type LedgerNameMember } from "./ledgerNames";
import { formatShareCurrency } from "./settleShareMessage";
import {
  buildExpenseRowModel,
  paymentAmountText,
  paymentInvolvesViewer,
  paymentRowTitle,
} from "./transactionRowImpact";

export type DetailSplitRow = {
  name: string;
  amountText: string;
  isViewer: boolean;
};

export type TransactionDetailModel = {
  title: string;
  amountText: string;
  metaLine: string;
  /** Secondary to the 40px amount. Null when a payment already says it in the title. */
  yourLine: string | null;
  paidBy: string | null;
  paidTo: string | null;
  split:
    | { mode: "equal"; line: string; names: string[] }
    | { mode: "unequal"; people: DetailSplitRow[] }
    | { mode: "none" };
  rateLine: string | null;
  historySummary: string;
  receipts?: import("./expenseReceipts").TransactionReceipt[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDetailStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const hour24 = date.getUTCHours();
  const hour = hour24 % 12 || 12;
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const suffix = hour24 < 12 ? "AM" : "PM";
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}, ${hour}:${minute} ${suffix}`;
}

function metaLine(date: string | null | undefined, category: string | null | undefined, now: Date): string {
  const when = ledgerDateSectionLabel(date, now);
  const label = category?.trim();
  return label ? `${when} · ${label}` : when;
}

function yourLineFromNet(net: number | null, involves: boolean, currency: string): string {
  if (!involves || net == null) return "Not in this split";
  if (Math.abs(net) <= 0.01) return "Even";
  const amount = formatShareCurrency(Math.abs(net), currency);
  return net > 0 ? `You lent ${amount}` : `You borrowed ${amount}`;
}

function nameFor(
  participantId: string | null | undefined,
  userId: string | null | undefined,
  viewerUserId: string | null | undefined,
  participants: Participant[],
  members: LedgerNameMember[],
): string {
  return resolveLedgerParticipantName({
    participantId,
    userId,
    currentUserId: viewerUserId,
    participants,
    members,
  });
}

function isViewerSplit(
  split: TransactionSplit,
  viewerUserId?: string | null,
  viewerParticipantId?: string | null,
): boolean {
  if (viewerParticipantId && split.participant_id === viewerParticipantId) return true;
  if (viewerUserId && split.user_id === viewerUserId) return true;
  return false;
}

export function buildSplitPresentation(
  splits: TransactionSplit[],
  currency: string,
  nameOf: (split: TransactionSplit) => string,
  isViewer: (split: TransactionSplit) => boolean,
): TransactionDetailModel["split"] {
  if (splits.length === 0) return { mode: "none" };
  const people = splits.map((split) => ({
    name: nameOf(split),
    amount: split.amount,
    amountText: formatShareCurrency(Math.abs(split.amount), currency),
    isViewer: isViewer(split),
  }));
  people.sort((a, b) => Number(b.isViewer) - Number(a.isViewer));
  const first = people[0].amount;
  const equal = people.length >= 2 && people.every((person) => Math.abs(person.amount - first) < 0.01);
  if (equal) {
    return {
      mode: "equal",
      line: `Split equally · ${formatShareCurrency(Math.abs(first), currency)} each`,
      names: people.map((person) => person.name),
    };
  }
  return {
    mode: "unequal",
    people: people.map((person) => ({
      name: person.name,
      amountText: person.amountText,
      isViewer: person.isViewer,
    })),
  };
}

function rateLineFor(input: {
  amount: number;
  currency: string;
  unifyEnabled: boolean;
  settlementCurrency?: string | null;
  rateBook?: RateBook | null;
}): string | null {
  if (!input.unifyEnabled || !input.settlementCurrency || !input.rateBook) return null;
  const from = input.currency.toUpperCase();
  const to = input.settlementCurrency.toUpperCase();
  if (from === to) return null;
  const quote = resolveRate(from, to, input.rateBook);
  const converted = convertAmount(input.amount, from, to, input.rateBook);
  if (!quote || converted == null) return null;
  const rateText = quote.rate.toFixed(2);
  return `Converted ${formatShareCurrency(roundMoney(converted, to), to)} at ${rateText}`;
}

function historySummary(addedBy: string | null, createdAt: string | null | undefined): string {
  const stamp = formatDetailStamp(createdAt);
  if (addedBy && stamp) return `Added by ${addedBy} · ${stamp}`;
  if (addedBy) return `Added by ${addedBy}`;
  if (stamp) return stamp;
  return "History";
}

export function buildExpenseDetailModel(input: {
  transaction: Transaction;
  viewerUserId?: string | null;
  viewerParticipantId?: string | null;
  participants?: Participant[];
  members?: LedgerNameMember[];
  now?: Date;
  unifyEnabled?: boolean;
  settlementCurrency?: string | null;
  rateBook?: RateBook | null;
}): TransactionDetailModel {
  const participants = input.participants ?? [];
  const members = input.members ?? [];
  const currency = input.transaction.currency || getDefaultCurrency();
  const payerName = nameFor(
    input.transaction.paid_by_participant_id,
    input.transaction.paid_by,
    input.viewerUserId,
    participants,
    members,
  );
  const row = buildExpenseRowModel({
    amount: input.transaction.amount,
    currency,
    payerName,
    paidByParticipantId: input.transaction.paid_by_participant_id,
    paidByUserId: input.transaction.paid_by,
    splits: input.transaction.splits,
    viewer: {
      userId: input.viewerUserId,
      participantId: input.viewerParticipantId,
    },
  });
  const splits = input.transaction.splits ?? [];
  const creator = participants.find((person) => person.user_id && person.user_id === input.transaction.user_id);
  const addedBy = nameFor(
    creator?.id,
    input.transaction.user_id,
    input.viewerUserId,
    participants,
    members,
  );
  return {
    title: input.transaction.description?.trim() || "Untitled",
    amountText: formatShareCurrency(Math.abs(input.transaction.amount), currency),
    metaLine: metaLine(input.transaction.date, input.transaction.category, input.now ?? new Date()),
    yourLine: yourLineFromNet(row.net, row.involvesViewer, currency),
    paidBy: payerName,
    paidTo: null,
    split: buildSplitPresentation(
      splits,
      currency,
      (split) => nameFor(split.participant_id, split.user_id, input.viewerUserId, participants, members),
      (split) => isViewerSplit(split, input.viewerUserId, input.viewerParticipantId),
    ),
    rateLine: rateLineFor({
      amount: input.transaction.amount,
      currency,
      unifyEnabled: input.unifyEnabled === true,
      settlementCurrency: input.settlementCurrency,
      rateBook: input.rateBook,
    }),
    historySummary: historySummary(
      addedBy === "Unknown" ? null : addedBy,
      input.transaction.created_at,
    ),
    receipts: input.transaction.receipts ?? [],
  };
}

/** Detail holds a snapshot; prefer the live feed row after receipt upload. */
export function resolveExpenseDetailTransaction(
  snapshot: Transaction,
  feed: readonly Transaction[],
): Transaction {
  return feed.find((tx) => tx.id === snapshot.id) ?? snapshot;
}

export function buildPaymentDetailModel(input: {
  settlement: Settlement;
  viewerUserId?: string | null;
  viewerParticipantId?: string | null;
  participants?: Participant[];
  members?: LedgerNameMember[];
  now?: Date;
  unifyEnabled?: boolean;
  settlementCurrency?: string | null;
  rateBook?: RateBook | null;
}): TransactionDetailModel {
  const participants = input.participants ?? [];
  const members = input.members ?? [];
  const currency = input.settlement.currency || getDefaultCurrency();
  const fromName = nameFor(
    input.settlement.from_participant_id,
    input.settlement.from_user_id,
    input.viewerUserId,
    participants,
    members,
  );
  const toName = nameFor(
    input.settlement.to_participant_id,
    input.settlement.to_user_id,
    input.viewerUserId,
    participants,
    members,
  );
  const involves = paymentInvolvesViewer({
    fromParticipantId: input.settlement.from_participant_id,
    fromUserId: input.settlement.from_user_id,
    toParticipantId: input.settlement.to_participant_id,
    toUserId: input.settlement.to_user_id,
    viewer: {
      userId: input.viewerUserId,
      participantId: input.viewerParticipantId,
    },
  });
  return {
    title: paymentRowTitle(fromName, toName),
    amountText: paymentAmountText(input.settlement.amount, currency),
    metaLine: metaLine(input.settlement.created_at, null, input.now ?? new Date()),
    yourLine: involves ? null : "Not in this split",
    paidBy: fromName,
    paidTo: toName,
    split: { mode: "none" },
    rateLine: rateLineFor({
      amount: input.settlement.amount,
      currency,
      unifyEnabled: input.unifyEnabled === true,
      settlementCurrency: input.settlementCurrency,
      rateBook: input.rateBook,
    }),
    historySummary: historySummary(null, input.settlement.created_at),
  };
}
