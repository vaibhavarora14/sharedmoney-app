import { assertEquals } from "jsr:@std/assert@1";
import {
  buildInvitationInsert,
  normalizeInviteIdentity,
  resolveInviteAction,
} from "./invite-identity.ts";

Deno.test("normalizeInviteIdentity accepts phone without email", () => {
  const result = normalizeInviteIdentity({
    phone: "98765 43210",
    country_code: null,
  });

  assertEquals(result.error, null);
  assertEquals(result.identity?.kind, "phone");
  assertEquals(result.identity?.value, "+919876543210");
});

Deno.test("normalizeInviteIdentity keeps email invite path working", () => {
  const result = normalizeInviteIdentity({ email: "USER@Example.COM" });

  assertEquals(result.error, null);
  assertEquals(result.identity?.kind, "email");
  assertEquals(result.identity?.value, "user@example.com");
});

Deno.test("phone and email invitation inserts use the correct nullable column", () => {
  const phoneIdentity = normalizeInviteIdentity({ phone: "+1 415 555 2671" })
    .identity;
  const emailIdentity = normalizeInviteIdentity({ email: "a@example.com" })
    .identity;

  if (!phoneIdentity || !emailIdentity) {
    throw new Error("expected normalized identities");
  }

  assertEquals(
    buildInvitationInsert({
      groupId: "group-id",
      invitedBy: "user-id",
      token: "phone-token",
      identity: phoneIdentity,
    }),
    {
      group_id: "group-id",
      email: null,
      phone: "+14155552671",
      invited_by: "user-id",
      token: "phone-token",
      status: "pending",
    },
  );

  assertEquals(
    buildInvitationInsert({
      groupId: "group-id",
      invitedBy: "user-id",
      token: "email-token",
      identity: emailIdentity,
    }),
    {
      group_id: "group-id",
      email: "a@example.com",
      phone: null,
      invited_by: "user-id",
      token: "email-token",
      status: "pending",
    },
  );
});

Deno.test("invite action attaches matching users and creates pending invite otherwise", () => {
  assertEquals(resolveInviteAction("existing-user-id"), "attach_existing_user");
  assertEquals(resolveInviteAction(null), "create_pending_invite");
});
