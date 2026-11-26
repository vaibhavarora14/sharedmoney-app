import { assertEquals } from "jsr:@std/assert@1";
import { activityPageMeta } from "./page-meta.ts";
import {
  ACTIVITY_SEQUENTIAL_DB_ROUND_TRIPS,
  ACTIVITY_SEQUENTIAL_DB_ROUND_TRIPS_BEFORE,
} from "./load-activity.ts";

Deno.test("activity feed is one RPC after JWT instead of four sequential DB batches", () => {
  assertEquals(ACTIVITY_SEQUENTIAL_DB_ROUND_TRIPS_BEFORE, {
    membershipAndBlocked: 1,
    historyAndCount: 1,
    participants: 1,
    emailsAndProfiles: 1,
  });
  assertEquals(ACTIVITY_SEQUENTIAL_DB_ROUND_TRIPS, {
    activityPageRpc: 1,
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
