import * as Sentry from "@sentry/react-native";
import { Platform } from "react-native";
import { captureIdentifiedAnalyticsEvent } from "./posthogAnalytics";
import { ANALYTICS_EVENTS } from "./posthogEvents";
import {
  GROUP_LIST_STALL_FRAME_GAP_MS,
  buildGroupListPageLoadedProperties,
  buildGroupListScrollProperties,
  computeApproxFps,
  isSlowGroupListLoadMore,
  shouldCaptureGroupListScroll,
  type GroupListPageLoadedSample,
  type GroupListScrollSample,
  type GroupListTab,
} from "./groupListPerf";

type BreadcrumbLevel = "fatal" | "error" | "warning" | "log" | "info" | "debug";

const lastScrollCaptureAtByTab: Partial<Record<GroupListTab, number>> = {};

function safeBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
  level: BreadcrumbLevel = "info",
) {
  try {
    Sentry.addBreadcrumb({ category, message, level, data });
  } catch {
    // Telemetry must never break the app.
  }
}

function safeSetTag(key: string, value: string) {
  try {
    Sentry.setTag(key, value);
  } catch {
    // Telemetry must never break the app.
  }
}

/**
 * Lightweight rAF sampler while the GroupDetails list is scrolling.
 * No native FPS APIs / extra deps — frame gaps approximate JS/UI stalls.
 */
export class GroupListScrollPerfMonitor {
  private running = false;
  private frameCount = 0;
  private maxFrameGapMs = 0;
  private startedAt = 0;
  private lastFrameAt = 0;
  private rafId: number | null = null;

  start() {
    this.stop();
    this.running = true;
    this.frameCount = 0;
    this.maxFrameGapMs = 0;
    this.startedAt = Date.now();
    this.lastFrameAt = this.startedAt;

    const tick = () => {
      if (!this.running) return;
      const now = Date.now();
      const gap = now - this.lastFrameAt;
      this.lastFrameAt = now;
      this.frameCount += 1;
      if (gap > this.maxFrameGapMs) this.maxFrameGapMs = gap;
      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  stop(): {
    durationMs: number;
    frameCount: number;
    maxFrameGapMs: number;
    approxFps: number;
  } | null {
    if (!this.running) return null;
    this.running = false;
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    const durationMs = Math.max(0, Date.now() - this.startedAt);
    // Need a few frames to be meaningful.
    if (this.frameCount < 5 || durationMs < 200) return null;

    return {
      durationMs,
      frameCount: this.frameCount,
      maxFrameGapMs: this.maxFrameGapMs,
      approxFps: computeApproxFps(durationMs, this.frameCount),
    };
  }
}

export function recordGroupListScrollTelemetry(input: {
  userId?: string | null;
  tab: GroupListTab;
  itemCount: number;
  pageCount: number;
  durationMs: number;
  frameCount: number;
  maxFrameGapMs: number;
  approxFps: number;
  platform?: string;
}): void {
  const sample: GroupListScrollSample = {
    tab: input.tab,
    itemCount: input.itemCount,
    pageCount: input.pageCount,
    durationMs: input.durationMs,
    frameCount: input.frameCount,
    maxFrameGapMs: input.maxFrameGapMs,
    approxFps: input.approxFps,
    platform: input.platform ?? Platform.OS,
  };

  const props = buildGroupListScrollProperties(sample);
  const slow = props.slow;

  safeSetTag("group_list_tab", sample.tab);
  safeSetTag("group_list_item_count", String(sample.itemCount));
  safeSetTag("group_list_page_count", String(sample.pageCount));
  safeSetTag("group_list_approx_fps", String(sample.approxFps));
  safeSetTag("group_list_max_frame_gap_ms", String(sample.maxFrameGapMs));

  safeBreadcrumb(
    "ui.list.perf",
    slow ? "Group list slow scroll" : "Group list scroll sample",
    props,
    slow ? "warning" : "debug",
  );

  if (sample.maxFrameGapMs >= GROUP_LIST_STALL_FRAME_GAP_MS) {
    safeBreadcrumb(
      "ui.list.perf",
      "Group list frame stall during scroll",
      {
        tab: sample.tab,
        max_frame_gap_ms: sample.maxFrameGapMs,
        item_count: sample.itemCount,
        platform: sample.platform,
      },
      sample.maxFrameGapMs >= 100 ? "warning" : "info",
    );
  }

  try {
    Sentry.setMeasurement("group_list_approx_fps", sample.approxFps, "none");
    Sentry.setMeasurement(
      "group_list_max_frame_gap_ms",
      sample.maxFrameGapMs,
      "millisecond",
    );
  } catch {
    // Optional measurement API — ignore if unsupported.
  }

  if (
    !shouldCaptureGroupListScroll({
      tab: sample.tab,
      lastCapturedAtByTab: lastScrollCaptureAtByTab,
    })
  ) {
    return;
  }

  lastScrollCaptureAtByTab[sample.tab] = Date.now();
  captureIdentifiedAnalyticsEvent(
    input.userId,
    ANALYTICS_EVENTS.GROUP_LIST_SCROLL,
    props,
  );
}

export async function withGroupListFetchNextPageTelemetry<T>(input: {
  userId?: string | null;
  tab: GroupListTab;
  itemCountBefore: number;
  pageCountBefore: number;
  fetch: () => Promise<T>;
  resolveCounts: (result: T) => { itemCount: number; pageCount: number };
  platform?: string;
}): Promise<T> {
  const startedAt = Date.now();
  const span = Sentry.startInactiveSpan({
    name: "group_list.fetch_next_page",
    op: "ui.load",
    attributes: {
      tab: input.tab,
      item_count_before: input.itemCountBefore,
      page_count_before: input.pageCountBefore,
      platform: input.platform ?? Platform.OS,
    },
  });

  try {
    const result = await input.fetch();
    const loadMoreMs = Math.max(0, Date.now() - startedAt);
    const counts = input.resolveCounts(result);
    const sample: GroupListPageLoadedSample = {
      tab: input.tab,
      itemCount: counts.itemCount,
      pageCount: counts.pageCount,
      loadMoreMs,
      platform: input.platform ?? Platform.OS,
    };
    const props = buildGroupListPageLoadedProperties(sample);

    safeSetTag("group_list_tab", sample.tab);
    safeSetTag("group_list_item_count", String(sample.itemCount));
    safeSetTag("group_list_page_count", String(sample.pageCount));
    safeSetTag("group_list_load_more_ms", String(sample.loadMoreMs));

    safeBreadcrumb(
      "ui.list.perf",
      isSlowGroupListLoadMore(sample.loadMoreMs)
        ? "Group list slow fetchNextPage"
        : "Group list fetchNextPage",
      props,
      isSlowGroupListLoadMore(sample.loadMoreMs) ? "warning" : "info",
    );

    try {
      Sentry.setMeasurement(
        "group_list_load_more_ms",
        sample.loadMoreMs,
        "millisecond",
      );
    } catch {
      // Optional.
    }

    captureIdentifiedAnalyticsEvent(
      input.userId,
      ANALYTICS_EVENTS.GROUP_LIST_PAGE_LOADED,
      props,
    );

    return result;
  } finally {
    span?.end();
  }
}

/** Test-only reset for throttle state. */
export function resetGroupListScrollCaptureThrottleForTests() {
  for (const key of Object.keys(lastScrollCaptureAtByTab) as GroupListTab[]) {
    delete lastScrollCaptureAtByTab[key];
  }
}
