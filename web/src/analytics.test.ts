import { describe, expect, it } from "vitest";
import {
  findDestinationForPlatform,
  marketingPostHogClientOptions,
  sanitizeMarketingCapture,
  seoCtaClickedEvent,
} from "./analytics";

describe("SSR CTA destination resolution", () => {
  it("maps stamped SSR platforms to landing destinations", () => {
    expect(findDestinationForPlatform("android")?.platform).toBe("android");
    expect(findDestinationForPlatform("ios")?.platform).toBe("ios");
    expect(findDestinationForPlatform("web")?.platform).toBe("web");
  });

  it("captures pageviews and web vitals without session replay", () => {
    expect(marketingPostHogClientOptions.capture_pageview).toBe(true);
    expect(marketingPostHogClientOptions.capture_pageleave).toBe(true);
    expect(marketingPostHogClientOptions.capture_performance.web_vitals).toBe(true);
    expect(marketingPostHogClientOptions.autocapture).toBe(false);
    expect(marketingPostHogClientOptions.disable_session_recording).toBe(true);
  });

  it("drops marketing captures that still contain a bearer token", () => {
    const token = "b".repeat(64);
    expect(
      sanitizeMarketingCapture({
        uuid: "00000000-0000-0000-0000-000000000000",
        event: "$pageview",
        properties: { $current_url: `https://sharedmoney.app/split/${token}` },
      }),
    ).toEqual({
      uuid: "00000000-0000-0000-0000-000000000000",
      event: "$pageview",
      properties: { $current_url: "https://sharedmoney.app/split/:token" },
    });
  });

  it("fires seo cta clicked with source=calculator for calculator results", () => {
    expect(
      seoCtaClickedEvent({
        platform: "android",
        placement: "split_bill_result_android",
        device: "desktop",
        pagePath: "/tools/split-bill-calculator",
        source: "calculator",
      }),
    ).toEqual({
      event: "seo cta clicked",
      properties: {
        platform: "android",
        placement: "split_bill_result_android",
        device: "desktop",
        page_path: "/tools/split-bill-calculator",
        source: "calculator",
      },
    });
  });

  it("omits source on CTAs that are not calculator results", () => {
    const tracked = seoCtaClickedEvent({
      platform: "web",
      placement: "header",
      device: "desktop",
      pagePath: "/",
    });
    expect(tracked.event).toBe("seo cta clicked");
    expect(tracked.properties).not.toHaveProperty("source");
  });

  it("rejects unknown or missing platforms", () => {
    expect(findDestinationForPlatform(undefined)).toBeNull();
    expect(findDestinationForPlatform(null)).toBeNull();
    expect(findDestinationForPlatform("desktop")).toBeNull();
    expect(findDestinationForPlatform("")).toBeNull();
  });
});
