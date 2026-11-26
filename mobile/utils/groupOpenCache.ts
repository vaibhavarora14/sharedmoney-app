/**
 * Disk cache for the last all-balances response and the last ~10 opened
 * groups (balances, first ledger page, participants, first activity page).
 * Sign-out clears it. Storage is injected so this stays on the AsyncStorage
 * the app already uses. Disk seeds use updatedAt 0 so money totals refetch.
 */
import type {
  ActivityFeedResponse,
  BalancesResponse,
  Participant,
  Settlement,
  Transaction,
} from "../types";
import { queryKeys } from "../hooks/queryKeys";

/** Disk seeds are stale so money/list queries refetch on open instead of looking final. */
export const DISK_CACHE_UPDATED_AT = 0;

export const GROUP_OPEN_CACHE_LIMIT = 10;

export type KeyValueStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export type SavedTransactionPage = {
  items: Transaction[];
  has_more: boolean;
  next_cursor: { date: string; id: number } | null;
};

export type SavedGroupOpen = {
  groupId: string;
  savedAt: string;
  balances: BalancesResponse;
  ledger: {
    transactions: SavedTransactionPage;
    settlements: Settlement[];
  };
  participants: Participant[];
  /** First activity page. Optional so older disk files still hydrate. */
  activity?: ActivityFeedResponse;
};

type GroupOpenFile = {
  order: string[];
  groups: Record<string, SavedGroupOpen>;
};

export type SavedAllBalances = {
  savedAt: string;
  response: BalancesResponse;
};

export type QueryDataWriter = {
  setQueryData: (
    queryKey: readonly unknown[],
    data: unknown,
    options?: { updatedAt?: number },
  ) => void;
  getQueryData?: (queryKey: readonly unknown[]) => unknown;
};

const files = new Map<string, GroupOpenFile>();
const allBalances = new Map<string, SavedAllBalances>();
const pendingActivity = new Map<string, ActivityFeedResponse>();

function activityPendingKey(userId: string, groupId: string): string {
  return `${userId}:${groupId}`;
}

export function groupOpenStorageKey(userId: string): string {
  return `sm:group-open:${userId}`;
}

export function allBalancesStorageKey(userId: string): string {
  return `sm:balances-all:${userId}`;
}

export function resetGroupOpenMemoryForTests(): void {
  files.clear();
  allBalances.clear();
  pendingActivity.clear();
}

export function readGroupOpenMemory(userId: string, groupId: string): SavedGroupOpen | null {
  return files.get(userId)?.groups[groupId] ?? null;
}

export function readAllBalancesMemory(userId: string): SavedAllBalances | null {
  return allBalances.get(userId) ?? null;
}

function emptyFile(): GroupOpenFile {
  return { order: [], groups: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseFile(raw: string | null): GroupOpenFile | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.order) || !isRecord(parsed.groups)) {
      return null;
    }
    return parsed as GroupOpenFile;
  } catch {
    return null;
  }
}

function parseAllBalances(raw: string | null): SavedAllBalances | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.response)) return null;
    return parsed as SavedAllBalances;
  } catch {
    return null;
  }
}

export async function hydrateGroupOpenCache(
  userId: string,
  storage: KeyValueStorage,
): Promise<void> {
  const [groupRaw, allRaw] = await Promise.all([
    storage.getItem(groupOpenStorageKey(userId)),
    storage.getItem(allBalancesStorageKey(userId)),
  ]);
  const file = parseFile(groupRaw);
  if (file) files.set(userId, file);
  const savedAll = parseAllBalances(allRaw);
  if (savedAll) allBalances.set(userId, savedAll);
}

export async function rememberAllBalances(
  storage: KeyValueStorage,
  userId: string,
  response: BalancesResponse,
  savedAt = new Date().toISOString(),
): Promise<void> {
  const saved = { savedAt, response };
  allBalances.set(userId, saved);
  await storage.setItem(allBalancesStorageKey(userId), JSON.stringify(saved));
}

export async function rememberGroupOpen(
  storage: KeyValueStorage,
  userId: string,
  entry: SavedGroupOpen,
): Promise<void> {
  const current = files.get(userId) ?? emptyFile();
  const previous = current.groups[entry.groupId];
  const pending = pendingActivity.get(activityPendingKey(userId, entry.groupId));
  const merged: SavedGroupOpen = {
    ...entry,
    activity: entry.activity ?? pending ?? previous?.activity,
  };
  const order = [entry.groupId, ...current.order.filter((id) => id !== entry.groupId)];
  const groups = { ...current.groups, [entry.groupId]: merged };
  while (order.length > GROUP_OPEN_CACHE_LIMIT) {
    const dropped = order.pop();
    if (dropped) delete groups[dropped];
  }
  const next = { order, groups };
  files.set(userId, next);
  await storage.setItem(groupOpenStorageKey(userId), JSON.stringify(next));
}

/** Removes every saved balance response and ledger page for this user. */
export async function clearSavedGroupMoney(
  userId: string,
  storage: KeyValueStorage,
): Promise<void> {
  files.delete(userId);
  allBalances.delete(userId);
  await Promise.all([
    storage.removeItem(groupOpenStorageKey(userId)),
    storage.removeItem(allBalancesStorageKey(userId)),
  ]);
}

function seedIfEmpty(
  client: QueryDataWriter,
  queryKey: readonly unknown[],
  data: unknown,
): void {
  const existing = client.getQueryData?.(queryKey);
  if (existing != null) return;
  client.setQueryData(queryKey, data, { updatedAt: DISK_CACHE_UPDATED_AT });
}

export function seedAllBalancesQuery(client: QueryDataWriter, userId: string): boolean {
  const saved = readAllBalancesMemory(userId);
  if (!saved) return false;
  seedIfEmpty(client, ["balances", "all"], saved.response);
  return true;
}

export function activityFeedQueryKey(groupId: string): readonly unknown[] {
  return [...queryKeys.activity(groupId), "feed"];
}

export async function rememberGroupActivity(
  storage: KeyValueStorage,
  userId: string,
  groupId: string,
  activity: ActivityFeedResponse,
): Promise<void> {
  pendingActivity.set(activityPendingKey(userId, groupId), activity);
  const current = files.get(userId)?.groups[groupId];
  if (!current) {
    return;
  }
  await rememberGroupOpen(storage, userId, { ...current, activity });
}

export function seedGroupOpenQueries(
  client: QueryDataWriter,
  userId: string,
  groupId: string,
): boolean {
  const saved = readGroupOpenMemory(userId, groupId);
  if (!saved) return false;
  seedIfEmpty(client, queryKeys.balances(groupId), saved.balances);
  seedIfEmpty(client, queryKeys.transactionsFeed(groupId), {
    pages: [saved.ledger.transactions],
    pageParams: [null],
  });
  seedIfEmpty(client, queryKeys.settlements(groupId), {
    settlements: saved.ledger.settlements,
  });
  seedIfEmpty(client, queryKeys.participants(groupId), saved.participants);
  if (saved.activity) {
    seedIfEmpty(client, activityFeedQueryKey(groupId), {
      pages: [saved.activity],
      pageParams: [0],
    });
  }
  return true;
}
