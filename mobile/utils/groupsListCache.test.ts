import { assertEquals } from "jsr:@std/assert@1";
import type { Group } from "../types.ts";
import {
  DISK_CACHE_UPDATED_AT,
  hydrateGroupsListCache,
  resetGroupsListMemoryForTests,
  seedGroupsListQuery,
  writeGroupsListCache,
} from "./groupsListCache.ts";

function memoryStorage() {
  const dump = new Map<string, string>();
  return {
    dump,
    getItem: (key: string) => Promise.resolve(dump.get(key) ?? null),
    setItem: (key: string, value: string) => {
      dump.set(key, value);
      return Promise.resolve();
    },
  };
}

Deno.test("groups list cache keeps last_activity for instant paint", async () => {
  resetGroupsListMemoryForTests();
  const storage = memoryStorage();
  const groups = [{
    id: "g1",
    name: "Goa",
    created_by: "u",
    created_at: "2026-11-01T00:00:00Z",
    last_activity: {
      actor: "Aisha",
      action: "added",
      subject: "Dinner",
      at: "2026-11-13T02:00:00.000Z",
    },
  }] as Group[];
  writeGroupsListCache("user", groups, storage);
  resetGroupsListMemoryForTests();
  const hydrated = await hydrateGroupsListCache("user", storage);
  assertEquals(hydrated?.[0]?.last_activity?.actor, "Aisha");

  const writes: Array<{ updatedAt?: number; data: unknown }> = [];
  const seeded = seedGroupsListQuery({
    getQueryData: () => undefined,
    setQueryData: (_key, data, options) => {
      writes.push({ data, updatedAt: options?.updatedAt });
    },
  }, "user");
  assertEquals(seeded, true);
  assertEquals(writes[0].updatedAt, DISK_CACHE_UPDATED_AT);
});
