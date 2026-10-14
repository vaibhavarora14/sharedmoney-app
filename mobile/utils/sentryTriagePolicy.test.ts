import { assertEquals } from "jsr:@std/assert@1";
import {
  resolveAuthSessionTransition,
  resolveSentryReplaySampleRates,
  shouldReportRatesFetchError,
} from "./sentryTriagePolicy.ts";

Deno.test("replay defaults keep error capture and lower iOS session sampling", () => {
  assertEquals(
    resolveSentryReplaySampleRates({ platform: "ios", env: {} }),
    {
      replaysSessionSampleRate: 0.02,
      replaysOnErrorSampleRate: 1.0,
    },
  );
  assertEquals(
    resolveSentryReplaySampleRates({ platform: "android", env: {} }),
    {
      replaysSessionSampleRate: 0.05,
      replaysOnErrorSampleRate: 1.0,
    },
  );
});

Deno.test("replay env overrides win over platform defaults", () => {
  assertEquals(
    resolveSentryReplaySampleRates({
      platform: "ios",
      env: {
        EXPO_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE: "0.1",
        EXPO_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE: "0.5",
      },
    }),
    {
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 0.5,
    },
  );
});

Deno.test("auth session transitions stay PII-free and stable", () => {
  assertEquals(resolveAuthSessionTransition(null, "u1"), "signed_in");
  assertEquals(resolveAuthSessionTransition("u1", null), "signed_out");
  assertEquals(resolveAuthSessionTransition("u1", "u1"), "session_refresh");
  assertEquals(resolveAuthSessionTransition("u1", "u2"), "signed_in");
  assertEquals(resolveAuthSessionTransition(null, null), null);
});

Deno.test("rates fetch: missing session is expected noise, not a Sentry error (REACT-NATIVE-24)", () => {
  assertEquals(shouldReportRatesFetchError(new Error("Not authenticated")), false);
  assertEquals(shouldReportRatesFetchError("Not authenticated"), false);
  assertEquals(shouldReportRatesFetchError(new Error("Request timed out")), true);
  assertEquals(shouldReportRatesFetchError(new Error("Internal server error")), true);
});
