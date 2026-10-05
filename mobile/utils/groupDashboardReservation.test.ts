import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { predictGroupDashboardReservation } from "./groupDashboardReservation.ts";

Deno.test("known zero or solo membership reserves no dashboard header rows", () => {
  for (const activeMemberCount of [0, 1]) {
    for (const unifyEnabled of [true, false, undefined]) {
      assertEquals(predictGroupDashboardReservation({ activeMemberCount, unifyEnabled }), {
        currencyHeader: false, settlement: false,
      });
    }
  }
});

Deno.test("known multiple members reserve only the applicable currency row", () => {
  for (const unifyEnabled of [true, false, undefined]) {
    assertEquals(predictGroupDashboardReservation({ activeMemberCount: 3, unifyEnabled }), {
      currencyHeader: unifyEnabled !== false, settlement: true,
    });
  }
});

Deno.test("unknown membership reserves space without overriding a known non-unify flag", () => {
  assertEquals(predictGroupDashboardReservation({}), { currencyHeader: true, settlement: true });
  assertEquals(predictGroupDashboardReservation({ unifyEnabled: false }), {
    currencyHeader: false, settlement: true,
  });
});
