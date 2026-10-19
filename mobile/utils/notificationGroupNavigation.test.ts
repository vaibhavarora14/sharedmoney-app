import { assertEquals } from "jsr:@std/assert@1";
import { Group, GroupWithMembers } from "../types.ts";
import {
  openNotificationGroupImmediately,
  resolveNotificationGroup,
} from "./notificationGroupNavigation.ts";

const groupReference = {
  id: "group-1",
  name: "Notification Test",
};

const cachedGroup: Group = {
  id: "group-1",
  name: "Cached group",
  description: "Cached summary",
  created_by: "user-1",
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-24T00:00:00.000Z",
};

const cachedDetails: GroupWithMembers = {
  ...cachedGroup,
  name: "Fresh details",
  members: [],
  invitations: [],
};

Deno.test("notification group navigation prefers cached details, then the cached group list", () => {
  assertEquals(
    resolveNotificationGroup(groupReference, cachedDetails, [cachedGroup]),
    cachedDetails,
  );
  assertEquals(
    resolveNotificationGroup(groupReference, null, [cachedGroup]),
    cachedGroup,
  );
});

Deno.test("notification group navigation creates a safe placeholder when no cache exists", () => {
  assertEquals(resolveNotificationGroup(groupReference, null, []), {
    id: "group-1",
    name: "Notification Test",
    created_by: "",
    created_at: "",
    updated_at: "",
  });
});

Deno.test("notification group navigation changes route before the group refresh finishes", async () => {
  const events: string[] = [];
  let releaseRefresh: () => void = () => {};
  const refreshFinished = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });

  const started = openNotificationGroupImmediately({
    reference: groupReference,
    cachedDetails: null,
    cachedGroups: [cachedGroup],
    isAlreadyOpening: false,
    navigate: (group) => events.push(`navigate:${group.name}`),
    refresh: async () => {
      events.push("refresh:start");
      await refreshFinished;
      events.push("refresh:end");
    },
    onRefreshError: () => events.push("refresh:error"),
    onSettled: () => events.push("settled"),
  });

  assertEquals(started, true);
  assertEquals(events, ["navigate:Cached group"]);

  await Promise.resolve();
  assertEquals(events, ["navigate:Cached group", "refresh:start"]);

  releaseRefresh();
  await refreshFinished;
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(events, [
    "navigate:Cached group",
    "refresh:start",
    "refresh:end",
    "settled",
  ]);
});

Deno.test("notification group navigation rejects a duplicate opening request", () => {
  const events: string[] = [];

  const started = openNotificationGroupImmediately({
    reference: groupReference,
    cachedDetails: null,
    cachedGroups: [cachedGroup],
    isAlreadyOpening: true,
    navigate: () => events.push("navigate"),
    refresh: async () => {
      events.push("refresh");
    },
    onRefreshError: () => events.push("error"),
    onSettled: () => events.push("settled"),
  });

  assertEquals(started, false);
  assertEquals(events, []);
});

Deno.test("notification group navigation tolerates a missing onSettled under Hermes finally semantics", async () => {
  // Hermes (promise npm lib) implements finally without a callable check:
  // it invokes f() directly, unlike V8 which passes non-callables through.
  const originalFinally = Promise.prototype.finally;
  Promise.prototype.finally = function (this: Promise<unknown>, f: () => unknown) {
    return this.then(
      (value) => Promise.resolve(f()).then(() => value),
      (err) => Promise.resolve(f()).then(() => { throw err; }),
    );
  } as typeof Promise.prototype.finally;

  const rejections: unknown[] = [];
  const onUnhandled = (event: PromiseRejectionEvent) => {
    event.preventDefault();
    rejections.push(event.reason);
  };
  globalThis.addEventListener("unhandledrejection", onUnhandled);

  try {
    const events: string[] = [];
    const started = openNotificationGroupImmediately({
      reference: groupReference,
      cachedDetails: null,
      cachedGroups: [cachedGroup],
      isAlreadyOpening: false,
      navigate: () => events.push("navigate"),
      refresh: async () => {
        events.push("refresh");
      },
      onRefreshError: () => events.push("error"),
    });

    assertEquals(started, true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(events, ["navigate", "refresh"]);
    assertEquals(rejections, []);
  } finally {
    globalThis.removeEventListener("unhandledrejection", onUnhandled);
    Promise.prototype.finally = originalFinally;
  }
});
