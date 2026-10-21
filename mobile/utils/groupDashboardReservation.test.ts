import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { countActiveMembers, countNonFormerParticipants } from "./transactionsEmptyCopy.ts";
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

Deno.test("one active member + person without account → settle slot visible", () => {
  // group_members only has the viewer; participants also include Sheeba (no account).
  const members = [{ status: "active" }];
  const participants = [{ type: "member" }, { type: "member" }];
  assertEquals(countActiveMembers(members), 1);
  const audience = countNonFormerParticipants(participants);
  assertEquals(audience, 2);
  assertEquals(
    resolveGroupDashboardSlots({ activeMemberCount: audience, unifyEnabled: true }),
    { currencyHeader: true, settlement: true },
  );
  // Non-zero balance is an independent gate (e.g. vs a former member).
  assertEquals(
    resolveGroupDashboardSlots({
      activeMemberCount: 1,
      unifyEnabled: false,
      hasNonZeroBalance: true,
    }),
    { currencyHeader: false, settlement: true },
  );
});

Deno.test("solo group (just the viewer) stays unchanged — no settle chrome", () => {
  const participants = [{ type: "member" }];
  assertEquals(countNonFormerParticipants(participants), 1);
  assertEquals(
    resolveGroupDashboardSlots({
      activeMemberCount: 1,
      unifyEnabled: true,
      hasNonZeroBalance: false,
    }),
    { currencyHeader: false, settlement: false },
  );
});

Deno.test("former member only does not open settle chrome without a balance", () => {
  const participants = [{ type: "member" }, { type: "former" }];
  assertEquals(countNonFormerParticipants(participants), 1);
  assertEquals(
    resolveGroupDashboardSlots({
      activeMemberCount: 1,
      unifyEnabled: true,
      hasNonZeroBalance: false,
    }),
    { currencyHeader: false, settlement: false },
  );
  // Former with a non-zero balance keeps the settle slot (existing former styling on the row).
  assertEquals(
    resolveGroupDashboardSlots({
      activeMemberCount: 1,
      unifyEnabled: true,
      hasNonZeroBalance: true,
    }),
    { currencyHeader: true, settlement: true },
  );
});
