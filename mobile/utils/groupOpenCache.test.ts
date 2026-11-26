import { assertEquals } from "jsr:@std/assert@1";
import type { ActivityItem, BalancesResponse } from "../types";
import {
  DISK_CACHE_UPDATED_AT,
  clearSavedGroupMoney,
  GROUP_OPEN_CACHE_LIMIT,
  hydrateGroupOpenCache,
  readAllBalancesMemory,
  readGroupOpenMemory,
  rememberAllBalances,
  rememberGroupActivity,
  rememberGroupOpen,
  resetGroupOpenMemoryForTests,
  seedGroupOpenQueries,
  type KeyValueStorage,
  type SavedGroupOpen,
} from "./groupOpenCache.ts";

function memoryStorage(): KeyValueStorage & { dump: Map<string, string> } {
  const dump = new Map<string, string>();
  return {
    dump,
    getItem: (key) => Promise.resolve(dump.get(key) ?? null),
    setItem: (key, value) => {
      dump.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key) => {
      dump.delete(key);
      return Promise.resolve();
    },
  };
}

function entry(groupId: string): SavedGroupOpen {
  return {
    groupId,
    savedAt: "2026-11-12T00:00:00.000Z",
    balances: { group_balances: [], overall_balances: [] },
    ledger: {
      transactions: { items: [{ id: 1, amount: 10, description: groupId, date: "2026-11-12", type: "expense" }], has_more: false, next_cursor: null },
      settlements: [],
    },
    participants: [],
  };
}

const all: BalancesResponse = {
  group_balances: [{ group_id: "g1", group_name: "Goa", balances: [] }],
  overall_balances: [],
};

Deno.test("sign-out clears every saved balance and ledger page", async () => {
  resetGroupOpenMemoryForTests();
  const storage = memoryStorage();
  await rememberAllBalances(storage, "user", all, "2026-11-12T00:00:00.000Z");
  await rememberGroupOpen(storage, "user", entry("g1"));
  await rememberGroupOpen(storage, "user", entry("g2"));
  assertEquals(readGroupOpenMemory("user", "g1")?.ledger.transactions.items[0]?.description, "g1");
  assertEquals(readAllBalancesMemory("user")?.response.group_balances.length, 1);

  await clearSavedGroupMoney("user", storage);

  assertEquals(readGroupOpenMemory("user", "g1"), null);
  assertEquals(readGroupOpenMemory("user", "g2"), null);
  assertEquals(readAllBalancesMemory("user"), null);
  assertEquals(storage.dump.size, 0);

  await hydrateGroupOpenCache("user", storage);
  assertEquals(readGroupOpenMemory("user", "g1"), null);
  assertEquals(readAllBalancesMemory("user"), null);
});

Deno.test("group open cache keeps the last 10 groups and restores the first ledger page", async () => {
  resetGroupOpenMemoryForTests();
  const storage = memoryStorage();
  for (let index = 0; index < GROUP_OPEN_CACHE_LIMIT + 1; index += 1) {
    await rememberGroupOpen(storage, "user", entry(`g${index}`));
  }
  assertEquals(readGroupOpenMemory("user", "g0"), null);
  assertEquals(readGroupOpenMemory("user", "g10")?.groupId, "g10");

  resetGroupOpenMemoryForTests();
  await hydrateGroupOpenCache("user", storage);
  const writes: { key: readonly unknown[]; data: unknown }[] = [];
  const seeded = seedGroupOpenQueries({
    setQueryData: (key, data) => writes.push({ key, data }),
  }, "user", "g10");
  assertEquals(seeded, true);
  assertEquals(writes.length, 4);
  const ledger = writes.find((write) => write.key[0] === "transactions");
  const page = ledger?.data as { pages: { items: { description: string }[] }[] };
  assertEquals(page.pages[0].items[0].description, "g10");
});

Deno.test("activity first page is restored as a stale infinite query", async () => {
  resetGroupOpenMemoryForTests();
  const storage = memoryStorage();
  await rememberGroupOpen(storage, "user", entry("g1"));
  await rememberGroupActivity(storage, "user", "g1", {
    activities: [{ id: "hist-1" } as ActivityItem],
    total: 1,
    has_more: false,
  });
  const writes: { key: readonly unknown[]; updatedAt?: number }[] = [];
  seedGroupOpenQueries({
    setQueryData: (key, _data, options) => writes.push({ key, updatedAt: options?.updatedAt }),
  }, "user", "g1");
  const activity = writes.find((write) => write.key[0] === "activity");
  const balances = writes.find((write) => write.key[0] === "balances");
  assertEquals(activity?.key, ["activity", "g1", "feed"]);
  assertEquals(activity?.updatedAt, DISK_CACHE_UPDATED_AT);
  assertEquals(balances?.updatedAt, DISK_CACHE_UPDATED_AT);
});
