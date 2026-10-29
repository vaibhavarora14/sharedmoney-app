import { assertEquals } from "jsr:@std/assert@1";
import {
  REVIEW_REQUESTED_STORAGE_KEY,
  reviewQualifyingExpenseCountKey,
} from "./inAppReviewEligibility.ts";
import {
  maybeRequestInAppReviewAfterExpense,
  requestNativeStoreReview,
  type InAppReviewPromptDependencies,
  type StoreReviewModule,
} from "./inAppReviewPromptLogic.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => Promise.resolve(map.get(key) ?? null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
      return Promise.resolve();
    },
    snapshot: () => Object.fromEntries(map.entries()),
  };
}

function baseDeps(
  overrides: Partial<InAppReviewPromptDependencies> & {
    storage: ReturnType<typeof memoryStorage>;
  },
): InAppReviewPromptDependencies & { flush: () => Promise<void> } {
  const pending: Promise<void>[] = [];
  return {
    platform: "ios",
    settleDelayMs: 0,
    schedule: (fn) => {
      const result = fn();
      pending.push(Promise.resolve(result).then(() => undefined));
      return 0;
    },
    loadStoreReview: () => null,
    captureEvent: () => {},
    reviewPromptRequestedEvent: "review_prompt_requested",
    ...overrides,
    flush: async () => {
      await Promise.all(pending.splice(0, pending.length));
    },
  };
}

Deno.test("requestNativeStoreReview no-ops when the native module is missing", async () => {
  assertEquals(await requestNativeStoreReview(() => null), "missing_module");
  assertEquals(
    await requestNativeStoreReview(() => {
      throw new Error("Cannot find native module 'ExpoStoreReview'");
    }),
    "missing_module",
  );
});

Deno.test("requestNativeStoreReview checks isAvailableAsync and hasAction", async () => {
  const unavailable: StoreReviewModule = {
    isAvailableAsync: async () => false,
    hasAction: async () => true,
    requestReview: async () => {
      throw new Error("should not be called");
    },
  };
  assertEquals(
    await requestNativeStoreReview(() => unavailable),
    "unavailable",
  );

  let requested = false;
  const available: StoreReviewModule = {
    isAvailableAsync: async () => true,
    hasAction: async () => true,
    requestReview: async () => {
      requested = true;
    },
  };
  assertEquals(await requestNativeStoreReview(() => available), "requested");
  assertEquals(requested, true);
});

Deno.test("maybeRequestInAppReviewAfterExpense counts multi-member expenses per user", async () => {
  const storage = memoryStorage();
  const userId = "user-1";

  await maybeRequestInAppReviewAfterExpense(
    { userId, transactionType: "expense", groupMemberCount: 2 },
    baseDeps({ storage }),
  );

  assertEquals(
    storage.snapshot()[reviewQualifyingExpenseCountKey(userId)],
    "1",
  );
  assertEquals(storage.snapshot()[REVIEW_REQUESTED_STORAGE_KEY], undefined);
});

Deno.test("maybeRequestInAppReviewAfterExpense ignores solo groups and non-expenses", async () => {
  const storage = memoryStorage();
  const userId = "user-1";

  await maybeRequestInAppReviewAfterExpense(
    { userId, transactionType: "expense", groupMemberCount: 1 },
    baseDeps({ storage }),
  );
  await maybeRequestInAppReviewAfterExpense(
    { userId, transactionType: "income", groupMemberCount: 4 },
    baseDeps({ storage }),
  );

  assertEquals(storage.snapshot(), {});
});

Deno.test("maybeRequestInAppReviewAfterExpense is a web no-op for requesting", async () => {
  const storage = memoryStorage();
  const userId = "user-1";
  let nativeCalls = 0;

  for (let i = 0; i < 3; i++) {
    await maybeRequestInAppReviewAfterExpense(
      { userId, transactionType: "expense", groupMemberCount: 2 },
      baseDeps({
        storage,
        platform: "web",
        loadStoreReview: () => {
          nativeCalls += 1;
          return {
            isAvailableAsync: async () => true,
            hasAction: async () => true,
            requestReview: async () => {},
          };
        },
      }),
    );
  }

  assertEquals(
    storage.snapshot()[reviewQualifyingExpenseCountKey(userId)],
    "3",
  );
  assertEquals(nativeCalls, 0);
  assertEquals(storage.snapshot()[REVIEW_REQUESTED_STORAGE_KEY], undefined);
});

Deno.test("third qualifying expense requests review once per install", async () => {
  const storage = memoryStorage();
  const userId = "user-1";
  let requestCount = 0;
  const events: string[] = [];

  const deps = baseDeps({
    storage,
    platform: "android",
    loadStoreReview: () => ({
      isAvailableAsync: async () => true,
      hasAction: async () => true,
      requestReview: async () => {
        requestCount += 1;
      },
    }),
    captureEvent: (_userId, event) => {
      events.push(event);
    },
  });

  for (let i = 0; i < 3; i++) {
    await maybeRequestInAppReviewAfterExpense(
      { userId, transactionType: "expense", groupMemberCount: 3 },
      deps,
    );
  }
  await deps.flush();

  assertEquals(requestCount, 1);
  assertEquals(events, ["review_prompt_requested"]);
  assertEquals(storage.snapshot()[REVIEW_REQUESTED_STORAGE_KEY], "1");

  await maybeRequestInAppReviewAfterExpense(
    { userId, transactionType: "expense", groupMemberCount: 3 },
    deps,
  );
  await deps.flush();

  assertEquals(requestCount, 1);
  assertEquals(events, ["review_prompt_requested"]);
});

Deno.test("missing native module leaves the once-per-install flag unset", async () => {
  const storage = memoryStorage({
    [reviewQualifyingExpenseCountKey("user-1")]: "2",
  });

  const deps = baseDeps({ storage, loadStoreReview: () => null });
  await maybeRequestInAppReviewAfterExpense(
    { userId: "user-1", transactionType: "expense", groupMemberCount: 2 },
    deps,
  );
  await deps.flush();

  assertEquals(
    storage.snapshot()[reviewQualifyingExpenseCountKey("user-1")],
    "3",
  );
  assertEquals(storage.snapshot()[REVIEW_REQUESTED_STORAGE_KEY], undefined);
});
