import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  formatGroupRecencyLine,
  groupRecencyLine,
  groupsWithoutRecency,
  type GroupLastActivity,
} from "./groupRecency.ts";

const NOW = new Date("2026-11-13T04:00:00.000Z");

function activity(partial: Partial<GroupLastActivity> & Pick<GroupLastActivity, "action">): GroupLastActivity {
  return {
    actor: "Aisha",
    subject: "Dinner",
    at: "2026-11-13T02:00:00.000Z",
    ...partial,
  };
}

Deno.test("recency line uses actor, action, and a relative time", () => {
  assertEquals(
    formatGroupRecencyLine(activity({ action: "added" }), NOW),
    "Aisha added Dinner · 2h",
  );
  assertEquals(
    formatGroupRecencyLine(activity({ action: "edited", at: "2026-11-13T03:40:00.000Z" }), NOW),
    "Aisha edited Dinner · 20m",
  );
  assertEquals(
    formatGroupRecencyLine(
      activity({ actor: "You", action: "settled", subject: "Dev", at: "2026-11-10T04:00:00.000Z" }),
      NOW,
    ),
    "You settled with Dev · 3d",
  );
});

Deno.test("a fetched group with no activity says quiet since the created date", () => {
  assertEquals(groupRecencyLine({
    created_at: "2026-10-08T00:00:00.000Z",
    last_activity: null,
  }, NOW), "Quiet since 8 Oct");
});

Deno.test("recency stays off the row until last_activity is fetched", () => {
  assertEquals(groupRecencyLine({
    created_at: "2026-10-08T00:00:00.000Z",
    name: "Goa trip",
  } as { created_at: string }, NOW), null);
});

Deno.test("groupsWithoutRecency still strips last_activity for callers that need it", () => {
  const stored = groupsWithoutRecency([
    {
      id: "g",
      name: "Goa trip",
      last_activity: activity({ action: "added" }),
    },
  ]);
  assertEquals(stored, [{ id: "g", name: "Goa trip" }]);
  assertEquals(Object.prototype.hasOwnProperty.call(stored[0], "last_activity"), false);
});
