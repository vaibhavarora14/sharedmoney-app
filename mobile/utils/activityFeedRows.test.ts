import { assertEquals } from "jsr:@std/assert@1";
import type { ActivityItem } from "../types.ts";
import { buildActivityFeedEntries } from "./activityFeedRows.ts";

Deno.test("activity feed rows insert date headers before items", () => {
  const now = new Date();
  const items = [
    {
      id: "a1",
      changed_at: now.toISOString(),
    } as ActivityItem,
    {
      id: "a2",
      changed_at: now.toISOString(),
    } as ActivityItem,
  ];

  const entries = buildActivityFeedEntries(items);
  assertEquals(entries[0]?.kind, "header");
  assertEquals(entries[0]?.kind === "header" ? entries[0].title : null, "Today");
  assertEquals(entries.filter((entry) => entry.kind === "item").length, 2);
  assertEquals(entries[1]?.kind, "item");
  assertEquals(entries[1]?.kind === "item" ? entries[1].activity.id : null, "a1");
});
