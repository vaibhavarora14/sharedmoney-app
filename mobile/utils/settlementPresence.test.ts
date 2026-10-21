import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  findParticipantForBalance,
  resolveSettlementPresence,
  settleRemindAudienceFromPresence,
  settlementCounterpartyDisplayName,
  settlementCounterpartyShortName,
  settlementPresenceCaption,
  settlementPresenceSuffix,
} from "./settlementPresence.ts";

Deno.test("resolveSettlementPresence: former wins", () => {
  assertEquals(
    resolveSettlementPresence({ user_id: "u1", type: "former" }),
    "former",
  );
});

Deno.test("resolveSettlementPresence: pending invite", () => {
  assertEquals(
    resolveSettlementPresence({ user_id: null, type: "invited" }),
    "invited",
  );
  assertEquals(
    resolveSettlementPresence({ user_id: "u1", type: "invited" }),
    "invited",
  );
});

Deno.test("resolveSettlementPresence: no account vs app member", () => {
  assertEquals(
    resolveSettlementPresence({ user_id: null, type: "member" }),
    "no_account",
  );
  assertEquals(
    resolveSettlementPresence({ user_id: "", type: "member" }),
    "no_account",
  );
  assertEquals(
    resolveSettlementPresence({ user_id: "u1", type: "member" }),
    "app_member",
  );
});

Deno.test("settlementPresenceCaption is secondary line for invited / no_account only", () => {
  assertEquals(settlementPresenceCaption("invited"), "Invited");
  assertEquals(settlementPresenceCaption("no_account"), "Not on SharedMoney");
  assertEquals(settlementPresenceCaption("app_member"), null);
  assertEquals(settlementPresenceCaption("former"), null);
  // Deprecated alias still returns the caption (not an inline · suffix).
  assertEquals(settlementPresenceSuffix("no_account"), "Not on SharedMoney");
});

Deno.test("remind audience: off-app for non-members", () => {
  assertEquals(settleRemindAudienceFromPresence("app_member"), "app_member");
  assertEquals(settleRemindAudienceFromPresence("invited"), "off_app");
  assertEquals(settleRemindAudienceFromPresence("no_account"), "off_app");
  assertEquals(settleRemindAudienceFromPresence("former"), "off_app");
});

Deno.test("settlementCounterpartyDisplayName prefers participant typed name over empty balance", () => {
  const participants = [
    {
      id: "p_sheeba",
      user_id: null,
      type: "member",
      full_name: "Sheeba",
      email: "sheeba@example.com",
      phone: "+919876543210",
    },
  ];
  assertEquals(
    settlementCounterpartyDisplayName(
      {
        participant_id: "p_sheeba",
        user_id: "",
        full_name: null,
        email: "sheeba@example.com",
        phone: "+919876543210",
      },
      participants,
    ),
    "Sheeba",
  );
  assertEquals(
    settlementCounterpartyShortName(
      { participant_id: "p_sheeba", full_name: null },
      participants,
    ),
    "Sheeba",
  );
  assertEquals(
    settlementCounterpartyDisplayName(
      { participant_id: "p_x", full_name: null, email: null, phone: "+91111" },
      [{ id: "p_x", full_name: null, email: null, phone: "+91111" }],
    ),
    "Someone",
  );
});

Deno.test("findParticipantForBalance matches participant_id before user_id", () => {
  const participants = [
    { id: "p1", user_id: "u1", full_name: "A" },
    { id: "p2", user_id: "u2", full_name: "B" },
  ];
  assertEquals(
    findParticipantForBalance({ participant_id: "p2", user_id: "u1" }, participants)
      ?.full_name,
    "B",
  );
  assertEquals(
    findParticipantForBalance({ user_id: "u1" }, participants)?.full_name,
    "A",
  );
});
