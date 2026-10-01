import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { balancesCacheMissingStats } from "./balancesCacheStats.ts";
import { queryKeys } from "./queryKeys.ts";
import type { BalancesResponse, GroupStatsResponse } from "../types.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const emptyStats: GroupStatsResponse = {
  member_breakdown: [],
  my_transactions: [],
  totals: { my_share: {}, group_total: {}, i_owe: {}, im_owed: {} },
  settlement_plan: [],
};
const withoutStats: BalancesResponse = { group_balances: [], overall_balances: [] };
const withStats: BalancesResponse = {
  group_balances: [],
  overall_balances: [],
  group_stats: emptyStats,
};

Deno.test("includeStats fetch replaces balances cache that lacked group_stats", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const groupId = "group-stats-fix";
  const key = queryKeys.balances(groupId);
  client.setQueryData(key, withoutStats);
  try {
    await client.fetchQuery({
      queryKey: key,
      queryFn: async () => {
        client.setQueryData(queryKeys.groupStats(groupId), emptyStats);
        return withStats;
      },
      staleTime: balancesCacheMissingStats(client.getQueryData(key), true) ? 0 : 30_000,
    });
    const cached = client.getQueryData<BalancesResponse>(key);
    assert(cached?.group_stats != null, "cache must gain group_stats");
  } finally {
    client.clear();
  }
});

Deno.test("observer with missing-stats refetchOnMount always hits network", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const groupId = "group-observer";
  const key = queryKeys.balances(groupId);
  client.setQueryData(key, withoutStats);
  let fetches = 0;
  const observer = new QueryObserver<BalancesResponse, Error>(client, {
    queryKey: key,
    queryFn: async () => {
      fetches += 1;
      return withStats;
    },
    staleTime: 30_000,
    refetchOnMount: (q: { state: { data: BalancesResponse | undefined } }) =>
      balancesCacheMissingStats(q.state.data, true) ? "always" : true,
  });
  try {
    const unsub = observer.subscribe(() => {});
    await observer.refetch();
    unsub();
    assert(fetches >= 1, "must refetch when mounts against stats-less cache");
  } finally {
    observer.destroy();
    client.clear();
  }
});
