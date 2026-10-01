import { QueryClient, QueryObserver } from "../../node_modules/@tanstack/react-query/build/modern/index.js";
import { balancesCacheMissingStats } from "../../mobile/hooks/balancesCacheStats.ts";
import { queryKeys } from "../../mobile/hooks/queryKeys.ts";
import type { BalancesResponse, GroupStatsResponse } from "../../mobile/types.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const emptyStats: GroupStatsResponse = {
  member_breakdown: [],
  my_transactions: [],
  totals: {
    my_share: {},
    group_total: {},
    i_owe: {},
    im_owed: {},
  },
  settlement_plan: [],
};

const withoutStats: BalancesResponse = {
  group_balances: [],
  overall_balances: [],
};

const withStats: BalancesResponse = {
  group_balances: [],
  overall_balances: [],
  group_stats: emptyStats,
};

Deno.test("balancesCacheMissingStats detects warm cache without group_stats", () => {
  assert(
    balancesCacheMissingStats(withoutStats, true) === true,
    "includeStats + no group_stats must be missing",
  );
  assert(
    balancesCacheMissingStats(withStats, true) === false,
    "includeStats + group_stats present is fine",
  );
  assert(
    balancesCacheMissingStats(withoutStats, false) === false,
    "without includeStats, missing group_stats is expected",
  );
  assert(
    balancesCacheMissingStats(undefined, true) === false,
    "empty cache should load normally, not treat as missing-stats",
  );
});

Deno.test("includeStats fetch replaces balances cache that lacked group_stats", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const groupId = "group-stats-fix";
  const key = queryKeys.balances(groupId);
  client.setQueryData(key, withoutStats);

  const endpoints: string[] = [];
  const fetchBalances = async (
    id: string,
    includeStats = false,
  ): Promise<BalancesResponse> => {
    endpoints.push(`${id}:${includeStats ? "stats" : "plain"}`);
    return includeStats ? withStats : withoutStats;
  };

  try {
    assert(
      balancesCacheMissingStats(client.getQueryData(key), true),
      "precondition: warm cache lacks stats",
    );

    await client.fetchQuery({
      queryKey: key,
      queryFn: async () => {
        const data = await fetchBalances(groupId, true);
        if (data.group_stats) {
          client.setQueryData(queryKeys.groupStats(groupId), data.group_stats);
        }
        return data;
      },
      staleTime: balancesCacheMissingStats(client.getQueryData(key), true)
        ? 0
        : 30_000,
    });

    const cached = client.getQueryData<BalancesResponse>(key);
    assert(cached?.group_stats != null, "cache must gain group_stats");
    assert(
      client.getQueryData(queryKeys.groupStats(groupId)) === cached?.group_stats,
      "groupStats key should be seeded",
    );
    assert(
      JSON.stringify(endpoints) === '["group-stats-fix:stats"]',
      `expected one stats fetch, got ${JSON.stringify(endpoints)}`,
    );
    assert(
      balancesCacheMissingStats(cached, true) === false,
      "postcondition: stats no longer missing",
    );
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
    refetchOnMount: (q) =>
      balancesCacheMissingStats(q.state.data, true) ? "always" : true,
  });

  try {
    const unsub = observer.subscribe(() => {});
    await observer.refetch();
    unsub();

    assert(fetches >= 1, "must refetch when mounts against stats-less cache");
    const cached = client.getQueryData<BalancesResponse>(key);
    assert(cached?.group_stats != null, "observer refetch must store group_stats");
  } finally {
    observer.destroy();
    client.clear();
  }
});
