import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getBalanceShareLinkUrl, isPublicYouOweEnabled } from "./publicYouOwe.ts";

Deno.test("isPublicYouOweEnabled stays off unless the database flag is on", () => {
  assertEquals(isPublicYouOweEnabled(undefined), false);
  assertEquals(isPublicYouOweEnabled(false), false);
  assertEquals(isPublicYouOweEnabled(true), true);
});

Deno.test("getBalanceShareLinkUrl uses the canonical public origin and rejects a bad token", () => {
  const token = "a".repeat(64);
  assertEquals(getBalanceShareLinkUrl(token), `https://sharedmoney.app/owe/${token}`);
  assertThrows(() => getBalanceShareLinkUrl("nope"));
});
