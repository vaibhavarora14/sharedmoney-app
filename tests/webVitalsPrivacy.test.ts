import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  containsSecretToken,
  sanitizeAnalyticsRecord,
  sanitizeSpeedInsightsVital,
  sanitizeWebVitalUrl,
} from "../shared/webVitalsPrivacy.ts";

const TOKEN = "a".repeat(64);

Deno.test("sanitizeWebVitalUrl keeps public paths and drops query, hash, and tokens", () => {
  assertEquals(
    sanitizeWebVitalUrl("https://sharedmoney.app/pricing?utm_source=x#faq"),
    "https://sharedmoney.app/pricing",
  );
  assertEquals(
    sanitizeWebVitalUrl(`https://sharedmoney.app/split/${TOKEN}?guest=1`),
    "https://sharedmoney.app/split/:token",
  );
  assertEquals(
    sanitizeWebVitalUrl(`https://sharedmoney.app/owe/${TOKEN}?ref=1`),
    "https://sharedmoney.app/owe/:token",
  );
  assertEquals(
    sanitizeWebVitalUrl(`https://sharedmoney.app/app/join/${TOKEN.toUpperCase()}`),
    "https://sharedmoney.app/app/join/:token",
  );
  assertEquals(
    sanitizeWebVitalUrl("https://sharedmoney.app/app/groups/11111111-2222-3333-4444-555555555555"),
    "https://sharedmoney.app/app/groups/11111111-2222-3333-4444-555555555555",
  );
  assertEquals(sanitizeWebVitalUrl("javascript:alert(1)"), null);
  assertEquals(sanitizeWebVitalUrl("not a url"), null);
});

Deno.test("sanitizeSpeedInsightsVital rewrites href secrets and drops unsafe URLs", () => {
  assertEquals(
    sanitizeSpeedInsightsVital({
      type: "vital",
      url: `https://sharedmoney.app/app/join/${TOKEN}`,
      route: `/app/join/${TOKEN}?x=1`,
    }),
    {
      type: "vital",
      url: "https://sharedmoney.app/app/join/:token",
      route: "/app/join/:token",
    },
  );
  assertEquals(
    sanitizeSpeedInsightsVital({ type: "vital", url: "sharedmoney://join/abc" }),
    null,
  );
});

Deno.test("sanitizeAnalyticsRecord scrubs nested URLs and refuses leftover secrets", () => {
  assertEquals(
    sanitizeAnalyticsRecord({
      $current_url: `https://sharedmoney.app/split/${TOKEN}?code=secret`,
      $pathname: `/split/${TOKEN}`,
      $web_vitals_LCP_value: 123,
      $web_vitals_LCP_event: { name: "LCP", id: "v1", nested: `https://sharedmoney.app/join/${TOKEN}` },
    }),
    {
      $current_url: "https://sharedmoney.app/split/:token",
      $pathname: "/split/:token",
      $web_vitals_LCP_value: 123,
      $web_vitals_LCP_event: { name: "LCP", id: "v1", nested: "https://sharedmoney.app/join/:token" },
    },
  );
  assertEquals(containsSecretToken({ url: `https://sharedmoney.app/split/${TOKEN}` }), true);
});
