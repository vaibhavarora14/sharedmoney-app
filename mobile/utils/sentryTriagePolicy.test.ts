import { assertEquals } from "jsr:@std/assert@1";
import {
  resolveAuthSessionTransition,
  resolveSentryReplaySampleRates,
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
