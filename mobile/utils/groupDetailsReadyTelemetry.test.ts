import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  resolveGroupDetailsReadyTiming,
  resolveGroupLedgerReadyTiming,
} from "./groupDetailsReadyTelemetry.ts";

Deno.test("warm cache hit reports positive duration from open intent, not zeroed effects", () => {
  const timing = resolveGroupDetailsReadyTiming({
    openStartedAtMs: 1_000,
    nowMs: 1_018,
    sawGroupLoading: false,
    sawBalancesLoading: false,
  });
  assertEquals(timing.duration_ms, 18);
  assertEquals(timing.from_cache, true);
  assertEquals(timing.cache_status, "hit");
});

Deno.test("cold miss reports full network wait", () => {
  const timing = resolveGroupDetailsReadyTiming({
    openStartedAtMs: 1_000,
    nowMs: 2_650,
    sawGroupLoading: true,
    sawBalancesLoading: true,
  });
  assertEquals(timing.duration_ms, 1_650);
  assertEquals(timing.from_cache, false);
  assertEquals(timing.cache_status, "miss");
});

Deno.test("partial cache when only balances miss", () => {
  const timing = resolveGroupDetailsReadyTiming({
    openStartedAtMs: 5_000,
    nowMs: 5_400,
    sawGroupLoading: false,
    sawBalancesLoading: true,
  });
  assertEquals(timing.duration_ms, 400);
  assertEquals(timing.from_cache, false);
  assertEquals(timing.cache_status, "partial");
});

Deno.test("never emits negative duration_ms", () => {
  const timing = resolveGroupDetailsReadyTiming({
    openStartedAtMs: 2_000,
    nowMs: 1_999,
    sawGroupLoading: false,
    sawBalancesLoading: false,
  });
  assertEquals(timing.duration_ms, 0);
});

Deno.test("group_ledger_ready duration_ms is open intent to first expense-list paint", () => {
  assertEquals(
    resolveGroupLedgerReadyTiming({ openStartedAtMs: 1_000, nowMs: 1_420 }).duration_ms,
    420,
  );
  assertEquals(
    resolveGroupLedgerReadyTiming({ openStartedAtMs: 2_000, nowMs: 1_999 }).duration_ms,
    0,
  );
});
