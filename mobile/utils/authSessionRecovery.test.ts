import { assertEquals } from "jsr:@std/assert@1";
import {
  createSessionRefreshController,
  decideSessionRecovery,
  isFatalRefreshFailure,
  parsePersistedAuthSession,
  planAuthStateChange,
  readPersistedAuthSession,
  shouldApplyAuthEvent,
  shouldRefreshAccessTokenOnForeground,
  supabaseAuthStorageKey,
} from "./authSessionRecovery.ts";

const cachedSession = {
  access_token: "access",
  refresh_token: "refresh",
  user: { id: "user-1" },
};

function networkError() {
  return Object.assign(new Error("Network request failed"), {
    name: "AuthRetryableFetchError",
  });
}

function invalidRefreshTokenError() {
  return Object.assign(new Error("Invalid Refresh Token: Refresh Token Not Found"), {
    name: "AuthApiError",
    status: 400,
    code: "refresh_token_not_found",
  });
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

Deno.test("timeout -> stays signed in", () => {
  assertEquals(
    decideSessionRecovery({
      source: "timeout",
      session: cachedSession,
    }),
    { action: "keep-existing" },
  );
});

Deno.test("network error -> stays signed in", () => {
  assertEquals(
    decideSessionRecovery({
      source: "resolved",
      session: null,
      error: networkError(),
    }),
    { action: "keep-existing" },
  );
  assertEquals(
    decideSessionRecovery({
      source: "exception",
      error: new TypeError("Failed to fetch"),
    }),
    { action: "keep-existing" },
  );
});

Deno.test("reconnect -> refresh called", async () => {
  let refreshCalls = 0;
  let autoRefreshStarted = 0;
  const controller = createSessionRefreshController({
    refreshSession: async () => {
      refreshCalls += 1;
      return { error: null };
    },
    startAutoRefresh: () => {
      autoRefreshStarted += 1;
    },
    stopAutoRefresh: () => {},
    onFatalFailure: () => {
      throw new Error("should not sign out on reconnect");
    },
  });

  controller.handleAppStateChange("active");
  await flushMicrotasks();
  assertEquals(refreshCalls, 0);
  assertEquals(autoRefreshStarted, 1);

  controller.handleAppStateChange("background");
  controller.handleAppStateChange("active");
  await flushMicrotasks();

  assertEquals(refreshCalls, 1);
  assertEquals(autoRefreshStarted, 2);
  controller.stop();
});

Deno.test("invalid refresh token -> signs out", async () => {
  let signedOut = false;
  const controller = createSessionRefreshController({
    refreshSession: async () => ({ error: invalidRefreshTokenError() }),
    startAutoRefresh: () => {},
    stopAutoRefresh: () => {},
    onFatalFailure: () => {
      signedOut = true;
    },
  });

  controller.handleAppStateChange("background");
  controller.handleAppStateChange("active");
  await flushMicrotasks();

  assertEquals(signedOut, true);
  assertEquals(
    decideSessionRecovery({
      source: "resolved",
      error: invalidRefreshTokenError(),
    }),
    { action: "sign-out" },
  );
  controller.stop();
});

Deno.test("isFatalRefreshFailure matches AuthApiError grant failures", () => {
  assertEquals(isFatalRefreshFailure(invalidRefreshTokenError()), true);
  assertEquals(
    isFatalRefreshFailure({
      name: "AuthApiError",
      status: 401,
      code: "invalid_grant",
      message: "invalid_grant",
    }),
    true,
  );
  assertEquals(isFatalRefreshFailure(networkError()), false);
});

Deno.test("INITIAL_SESSION+null while signed in keeps the session and schedules a retry", () => {
  assertEquals(shouldApplyAuthEvent("INITIAL_SESSION", null, true), false);
  assertEquals(planAuthStateChange("INITIAL_SESSION", null, true), {
    apply: false,
    scheduleRetry: true,
  });
});

Deno.test("TOKEN_REFRESHED/other null events while signed in keep the session", () => {
  assertEquals(shouldApplyAuthEvent("TOKEN_REFRESHED", null, true), false);
  assertEquals(planAuthStateChange("TOKEN_REFRESHED", null, true), {
    apply: false,
    scheduleRetry: true,
  });
  assertEquals(shouldApplyAuthEvent("USER_UPDATED", null, true), false);
  assertEquals(shouldApplyAuthEvent("SIGNED_IN", null, true), false);
});

Deno.test("SIGNED_OUT clears the session", () => {
  assertEquals(shouldApplyAuthEvent("SIGNED_OUT", null, true), true);
  assertEquals(planAuthStateChange("SIGNED_OUT", null, true), {
    apply: true,
    scheduleRetry: false,
  });
});

Deno.test("INITIAL_SESSION+null with no session stays signed out", () => {
  assertEquals(shouldApplyAuthEvent("INITIAL_SESSION", null, false), true);
  assertEquals(planAuthStateChange("INITIAL_SESSION", null, false), {
    apply: true,
    scheduleRetry: false,
  });
});

Deno.test("foreground skips refresh when access token is still fresh", async () => {
  let refreshCalls = 0;
  const now = 1_700_000_000;
  const controller = createSessionRefreshController({
    refreshSession: async () => {
      refreshCalls += 1;
      return { error: null };
    },
    startAutoRefresh: () => {},
    stopAutoRefresh: () => {},
    onFatalFailure: () => {
      throw new Error("should not sign out");
    },
    getAccessTokenExpiresAt: () => now + 10 * 60,
    nowSeconds: () => now,
  });

  controller.handleAppStateChange("background");
  controller.handleAppStateChange("active");
  await flushMicrotasks();
  assertEquals(refreshCalls, 0);
  assertEquals(shouldRefreshAccessTokenOnForeground(now + 10 * 60, now), false);
  controller.stop();
});

Deno.test("foreground refreshes when access token expires within 5 minutes", async () => {
  let refreshCalls = 0;
  const now = 1_700_000_000;
  const controller = createSessionRefreshController({
    refreshSession: async () => {
      refreshCalls += 1;
      return { error: null };
    },
    startAutoRefresh: () => {},
    stopAutoRefresh: () => {},
    onFatalFailure: () => {
      throw new Error("should not sign out");
    },
    getAccessTokenExpiresAt: () => now + 4 * 60,
    nowSeconds: () => now,
  });

  controller.handleAppStateChange("background");
  controller.handleAppStateChange("active");
  await flushMicrotasks();
  assertEquals(refreshCalls, 1);
  assertEquals(shouldRefreshAccessTokenOnForeground(now + 4 * 60, now), true);
  controller.stop();
});

Deno.test("persisted session is read from the default supabase storage key", async () => {
  assertEquals(
    supabaseAuthStorageKey("https://abcd.supabase.co"),
    "sb-abcd-auth-token",
  );

  const stored = JSON.stringify({
    access_token: "access",
    refresh_token: "refresh",
    user: { id: "user-1", email: "a@example.com" },
  });
  assertEquals(parsePersistedAuthSession(stored)?.user?.id, "user-1");

  const session = await readPersistedAuthSession(
    async (key) => (key === "sb-abcd-auth-token" ? stored : null),
    "https://abcd.supabase.co",
  );
  assertEquals(session?.access_token, "access");
});
