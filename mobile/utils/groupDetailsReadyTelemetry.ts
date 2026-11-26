/**
 * Helpers for trustworthy group_details_ready timing.
 *
 * Historical bug: a mount effect reset Date.now() and a second effect immediately
 * logged duration_ms ≈ 0 on warm React Query cache. Start time must come from the
 * navigation intent (tap / deep link), and cache hits must be labeled explicitly.
 */

export type GroupDetailsReadyCacheStatus = "hit" | "miss" | "partial";

export interface GroupDetailsReadyTimingInput {
  openStartedAtMs: number;
  nowMs: number;
  /** True if group details query was observed loading during this open. */
  sawGroupLoading: boolean;
  /** True if balances/stats query was observed loading during this open. */
  sawBalancesLoading: boolean;
}

export interface GroupDetailsReadyTiming {
  duration_ms: number;
  from_cache: boolean;
  cache_status: GroupDetailsReadyCacheStatus;
}

export function resolveGroupDetailsReadyTiming({
  openStartedAtMs,
  nowMs,
  sawGroupLoading,
  sawBalancesLoading,
}: GroupDetailsReadyTimingInput): GroupDetailsReadyTiming {
  const duration_ms = Math.max(0, Math.round(nowMs - openStartedAtMs));
  const from_cache = !sawGroupLoading && !sawBalancesLoading;
  let cache_status: GroupDetailsReadyCacheStatus;
  if (from_cache) {
    cache_status = "hit";
  } else if (sawGroupLoading && sawBalancesLoading) {
    cache_status = "miss";
  } else {
    cache_status = "partial";
  }
  return { duration_ms, from_cache, cache_status };
}

export function resolveGroupLedgerReadyTiming(input: {
  openStartedAtMs: number;
  nowMs: number;
}): { duration_ms: number } {
  return {
    duration_ms: Math.max(0, Math.round(input.nowMs - input.openStartedAtMs)),
  };
}
