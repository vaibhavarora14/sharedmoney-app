import { useMemo } from "react";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../contexts/AuthContext";
import { Transaction } from "../types";
import { fetchWithAuth } from "../utils/api";
import { getDefaultCurrency } from "../utils/currency";
import {
  normalizeGroupCurrency,
  resolveGroupDefaultCurrency,
} from "../utils/groupCurrency";
import {
  extractSplitAmongParticipantIds,
  resolveGroupDefaultSplitAmong,
} from "../utils/groupSplit";
import { captureIdentifiedAnalyticsEvent } from "../utils/posthogAnalytics";
import { ANALYTICS_EVENTS } from "../utils/posthogEvents";
import {
  mapInfiniteTransactions,
  replaceOptimisticTransactionInFeed,
  resolveCreatedTransaction,
} from "../utils/transactionOptimisticCache";
import { queryKeys } from "./queryKeys";

export interface TransactionsCursor {
  date: string;
  id: number;
}

export interface TransactionsPageResponse {
  items: Transaction[];
  has_more: boolean;
  next_cursor: TransactionsCursor | null;
}

export type TransactionListSort = "date" | "created_at";

interface FetchTransactionsPageArgs {
  groupId?: string | null;
  cursor?: TransactionsCursor | null;
  limit?: number;
  sort?: TransactionListSort;
}

const TRANSACTIONS_PAGE_SIZE = 30;

export async function fetchTransactionsPage({
  groupId,
  cursor,
  limit = TRANSACTIONS_PAGE_SIZE,
  sort = "date",
}: FetchTransactionsPageArgs): Promise<TransactionsPageResponse> {
  const params = new URLSearchParams();
  if (groupId) {
    params.set("group_id", groupId);
  }
  params.set("limit", String(limit));
  if (sort !== "date") {
    params.set("sort", sort);
  }
  if (cursor) {
    params.set("cursor_date", cursor.date);
    params.set("cursor_id", String(cursor.id));
  }

  const endpoint = `/transactions?${params.toString()}`;
  const response = await fetchWithAuth(endpoint);
  if (!response.ok) {
    throw new Error(`Failed to fetch transactions: ${response.status}`);
  }
  const payload = await response.json();
  return {
    items: Array.isArray(payload?.items) ? payload.items : [],
    has_more: payload?.has_more === true,
    next_cursor:
      payload?.next_cursor &&
      typeof payload.next_cursor.date === "string" &&
      typeof payload.next_cursor.id === "number"
        ? payload.next_cursor
        : null,
  };
}

export async function fetchTransactions(groupId?: string | null): Promise<Transaction[]> {
  const firstPage = await fetchTransactionsPage({ groupId });
  return firstPage.items;
}

export async function fetchLatestGroupTransaction(
  groupId: string
): Promise<Transaction | null> {
  const page = await fetchTransactionsPage({
    groupId,
    limit: 1,
    sort: "created_at",
  });
  return page.items[0] ?? null;
}

export async function fetchLatestGroupTransactionCurrency(
  groupId: string
): Promise<string | null> {
  const transaction = await fetchLatestGroupTransaction(groupId);
  return normalizeGroupCurrency(transaction?.currency) ?? null;
}

export async function fetchLatestGroupExpenseSplitAmong(
  groupId: string
): Promise<string[] | null> {
  const page = await fetchTransactionsPage({
    groupId,
    limit: TRANSACTIONS_PAGE_SIZE,
    sort: "created_at",
  });
  return resolveGroupDefaultSplitAmong({
    groupId,
    latestSplitAmong: null,
    feedTransactions: page.items,
  }) ?? null;
}

function getCachedGroupFeedTransactions(
  queryClient: QueryClient,
  groupId: string
): Transaction[] {
  const feed = queryClient.getQueryData<InfiniteData<TransactionsPageResponse>>(
    queryKeys.transactionsFeed(groupId)
  );
  return feed?.pages?.flatMap((page) =>
    Array.isArray(page?.items) ? page.items : []
  ) ?? [];
}

export function getGroupFormDefaultCurrency(
  queryClient: QueryClient,
  groupId: string
): string {
  return resolveGroupDefaultCurrency({
    groupId,
    latestCurrency: queryClient.getQueryData<string | null>(
      queryKeys.lastGroupTransactionCurrency(groupId)
    ),
    feedTransactions: getCachedGroupFeedTransactions(queryClient, groupId),
    fallbackCurrency: getDefaultCurrency(),
  });
}

export function getGroupFormDefaultSplitAmong(
  queryClient: QueryClient,
  groupId: string
): string[] | undefined {
  return resolveGroupDefaultSplitAmong({
    groupId,
    latestSplitAmong: queryClient.getQueryData<string[] | null>(
      queryKeys.lastGroupExpenseSplitAmong(groupId)
    ),
    feedTransactions: getCachedGroupFeedTransactions(queryClient, groupId),
  });
}

function invalidateTransactionAdjacents(queryClient: QueryClient, groupId?: string | null) {
  if (!groupId) return;
  queryClient.invalidateQueries({ queryKey: queryKeys.transactionsFeed(groupId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.transactions(groupId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.lastGroupTransactionCurrency(groupId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.lastGroupExpenseSplitAmong(groupId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.groupStats(groupId) });
  queryClient.invalidateQueries({ queryKey: ["balances"] }); // Invalidate all balances (including global)
  queryClient.invalidateQueries({ queryKey: queryKeys.balances(groupId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.activity(groupId) });
}

export function useGroupLastTransactionCurrency(groupId?: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: groupId
      ? queryKeys.lastGroupTransactionCurrency(groupId)
      : queryKeys.lastGroupTransactionCurrency(""),
    queryFn: () => {
      if (groupId) {
        const cachedCurrency = getGroupFormDefaultCurrency(queryClient, groupId);
        if (cachedCurrency) return cachedCurrency;
        return fetchLatestGroupTransactionCurrency(groupId);
      }
      return null;
    },
    enabled: !!user?.id && !!groupId,
    staleTime: 30_000,
  });
}

export function useGroupLastExpenseSplitAmong(groupId?: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: groupId
      ? queryKeys.lastGroupExpenseSplitAmong(groupId)
      : queryKeys.lastGroupExpenseSplitAmong(""),
    queryFn: () => {
      if (groupId) {
        const cachedSplit = getGroupFormDefaultSplitAmong(queryClient, groupId);
        if (cachedSplit && cachedSplit.length > 0) return cachedSplit;
        return fetchLatestGroupExpenseSplitAmong(groupId);
      }
      return null;
    },
    enabled: !!user?.id && !!groupId,
    staleTime: 30_000,
  });
}

export function useTransactions(groupId?: string | null) {
  const { user } = useAuth();

  const query = useInfiniteQuery({
    queryKey: groupId ? queryKeys.transactionsFeed(groupId) : queryKeys.transactionsFeed(""),
    queryFn: ({ pageParam }: { pageParam: TransactionsCursor | null }) =>
      fetchTransactionsPage({ groupId, cursor: pageParam }),
    initialPageParam: null as TransactionsCursor | null,
    getNextPageParam: (lastPage) => (
      lastPage?.has_more && lastPage?.next_cursor ? lastPage.next_cursor : null
    ),
    enabled: !!user?.id && (!!groupId || groupId === null || groupId === undefined),
    staleTime: 30_000,
  });

  const pages = query.data?.pages;
  const flattenedData = useMemo(() => {
    if (!Array.isArray(pages)) return [];
    return pages.flatMap((page) =>
      Array.isArray(page?.items) ? page.items : []
    );
  }, [pages]);

  return {
    data: flattenedData,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    error: query.error ?? null,
    refetch: query.refetch,
  };
}

// Types for mutation inputs to improve type safety
interface BaseTransactionInput extends Omit<Transaction, "created_at" | "user_id"> {
  group_id: string;
}

type CreateTransactionInput = Omit<BaseTransactionInput, "id">;
type UpdateTransactionInput = BaseTransactionInput;

// Mutation hooks
export function useCreateTransaction(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const mutation = useMutation<
    Transaction | null,
    Error,
    CreateTransactionInput,
    {
      previous?: InfiniteData<TransactionsPageResponse>;
      previousLatestCurrency?: string | null;
      previousLatestSplitAmong?: string[] | null;
      groupId?: string;
      optimisticId?: number;
    }
  >({
    mutationFn: async (transactionData) => {
      const response = await fetchWithAuth("/transactions", {
        method: "POST",
        body: JSON.stringify(transactionData),
      });

      if (!response.ok) {
        throw new Error("Failed to create transaction");
      }

      return response.status === 204 ? null : await response.json();
    },
    onMutate: async (variables) => {
      const groupId = variables.group_id;
      if (!groupId) return { groupId, previous: undefined };

      await queryClient.cancelQueries({ queryKey: queryKeys.transactionsFeed(groupId) });
      await queryClient.cancelQueries({
        queryKey: queryKeys.lastGroupTransactionCurrency(groupId),
      });
      await queryClient.cancelQueries({
        queryKey: queryKeys.lastGroupExpenseSplitAmong(groupId),
      });
      const previous = queryClient.getQueryData<InfiniteData<TransactionsPageResponse>>(
        queryKeys.transactionsFeed(groupId)
      );
      const previousLatestCurrency = queryClient.getQueryData<string | null>(
        queryKeys.lastGroupTransactionCurrency(groupId)
      );
      const previousLatestSplitAmong = queryClient.getQueryData<string[] | null>(
        queryKeys.lastGroupExpenseSplitAmong(groupId)
      );

      const optimisticId = Date.now();
      const optimisticEntry: Transaction = {
        ...(variables as Transaction),
        id: optimisticId,
        created_at: new Date().toISOString(),
      };

      queryClient.setQueryData<InfiniteData<TransactionsPageResponse>>(
        queryKeys.transactionsFeed(groupId),
        (old) => {
          if (!old || old.pages.length === 0) {
            return {
              pages: [{ items: [optimisticEntry], has_more: false, next_cursor: null }],
              pageParams: [null],
            };
          }

          return {
            ...old,
            pages: old.pages.map((page, index) => (
              index === 0
                ? { ...page, items: [optimisticEntry, ...page.items] }
                : page
            )),
          };
        }
      );

      const latestCurrency = normalizeGroupCurrency(variables.currency);
      if (latestCurrency) {
        queryClient.setQueryData(
          queryKeys.lastGroupTransactionCurrency(groupId),
          latestCurrency
        );
      }

      const latestSplitAmong = extractSplitAmongParticipantIds(variables);
      if (latestSplitAmong.length > 0) {
        queryClient.setQueryData(
          queryKeys.lastGroupExpenseSplitAmong(groupId),
          latestSplitAmong
        );
      }

      return {
        previous,
        previousLatestCurrency,
        previousLatestSplitAmong,
        groupId,
        optimisticId,
      };
    },
    onError: (_error, _variables, context) => {
      if (!context?.groupId) return;
      if (context.previous) {
        queryClient.setQueryData(
          queryKeys.transactionsFeed(context.groupId),
          context.previous
        );
      }
      queryClient.setQueryData(
        queryKeys.lastGroupTransactionCurrency(context.groupId),
        context.previousLatestCurrency
      );
      queryClient.setQueryData(
        queryKeys.lastGroupExpenseSplitAmong(context.groupId),
        context.previousLatestSplitAmong
      );
    },
    onSuccess: (data, variables, context) => {
      const groupId = variables.group_id || context?.groupId;
      const created = resolveCreatedTransaction(data, variables as Partial<Transaction>);

      // Replace temp optimistic id immediately so create → edit/delete
      // before refetch cannot 404 with Date.now() ids.
      if (groupId && context?.optimisticId != null) {
        queryClient.setQueryData<InfiniteData<TransactionsPageResponse>>(
          queryKeys.transactionsFeed(groupId),
          (old) =>
            replaceOptimisticTransactionInFeed(old, context.optimisticId!, created)
        );
      }

      invalidateTransactionAdjacents(queryClient, groupId);
      if (groupId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.transactionsFeed(groupId),
        });
      }
      captureIdentifiedAnalyticsEvent(user?.id, ANALYTICS_EVENTS.EXPENSE_CREATED, {
        currency: variables.currency,
        split_count: extractSplitAmongParticipantIds(variables).length,
        ...(groupId ? { group_id: groupId } : {}),
      });
      onSuccess?.();
    },
  });

  return {
    mutate: mutation.mutateAsync,
    isLoading: mutation.isPending,
    error: (mutation.error as Error | null) ?? null,
  };
}

export function useUpdateTransaction(onSuccess?: () => void) {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    Transaction | null,
    Error,
    UpdateTransactionInput,
    { previous?: InfiniteData<TransactionsPageResponse>; groupId: string }
  >({
    mutationFn: async (transactionData) => {
      const response = await fetchWithAuth("/transactions", {
        method: "PUT",
        body: JSON.stringify(transactionData),
      });

      if (!response.ok) {
        throw new Error("Failed to update transaction");
      }

      return response.status === 204 ? null : await response.json();
    },
    onMutate: async (variables) => {
      const groupId = variables.group_id;
      if (!groupId) return { groupId, previous: undefined };

      await queryClient.cancelQueries({ queryKey: queryKeys.transactionsFeed(groupId) });
      const previous = queryClient.getQueryData<InfiniteData<TransactionsPageResponse>>(
        queryKeys.transactionsFeed(groupId)
      );

      queryClient.setQueryData<InfiniteData<TransactionsPageResponse>>(
        queryKeys.transactionsFeed(groupId),
        (old) => mapInfiniteTransactions(
          old,
          (tx) => tx.id === variables.id ? { ...tx, ...variables } : tx
        )
      );

      return { previous, groupId };
    },
    onError: (_error, _variables, context) => {
      if (context?.groupId && context.previous) {
        queryClient.setQueryData(
          queryKeys.transactionsFeed(context.groupId),
          context.previous
        );
      }
    },
    onSuccess: (_data, variables, context) => {
      const groupId = variables.group_id;
      invalidateTransactionAdjacents(queryClient, groupId);
      if (context?.groupId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.transactionsFeed(context.groupId),
        });
      }
      onSuccess?.();
    },
  });

  return {
    mutate: mutation.mutateAsync,
    isLoading: mutation.isPending,
    error: (mutation.error as Error | null) ?? null,
  };
}

export function useDeleteTransaction(onSuccess?: () => void) {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    { id: number; group_id?: string },
    Error,
    { id: number; group_id?: string },
    { previous?: InfiniteData<TransactionsPageResponse>; groupId?: string }
  >({
    mutationFn: async (variables) => {
      const response = await fetchWithAuth(`/transactions?id=${variables.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete transaction");
      }

      return variables;
    },
    onMutate: async (variables) => {
      const groupId = variables.group_id;
      if (!groupId) return { groupId, previous: undefined };

      await queryClient.cancelQueries({ queryKey: queryKeys.transactionsFeed(groupId) });
      const previous = queryClient.getQueryData<InfiniteData<TransactionsPageResponse>>(
        queryKeys.transactionsFeed(groupId)
      );

      queryClient.setQueryData<InfiniteData<TransactionsPageResponse>>(
        queryKeys.transactionsFeed(groupId),
        (old) => mapInfiniteTransactions(old, (tx) => (
          tx.id === variables.id ? null : tx
        ))
      );

      return { previous, groupId };
    },
    onError: (_error, _variables, context) => {
      if (context?.groupId && context.previous) {
        queryClient.setQueryData(
          queryKeys.transactionsFeed(context.groupId),
          context.previous
        );
      }
    },
    onSuccess: (_data, variables, context) => {
      const groupId = variables.group_id;
      invalidateTransactionAdjacents(queryClient, groupId);
      if (context?.groupId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.transactionsFeed(context.groupId),
        });
      }
      onSuccess?.();
    },
  });

  return {
    mutate: mutation.mutateAsync,
    isLoading: mutation.isPending,
    error: (mutation.error as Error | null) ?? null,
  };
}
