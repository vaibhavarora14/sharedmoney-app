import { assertEquals } from "jsr:@std/assert@1";
import {
  INVITE_LINK_MAX_USES,
  INVITE_LINK_VALID_DAYS,
  buildInviteShareMessage,
  buildInviteShareTitle,
} from "./inviteShare.ts";

Deno.test("invite share copy uses the canonical /app/join/:token URL", () => {
  const url = `https://sharedmoney.app/app/join/${"a".repeat(64)}`;
  const message = buildInviteShareMessage(url, "Flat 4B");
  assertEquals(message.includes(url), true);
  assertEquals(message.includes("/app/join/"), true);
  assertEquals(buildInviteShareTitle("Flat 4B"), "I started 'Flat 4B' on SharedMoney");
});

Deno.test("invite share limits match Add people", () => {
  assertEquals(INVITE_LINK_MAX_USES, 10);
  assertEquals(INVITE_LINK_VALID_DAYS, 30);
});

Deno.test("unnamed groups still produce a join link message", () => {
  const url = "https://sharedmoney.app/app/join/abc";
  assertEquals(
    buildInviteShareMessage(url),
    "I started a SharedMoney group for us to track who paid and who owes. No bank link needed. Join here: https://sharedmoney.app/app/join/abc",
  );
  assertEquals(buildInviteShareTitle(), "I started a SharedMoney group");
});
