import { assertEquals } from "jsr:@std/assert@1";
import {
  claimsAreAnonymous,
  guestCleanupMayRun,
  guestDatabaseError,
  readJwtClaims,
  sessionIsAnonymous,
} from "./guest-rules.ts";

function headerFor(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify(claims))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `Bearer header.${payload}.sig`;
}

Deno.test("guest cleanup env flag defaults off", () => {
  assertEquals(guestCleanupMayRun(undefined), false);
  assertEquals(guestCleanupMayRun(""), false);
  assertEquals(guestCleanupMayRun("false"), false);
  assertEquals(guestCleanupMayRun("true"), true);
});

Deno.test("anonymous claim is read from the bearer token", () => {
  assertEquals(claimsAreAnonymous(readJwtClaims(headerFor({ is_anonymous: true }))), true);
  assertEquals(claimsAreAnonymous(readJwtClaims(headerFor({ is_anonymous: false }))), false);
  assertEquals(claimsAreAnonymous(readJwtClaims(null)), false);
  assertEquals(
    sessionIsAnonymous({ is_anonymous: false }, headerFor({ is_anonymous: true })),
    true,
  );
  assertEquals(sessionIsAnonymous({ is_anonymous: true }, null), true);
  assertEquals(sessionIsAnonymous({ is_anonymous: false }, headerFor({})), false);
});

Deno.test("guest database errors stay typed and do not echo the raw message", () => {
  assertEquals(guestDatabaseError("GUEST_GROUP_CAP"), {
    status: 403,
    code: "GUEST_GROUP_CAP",
    error: "Sign in to add more groups",
  });
  assertEquals(guestDatabaseError("GUEST_EXPENSE_CAP"), {
    status: 403,
    code: "GUEST_EXPENSE_CAP",
    error: "Sign in to add more expenses",
  });
  assertEquals(guestDatabaseError("GUEST_SIGNIN_REQUIRED"), {
    status: 403,
    code: "GUEST_SIGNIN_REQUIRED",
    error: "Sign in to continue",
  });
  assertEquals(guestDatabaseError("something else"), null);
});
