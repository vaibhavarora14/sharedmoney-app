import type { BalancesResponse } from "../types";

/**
 * Shared balances query key is used with and without include_stats.
 * Callers that need stats must treat a warm cache lacking group_stats as stale.
 */
export function balancesCacheMissingStats(
  data: BalancesResponse | undefined,
  includeStats: boolean
): boolean {
  return includeStats && !!data && data.group_stats == null;
}
