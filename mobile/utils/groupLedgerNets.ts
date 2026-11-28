/**
 * Group net balances from a ledger of expenses and settlements.
 *
 * This is the same update rule as `calculateGroupBalancesFromLedger` in
 * `supabase/functions/balances/index.ts`: each payer is credited their paid
 * amount, each split is debited its share, and a settlement credits the
 * payer and debits the payee. Do not add a second formula here.
 */

export type LedgerNetSplit = {
  participant_id?: string | null;
  amount: number | string;
};

export type LedgerNetExpense = {
  amount: number | string;
  currency?: string | null;
  paid_by_participant_id?: string | null;
  payers?: LedgerNetSplit[] | null;
  transaction_payers?: LedgerNetSplit[] | null;
  splits?: LedgerNetSplit[] | null;
  transaction_splits?: LedgerNetSplit[] | null;
  type?: string | null;
};

export type LedgerNetSettlement = {
  from_participant_id?: string | null;
  to_participant_id?: string | null;
  amount: number | string;
  currency?: string | null;
};

export type LedgerNetParticipant = {
  id: string;
  user_id?: string | null;
  email?: string | null;
  full_name?: string | null;
  type?: string | null;
};

export type LedgerNetBalance = {
  user_id: string;
  participant_id: string;
  email?: string;
  full_name?: string | null;
  amount: number;
  currency: string;
};

function parseAmount(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseFloat(value);
  return Number.NaN;
}

function typeRank(type: string | null | undefined): number {
  if (type === "member") return 2;
  if (type === "former") return 1;
  return 0;
}

function normEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

/**
 * Map invited (or duplicate) participant ids onto the canonical member row
 * for the same email / user, matching the balances edge function.
 */
export function buildLedgerCanonicalId(
  participants: LedgerNetParticipant[],
): (participantId: string) => string {
  const emailBest = new Map<string, { id: string; rank: number }>();
  const userBest = new Map<string, { id: string; rank: number }>();

  for (const person of participants) {
    const rank = typeRank(person.type);
    const email = normEmail(person.email);
    if (email) {
      const current = emailBest.get(email);
      if (!current || rank > current.rank) emailBest.set(email, { id: person.id, rank });
    }
    if (person.user_id) {
      const current = userBest.get(person.user_id);
      if (!current || rank > current.rank) {
        userBest.set(person.user_id, { id: person.id, rank });
      }
    }
  }

  const remap = new Map<string, string>();
  for (const person of participants) {
    const email = normEmail(person.email);
    const byEmail = email ? emailBest.get(email) : undefined;
    const byUser = person.user_id ? userBest.get(person.user_id) : undefined;
    const target = (byUser && byUser.rank >= (byEmail?.rank ?? -1) ? byUser : byEmail)
      ?? byUser
      ?? byEmail;
    if (target && target.id !== person.id) remap.set(person.id, target.id);
  }

  return (participantId: string) => remap.get(participantId) ?? participantId;
}

function updateBalance(
  nets: Map<string, Map<string, number>>,
  key: string,
  currency: string,
  amount: number,
) {
  if (!nets.has(key)) nets.set(key, new Map());
  const byCurrency = nets.get(key)!;
  byCurrency.set(currency, (byCurrency.get(currency) || 0) + amount);
}

function expenseSplits(expense: LedgerNetExpense): LedgerNetSplit[] {
  if (Array.isArray(expense.splits) && expense.splits.length > 0) {
    return expense.splits;
  }
  if (Array.isArray(expense.transaction_splits)) {
    return expense.transaction_splits;
  }
  return [];
}

function expensePayers(expense: LedgerNetExpense): LedgerNetSplit[] {
  if (Array.isArray(expense.payers) && expense.payers.length > 0) {
    return expense.payers;
  }
  if (Array.isArray(expense.transaction_payers) && expense.transaction_payers.length > 0) {
    return expense.transaction_payers;
  }
  if (expense.paid_by_participant_id) {
    return [{ participant_id: expense.paid_by_participant_id, amount: expense.amount }];
  }
  return [];
}

/**
 * Apply one expense using the balances edge-function rule.
 * Deleted expenses are simply absent from the input list.
 */
export function applyExpenseToNets(
  nets: Map<string, Map<string, number>>,
  expense: LedgerNetExpense,
  canonical: (participantId: string) => string,
) {
  if (expense.type && expense.type !== "expense") return;
  const currency = (expense.currency || "").trim() || "USD";

  const payers = expensePayers(expense)
    .map((payer) => {
      const amount = parseAmount(payer.amount);
      if (!payer.participant_id || !Number.isFinite(amount)) return undefined;
      return { pid: canonical(payer.participant_id), amount };
    })
    .filter((payer): payer is { pid: string; amount: number } => !!payer);

  const splits = expenseSplits(expense)
    .map((split) => {
      const amount = parseAmount(split.amount);
      if (!split.participant_id || !Number.isFinite(amount)) return undefined;
      return { pid: canonical(split.participant_id), amount };
    })
    .filter((split): split is { pid: string; amount: number } => !!split);

  if (payers.length === 0 || splits.length === 0) return;

  for (const payer of payers) {
    updateBalance(nets, payer.pid, currency, payer.amount);
  }
  for (const split of splits) {
    updateBalance(nets, split.pid, currency, -split.amount);
  }
}

/** Apply one settlement using the balances edge-function rule. */
export function applySettlementToNets(
  nets: Map<string, Map<string, number>>,
  settlement: LedgerNetSettlement,
  canonical: (participantId: string) => string,
) {
  const fromKey = settlement.from_participant_id
    ? canonical(settlement.from_participant_id)
    : null;
  const toKey = settlement.to_participant_id
    ? canonical(settlement.to_participant_id)
    : null;
  if (!fromKey || !toKey) return;

  const amount = parseAmount(settlement.amount);
  const currency = (settlement.currency || "").trim() || "USD";
  if (!Number.isFinite(amount) || amount <= 0) return;

  updateBalance(nets, fromKey, currency, amount);
  updateBalance(nets, toKey, currency, -amount);
}

export function emptyLedgerNets(): Map<string, Map<string, number>> {
  return new Map();
}

export function cloneLedgerNets(
  nets: Map<string, Map<string, number>>,
): Map<string, Map<string, number>> {
  const clone = new Map<string, Map<string, number>>();
  for (const [key, currencies] of nets) {
    clone.set(key, new Map(currencies));
  }
  return clone;
}

/**
 * Convert running nets into the Balance[] shape `viewerSettlementRows` already
 * consumes. Rounding matches the balances edge function (`Math.round(x * 100) / 100`).
 */
export function ledgerNetsToBalances(
  nets: Map<string, Map<string, number>>,
  participants: LedgerNetParticipant[],
  canonical: (participantId: string) => string,
): LedgerNetBalance[] {
  const byCanonical = new Map<string, LedgerNetParticipant>();
  for (const person of participants) {
    const key = canonical(person.id);
    const existing = byCanonical.get(key);
    if (!existing || typeRank(person.type) > typeRank(existing.type)) {
      byCanonical.set(key, person);
    }
  }

  const balances: LedgerNetBalance[] = [];
  for (const [key, currencies] of nets) {
    const person = byCanonical.get(key);
    for (const [currency, amount] of currencies) {
      const rounded = Math.round(amount * 100) / 100;
      if (Math.abs(rounded) <= 0.01) continue;
      balances.push({
        user_id: person?.user_id || "",
        participant_id: key,
        email: person?.email || undefined,
        full_name: person?.full_name || null,
        amount: rounded,
        currency,
      });
    }
  }
  return balances;
}

export function calculateGroupNetsFromLedger(input: {
  expenses: LedgerNetExpense[];
  settlements: LedgerNetSettlement[];
  participants: LedgerNetParticipant[];
}): LedgerNetBalance[] {
  const canonical = buildLedgerCanonicalId(input.participants);
  const nets = emptyLedgerNets();
  for (const expense of input.expenses) {
    applyExpenseToNets(nets, expense, canonical);
  }
  for (const settlement of input.settlements) {
    applySettlementToNets(nets, settlement, canonical);
  }
  return ledgerNetsToBalances(nets, input.participants, canonical);
}
