import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  findParticipantForBalance,
  formatSettlementNameWithSuffix,
  resolveSettlementPresence,
  settleRemindAudienceFromPresence,
  settlementCounterpartyDisplayName,
  settlementCounterpartyShortName,
  settlementPresenceSuffix,
  shouldShowSettleModalPresenceSuffix,
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

Deno.test("settlementPresenceSuffix only for invited / no_account", () => {
  assertEquals(settlementPresenceSuffix("invited"), "invited");
  assertEquals(settlementPresenceSuffix("no_account"), "not on SharedMoney");
  assertEquals(settlementPresenceSuffix("app_member"), null);
  assertEquals(settlementPresenceSuffix("former"), null);
});

Deno.test("formatSettlementNameWithSuffix truncates name before suffix", () => {
  assertEquals(
    formatSettlementNameWithSuffix("Sheeba", "not on SharedMoney"),
    "Sheeba · not on SharedMoney",
  );
  assertEquals(
    formatSettlementNameWithSuffix("Christopher Fernandes", "invited", 12),
    "Christopher… · invited",
  );
  assertEquals(formatSettlementNameWithSuffix("Sheeba", null), "Sheeba");
});

Deno.test("modal presence suffix only when name fits cleanly", () => {
  assertEquals(shouldShowSettleModalPresenceSuffix("Sheeba"), true);
  assertEquals(shouldShowSettleModalPresenceSuffix("Christopher Fernandes"), false);
  assertEquals(shouldShowSettleModalPresenceSuffix(""), false);
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
  // Balance enrichment missing / wrong — participants are the source of truth.
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
  // Never raw email or phone when typed name is absent on both.
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
