import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { countActiveMembers } from "./transactionsEmptyCopy.ts";
import { resolveGroupDashboardSlots } from "./groupDashboardReservation.ts";

Deno.test("known zero or solo membership reserves no dashboard header rows", () => {
  for (const activeMemberCount of [0, 1]) {
    for (const unifyEnabled of [true, false, undefined]) {
      assertEquals(resolveGroupDashboardSlots({ activeMemberCount, unifyEnabled }), {
        currencyHeader: false, settlement: false,
      });
    }
  }
});

Deno.test("known multiple members reserve only the applicable currency row", () => {
  for (const unifyEnabled of [true, false, undefined]) {
    assertEquals(resolveGroupDashboardSlots({ activeMemberCount: 3, unifyEnabled }), {
      currencyHeader: unifyEnabled !== false, settlement: true,
    });
  }
});

Deno.test("unknown membership reserves space without overriding a known non-unify flag", () => {
  assertEquals(resolveGroupDashboardSlots({}), { currencyHeader: true, settlement: true });
  assertEquals(resolveGroupDashboardSlots({ unifyEnabled: false }), {
    currencyHeader: false, settlement: true,
  });
});

Deno.test("cached members with one active person and one invited/left person render no header slots", () => {
  for (const status of ["invited", "left", "pending", "former"]) {
    const members = [{ status: "active" }, { status }];
    const activeMemberCount = countActiveMembers(members);
    assertEquals(activeMemberCount, 1);
    const inputs = { activeMemberCount, unifyEnabled: false };
    const prediction = resolveGroupDashboardSlots(inputs);
    const loaded = resolveGroupDashboardSlots(inputs);
    assertEquals(prediction, { currencyHeader: false, settlement: false });
    assertEquals(loaded, prediction);
  }
});

Deno.test("balance errors always retain error content even for solo groups", () => {
  assertEquals(resolveGroupDashboardSlots({ activeMemberCount: 1, unifyEnabled: true, balanceError: true }), {
    currencyHeader: false, settlement: true,
  });
});
