import { assertEquals } from "jsr:@std/assert@1";
import { GUEST_PRIVACY_DRAFT } from "./guestPrivacyDraft.ts";
import {
  REAL_EXPENSE_CREATORS_FILTER,
  guestCleanupBanner,
  guestCleanupVisible,
  guestCollisionName,
  guestEntryVisible,
  guestEventProps,
  guestSignInCopy,
  guestUpgradePath,
  isGuestUser,
  keepDataCounts,
  planGuestGroups,
  readFlagOverride,
  stripShareLinks,
} from "./guestMode.ts";

Deno.test("guest entry and cleanup flags default off", () => {
  assertEquals(readFlagOverride(undefined), null);
  assertEquals(readFlagOverride(""), null);
  assertEquals(readFlagOverride("true"), true);
  assertEquals(readFlagOverride("false"), false);
  assertEquals(guestEntryVisible({ envOverride: null, remoteEnabled: false }), false);
  assertEquals(guestEntryVisible({ envOverride: null, remoteEnabled: true }), true);
  assertEquals(guestEntryVisible({ envOverride: false, remoteEnabled: true }), false);
  assertEquals(guestEntryVisible({ envOverride: true, remoteEnabled: false }), true);
  assertEquals(guestCleanupVisible({ envOverride: null, remoteEnabled: false }), false);
});

Deno.test("linking keeps the same user and an existing identity asks to merge", () => {
  assertEquals(guestUpgradePath({
    errorCode: null,
    errorMessage: null,
    sameUserId: true,
    stillAnonymous: false,
  }), "link");
  assertEquals(guestUpgradePath({
    errorCode: "identity_already_exists",
    errorMessage: "Identity already exists",
    sameUserId: true,
    stillAnonymous: true,
  }), "merge");
  assertEquals(guestUpgradePath({
    errorCode: "email_exists",
    errorMessage: "A user with this email address has already been registered",
    sameUserId: false,
    stillAnonymous: true,
  }), "merge");
  assertEquals(guestUpgradePath({
    errorCode: "server_error",
    errorMessage: "unavailable",
    sameUserId: true,
    stillAnonymous: true,
  }), "failed");
});

Deno.test("same-name guest groups are suffixed and existing names are not rewritten", () => {
  assertEquals(guestCollisionName("Flat 4B", ["Flat 4B"]), "Flat 4B (guest)");
  assertEquals(
    guestCollisionName("Flat 4B", ["Flat 4B", "Flat 4B (guest)"]),
    "Flat 4B (guest 2)",
  );
  assertEquals(
    planGuestGroups(["Goa trip", "Flat 4B"], ["Flat 4B"]),
    [
      { name: "Goa trip", renamed: false, note: null },
      { name: "Flat 4B (guest)", renamed: true, note: "Same name, kept separate" },
    ],
  );
});

Deno.test("plain-text share drops links and keeps the balance sentence", () => {
  const message = [
    "Hi Rahul, quick one from Goa trip: you owe me ₹1,600.",
    "",
    "https://sharedmoney.app/join/secret-token",
  ].join("\n");
  const plain = stripShareLinks(message);
  assertEquals(plain.includes("http"), false);
  assertEquals(plain.includes("you owe me ₹1,600"), true);
});

Deno.test("sign-in sheet copy names the blocked action", () => {
  assertEquals(guestSignInCopy("invite", "Rahul").title, "Sign in to invite Rahul");
  assertEquals(guestSignInCopy("export", "Goa trip").title, "Sign in to export Goa trip");
  assertEquals(guestSignInCopy("remind", "Rahul").title, "Sign in to remind Rahul");
  assertEquals(
    guestSignInCopy("chip", keepDataCounts(2, 6)).body,
    "Sign in to keep 2 groups and 6 expenses and use them on any device.",
  );
  assertEquals(guestSignInCopy("cap_groups").title, "Sign in to add more");
});

Deno.test("cleanup banner is a date from day 45 through day 59", () => {
  const activity = new Date("2025-11-16T00:00:00.000Z");
  assertEquals(guestCleanupBanner(activity, new Date("2025-12-30T00:00:00.000Z")), null);
  const day45 = guestCleanupBanner(activity, new Date("2025-12-31T00:00:00.000Z"));
  assertEquals(day45?.title, "Sign in by 15 Jan to keep your data");
  assertEquals(day45?.body, "Unused guest data is deleted after 60 days.");
  assertEquals(guestCleanupBanner(activity, new Date("2026-01-15T00:00:00.000Z")), null);
});

Deno.test("expense events tag guests and the real-creator metric excludes them", () => {
  assertEquals(guestEventProps({ is_anonymous: true }), { is_guest: true });
  assertEquals(guestEventProps({ is_anonymous: false }), {});
  assertEquals(isGuestUser(null), false);
  assertEquals(REAL_EXPENSE_CREATORS_FILTER.includes("is_guest != true"), true);
  assertEquals(GUEST_PRIVACY_DRAFT.status, "draft-not-approved");
});
