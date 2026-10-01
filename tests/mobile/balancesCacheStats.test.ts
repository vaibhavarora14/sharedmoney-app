import { balancesCacheMissingStats } from "../../mobile/hooks/balancesCacheStats.ts";
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

Deno.test("missing-stats signal drives staleTime 0 so includeStats fetch replaces cache", () => {
  // Mirrors useBalances / prefetch: when the shared key is warm without
  // group_stats, treat it as immediately stale and replace with a stats payload.
  const warm = withoutStats;
  assert(balancesCacheMissingStats(warm, true), "precondition");
  const staleTime = balancesCacheMissingStats(warm, true) ? 0 : 30_000;
  assert(staleTime === 0, "must bypass 30s staleTime for stats-less cache");

  const replaced = withStats;
  assert(
    balancesCacheMissingStats(replaced, true) === false,
    "after include_stats fetch, cache is complete",
  );
});
