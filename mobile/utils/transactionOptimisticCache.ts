import type { InfiniteData } from "@tanstack/react-query";
import { queryKeys } from "../hooks/queryKeys";
import type { Transaction } from "../types";

export interface TransactionsPageResponse {
  items: Transaction[];
  has_more: boolean;
  next_cursor: { date: string; id: number } | null;
}

export function mapInfiniteTransactions(
  data: InfiniteData<TransactionsPageResponse> | undefined,
  mapper: (tx: Transaction) => Transaction | null
): InfiniteData<TransactionsPageResponse> | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items
        .map((tx) => mapper(tx))
        .filter((tx): tx is Transaction => tx !== null),
    })),
  };
}

/** Normalize create-transaction API payloads (flat or wrapped). */
export function resolveCreatedTransaction(
  data: unknown,
  fallbackFields?: Partial<Transaction>
): Transaction | null {
  if (!data || typeof data !== "object") return null;

  const root = data as Record<string, unknown>;
  const candidate =
    root.transaction && typeof root.transaction === "object"
      ? (root.transaction as Record<string, unknown>)
      : root;

  const rawId = candidate.id;
  const id =
    typeof rawId === "number"
      ? rawId
      : typeof rawId === "string" && /^\d+$/.test(rawId)
      ? Number(rawId)
      : null;

  if (id == null || !Number.isFinite(id)) return null;

  return {
    ...(fallbackFields as Transaction),
    ...(candidate as Partial<Transaction>),
    id,
  };
}

/**
 * Client-side optimistic create ids use Date.now() (ms since epoch).
 * Real Postgres serial/identity ids stay far below this floor.
 */
export const OPTIMISTIC_TRANSACTION_ID_MIN = 1_000_000_000_000;

export function isOptimisticTransactionId(id: number): boolean {
  return Number.isFinite(id) && id >= OPTIMISTIC_TRANSACTION_ID_MIN;
}

/** Match a local optimistic row to the server create that replaces it. */
export function optimisticMatchesServerCreate(
  local: Transaction,
  server: Transaction
): boolean {
  if (!isOptimisticTransactionId(local.id)) return false;
  return (
    local.amount === server.amount &&
    local.description === server.description &&
    local.date === server.date &&
    (local.currency ?? null) === (server.currency ?? null) &&
    (local.type ?? null) === (server.type ?? null) &&
    (local.group_id ?? null) === (server.group_id ?? null)
  );
}

/**
 * Apply a server create into the feed without duplicating rows when an
 * optimistic placeholder (or an earlier push) already exists.
 */
export function applyTransactionCreateToFeed(
  data: InfiniteData<TransactionsPageResponse> | undefined,
  newTx: Transaction
): InfiniteData<TransactionsPageResponse> | undefined {
  if (!data?.pages?.length) return data;

  const cleaned = mapInfiniteTransactions(data, (tx) => {
    if (tx.id === newTx.id) return null;
    if (optimisticMatchesServerCreate(tx, newTx)) return null;
    return tx;
  });

  if (!cleaned?.pages?.length) return cleaned;

  return {
    ...cleaned,
    pages: cleaned.pages.map((page, idx) =>
      idx === 0 ? { ...page, items: [newTx, ...page.items] } : page
    ),
  };
}

/**
 * Swap a temporary optimistic list id for the real server id so create →
 * immediate edit/delete cannot 404.
 *
 * If a realtime push already inserted the server id, only drop the temp row
 * so the feed never shows two rows for the same transaction.
 */
export function replaceOptimisticTransactionInFeed(
  data: InfiniteData<TransactionsPageResponse> | undefined,
  optimisticId: number,
  created: Transaction | null
): InfiniteData<TransactionsPageResponse> | undefined {
  if (created?.id != null) {
    const serverIdAlreadyPresent = data?.pages?.some((page) =>
      page.items.some((tx) => tx.id === created.id && tx.id !== optimisticId)
    );
    if (serverIdAlreadyPresent) {
      return mapInfiniteTransactions(data, (tx) =>
        tx.id === optimisticId ? null : tx
      );
    }
    return mapInfiniteTransactions(data, (tx) =>
      tx.id === optimisticId ? { ...tx, ...created, id: created.id } : tx
    );
  }
  // Drop the temp row if the server payload had no usable id.
  return mapInfiniteTransactions(data, (tx) =>
    tx.id === optimisticId ? null : tx
  );
}

/** Write the post-upload receipt list onto the matching feed row. */
export function applyTransactionReceiptsToFeed(
  data: InfiniteData<TransactionsPageResponse> | undefined,
  transactionId: number,
  receipts: NonNullable<Transaction["receipts"]>,
): InfiniteData<TransactionsPageResponse> | undefined {
  return mapInfiniteTransactions(data, (tx) => (
    tx.id === transactionId ? { ...tx, receipts } : tx
  ));
}

export type ExpenseReceiptCacheClient = {
  cancelQueries: (opts: { queryKey: readonly unknown[] }) => Promise<unknown>;
  setQueryData: (
    queryKey: readonly unknown[],
    updater: (
      old: InfiniteData<TransactionsPageResponse> | undefined,
    ) => InfiniteData<TransactionsPageResponse> | undefined,
  ) => unknown;
};

/**
 * Drop in-flight feed refetches (which can still be the pre-upload snapshot)
 * then patch the returned receipts so the expense shows them without a refresh.
 */
export async function commitExpenseReceiptsToCache(
  client: ExpenseReceiptCacheClient,
  groupId: string,
  transactionId: number,
  receipts: NonNullable<Transaction["receipts"]>,
): Promise<void> {
  const feedKey = queryKeys.transactionsFeed(groupId);
  await client.cancelQueries({ queryKey: feedKey });
  client.setQueryData(feedKey, (old) =>
    applyTransactionReceiptsToFeed(old, transactionId, receipts)
  );
}
