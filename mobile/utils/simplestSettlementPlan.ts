import type { Balance } from "../types";

const PAISE = 100;

export type SettlementPerson = {
  key: string;
  name: string;
  avatarUrl: string | null;
  userId: string | null;
  participantId: string | null;
};

export type SettlementPayment = {
  key: string;
  from: SettlementPerson;
  to: SettlementPerson;
  amount: number;
  currency: string;
};

export type SettlePlanInvolvement = "pay" | "receive" | "other";

function toPaise(amount: number): number {
  return Math.round(amount * PAISE);
}

function fromPaise(paise: number): number {
  return paise / PAISE;
}

function personFromBalance(balance: Balance, index: number): SettlementPerson {
  const participantId = balance.participant_id || null;
  const userId = balance.user_id || null;
  const key = participantId || userId || `person-${index}`;
  const name = (balance.full_name || balance.email || "Someone").trim() || "Someone";
  return {
    key,
    name,
    avatarUrl: balance.avatar_url || null,
    userId,
    participantId,
  };
}

function isViewer(person: SettlementPerson, userId?: string, participantId?: string): boolean {
  if (userId && person.userId === userId) return true;
  if (participantId && person.participantId === participantId) return true;
  return person.name === "You";
}

/**
 * Minimum payments that clear the group's nets.
 *
 * Amounts are rounded to paise first and the leftover tick is applied to the
 * largest absolute net so the set still sums to zero. Greedy pairing then
 * yields at most n−1 payments for n nonzero people.
 */
export function simplestSettlementPlan(balances: Balance[]): SettlementPayment[] {
  const byCurrency = new Map<string, Balance[]>();
  for (const row of balances) {
    const currency = (row.currency || "").toUpperCase() || "INR";
    const list = byCurrency.get(currency) || [];
    list.push(row);
    byCurrency.set(currency, list);
  }

  const payments: SettlementPayment[] = [];
  for (const [currency, rows] of byCurrency) {
    type Net = { person: SettlementPerson; paise: number };
    const nets: Net[] = rows.map((row, index) => ({
      person: personFromBalance(row, index),
      paise: toPaise(row.amount),
    })).filter((row) => row.paise !== 0);

    const merged = new Map<string, Net>();
    for (const row of nets) {
      const existing = merged.get(row.person.key);
      if (existing) existing.paise += row.paise;
      else merged.set(row.person.key, { ...row, person: { ...row.person } });
    }
    const people = [...merged.values()].filter((row) => row.paise !== 0);

    const sum = people.reduce((total, row) => total + row.paise, 0);
    if (sum !== 0 && people.length > 0) {
      people.sort((a, b) => Math.abs(b.paise) - Math.abs(a.paise));
      people[0].paise -= sum;
    }

    const debtors = people.filter((row) => row.paise < 0).sort((a, b) => a.paise - b.paise);
    const creditors = people.filter((row) => row.paise > 0).sort((a, b) => b.paise - a.paise);

    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const debtor = debtors[i];
      const creditor = creditors[j];
      const paise = Math.min(-debtor.paise, creditor.paise);
      if (paise > 0) {
        payments.push({
          key: `${debtor.person.key}->${creditor.person.key}:${currency}`,
          from: debtor.person,
          to: creditor.person,
          amount: fromPaise(paise),
          currency,
        });
      }
      debtor.paise += paise;
      creditor.paise -= paise;
      if (debtor.paise === 0) i += 1;
      if (creditor.paise === 0) j += 1;
    }
  }
  return payments;
}

export function paymentInvolvement(
  payment: SettlementPayment,
  userId?: string,
  participantId?: string,
): SettlePlanInvolvement {
  const fromMine = isViewer(payment.from, userId, participantId);
  const toMine = isViewer(payment.to, userId, participantId);
  if (fromMine && !toMine) return "pay";
  if (toMine && !fromMine) return "receive";
  return "other";
}

export function partitionSettlePlan(
  payments: SettlementPayment[],
  userId?: string,
  participantId?: string,
): { yours: SettlementPayment[]; others: SettlementPayment[] } {
  const yours: SettlementPayment[] = [];
  const others: SettlementPayment[] = [];
  for (const payment of payments) {
    const involvement = paymentInvolvement(payment, userId, participantId);
    if (involvement === "other") others.push(payment);
    else yours.push(payment);
  }
  yours.sort((a, b) => {
    const aPay = paymentInvolvement(a, userId, participantId) === "pay" ? 0 : 1;
    const bPay = paymentInvolvement(b, userId, participantId) === "pay" ? 0 : 1;
    if (aPay !== bPay) return aPay - bPay;
    return b.amount - a.amount;
  });
  others.sort((a, b) => b.amount - a.amount);
  return { yours, others };
}

export function viewerPlanLine(
  payments: SettlementPayment[],
  userId?: string,
  participantId?: string,
): SettlementPayment | null {
  const { yours } = partitionSettlePlan(payments, userId, participantId);
  return yours[0] ?? null;
}

export function settlePlanActionLabel(involvement: SettlePlanInvolvement): string {
  switch (involvement) {
    case "pay":
      return "Settle";
    case "receive":
      return "Mark received";
    case "other":
      return "Mark as paid";
    default: {
      const _exhaustive: never = involvement;
      return _exhaustive;
    }
  }
}

export type SettlePayMethod = "upi" | "cash" | "already_paid";

export function settlePayMethodLabel(method: SettlePayMethod): string {
  switch (method) {
    case "upi":
      return "UPI";
    case "cash":
      return "Cash";
    case "already_paid":
      return "Already paid";
    default: {
      const _exhaustive: never = method;
      return _exhaustive;
    }
  }
}

export function settlePayMethodNote(method: SettlePayMethod): string {
  switch (method) {
    case "upi":
      return "UPI";
    case "cash":
      return "Cash";
    case "already_paid":
      return "Already paid";
    default: {
      const _exhaustive: never = method;
      return _exhaustive;
    }
  }
}

export function paymentArrowLabel(payment: SettlementPayment): string {
  return `${payment.from.name} → ${payment.to.name}`;
}

export function settlementInputFromPayment(
  groupId: string,
  payment: SettlementPayment,
  notes?: string,
): {
  group_id: string;
  from_participant_id: string;
  to_participant_id: string;
  amount: number;
  currency: string;
  notes?: string;
} | null {
  const fromId = payment.from.participantId;
  const toId = payment.to.participantId;
  if (!fromId || !toId) return null;
  return {
    group_id: groupId,
    from_participant_id: fromId,
    to_participant_id: toId,
    amount: payment.amount,
    currency: payment.currency,
    notes,
  };
}
