import { assertEquals } from "jsr:@std/assert@1";
import {
  buildGroupJoinedProperties,
  normalizeRedeemInviteLinkResult,
  selectRecentEmailInviteJoins,
  shouldCaptureGroupJoinedFromRedeem,
} from "./groupJoinedAnalytics.ts";

Deno.test("normalizeRedeemInviteLinkResult accepts object payloads", () => {
  assertEquals(
    normalizeRedeemInviteLinkResult({
      status: "joined",
      group_id: "g1",
      group_name: "Trip",
      remaining_uses: 2,
    }),
    {
      status: "joined",
      group_id: "g1",
      group_name: "Trip",
      remaining_uses: 2,
    },
  );
});

Deno.test("normalizeRedeemInviteLinkResult accepts JSON strings", () => {
  assertEquals(
    normalizeRedeemInviteLinkResult(
      JSON.stringify({
        status: "already_member",
        group_id: "g2",
        group_name: null,
      }),
    ),
    {
      status: "already_member",
      group_id: "g2",
      group_name: null,
    },
  );
});

Deno.test("shouldCaptureGroupJoinedFromRedeem only for newly joined", () => {
  assertEquals(shouldCaptureGroupJoinedFromRedeem("joined"), true);
  assertEquals(shouldCaptureGroupJoinedFromRedeem("already_member"), false);
  assertEquals(shouldCaptureGroupJoinedFromRedeem("expired"), false);
});

Deno.test("buildGroupJoinedProperties stays PII-safe", () => {
  assertEquals(
    buildGroupJoinedProperties({
      groupId: "group-1",
      joinMethod: "invite_link",
    }),
    { group_id: "group-1", join_method: "invite_link" },
  );
  assertEquals(
    buildGroupJoinedProperties({
      groupId: "group-2",
      joinMethod: "email_invite",
    }),
    { group_id: "group-2", join_method: "email_invite" },
  );
});

Deno.test("selectRecentEmailInviteJoins attributes signup auto-accept once", () => {
  const now = Date.parse("2026-09-27T12:00:00.000Z");
  const selected = selectRecentEmailInviteJoins(
    [
      {
        id: "inv-1",
        group_id: "g1",
        status: "accepted",
        email: "Alex@Example.com",
        accepted_at: "2026-09-27T11:30:00.000Z",
      },
      {
        id: "inv-2",
        group_id: "g2",
        status: "pending",
        email: "alex@example.com",
        accepted_at: null,
      },
      {
        id: "inv-3",
        group_id: "g3",
        status: "accepted",
        email: null,
        accepted_at: "2026-09-27T11:30:00.000Z",
      },
      {
        id: "inv-4",
        group_id: "g4",
        status: "accepted",
        email: "alex@example.com",
        accepted_at: "2026-09-20T11:30:00.000Z",
      },
      {
        id: "inv-5",
        group_id: "g5",
        status: "accepted",
        email: "alex@example.com",
        accepted_at: "2026-09-27T11:45:00.000Z",
      },
    ],
    {
      userEmail: "alex@example.com",
      nowMs: now,
      alreadyReportedIds: new Set(["inv-5"]),
    },
  );

  assertEquals(selected.map((row) => row.id), ["inv-1"]);
});
