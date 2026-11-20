import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ITUNES_LOOKUP_URL, PLAY_STORE_LOOKUP_URL } from "./inAppUpdateEligibility.ts";
import {
  maybePromptAppUpdateAfterExpense,
  type InAppUpdatePromptDependencies,
} from "./inAppUpdatePromptLogic.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: async (key: string) => data[key] ?? null,
    setItem: async (key: string, value: string) => {
      data[key] = value;
    },
  };
}

function createDeps(
  overrides: Partial<InAppUpdatePromptDependencies> & {
    storeLookup?: string;
  } = {},
): InAppUpdatePromptDependencies & {
  events: Array<{ event: string; props?: Record<string, unknown> }>;
  opened: string[];
  flush: () => Promise<void>;
  choices: UpdateChoiceQueue;
} {
  const pending: Array<() => void | Promise<void>> = [];
  const events: Array<{ event: string; props?: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const choices: UpdateChoiceQueue = { next: "update" };
  const storage = overrides.storage ?? memoryStorage();
  const storeLookup = overrides.storeLookup ?? "2.60.1";

  const deps: InAppUpdatePromptDependencies & {
    events: typeof events;
    opened: typeof opened;
    flush: () => Promise<void>;
    choices: typeof choices;
  } = {
    platform: overrides.platform ?? "ios",
    currentVersion: overrides.currentVersion ?? "2.30.6",
    storage,
    storeUrl: overrides.storeUrl ?? "https://apps.apple.com/app/id6755923591",
    inOnboarding: overrides.inOnboarding ?? false,
    settleDelayMs: 0,
    schedule: overrides.schedule ?? ((fn) => {
      pending.push(fn);
    }),
    fetchText: overrides.fetchText ?? (async (url: string) => {
      if (url === ITUNES_LOOKUP_URL) {
        return JSON.stringify({ resultCount: 1, results: [{ version: storeLookup }] });
      }
      if (url === PLAY_STORE_LOOKUP_URL) {
        return `<div itemprop="softwareVersion" content="${storeLookup}">`;
      }
      throw new Error(`unexpected url ${url}`);
    }),
    presentPrompt: overrides.presentPrompt ?? (async () => choices.next),
    openStoreUrl: overrides.openStoreUrl ?? (async (url: string) => {
      opened.push(url);
    }),
    captureEvent: overrides.captureEvent ?? ((_user, event, props) => {
      events.push({ event, props });
    }),
    promptShownEvent: "app_update_prompt_shown",
    updateStartedEvent: "app_update_started",
    events,
    opened,
    choices,
    flush: async () => {
      const jobs = pending.splice(0);
      for (const job of jobs) await job();
    },
  };
  return deps;
}

type UpdateChoiceQueue = { next: "update" | "later" };

Deno.test("prompts and opens the store when the iOS listing is newer", async () => {
  const deps = createDeps();
  const scheduled = await maybePromptAppUpdateAfterExpense(
    { userId: "user-1", transactionType: "expense" },
    deps,
  );
  assertEquals(scheduled, true);
  await deps.flush();
  assertEquals(deps.events.map((e) => e.event), [
    "app_update_prompt_shown",
    "app_update_started",
  ]);
  assertEquals(deps.opened, ["https://apps.apple.com/app/id6755923591"]);
  assertEquals(
    await deps.storage.getItem("@sharedmoney/app_update_prompt_shown:2.30.6"),
    "1",
  );
});

Deno.test("does not prompt again for the same installed version", async () => {
  const storage = memoryStorage({
    "@sharedmoney/app_update_prompt_shown:2.30.6": "1",
  });
  const deps = createDeps({ storage });
  const scheduled = await maybePromptAppUpdateAfterExpense(
    { userId: "user-1", transactionType: "expense" },
    deps,
  );
  assertEquals(scheduled, false);
  await deps.flush();
  assertEquals(deps.events, []);
});

Deno.test("is a no-op on web, during onboarding, and for non-expenses", async () => {
  for (const overrides of [
    { platform: "web" },
    { inOnboarding: true },
    {},
  ] as Array<Partial<InAppUpdatePromptDependencies>>) {
    const deps = createDeps(overrides);
    const scheduled = await maybePromptAppUpdateAfterExpense(
      {
        userId: "user-1",
        transactionType: overrides.platform || overrides.inOnboarding
          ? "expense"
          : "settlement",
      },
      deps,
    );
    assertEquals(scheduled, false);
    await deps.flush();
    assertEquals(deps.events, []);
  }
});

Deno.test("does not prompt when the store version is missing or not newer", async () => {
  const missing = createDeps({
    fetchText: async () => JSON.stringify({ resultCount: 0, results: [] }),
  });
  assertEquals(
    await maybePromptAppUpdateAfterExpense(
      { userId: "user-1", transactionType: "expense" },
      missing,
    ),
    false,
  );

  const current = createDeps({ currentVersion: "2.60.1", storeLookup: "2.60.1" });
  assertEquals(
    await maybePromptAppUpdateAfterExpense(
      { userId: "user-1", transactionType: "expense" },
      current,
    ),
    false,
  );
  await current.flush();
  assertEquals(current.events, []);
});

Deno.test("later still records the shown event and does not open the store", async () => {
  const deps = createDeps();
  deps.choices.next = "later";
  await maybePromptAppUpdateAfterExpense(
    { userId: "user-1", transactionType: "expense" },
    deps,
  );
  await deps.flush();
  assertEquals(deps.events.map((e) => e.event), ["app_update_prompt_shown"]);
  assertEquals(deps.opened, []);
});

Deno.test("looks up the Play Store version for Android", async () => {
  const deps = createDeps({
    platform: "android",
    storeUrl: "https://play.google.com/store/apps/details?id=com.vaibhavarora.sharemoney",
    storeLookup: "2.60.1",
  });
  await maybePromptAppUpdateAfterExpense(
    { userId: "user-1", transactionType: "expense" },
    deps,
  );
  await deps.flush();
  assertEquals(deps.opened, [
    "https://play.google.com/store/apps/details?id=com.vaibhavarora.sharemoney",
  ]);
  assertEquals(deps.events[0]?.props?.platform, "android");
  assertEquals(deps.events[0]?.props?.store_version, "2.60.1");
});
