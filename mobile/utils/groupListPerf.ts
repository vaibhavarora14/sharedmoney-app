/**
 * Heuristics for GroupDetails FlatList production telemetry.
 * Used to decide later whether FlashList is worth adopting — not hard SLOs.
 */

export type GroupListTab = "transactions" | "activity";

/** Approx FPS below this (over a scroll sample) → FlatList may struggle. */
export const GROUP_LIST_SLOW_FPS_THRESHOLD = 40;

/** Single frame gap (ms) treated as a JS/UI stall during scroll. */
export const GROUP_LIST_STALL_FRAME_GAP_MS = 50;

/** Max frame gap (ms) that warrants a Sentry breadcrumb / FlashList look. */
export const GROUP_LIST_SLOW_FRAME_GAP_MS = 100;

/** fetchNextPage duration (ms) worth tagging as slow load-more. */
export const GROUP_LIST_SLOW_LOAD_MORE_MS = 1_500;

/** Min rows before scroll telemetry is meaningful. */
export const GROUP_LIST_MIN_ITEMS_FOR_SCROLL_SIGNAL = 40;

/** PostHog: probability of capturing a scroll sample (0–1). */
export const GROUP_LIST_SCROLL_SAMPLE_RATE = 0.15;

/** PostHog: min ms between scroll captures per tab. */
export const GROUP_LIST_SCROLL_THROTTLE_MS = 45_000;

export type GroupListScrollSample = {
  tab: GroupListTab;
  itemCount: number;
  pageCount: number;
  durationMs: number;
  frameCount: number;
  maxFrameGapMs: number;
  approxFps: number;
  platform: string;
};

export type GroupListPageLoadedSample = {
  tab: GroupListTab;
  itemCount: number;
  pageCount: number;
  loadMoreMs: number;
  platform: string;
};

export function estimateTransactionsPageCount(
  itemCount: number,
  pageSize = 30,
): number {
  if (itemCount <= 0) return 0;
  return Math.max(1, Math.ceil(itemCount / pageSize));
}

export function estimateActivityPageCount(
  itemCount: number,
  pageSize = 50,
): number {
  if (itemCount <= 0) return 0;
  return Math.max(1, Math.ceil(itemCount / pageSize));
}

export function computeApproxFps(
  durationMs: number,
  frameCount: number,
): number {
  if (durationMs <= 0 || frameCount <= 0) return 0;
  return Math.round((frameCount / durationMs) * 1000);
}

export function isSlowGroupListScroll(sample: {
  approxFps: number;
  maxFrameGapMs: number;
  itemCount: number;
}): boolean {
  if (sample.itemCount < GROUP_LIST_MIN_ITEMS_FOR_SCROLL_SIGNAL) return false;
  return (
    sample.approxFps > 0 && sample.approxFps < GROUP_LIST_SLOW_FPS_THRESHOLD
  ) || sample.maxFrameGapMs >= GROUP_LIST_SLOW_FRAME_GAP_MS;
}

export function isSlowGroupListLoadMore(loadMoreMs: number): boolean {
  return loadMoreMs >= GROUP_LIST_SLOW_LOAD_MORE_MS;
}

/**
 * Pure sampler: returns true when this scroll session should emit PostHog.
 * Inject `random` / `now` for tests.
 */
export function shouldCaptureGroupListScroll(input: {
  tab: GroupListTab;
  lastCapturedAtByTab: Partial<Record<GroupListTab, number>>;
  nowMs?: number;
  random?: () => number;
  sampleRate?: number;
  throttleMs?: number;
}): boolean {
  const nowMs = input.nowMs ?? Date.now();
  const random = input.random ?? Math.random;
  const sampleRate = input.sampleRate ?? GROUP_LIST_SCROLL_SAMPLE_RATE;
  const throttleMs = input.throttleMs ?? GROUP_LIST_SCROLL_THROTTLE_MS;
  const last = input.lastCapturedAtByTab[input.tab];
  if (last != null && nowMs - last < throttleMs) return false;
  return random() < sampleRate;
}

export function buildGroupListScrollProperties(sample: GroupListScrollSample) {
  return {
    tab: sample.tab,
    item_count: sample.itemCount,
    page_count: sample.pageCount,
    duration_ms: sample.durationMs,
    frame_count: sample.frameCount,
    max_frame_gap_ms: sample.maxFrameGapMs,
    approx_fps: sample.approxFps,
    platform: sample.platform,
    list_impl: "flatlist" as const,
    slow: isSlowGroupListScroll(sample),
  };
}

export function buildGroupListPageLoadedProperties(
  sample: GroupListPageLoadedSample,
) {
  return {
    tab: sample.tab,
    item_count: sample.itemCount,
    page_count: sample.pageCount,
    load_more_ms: sample.loadMoreMs,
    platform: sample.platform,
    list_impl: "flatlist" as const,
    slow: isSlowGroupListLoadMore(sample.loadMoreMs),
  };
}

/**
 * Human guidance for the PR / ops notes — not enforced in code.
 */
export const GROUP_LIST_FLASHLIST_HEURISTIC = {
  watchInSentry:
    "Breadcrumbs category `ui.list.perf` + tags `group_list_approx_fps` / `group_list_max_frame_gap_ms` / `group_list_load_more_ms` on sessions that later crash or hang.",
  watchInPostHog:
    "`group_list_scroll` (sampled) and `group_list_page_loaded` — break down by platform, tab, item_count buckets.",
  considerFlashListWhen:
    "Repeated slow scrolls: approx_fps < 40 or max_frame_gap_ms ≥ 100 with item_count ≥ 40 on mid/low devices; or users regularly load 5+ pages while fps stays low. Prefer FlashList over micro-optimizing FlatList props first if those signals recur across users.",
} as const;
