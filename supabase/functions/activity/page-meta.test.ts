import { assertEquals } from "jsr:@std/assert@1";
import { ACTIVITY_SEQUENTIAL_DB_ROUND_TRIPS, activityPageMeta } from "./page-meta.ts";

Deno.test("activity membership/blocked and history/count each count as one sequential batch", () => {
  assertEquals(ACTIVITY_SEQUENTIAL_DB_ROUND_TRIPS, {
    membershipAndBlocked: 1,
    historyAndCount: 1,
  });
});

Deno.test("activity page meta keeps total and has_more compatible with store clients", () => {
  assertEquals(
    activityPageMeta({ offset: 0, limit: 50, pageLength: 50, count: 51, countError: false }),
    { total: 51, has_more: true },
  );
  assertEquals(
    activityPageMeta({ offset: 50, limit: 50, pageLength: 1, count: 51, countError: false }),
    { total: 51, has_more: false },
  );
  assertEquals(
    activityPageMeta({ offset: 0, limit: 50, pageLength: 50, count: null, countError: true }),
    { total: 50, has_more: true },
  );
});
