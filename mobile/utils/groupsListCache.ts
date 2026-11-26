import type { Group } from "../types";
import { queryKeys } from "../hooks/queryKeys";

export const DISK_CACHE_UPDATED_AT = 0;

export type KeyValueStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

export type QueryDataWriter = {
  setQueryData: (
    queryKey: readonly unknown[],
    data: unknown,
    options?: { updatedAt?: number },
  ) => void;
  getQueryData: (queryKey: readonly unknown[]) => unknown;
};

const memory = new Map<string, Group[]>();

export function groupsListStorageKey(userId: string): string {
  return `sm:rq-groups:${userId}`;
}

export function resetGroupsListMemoryForTests(): void {
  memory.clear();
}

export function readGroupsListMemory(userId: string): Group[] | null {
  return memory.get(userId) ?? null;
}

function isGroupArray(value: unknown): value is Group[] {
  return Array.isArray(value);
}

export async function readGroupsListCache(
  userId: string,
  storage: KeyValueStorage,
): Promise<Group[] | null> {
  const cached = memory.get(userId);
  if (cached?.length) return cached;
  try {
    const raw = await storage.getItem(groupsListStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isGroupArray(parsed) || parsed.length === 0) return null;
    memory.set(userId, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export function writeGroupsListCache(
  userId: string,
  groups: Group[],
  storage: KeyValueStorage,
): void {
  memory.set(userId, groups);
  storage.setItem(groupsListStorageKey(userId), JSON.stringify(groups)).catch(() => {});
}

/** Seed RQ from disk/memory as stale so open always refreshes in the background. */
export function seedGroupsListQuery(client: QueryDataWriter, userId: string): boolean {
  const cached = memory.get(userId);
  if (!cached?.length) return false;
  const existing = client.getQueryData(queryKeys.groups);
  if (Array.isArray(existing) && existing.length > 0) return false;
  client.setQueryData(queryKeys.groups, cached, { updatedAt: DISK_CACHE_UPDATED_AT });
  return true;
}

export async function hydrateGroupsListCache(
  userId: string,
  storage: KeyValueStorage,
): Promise<Group[] | null> {
  return readGroupsListCache(userId, storage);
}
