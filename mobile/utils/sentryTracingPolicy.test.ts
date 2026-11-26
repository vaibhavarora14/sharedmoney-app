import { assertEquals } from "jsr:@std/assert@1";
import {
  resolveSentryTracePropagationTargets,
  resolveSentryTracesSampleRate,
  scrubSentryBreadcrumb,
  scrubSentryTransaction,
  shouldCreateSentryHttpSpan,
} from "./sentryTracingPolicy.ts";

Deno.test("traces sample rate defaults to 1.0 while traffic is tiny", () => {
  assertEquals(resolveSentryTracesSampleRate({ env: {} }), 1.0);
});

Deno.test("traces sample rate honors explicit env overrides", () => {
  assertEquals(
    resolveSentryTracesSampleRate({
      env: { EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: "0.25" },
    }),
    0.25,
  );
  assertEquals(
    resolveSentryTracesSampleRate({
      env: { EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: "0" },
    }),
    0,
  );
  assertEquals(
    resolveSentryTracesSampleRate({
      env: { EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: "2" },
    }),
    1.0,
  );
  assertEquals(
    resolveSentryTracesSampleRate({
      env: { EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: "nope" },
    }),
    1.0,
  );
});

Deno.test("traces sample rate default path reads process.env.EXPO_PUBLIC_* directly", () => {
  const key = "EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE";
  const previous = process.env[key];
  try {
    process.env[key] = "0.4";
    assertEquals(resolveSentryTracesSampleRate(), 0.4);
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

Deno.test("trace propagation targets keep hosts only (no secrets)", () => {
  assertEquals(
    resolveSentryTracePropagationTargets({
      supabaseUrl: "https://abc.supabase.co",
      apiUrl: "https://abc.supabase.co/functions/v1",
    }),
    ["abc.supabase.co", "abc.supabase.co", "localhost", "127.0.0.1"],
  );
});

Deno.test("HTTP spans are created for Supabase hosts and skipped elsewhere", () => {
  const targets = resolveSentryTracePropagationTargets({
    supabaseUrl: "https://abc.supabase.co",
    apiUrl: "https://abc.supabase.co/functions/v1",
  });
  assertEquals(
    shouldCreateSentryHttpSpan("https://abc.supabase.co/functions/v1/groups", targets),
    true,
  );
  assertEquals(
    shouldCreateSentryHttpSpan("https://evil.example/steal", targets),
    false,
  );
});

Deno.test("transaction scrubber keeps URLs but strips auth headers and tokens", () => {
  const scrubbed = scrubSentryTransaction({
    type: "transaction",
    transaction: "groups",
    request: {
      url: "https://abc.supabase.co/rest/v1/groups?apikey=secret-key&select=*",
      headers: {
        Authorization: "Bearer super-secret",
        authorization: "Bearer also-secret",
        "content-type": "application/json",
        apikey: "anon-or-service-key",
      },
    },
    spans: [
      {
        op: "http.client",
        description: "GET /rest/v1/groups",
        data: {
          "http.request.header.authorization": "Bearer leak",
          "http.request.header.content_type": "application/json",
          url: "https://abc.supabase.co/rest/v1/groups",
        },
      },
    ],
  });

  assertEquals(scrubbed?.request?.headers?.Authorization, "[Filtered]");
  assertEquals(scrubbed?.request?.headers?.authorization, "[Filtered]");
  assertEquals(scrubbed?.request?.headers?.apikey, "[Filtered]");
  assertEquals(
    scrubbed?.request?.headers?.["content-type"],
    "application/json",
  );
  assertEquals(scrubbed?.request?.url?.includes("apikey=filtered"), true);
  assertEquals(scrubbed?.request?.url?.includes("secret-key"), false);
  assertEquals(scrubbed?.request?.url?.includes("select=*"), true);
  assertEquals(
    scrubbed?.spans?.[0]?.data?.["http.request.header.authorization"],
    "[Filtered]",
  );
  assertEquals(
    scrubbed?.spans?.[0]?.data?.["http.request.header.content_type"],
    "application/json",
  );
});

Deno.test("breadcrumb scrubber strips Authorization without dropping the URL", () => {
  const breadcrumb = scrubSentryBreadcrumb({
    category: "fetch",
    data: {
      url: "https://abc.supabase.co/functions/v1/profile",
      method: "GET",
      headers: {
        Authorization: "Bearer token-value",
        "Content-Type": "application/json",
      },
    },
  });

  assertEquals(
    (breadcrumb?.data?.headers as Record<string, unknown>)?.Authorization,
    "[Filtered]",
  );
  assertEquals(
    (breadcrumb?.data?.headers as Record<string, unknown>)?.["Content-Type"],
    "application/json",
  );
  assertEquals(
    breadcrumb?.data?.url,
    "https://abc.supabase.co/functions/v1/profile",
  );
});
