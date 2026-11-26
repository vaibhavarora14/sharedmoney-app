import { assertEquals } from "jsr:@std/assert@1";
import {
  lastActivityByGroup,
  type HistoryActivityRow,
} from "../_shared/groupLastActivity.ts";
import {
  GROUPS_LIST_SEQUENTIAL_DB_ROUND_TRIPS,
  applyBalanceNudgeMutes,
  flattenListedGroups,
  loadGroupsList,
  visibleMemberships,
  type GroupMembershipRow,
} from "./list-groups.ts";

const AISHA = "22222222-2222-2222-2222-222222222222";
const VIEWER = "11111111-1111-1111-1111-111111111111";

Deno.test("groups list sequential round trips stay at memberships + parallel batch + names", () => {
  assertEquals(GROUPS_LIST_SEQUENTIAL_DB_ROUND_TRIPS, {
    memberships: 1,
    parallelListBatch: 1,
    recencyNames: 1,
  });
});

Deno.test("hidden memberships are omitted and left groups sort last", () => {
  const memberships: GroupMembershipRow[] = [
    { group_id: "left", status: "left", archived_at: null, hidden_at: null },
    { group_id: "hidden", status: "active", archived_at: null, hidden_at: "2026-11-01T00:00:00Z" },
    { group_id: "live", status: "active", archived_at: null, hidden_at: null },
    { group_id: "archived", status: "active", archived_at: "2026-10-01T00:00:00Z", hidden_at: null },
  ];
  const visible = visibleMemberships(memberships);
  assertEquals(visible.map((row) => row.group_id).sort(), ["archived", "left", "live"]);

  const flattened = flattenListedGroups(
    [
      { id: "left", name: "Old" },
      { id: "live", name: "Trip" },
      { id: "archived", name: "Archive" },
    ],
    new Map(visible.map((row) => [row.group_id, row])),
  );
  assertEquals(flattened.map((group) => group.id), ["live", "archived", "left"]);
  assertEquals(flattened.map((group) => group.hidden_at), [null, null, null]);
});

Deno.test("groups list recency and mute flags stay backward compatible", () => {
  const groups = applyBalanceNudgeMutes(
    [{ id: "g1", name: "Trip" }, { id: "g2", name: "Home" }],
    ["g2"],
  );
  assertEquals(groups[0].balance_nudge_muted, false);
  assertEquals(groups[1].balance_nudge_muted, true);

  const rows: HistoryActivityRow[] = [
    {
      group_id: "g1",
      action: "created",
      activity_type: "transaction",
      changed_by: AISHA,
      changed_at: "2026-11-13 02:00:00",
      changes: { action: "created", transaction: { description: "Dinner" } },
      snapshot: { description: "Dinner" },
    },
  ];
  const mapped = lastActivityByGroup(
    rows,
    new Map([[AISHA, "Aisha Kapoor"]]),
    VIEWER,
  );
  assertEquals(mapped.get("g1"), {
    actor: "Aisha",
    action: "added",
    subject: "Dinner",
    at: "2026-11-13T02:00:00.000Z",
  });
});

Deno.test("loadGroupsList fetches groups, mutes, and latest activity in one parallel batch", async () => {
  const groupId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const started: string[] = [];
  const chain = (data: unknown) => {
    const builder: Record<string, unknown> = {};
    const self = () => builder;
    const result = Promise.resolve({ data, error: null });
    builder.select = () => self();
    builder.eq = () => self();
    builder.in = () => self();
    builder.neq = () => self();
    builder.order = () => self();
    builder.then = (
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => result.then(onFulfilled, onRejected);
    return builder;
  };

  const supabase = {
    from(table: string) {
      started.push(table);
      if (table === "group_members") {
        return chain([
          { group_id: groupId, status: "active", archived_at: null, hidden_at: null },
        ]);
      }
      if (table === "groups") return chain([{ id: groupId, name: "Trip" }]);
      if (table === "group_balance_nudge_mutes") return chain([]);
      if (table === "profiles") return chain([]);
      if (table === "participants") return chain([]);
      throw new Error(`unexpected table ${table}`);
    },
    rpc(fn: string) {
      if (fn !== "latest_group_activity") throw new Error(fn);
      started.push("activity");
      return Promise.resolve({ data: [], error: null });
    },
  };

  const listed = await loadGroupsList(supabase, VIEWER, true);
  assertEquals(listed[0].id, groupId);
  assertEquals(listed[0].balance_nudge_muted, false);
  assertEquals(listed[0].last_activity, null);
  assertEquals(started[0], "group_members");
  const parallel = started.slice(1, 4).sort();
  assertEquals(parallel, ["activity", "group_balance_nudge_mutes", "groups"]);
});
