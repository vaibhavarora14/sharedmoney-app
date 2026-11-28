/**
 * Shared ledger loader for balance + stats calculation.
 * Fetches expense transactions, settlements, and participants in parallel
 * so the balances edge function avoids sequential waterfalls and duplicate
 * re-fetches when include_stats=true.
 *
 * PostgREST max_rows is 1000. Every table here is paged so a group with
 * more than 1,000 expenses still has complete balances.
 */

export type LedgerTransactionSplit = {
  participant_id?: string | null;
  amount: number | string;
};

export type LedgerTransactionPayer = {
  participant_id?: string | null;
  amount: number | string;
};

export type LedgerTransaction = {
  id: number;
  group_id?: string;
  amount: number | string;
  description?: string;
  date?: string;
  type?: string;
  paid_by_participant_id: string | null;
  currency: string;
  transaction_splits?: LedgerTransactionSplit[];
  transaction_payers?: LedgerTransactionPayer[];
};

export type LedgerParticipant = {
  id: string;
  group_id?: string;
  user_id: string | null;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  type?: string;
};

export type LedgerSettlement = {
  id: string;
  group_id: string;
  from_participant_id: string | null;
  to_participant_id: string | null;
  amount: number | string;
  currency: string;
};

export type GroupLedgerSnapshot = {
  transactions: LedgerTransaction[];
  participants: LedgerParticipant[];
  settlements: LedgerSettlement[];
};

export const POSTGREST_PAGE_SIZE = 1000;

const BALANCE_TX_SELECT = `
  id,
  group_id,
  amount,
  paid_by_participant_id,
  currency,
  transaction_splits (
    participant_id,
    amount
  ),
  transaction_payers (
    participant_id,
    amount
  )
`;

const STATS_TX_SELECT = `
  id,
  group_id,
  amount,
  description,
  date,
  type,
  paid_by_participant_id,
  currency,
  transaction_splits (
    participant_id,
    amount
  ),
  transaction_payers (
    participant_id,
    amount
  )
`;

/**
 * Count of parallel PostgREST queries issued by loadGroupLedger / loadGroupLedgers
 * (transactions, participants, settlements). Used in tests / PR before-after
 * reasoning (not a runtime metric).
 */
export const GROUP_LEDGER_PARALLEL_QUERY_COUNT = 3;

type RangeQuery<T> = {
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>;
};

export async function pageAllRows<T>(
  buildQuery: () => RangeQuery<T>,
  pageSize = POSTGREST_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data || []) as T[];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

export async function loadGroupLedger(
  supabase: any,
  groupId: string,
  options?: { includeStatsFields?: boolean },
): Promise<GroupLedgerSnapshot> {
  const includeStatsFields = options?.includeStatsFields === true;
  const txSelect = includeStatsFields ? STATS_TX_SELECT : BALANCE_TX_SELECT;

  const makeTransactionsQuery = () => {
    let query = supabase
      .from("transactions")
      .select(txSelect)
      .eq("group_id", groupId)
      .eq("type", "expense");
    if (includeStatsFields) {
      query = query
        .order("date", { ascending: false })
        .order("id", { ascending: false });
    } else {
      query = query.order("id", { ascending: true });
    }
    return query;
  };

  const [transactions, participants, settlements] = await Promise.all([
    pageAllRows<LedgerTransaction>(makeTransactionsQuery),
    pageAllRows<LedgerParticipant>(() =>
      supabase
        .from("participants")
        .select("id, group_id, user_id, email, full_name, avatar_url, type")
        .eq("group_id", groupId)
        .order("id", { ascending: true }),
    ),
    pageAllRows<LedgerSettlement>(() =>
      supabase
        .from("settlements")
        .select(
          "id, group_id, from_participant_id, to_participant_id, amount, currency",
        )
        .eq("group_id", groupId)
        .order("id", { ascending: true }),
    ),
  ]);

  return { transactions, participants, settlements };
}

/**
 * Home multi-group ledger: a few `in (group_ids)` queries instead of
 * per-group waterfalls. Pages past 1,000 rows per table.
 */
export async function loadGroupLedgers(
  supabase: any,
  groupIds: string[],
  options?: { includeStatsFields?: boolean },
): Promise<Map<string, GroupLedgerSnapshot>> {
  const byGroup = new Map<string, GroupLedgerSnapshot>();
  for (const groupId of groupIds) {
    byGroup.set(groupId, {
      transactions: [],
      participants: [],
      settlements: [],
    });
  }
  if (groupIds.length === 0) return byGroup;

  const includeStatsFields = options?.includeStatsFields === true;
  const txSelect = includeStatsFields ? STATS_TX_SELECT : BALANCE_TX_SELECT;

  const [transactions, participants, settlements] = await Promise.all([
    pageAllRows<LedgerTransaction>(() => {
      let query = supabase
        .from("transactions")
        .select(txSelect)
        .in("group_id", groupIds)
        .eq("type", "expense");
      if (includeStatsFields) {
        query = query
          .order("date", { ascending: false })
          .order("id", { ascending: false });
      } else {
        query = query.order("id", { ascending: true });
      }
      return query;
    }),
    pageAllRows<LedgerParticipant>(() =>
      supabase
        .from("participants")
        .select("id, group_id, user_id, email, full_name, avatar_url, type")
        .in("group_id", groupIds)
        .order("id", { ascending: true }),
    ),
    pageAllRows<LedgerSettlement>(() =>
      supabase
        .from("settlements")
        .select(
          "id, group_id, from_participant_id, to_participant_id, amount, currency",
        )
        .in("group_id", groupIds)
        .order("id", { ascending: true }),
    ),
  ]);

  for (const transaction of transactions) {
    const groupId = transaction.group_id;
    if (!groupId) continue;
    byGroup.get(groupId)?.transactions.push(transaction);
  }
  for (const participant of participants) {
    const groupId = participant.group_id;
    if (!groupId) continue;
    byGroup.get(groupId)?.participants.push(participant);
  }
  for (const settlement of settlements) {
    byGroup.get(settlement.group_id)?.settlements.push(settlement);
  }

  return byGroup;
}
