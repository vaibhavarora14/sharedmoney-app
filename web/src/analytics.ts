import type { CaptureResult } from "posthog-js";
import { sanitizeAnalyticsRecord } from "../../shared/webVitalsPrivacy";
import type { PlatformDestination } from "./landingContent";
import { platformDestinations } from "./landingContent";
import type { SeoPage, SeoTool } from "./seoPages";
import { detectDevice } from "./utils/deviceDetection";

/**
 * Landing / SEO analytics only (Vite site).
 * Product activation events for SharedMoney Production PostHog project 563625
 * (`auth_succeeded`, `group_created`, `group_joined`, `expense_created`, …)
 * are emitted from the Expo app — see `mobile/utils/posthogEvents.ts`.
 */

type PostHogClient = typeof import("posthog-js").default;

/**
 * Standard `$pageview`, `$pageleave`, and `$web_vitals` for the marketing site.
 * `web_vitals: true` overrides PostHog remote config so capture does not
 * depend on a project setting. Session replay and autocapture stay off.
 */
export const marketingPostHogClientOptions = {
  autocapture: false,
  capture_pageview: true,
  capture_pageleave: true,
  capture_performance: { web_vitals: true },
  disable_session_recording: true,
  person_profiles: "never",
  persistence: "memory",
} as const;

export function sanitizeMarketingCapture(capture: CaptureResult | null): CaptureResult | null {
  if (!capture) return capture;
  const properties = sanitizeAnalyticsRecord(capture.properties);
  if (!properties) return null;
  return { ...capture, properties };
}

let analyticsRequested = false;
let analyticsEnabled = false;
let posthogClient: PostHogClient | null = null;
let ssrCtaDelegationBound = false;
const queuedEvents: Array<{ event: string; properties: Record<string, string> }> = [];

function capture(event: string, properties: Record<string, string>) {
  if (analyticsEnabled && posthogClient) {
    posthogClient.capture(event, properties);
    return;
  }

  if (analyticsRequested) {
    queuedEvents.push({ event, properties });
  }
}

export function findDestinationForPlatform(
  platform: string | null | undefined,
): PlatformDestination | null {
  if (platform !== "android" && platform !== "ios" && platform !== "web") {
    return null;
  }

  return platformDestinations.find((item) => item.platform === platform) ?? null;
}

function onSsrCtaClick(event: Event) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const anchor = target.closest("a[data-seo-cta]");
  if (!(anchor instanceof HTMLAnchorElement)) {
    return;
  }

  const destination = findDestinationForPlatform(anchor.dataset.platform);
  if (!destination) {
    return;
  }

  trackCtaClick(destination, anchor.dataset.placement || "ssr_fallback", anchor);
}

/** Capture clicks on stamped SSR fallback CTAs before React replaces them. */
export function bindSsrCtaClickDelegation() {
  if (typeof document === "undefined" || ssrCtaDelegationBound) {
    return;
  }

  ssrCtaDelegationBound = true;
  document.addEventListener("click", onSsrCtaClick, true);
}

export function initializeAnalytics(): boolean {
  bindSsrCtaClickDelegation();

  const key = import.meta.env.VITE_POSTHOG_KEY?.trim();
  const host = import.meta.env.VITE_POSTHOG_HOST?.trim();

  if (!key) {
    return false;
  }

  analyticsRequested = true;
  void import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(key, {
        ...marketingPostHogClientOptions,
        api_host: host || "https://us.i.posthog.com",
        before_send: sanitizeMarketingCapture,
      });
      posthogClient = posthog;
      analyticsEnabled = true;

      queuedEvents.splice(0).forEach(({ event, properties }) => {
        posthog.capture(event, properties);
      });
    })
    .catch(() => {
      analyticsRequested = false;
      queuedEvents.splice(0);
    });

  return true;
}

export function trackPageView(page: SeoPage) {
  capture("seo page viewed", {
    page_path: page.path,
    page_type: page.kind,
    region: page.region,
  });
}

export function seoCtaClickedEvent(input: {
  platform: string;
  placement: string;
  device: string;
  pagePath: string;
  source?: string;
}): { event: "seo cta clicked"; properties: Record<string, string> } {
  const properties: Record<string, string> = {
    platform: input.platform,
    placement: input.placement,
    device: input.device,
    page_path: input.pagePath,
  };
  const source = input.source?.trim();
  if (source) {
    properties.source = source;
  }
  return { event: "seo cta clicked", properties };
}

export function trackCtaClick(
  destination: PlatformDestination,
  placement: string,
  source?: HTMLElement,
) {
  // Capture-phase delegation and the React handler can both see one click.
  if (source?.dataset.seoTracked === "1") return;
  if (source) source.dataset.seoTracked = "1";

  const pathname =
    typeof window !== "undefined" ? window.location.pathname.replace(/\/+$/, "") || "/" : "";

  const tracked = seoCtaClickedEvent({
    platform: destination.platform,
    placement,
    device: detectDevice(),
    pagePath: pathname,
    source: source?.dataset.source,
  });
  capture(tracked.event, tracked.properties);
}

export function trackToolStarted(tool: SeoTool) {
  capture("seo tool started", { tool });
}

export function trackToolCompleted(tool: SeoTool) {
  capture("seo tool completed", { tool });
}

export function trackRelatedPageClick(from: SeoPage, to: SeoPage) {
  capture("seo related page clicked", {
    from_path: from.path,
    to_path: to.path,
  });
}
