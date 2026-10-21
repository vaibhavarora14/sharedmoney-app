import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  formatSettlementNameWithSuffix,
  resolveSettlementPresence,
  settleRemindAudienceFromPresence,
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
