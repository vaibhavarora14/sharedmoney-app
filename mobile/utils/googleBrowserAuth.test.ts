import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  classifyGoogleAuthSessionResult,
  openGoogleAuthSession,
  pickCustomTabsBrowserPackage,
  type CustomTabsBrowserListing,
  type GoogleAuthBrowserResult,
  type GoogleBrowserAuthDependencies,
} from "./googleBrowserAuth.ts";

const NO_BROWSER = new Error("No matching browser activity found");

Deno.test("pickCustomTabsBrowserPackage prefers a full Custom Tabs browser", () => {
  assertEquals(
    pickCustomTabsBrowserPackage({
      preferredBrowserPackage: "com.android.chrome",
      defaultBrowserPackage: "com.other.browser",
      browserPackages: ["com.fallback.browser"],
    }),
    "com.android.chrome",
  );
});

Deno.test("pickCustomTabsBrowserPackage falls back to the first resolving package", () => {
  assertEquals(
    pickCustomTabsBrowserPackage({
      preferredBrowserPackage: "  ",
      defaultBrowserPackage: null,
      browserPackages: ["", "com.android.chrome"],
    }),
    "com.android.chrome",
  );
  assertEquals(pickCustomTabsBrowserPackage({ browserPackages: [] }), null);
  assertEquals(pickCustomTabsBrowserPackage(null), null);
});

function deps(options: {
  openResults: Array<GoogleAuthBrowserResult | Error>;
  listing?: CustomTabsBrowserListing | Error;
}): {
  dependencies: GoogleBrowserAuthDependencies;
  calls: Array<{ url: string; redirectUrl: string; browserPackage?: string }>;
  listed: { count: number };
} {
  const calls: Array<{ url: string; redirectUrl: string; browserPackage?: string }> = [];
  const listed = { count: 0 };
  const openResults = [...options.openResults];

  return {
    calls,
    listed,
    dependencies: {
      openAuthSession: async (url, redirectUrl, openOptions) => {
        calls.push({
          url,
          redirectUrl,
          browserPackage: openOptions?.browserPackage,
        });
        const next = openResults.shift();
        if (!next) throw new Error("missing open result");
        if (next instanceof Error) throw next;
        return next;
      },
      listCustomTabsBrowsers: async () => {
        listed.count += 1;
        if (options.listing instanceof Error) throw options.listing;
        return options.listing ?? { browserPackages: [] };
      },
    },
  };
}

Deno.test("successful auth session does not query installed browsers", async () => {
  const harness = deps({
    openResults: [{ type: "success", url: "sharedmoney://auth/callback#access_token=a" }],
  });

  const result = await openGoogleAuthSession(
    "https://accounts.google.com",
    "sharedmoney://auth/callback",
    harness.dependencies,
    "android",
  );

  assertEquals(result.type, "success");
  assertEquals(harness.listed.count, 0);
  assertEquals(harness.calls.length, 1);
  assertEquals(harness.calls[0].browserPackage, undefined);
});

Deno.test("Android retries with an explicit Custom Tabs package", async () => {
  const harness = deps({
    openResults: [
      NO_BROWSER,
      { type: "success", url: "sharedmoney://auth/callback#ok" },
    ],
    listing: {
      preferredBrowserPackage: undefined,
      defaultBrowserPackage: undefined,
      browserPackages: ["com.android.chrome"],
    },
  });

  const result = await openGoogleAuthSession(
    "https://accounts.google.com",
    "sharedmoney://auth/callback",
    harness.dependencies,
    "android",
  );

  assertEquals(result.type, "success");
  assertEquals(harness.listed.count, 1);
  assertEquals(harness.calls.map((call) => call.browserPackage), [
    undefined,
    "com.android.chrome",
  ]);
});

Deno.test("Android rethrows the original error when no browser is installed", async () => {
  const harness = deps({
    openResults: [NO_BROWSER],
    listing: { browserPackages: [] },
  });

  const error = await assertRejects(
    () =>
      openGoogleAuthSession(
        "https://accounts.google.com",
        "sharedmoney://auth/callback",
        harness.dependencies,
        "android",
      ),
    Error,
    "No matching browser activity found",
  );

  assertEquals(error, NO_BROWSER);
  assertEquals(harness.calls.length, 1);
});

Deno.test("a wrapped Expo cause still triggers the browser retry", async () => {
  const wrapped = new Error(
    "Call to function 'ExpoWebBrowser.openBrowserAsync' has been rejected.",
  );
  wrapped.cause = new Error("No matching activity!");
  const harness = deps({
    openResults: [wrapped, { type: "cancel" }],
    listing: { preferredBrowserPackage: "com.android.chrome" },
  });

  const result = await openGoogleAuthSession(
    "https://accounts.google.com",
    "sharedmoney://auth/callback",
    harness.dependencies,
    "android",
  );

  assertEquals(result.type, "cancel");
  assertEquals(harness.calls[1].browserPackage, "com.android.chrome");
});

Deno.test("browser listing failure keeps the original rejection", async () => {
  const harness = deps({
    openResults: [NO_BROWSER],
    listing: new Error("Package Manager not found"),
  });

  await assertRejects(
    () =>
      openGoogleAuthSession(
        "https://accounts.google.com",
        "sharedmoney://auth/callback",
        harness.dependencies,
        "android",
      ),
    Error,
    "No matching browser activity found",
  );
  assertEquals(harness.calls.length, 1);
});

Deno.test("iOS dismiss is an incomplete Google session, not a silent cancel", () => {
  assertEquals(classifyGoogleAuthSessionResult("success"), "success");
  assertEquals(classifyGoogleAuthSessionResult("cancel"), "cancelled");
  assertEquals(classifyGoogleAuthSessionResult("dismiss"), "incomplete");
  assertEquals(classifyGoogleAuthSessionResult("opened"), "incomplete");
  assertEquals(classifyGoogleAuthSessionResult("locked"), "incomplete");
});

Deno.test("iOS does not retry a browser resolution failure", async () => {
  const harness = deps({
    openResults: [NO_BROWSER],
    listing: { preferredBrowserPackage: "com.android.chrome" },
  });

  await assertRejects(
    () =>
      openGoogleAuthSession(
        "https://accounts.google.com",
        "sharedmoney://auth/callback",
        harness.dependencies,
        "ios",
      ),
    Error,
    "No matching browser activity found",
  );
  assertEquals(harness.listed.count, 0);
});

Deno.test("unrelated auth errors are not retried", async () => {
  const harness = deps({
    openResults: [new Error("Network request failed")],
    listing: { preferredBrowserPackage: "com.android.chrome" },
  });

  await assertRejects(
    () =>
      openGoogleAuthSession(
        "https://accounts.google.com",
        "sharedmoney://auth/callback",
        harness.dependencies,
        "android",
      ),
    Error,
    "Network request failed",
  );
  assertEquals(harness.listed.count, 0);
});
