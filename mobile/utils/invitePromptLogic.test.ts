import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { maybeShowInvitePromptAfterExpense } from "./invitePromptLogic.ts";
import type { InvitePromptDependencies } from "./invitePromptLogic.ts";
import type { InvitePromptChoice } from "./invitePromptPresenter.ts";

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
  overrides: Partial<InvitePromptDependencies> = {},
): InvitePromptDependencies & {
  events: Array<{ event: string; props?: Record<string, unknown> }>;
  flush: () => Promise<void>;
  choices: { next: InvitePromptChoice };
  presented: Array<{
    groupId: string;
    groupName?: string;
    amount?: number;
    currency?: string;
  }>;
} {
  const pending: Array<() => void | Promise<void>> = [];
  const events: Array<{ event: string; props?: Record<string, unknown> }> = [];
  const presented: Array<{
    groupId: string;
    groupName?: string;
    amount?: number;
    currency?: string;
  }> = [];
  const choices: { next: InvitePromptChoice } = { next: "share" };
  const storage = overrides.storage ?? memoryStorage();

  const deps: InvitePromptDependencies & {
    events: typeof events;
    flush: () => Promise<void>;
    choices: typeof choices;
    presented: typeof presented;
  } = {
    platform: overrides.platform ?? "web",
    storage,
    settleDelayMs: 0,
    schedule: overrides.schedule ?? ((fn) => {
      pending.push(fn);
    }),
    presentPrompt: overrides.presentPrompt ?? (async (request) => {
      presented.push(request);
      return choices.next;
    }),
    captureEvent: overrides.captureEvent ?? ((_user, event, props) => {
      events.push({ event, props });
    }),
    promptShownEvent: "invite_prompt_shown",
    promptSharedEvent: "invite_prompt_shared",
    promptDismissedEvent: "invite_prompt_dismissed",
    events,
    choices,
    presented,
    flush: async () => {
      const jobs = pending.splice(0);
      for (const job of jobs) await job();
    },
  };
  return deps;
}

const firstSoloExpense = {
  userId: "user-1",
  groupId: "group-1",
  groupName: "Flat 4B",
  amount: 840,
  currency: "INR",
  transactionType: "expense",
  isFirstExpense: true,
  activeMemberCount: 1,
  groupKind: "standard" as const,
};

Deno.test("shows once, shares, and records shown then shared with no PII", async () => {
  const deps = createDeps();
  const scheduled = await maybeShowInvitePromptAfterExpense(firstSoloExpense, deps);
  assertEquals(scheduled, true);
  assertEquals(
    await deps.storage.getItem("@sharedmoney/invite_prompt_shown:group-1"),
    "1",
  );
  await deps.flush();
  assertEquals(deps.presented, [{
    groupId: "group-1",
    groupName: "Flat 4B",
    amount: 840,
    currency: "INR",
  }]);
  assertEquals(deps.events.map((e) => e.event), [
    "invite_prompt_shown",
    "invite_prompt_shared",
  ]);
  for (const event of deps.events) {
    assertEquals(event.props?.group_id, "group-1");
    assertEquals(event.props?.platform, "web");
    assertEquals(event.props?.group_name, undefined);
    assertEquals(event.props?.email, undefined);
    assertEquals(event.props?.token, undefined);
  }
});

Deno.test("dismiss records shown then dismissed and still sticks the once-flag", async () => {
  const deps = createDeps();
  deps.choices.next = "dismiss";
  await maybeShowInvitePromptAfterExpense(firstSoloExpense, deps);
  await deps.flush();
  assertEquals(deps.events.map((e) => e.event), [
    "invite_prompt_shown",
    "invite_prompt_dismissed",
  ]);
  assertEquals(
    await deps.storage.getItem("@sharedmoney/invite_prompt_shown:group-1"),
    "1",
  );
});

Deno.test("does not show again for the same group after it was marked", async () => {
  const storage = memoryStorage({
    "@sharedmoney/invite_prompt_shown:group-1": "1",
  });
  const deps = createDeps({ storage });
  const scheduled = await maybeShowInvitePromptAfterExpense(firstSoloExpense, deps);
  assertEquals(scheduled, false);
  await deps.flush();
  assertEquals(deps.events, []);
  assertEquals(deps.presented, []);
});

Deno.test("a second group can still be prompted independently", async () => {
  const storage = memoryStorage({
    "@sharedmoney/invite_prompt_shown:group-1": "1",
  });
  const deps = createDeps({ storage });
  const scheduled = await maybeShowInvitePromptAfterExpense(
    { ...firstSoloExpense, groupId: "group-2" },
    deps,
  );
  assertEquals(scheduled, true);
  await deps.flush();
  assertEquals(deps.events[0]?.props?.group_id, "group-2");
});

Deno.test("skips multi-member groups, non-expenses, later expenses, and direct groups", async () => {
  for (const input of [
    { ...firstSoloExpense, activeMemberCount: 2 },
    { ...firstSoloExpense, transactionType: "settlement" },
    { ...firstSoloExpense, isFirstExpense: false },
    { ...firstSoloExpense, groupKind: "direct" },
    { ...firstSoloExpense, groupId: undefined },
  ]) {
    const deps = createDeps();
    const scheduled = await maybeShowInvitePromptAfterExpense(input, deps);
    assertEquals(scheduled, false);
    await deps.flush();
    assertEquals(deps.events, []);
  }
});

Deno.test("works on web, iOS, and Android", async () => {
  for (const platform of ["web", "ios", "android"]) {
    const deps = createDeps({ platform });
    assertEquals(
      await maybeShowInvitePromptAfterExpense(firstSoloExpense, deps),
      true,
    );
    await deps.flush();
    assertEquals(deps.events[0]?.props?.platform, platform);
  }
});

Deno.test("a cancelled presentPrompt still leaves the once-flag set", async () => {
  const deps = createDeps({
    presentPrompt: async () => {
      throw new Error("AbortError: Share canceled");
    },
  });
  await maybeShowInvitePromptAfterExpense(firstSoloExpense, deps);
  await deps.flush();
  assertEquals(deps.events.map((e) => e.event), ["invite_prompt_shown"]);
  assertEquals(
    await deps.storage.getItem("@sharedmoney/invite_prompt_shown:group-1"),
    "1",
  );
});

Deno.test("never shows again after Share, including a later first-expense retry", async () => {
  const storage = memoryStorage();
  const deps = createDeps({ storage });
  deps.choices.next = "share";
  assertEquals(await maybeShowInvitePromptAfterExpense(firstSoloExpense, deps), true);
  await deps.flush();
  assertEquals(
    await maybeShowInvitePromptAfterExpense(firstSoloExpense, deps),
    false,
  );
  assertEquals(
    await maybeShowInvitePromptAfterExpense(
      { ...firstSoloExpense, isFirstExpense: false },
      deps,
    ),
    false,
  );
  await deps.flush();
  assertEquals(deps.presented.length, 1);
  assertEquals(deps.events.map((e) => e.event), [
    "invite_prompt_shown",
    "invite_prompt_shared",
  ]);
});

Deno.test("never shows again after Not now, and not on the second expense", async () => {
  const storage = memoryStorage();
  const deps = createDeps({ storage });
  deps.choices.next = "dismiss";
  assertEquals(await maybeShowInvitePromptAfterExpense(firstSoloExpense, deps), true);
  await deps.flush();
  assertEquals(
    await maybeShowInvitePromptAfterExpense(firstSoloExpense, deps),
    false,
  );
  assertEquals(
    await maybeShowInvitePromptAfterExpense(
      { ...firstSoloExpense, isFirstExpense: false, amount: 200 },
      deps,
    ),
    false,
  );
  await deps.flush();
  assertEquals(deps.presented.length, 1);
  assertEquals(deps.events.map((e) => e.event), [
    "invite_prompt_shown",
    "invite_prompt_dismissed",
  ]);
});
