import { assertEquals } from "jsr:@std/assert@1";
import {
  GROUP_LIST_FLASHLIST_HEURISTIC,
  buildGroupListPageLoadedProperties,
  buildGroupListScrollProperties,
  computeApproxFps,
  estimateActivityPageCount,
  estimateTransactionsPageCount,
  isSlowGroupListLoadMore,
  isSlowGroupListScroll,
  shouldCaptureGroupListScroll,
} from "./groupListPerf.ts";

Deno.test("page count estimates follow page sizes", () => {
  assertEquals(estimateTransactionsPageCount(0), 0);
  assertEquals(estimateTransactionsPageCount(1), 1);
  assertEquals(estimateTransactionsPageCount(30), 1);
  assertEquals(estimateTransactionsPageCount(31), 2);
  assertEquals(estimateActivityPageCount(100), 2);
  assertEquals(estimateActivityPageCount(101), 3);
});

Deno.test("approx fps and slow-scroll heuristics", () => {
  assertEquals(computeApproxFps(1000, 55), 55);
  assertEquals(
    isSlowGroupListScroll({
      approxFps: 35,
      maxFrameGapMs: 20,
      itemCount: 80,
    }),
    true,
  );
  assertEquals(
    isSlowGroupListScroll({
      approxFps: 55,
      maxFrameGapMs: 120,
      itemCount: 80,
    }),
    true,
  );
  assertEquals(
    isSlowGroupListScroll({
      approxFps: 35,
      maxFrameGapMs: 120,
      itemCount: 10,
    }),
    false,
  );
  assertEquals(isSlowGroupListLoadMore(1499), false);
  assertEquals(isSlowGroupListLoadMore(1500), true);
});

Deno.test("scroll PostHog sampler respects throttle and rate", () => {
  assertEquals(
    shouldCaptureGroupListScroll({
      tab: "transactions",
      lastCapturedAtByTab: { transactions: 1_000 },
      nowMs: 1_000 + 1_000,
      random: () => 0,
      throttleMs: 45_000,
    }),
    false,
  );
  assertEquals(
    shouldCaptureGroupListScroll({
      tab: "transactions",
      lastCapturedAtByTab: {},
      nowMs: 10_000,
      random: () => 0.99,
      sampleRate: 0.15,
    }),
    false,
  );
  assertEquals(
    shouldCaptureGroupListScroll({
      tab: "activity",
      lastCapturedAtByTab: {},
      nowMs: 10_000,
      random: () => 0.01,
      sampleRate: 0.15,
    }),
    true,
  );
});

Deno.test("event properties stay PII-safe counts only", () => {
  const scroll = buildGroupListScrollProperties({
    tab: "transactions",
    itemCount: 90,
    pageCount: 3,
    durationMs: 800,
    frameCount: 40,
    maxFrameGapMs: 110,
    approxFps: 50,
    platform: "ios",
  });
  assertEquals(scroll.list_impl, "flatlist");
  assertEquals(scroll.slow, true);
  assertEquals("email" in scroll, false);

  const page = buildGroupListPageLoadedProperties({
    tab: "activity",
    itemCount: 150,
    pageCount: 3,
    loadMoreMs: 2000,
    platform: "android",
  });
  assertEquals(page.slow, true);
  assertEquals(page.load_more_ms, 2000);
  assertEquals(GROUP_LIST_FLASHLIST_HEURISTIC.considerFlashListWhen.length > 20, true);
});
