import { createErrorResponse, handleError } from "../_shared/error-handler.ts";
import { createSuccessResponse } from "../_shared/response.ts";
import { isValidUUID } from "../_shared/validation.ts";

export const TRANSACTION_PAGE_DEFAULT_LIMIT = 30;
export const TRANSACTION_PAGE_MAX_LIMIT = 100;

export const TRANSACTIONS_LIST_SEQUENTIAL_DB_ROUND_TRIPS_BEFORE = {
  participant: 1,
  page: 1,
  people: 1,
} as const;

/** After JWT: participant check + first page + group people in one Promise.all. */
export const TRANSACTIONS_LIST_SEQUENTIAL_DB_ROUND_TRIPS = {
  participantAndPageAndPeople: 1,
} as const;

const TRANSACTION_LIST_SELECT = `
            *,
            transaction_splits (
              id,
              participant_id,
              amount,
              created_at
            ),
            transaction_payers (
              id,
              participant_id,
              amount,
              created_at
            ),
            transaction_receipts (
              id,
              transaction_id,
              group_id,
              storage_path,
              content_type,
              byte_size,
              sort_order,
              created_at
            )
          `;

interface TransactionSplit {
  transaction_id: number;
  participant_id: string | null;
  user_id?: string | null;
  email?: string | null;
  amount: number;
  full_name?: string | null;
  avatar_url?: string | null;
}

interface Participant {
  id: string;
  group_id: string;
  user_id?: string | null;
  email?: string | null;
  type: "member" | "invited" | "former";
  role?: "owner" | "member";
  full_name?: string | null;
  avatar_url?: string | null;
}

interface TransactionWithSplits {
  id: number;
  date: string;
  paid_by_participant_id?: string;
  paid_by?: string;
  user_id?: string;
  split_among?: string[];
  split_among_participant_ids?: string[];
  transaction_splits?: TransactionSplit[];
  splits?: TransactionSplit[];
  transaction_payers?: TransactionSplit[];
  payers?: TransactionSplit[];
  transaction_receipts?: unknown;
  receipts?: unknown;
}

export interface TransactionCursor {
  date: string;
  id: number;
}

export interface TransactionListEnvelope {
  items: TransactionWithSplits[];
  has_more: boolean;
  next_cursor: TransactionCursor | null;
}

export function resolveTransactionListSort(sort: string | null): "date" | "created_at" {
  return sort === "created_at" ? "created_at" : "date";
}

export function parsePositiveInt(input: string | null): number | null {
  if (!input) return null;
  const parsed = Number.parseInt(input, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function attachReceipts<T extends { transaction_receipts?: unknown; receipts?: unknown }>(
  tx: T,
): T {
  const rows = Array.isArray(tx.transaction_receipts) ? tx.transaction_receipts : [];
  const receipts = [...rows].sort((a: { sort_order?: number; created_at?: string }, b: {
    sort_order?: number;
    created_at?: string;
  }) =>
    (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
    String(a.created_at || "").localeCompare(String(b.created_at || ""))
  );
  const next = { ...tx, receipts };
  delete (next as { transaction_receipts?: unknown }).transaction_receipts;
  return next;
}

export function enrichTransactionsWithParticipants(
  transactions: TransactionWithSplits[],
  participantMap: Map<string, Participant>,
): TransactionWithSplits[] {
  return (transactions || []).map((tx) => {
    if (tx.transaction_splits) {
      tx.splits = tx.transaction_splits.map((split) => {
        const participant = split.participant_id
          ? participantMap.get(split.participant_id)
          : null;
        return {
          ...split,
          user_id: participant?.user_id || null,
          email: participant?.email || null,
          full_name: participant?.full_name || null,
          avatar_url: participant?.avatar_url || null,
        };
      });
      delete tx.transaction_splits;
    }
    if (tx.splits) {
      tx.split_among_participant_ids = tx.splits
        .map((s) => s.participant_id)
        .filter((id): id is string => !!id);
    }
    if (tx.transaction_payers) {
      tx.payers = tx.transaction_payers.map((payer) => {
        const participant = payer.participant_id
          ? participantMap.get(payer.participant_id)
          : null;
        return {
          ...payer,
          user_id: participant?.user_id || null,
          email: participant?.email || null,
          full_name: participant?.full_name || null,
          avatar_url: participant?.avatar_url || null,
        };
      });
      delete tx.transaction_payers;
    }
    return attachReceipts(tx);
  });
}

function emptyPeopleResult(): PromiseLike<{ data: Participant[] | null; error: unknown }> {
  return Promise.resolve({ data: [], error: null });
}

export async function loadGroupTransactionsPage(
  supabase: { from: (table: string) => any },
  user: { id: string },
  input: {
    groupId: string | null;
    limit: number;
    cursorDate: string | null;
    cursorId: number | null;
    listSort: "date" | "created_at";
  },
): Promise<
  | { kind: "ok"; body: TransactionListEnvelope }
  | { kind: "forbidden" }
  | { kind: "error"; error: unknown; context: string }
> {
  const { groupId, limit, listSort } = input;

  const participantQuery = groupId
    ? supabase
      .from("participants")
      .select("id, type")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .single()
    : Promise.resolve({ data: null, error: null });

  const peopleQuery = groupId
    ? supabase
      .from("participants")
      .select("id, group_id, user_id, email, type, role, full_name, avatar_url")
      .eq("group_id", groupId)
    : emptyPeopleResult();

  const buildTransactionsQuery = (
    pageCursorDate?: string | null,
    pageCursorId?: number | null,
  ) => {
    let query = supabase.from("transactions").select(TRANSACTION_LIST_SELECT);
    if (groupId) {
      query = query.eq("group_id", groupId);
    }
    if (pageCursorDate && pageCursorId) {
      query = query.or(
        `date.lt.${pageCursorDate},and(date.eq.${pageCursorDate},id.lt.${pageCursorId})`,
      );
    }
    if (listSort === "created_at") {
      return query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
    }
    return query
      .order("date", { ascending: false })
      .order("id", { ascending: false });
  };

  const firstPageQuery = buildTransactionsQuery(input.cursorDate, input.cursorId)
    .limit(limit + 1);

  const [participantResult, firstPageResult, peopleResult] = await Promise.all([
    participantQuery,
    firstPageQuery,
    peopleQuery,
  ]);

  if (groupId && (participantResult.error || !participantResult.data)) {
    return { kind: "forbidden" };
  }
  if (firstPageResult.error) {
    return { kind: "error", error: firstPageResult.error, context: "fetching transactions" };
  }
  if (peopleResult.error) {
    return { kind: "error", error: peopleResult.error, context: "fetching participants" };
  }

  const participantData = (participantResult.data ?? null) as { id: string; type: string } | null;
  const isFormerParticipant = participantData?.type === "former" && !!groupId;
  const formerParticipantId = participantData?.id ?? null;

  const participantMap = new Map<string, Participant>();
  for (const person of (peopleResult.data || []) as Participant[]) {
    participantMap.set(person.id, person);
  }

  let fetchedTransactions: TransactionWithSplits[] = [];
  let sourceExhausted = false;
  let rollingCursorDate = input.cursorDate;
  let rollingCursorId = input.cursorId;
  let safetyIterations = 0;
  const maxFetchIterations = listSort === "created_at" ? 1 : 20;

  const takePage = (pageRows: TransactionWithSplits[]) => {
    if (pageRows.length === 0) {
      sourceExhausted = true;
      return;
    }
    if (isFormerParticipant && formerParticipantId) {
      const formerVisible = pageRows.filter((tx) => {
        const isPayer = tx.paid_by_participant_id === formerParticipantId
          || tx.transaction_payers?.some((payer) => payer.participant_id === formerParticipantId);
        const isInSplits = tx.transaction_splits?.some(
          (s) => s.participant_id === formerParticipantId,
        );
        const isLegacyPayer = tx.paid_by === user.id || tx.user_id === user.id;
        const isLegacySplit = tx.split_among?.includes(user.id);
        return isPayer || isInSplits || isLegacyPayer || isLegacySplit;
      });
      fetchedTransactions.push(...formerVisible);
    } else {
      fetchedTransactions.push(...pageRows);
    }
    const lastRow = pageRows[pageRows.length - 1];
    rollingCursorDate = lastRow?.date ?? null;
    rollingCursorId = lastRow?.id ?? null;
    if (pageRows.length < limit + 1) {
      sourceExhausted = true;
    }
  };

  takePage((firstPageResult.data || []) as TransactionWithSplits[]);
  safetyIterations += 1;

  while (
    fetchedTransactions.length < limit + 1 &&
    !sourceExhausted &&
    safetyIterations < maxFetchIterations
  ) {
    safetyIterations += 1;
    const { data: transactionsData, error } = await buildTransactionsQuery(
      rollingCursorDate,
      rollingCursorId,
    ).limit(limit + 1);
    if (error) {
      return { kind: "error", error, context: "fetching transactions" };
    }
    takePage((transactionsData || []) as TransactionWithSplits[]);
  }

  const transactions = fetchedTransactions.slice(0, limit);
  const lastVisibleTransaction = transactions[transactions.length - 1];
  const moreInSource = fetchedTransactions.length > limit || !sourceExhausted;
  const nextCursor: TransactionCursor | null =
    listSort === "created_at" || !moreInSource || !lastVisibleTransaction
      ? null
      : {
        date: lastVisibleTransaction.date,
        id: lastVisibleTransaction.id,
      };

  return {
    kind: "ok",
    body: {
      items: enrichTransactionsWithParticipants(transactions, participantMap),
      has_more: nextCursor !== null,
      next_cursor: nextCursor,
    },
  };
}

export function transactionListHttpResponse(
  loaded: Awaited<ReturnType<typeof loadGroupTransactionsPage>>,
  req: Request,
): Response {
  switch (loaded.kind) {
    case "ok":
      return createSuccessResponse(loaded.body, 200, 0, req);
    case "forbidden":
      return createErrorResponse(
        403,
        "Forbidden: You are not a participant in this group",
        "PERMISSION_DENIED",
        undefined,
        req,
      );
    case "error":
      return handleError(loaded.error, loaded.context, req);
    default: {
      const _never: never = loaded;
      return handleError(new Error(String(_never)), "fetching transactions", req);
    }
  }
}

export function parseTransactionListRequest(url: URL): {
  ok: true;
  groupId: string | null;
  limit: number;
  cursorDate: string | null;
  cursorId: number | null;
  listSort: "date" | "created_at";
} | { ok: false; status: number; message: string; code: string } {
  const groupId = url.searchParams.get("group_id");
  const rawLimit = parsePositiveInt(url.searchParams.get("limit"));
  const limit = Math.min(
    rawLimit ?? TRANSACTION_PAGE_DEFAULT_LIMIT,
    TRANSACTION_PAGE_MAX_LIMIT,
  );
  const cursorDate = url.searchParams.get("cursor_date");
  const cursorId = parsePositiveInt(url.searchParams.get("cursor_id"));
  const listSort = resolveTransactionListSort(url.searchParams.get("sort"));

  if (groupId && !isValidUUID(groupId)) {
    return { ok: false, status: 400, message: "Invalid group_id format. Expected UUID.", code: "VALIDATION_ERROR" };
  }
  if ((cursorDate && !cursorId) || (!cursorDate && cursorId)) {
    return {
      ok: false,
      status: 400,
      message: "Both cursor_date and cursor_id are required when paginating.",
      code: "VALIDATION_ERROR",
    };
  }
  if (listSort === "created_at" && (cursorDate || cursorId)) {
    return {
      ok: false,
      status: 400,
      message: "sort=created_at does not support cursor pagination.",
      code: "VALIDATION_ERROR",
    };
  }
  if (listSort === "created_at" && !groupId) {
    return {
      ok: false,
      status: 400,
      message: "sort=created_at requires group_id.",
      code: "VALIDATION_ERROR",
    };
  }
  return { ok: true, groupId, limit, cursorDate, cursorId, listSort };
}
