import AsyncStorage from "@react-native-async-storage/async-storage";
import { BILL_TOKEN_PATTERN, type BillSplitMode } from "./billSplit";
import { formatCurrency } from "./currency";

const STORAGE_KEY = "recent-bill-splits-v2";
const LAST_CURRENCY_KEY = "last-bill-split-currency";
/** Persist enough history that Home can show 3 + “See all”. */
const MAX_STORED = 20;
export const RECENT_BILLS_PREVIEW_COUNT = 3;

export interface RecentBillSplit {
  token: string;
  amount_minor: number;
  currency: string;
  mode: BillSplitMode;
  /** Bill name when set; otherwise first payee / creator. */
  identity: string;
  people_count: number;
  remembered_at: string;
  /** @deprecated kept for v1 migrations */
  title?: string;
}

function storageKey(userId: string): string {
  return `${STORAGE_KEY}:${userId}`;
}

function isRecentBill(value: unknown): value is RecentBillSplit {
  if (!value || typeof value !== "object") return false;
  const row = value as RecentBillSplit;
  return (
    typeof row.token === "string" &&
    BILL_TOKEN_PATTERN.test(row.token) &&
    typeof row.amount_minor === "number" &&
    typeof row.currency === "string" &&
    typeof row.identity === "string" &&
    typeof row.people_count === "number" &&
    typeof row.remembered_at === "string" &&
    (row.mode === "equal" || row.mode === "shares" || row.mode === "unequal")
  );
}

/** Migrate v1 rows that only had a `title` into the identity shape. */
function coerceRecentBill(value: unknown): RecentBillSplit | null {
  if (isRecentBill(value)) return value;
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.token !== "string" ||
    !BILL_TOKEN_PATTERN.test(row.token) ||
    typeof row.amount_minor !== "number" ||
    typeof row.currency !== "string" ||
    typeof row.remembered_at !== "string"
  ) {
    return null;
  }
  const mode = row.mode;
  if (mode !== "equal" && mode !== "shares" && mode !== "unequal") return null;
  const identity = typeof row.identity === "string" && row.identity.trim()
    ? row.identity.trim()
    : typeof row.title === "string" && row.title.trim()
      ? row.title.trim()
      : "Bill";
  return {
    token: row.token,
    amount_minor: row.amount_minor,
    currency: row.currency,
    mode,
    identity,
    people_count: typeof row.people_count === "number" ? row.people_count : 2,
    remembered_at: row.remembered_at,
  };
}

export function formatRecentBillAmount(amountMinor: number, currency: string): string {
  return formatCurrency(amountMinor / 100, currency);
}

export function relativeBillDate(iso: string, nowMs = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const dayMs = 86_400_000;
  const startToday = new Date(nowMs);
  startToday.setHours(0, 0, 0, 0);
  const startThen = new Date(then);
  startThen.setHours(0, 0, 0, 0);
  const days = Math.round((startToday.getTime() - startThen.getTime()) / dayMs);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function recentBillIdentity(input: {
  name?: string | null;
  creatorName?: string | null;
  firstPayeeName?: string | null;
}): string {
  const name = input.name?.trim();
  if (name) return name.slice(0, 100);
  const payee = input.firstPayeeName?.trim();
  if (payee) return payee.slice(0, 100);
  const creator = input.creatorName?.trim();
  if (creator) return creator.slice(0, 100);
  return "Bill";
}

export async function listRecentBillSplits(userId: string): Promise<RecentBillSplit[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(coerceRecentBill).filter((row): row is RecentBillSplit => !!row).slice(0, MAX_STORED);
  } catch {
    return [];
  }
}

/** Keep recent bills so a closed bill can be reopened from Home. */
export async function rememberRecentBillSplit(
  userId: string,
  entry: {
    token: string;
    amount_minor: number;
    currency: string;
    mode: BillSplitMode;
    identity?: string;
    name?: string | null;
    creatorName?: string | null;
    firstPayeeName?: string | null;
    people_count?: number;
  },
): Promise<RecentBillSplit[]> {
  if (!BILL_TOKEN_PATTERN.test(entry.token)) return listRecentBillSplits(userId);
  const next: RecentBillSplit = {
    token: entry.token,
    amount_minor: entry.amount_minor,
    currency: entry.currency,
    mode: entry.mode,
    identity: entry.identity
      ?? recentBillIdentity({
        name: entry.name,
        creatorName: entry.creatorName,
        firstPayeeName: entry.firstPayeeName,
      }),
    people_count: entry.people_count && entry.people_count > 0 ? entry.people_count : 2,
    remembered_at: new Date().toISOString(),
  };
  const existing = await listRecentBillSplits(userId);
  const merged = [next, ...existing.filter((row) => row.token !== next.token)].slice(0, MAX_STORED);
  try {
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(merged));
    await AsyncStorage.setItem(LAST_CURRENCY_KEY, entry.currency.toUpperCase());
  } catch {
    // Ephemeral cache only — failure must not block split flow.
  }
  return merged;
}

export async function readLastBillSplitCurrency(): Promise<string | null> {
  try {
    const value = await AsyncStorage.getItem(LAST_CURRENCY_KEY);
    return value && /^[A-Z]{3}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export async function writeLastBillSplitCurrency(currency: string): Promise<void> {
  if (!/^[A-Z]{3}$/.test(currency)) return;
  try {
    await AsyncStorage.setItem(LAST_CURRENCY_KEY, currency);
  } catch {
    // ignore
  }
}
