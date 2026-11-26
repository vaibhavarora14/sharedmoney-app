import { assertEquals } from "jsr:@std/assert@1";
import {
  fetchLatestHistoryRows,
  lastActivityByGroup,
  type HistoryActivityRow,
} from "./groupLastActivity.ts";

const VIEWER = "11111111-1111-1111-1111-111111111111";
const AISHA = "22222222-2222-2222-2222-222222222222";
const DEV = "33333333-3333-3333-3333-333333333333";

function row(partial: Partial<HistoryActivityRow>): HistoryActivityRow {
  return {
    group_id: "group-1",
    action: "created",
    activity_type: "transaction",
    changed_by: AISHA,
    changed_at: "2026-11-13 02:00:00",
    changes: { action: "created", transaction: { description: "Dinner" } },
    snapshot: { description: "Dinner" },
    ...partial,
  };
}

Deno.test("last activity is actor, action, subject, and a timestamp", () => {
  const names = new Map<string, string | null>([[AISHA, "Aisha Kapoor"]]);
  const mapped = lastActivityByGroup([row({})], names, VIEWER);
  assertEquals(mapped.get("group-1"), {
    actor: "Aisha",
    action: "added",
    subject: "Dinner",
    at: "2026-11-13T02:00:00.000Z",
  });
});

Deno.test("a settlement by the viewer names the other person", () => {
  const names = new Map<string, string | null>([
    [VIEWER, "Vaibhav"],
    [DEV, "Dev Shah"],
  ]);
  const mapped = lastActivityByGroup([
    row({
      action: "created",
      activity_type: "settlement",
      changed_by: VIEWER,
      changes: { action: "created", settlement: { from_user_id: VIEWER, to_user_id: DEV } },
      snapshot: { from_user_id: VIEWER, to_user_id: DEV },
    }),
  ], names, VIEWER);
  assertEquals(mapped.get("group-1"), {
    actor: "You",
    action: "settled",
    subject: "Dev",
    at: "2026-11-13T02:00:00.000Z",
    viewerPaid: true,
  });
});

Deno.test("activity names do not include an email", () => {
  const names = new Map<string, string | null>([[AISHA, null]]);
  const mapped = lastActivityByGroup([row({ snapshot: { description: "Dinner" } })], names, VIEWER);
  const activity = mapped.get("group-1");
  assertEquals(activity?.actor, "Someone");
  assertEquals(JSON.stringify(activity).includes("@"), false);
});

Deno.test("latest activity RPC is scoped to the caller's group ids", async () => {
  const calls: Array<{ fn: string; args: { p_group_ids: string[] } }> = [];
  const rows = await fetchLatestHistoryRows({
    rpc(fn, args) {
      calls.push({ fn, args });
      return Promise.resolve({
        data: [row({ group_id: args.p_group_ids[0] })],
        error: null,
      });
    },
  }, ["group-1", "group-2"]);
  assertEquals(calls, [{
    fn: "latest_group_activity",
    args: { p_group_ids: ["group-1", "group-2"] },
  }]);
  assertEquals(rows[0].group_id, "group-1");
  assertEquals(await fetchLatestHistoryRows({ rpc: () => Promise.resolve({ data: [], error: null }) }, []), []);
});
