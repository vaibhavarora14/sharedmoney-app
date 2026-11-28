import type { InfiniteData } from "@tanstack/react-query";
import { queryKeys } from "../hooks/queryKeys.ts";
import type { Transaction, TransactionReceipt } from "../types.ts";
import {
  applyTransactionCreateToFeed,
  applyTransactionReceiptsToFeed,
  commitExpenseReceiptsToCache,
  replaceOptimisticTransactionInFeed,
  resolveCreatedTransaction,
  type TransactionsPageResponse,
} from "../utils/transactionOptimisticCache.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function feedWith(
  items: Transaction[]
): InfiniteData<TransactionsPageResponse> {
  return {
    pages: [{ items, has_more: false, next_cursor: null }],
    pageParams: [null],
  };
}

Deno.test("resolveCreatedTransaction accepts flat and wrapped create payloads", () => {
  const flat = resolveCreatedTransaction({ id: 42, description: "Lunch", amount: 10 });
  assert(flat?.id === 42, "flat payload should resolve numeric id");

  const wrapped = resolveCreatedTransaction({
    transaction: { id: "99", description: "Taxi", amount: 20 },
  });
  assert(wrapped?.id === 99, "wrapped string id should coerce to number");

  assert(
    resolveCreatedTransaction({ description: "Nope" }) === null,
    "missing id should return null"
  );
});

Deno.test("replaceOptimisticTransactionInFeed swaps Date.now id for server id", () => {
  const optimisticId = 1_700_000_000_000;
  const before = feedWith([
    {
      id: optimisticId,
      description: "Temp",
      amount: 5,
      date: "2026-09-14",
      type: "expense",
      currency: "USD",
      group_id: "g1",
    } as Transaction,
    {
      id: 7,
      description: "Existing",
      amount: 1,
      date: "2026-09-13",
      type: "expense",
      currency: "USD",
      group_id: "g1",
    } as Transaction,
  ]);

  const after = replaceOptimisticTransactionInFeed(before, optimisticId, {
    id: 123,
    description: "Temp",
    amount: 5,
    date: "2026-09-14",
    type: "expense",
    currency: "USD",
    group_id: "g1",
  } as Transaction);

  assert(after?.pages[0].items[0].id === 123, "optimistic id must become server id");
  assert(after?.pages[0].items[1].id === 7, "other rows must stay intact");
  assert(
    !after?.pages[0].items.some((tx) => tx.id === optimisticId),
    "temp id must not remain editable"
  );
});

Deno.test("replaceOptimisticTransactionInFeed drops temp when server id already present", () => {
  const optimisticId = 1_700_000_000_002;
  const before = feedWith([
    {
      id: 123,
      description: "From push",
      amount: 5,
      date: "2026-09-14",
      type: "expense",
      currency: "USD",
      group_id: "g1",
    } as Transaction,
    {
      id: optimisticId,
      description: "Temp",
      amount: 5,
      date: "2026-09-14",
      type: "expense",
      currency: "USD",
      group_id: "g1",
    } as Transaction,
  ]);

  const after = replaceOptimisticTransactionInFeed(before, optimisticId, {
    id: 123,
    description: "Temp",
    amount: 5,
    date: "2026-09-14",
    type: "expense",
    currency: "USD",
    group_id: "g1",
  } as Transaction);

  assert(after?.pages[0].items.length === 1, "must not duplicate server id");
  assert(after?.pages[0].items[0].id === 123, "server row must remain");
});

Deno.test("applyTransactionCreateToFeed strips matching optimistic and dedupes server id", () => {
  const optimisticId = 1_700_000_000_003;
  const before = feedWith([
    {
      id: optimisticId,
      description: "Coffee",
      amount: 4.5,
      date: "2026-09-14",
      type: "expense",
      currency: "USD",
      group_id: "g1",
    } as Transaction,
    {
      id: 9,
      description: "Other",
      amount: 1,
      date: "2026-09-13",
      type: "expense",
      currency: "USD",
      group_id: "g1",
    } as Transaction,
  ]);

  const serverTx = {
    id: 200,
    description: "Coffee",
    amount: 4.5,
    date: "2026-09-14",
    type: "expense",
    currency: "USD",
    group_id: "g1",
  } as Transaction;

  const afterPush = applyTransactionCreateToFeed(before, serverTx);
  assert(afterPush?.pages[0].items[0].id === 200, "server row should lead");
  assert(
    !afterPush?.pages[0].items.some((tx) => tx.id === optimisticId),
    "matching optimistic row must be removed"
  );
  assert(afterPush?.pages[0].items.length === 2, "existing unrelated row stays");

  const afterSecond = applyTransactionCreateToFeed(afterPush, serverTx);
  assert(
    afterSecond?.pages[0].items.filter((tx) => tx.id === 200).length === 1,
    "second push must not duplicate server id"
  );
});

Deno.test("replaceOptimisticTransactionInFeed drops temp row when create payload has no id", () => {
  const optimisticId = 1_700_000_000_001;
  const before = feedWith([
    {
      id: optimisticId,
      description: "Temp",
      amount: 5,
      date: "2026-09-14",
      type: "expense",
      currency: "USD",
      group_id: "g1",
    } as Transaction,
  ]);

  const after = replaceOptimisticTransactionInFeed(before, optimisticId, null);
  assert(after?.pages[0].items.length === 0, "temp row should be removed without server id");
});

function receipt(overrides: Partial<TransactionReceipt> = {}): TransactionReceipt {
  return {
    id: "abcdef12-3456-7890-abcd-ef1234567890",
    transaction_id: 42,
    group_id: "g1",
    storage_path: "g1/42/abcdef12-3456-7890-abcd-ef1234567890.jpg",
    content_type: "image/jpeg",
    sort_order: 0,
    ...overrides,
  };
}

Deno.test("applyTransactionReceiptsToFeed writes receipts onto the matching expense", () => {
  const before = feedWith([
    {
      id: 42,
      description: "Dinner",
      amount: 80,
      date: "2026-11-28",
      type: "expense",
      currency: "INR",
      group_id: "g1",
    } as Transaction,
    {
      id: 7,
      description: "Taxi",
      amount: 20,
      date: "2026-11-27",
      type: "expense",
      currency: "INR",
      group_id: "g1",
    } as Transaction,
  ]);
  const uploaded = [receipt()];

  const after = applyTransactionReceiptsToFeed(before, 42, uploaded);

  assert(after?.pages[0].items[0].receipts?.[0].id === uploaded[0].id, "target row must show the uploaded receipt");
  assert(after?.pages[0].items[1].receipts === undefined, "other rows must stay untouched");
});

Deno.test("applyTransactionReceiptsToFeed replaces and clears receipts after edit/remove", () => {
  const original = receipt({ id: "11111111-1111-4111-8111-111111111111" });
  const replacement = receipt({ id: "22222222-2222-4222-8222-222222222222", sort_order: 0 });
  const before = feedWith([
    {
      id: 42,
      description: "Dinner",
      amount: 80,
      date: "2026-11-28",
      type: "expense",
      currency: "INR",
      group_id: "g1",
      receipts: [original],
    } as Transaction,
  ]);

  const replaced = applyTransactionReceiptsToFeed(before, 42, [replacement]);
  assert(
    replaced?.pages[0].items[0].receipts?.map((item: TransactionReceipt) => item.id).join(",") === replacement.id,
    "replace must swap in the returned receipts",
  );

  const removed = applyTransactionReceiptsToFeed(replaced, 42, []);
  assert(removed?.pages[0].items[0].receipts?.length === 0, "remove must clear receipts without a refresh");
});

Deno.test("commitExpenseReceiptsToCache cancels the in-flight feed then patches receipts", async () => {
  const groupId = "g1";
  const feedKey = queryKeys.transactionsFeed(groupId);
  const keyOf = (queryKey: readonly unknown[]) => JSON.stringify(queryKey);
  const store = new Map<string, InfiniteData<TransactionsPageResponse>>();
  store.set(keyOf(feedKey), feedWith([
    {
      id: 42,
      description: "Dinner",
      amount: 80,
      date: "2026-11-28",
      type: "expense",
      currency: "INR",
      group_id: groupId,
    } as Transaction,
  ]));
  const cancelled: unknown[] = [];
  const uploaded = [receipt()];

  await commitExpenseReceiptsToCache(
    {
      cancelQueries: async ({ queryKey }: { queryKey: readonly unknown[] }) => {
        cancelled.push(queryKey);
      },
      setQueryData: (
        queryKey: readonly unknown[],
        updater: (
          old: InfiniteData<TransactionsPageResponse> | undefined,
        ) => InfiniteData<TransactionsPageResponse> | undefined,
      ) => {
        const key = keyOf(queryKey);
        const next = updater(store.get(key));
        if (next === undefined) store.delete(key);
        else store.set(key, next);
        return next;
      },
    },
    groupId,
    42,
    uploaded,
  );

  assert(
    cancelled.length === 1
      && JSON.stringify(cancelled[0]) === JSON.stringify(feedKey),
    "must cancel the feed query so a pre-upload refetch cannot overwrite receipts",
  );
  const patched = store.get(keyOf(feedKey));
  assert(patched?.pages[0].items[0].receipts?.[0].id === uploaded[0].id, "feed cache must include the uploaded receipt");
});
