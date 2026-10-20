import AsyncStorage from "@react-native-async-storage/async-storage";
import { BILL_TOKEN_PATTERN, formatBillAmount, type BillSplitMode } from "./billSplit";

const STORAGE_KEY = "recent-bill-splits-v1";
const MAX_RECENT = 3;

export interface RecentBillSplit {
  token: string;
  amount_minor: number;
  currency: string;
  mode: BillSplitMode;
  /** Short label for the Home row (amount + optional people hint). */
  title: string;
  remembered_at: string;
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
    typeof row.title === "string" &&
    typeof row.remembered_at === "string" &&
    (row.mode === "equal" || row.mode === "shares" || row.mode === "unequal")
  );
}

export function recentBillTitle(
  amountMinor: number,
  currency: string,
  peopleCount?: number,
): string {
  const amount = formatBillAmount(amountMinor, currency);
  if (peopleCount && peopleCount > 1) {
    return `${amount} · ${peopleCount} people`;
  }
  return amount;
}

export async function listRecentBillSplits(userId: string): Promise<RecentBillSplit[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentBill).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

/** Keep the newest 2–3 bills so a closed bill can be reopened from Home. */
export async function rememberRecentBillSplit(
  userId: string,
  entry: Omit<RecentBillSplit, "remembered_at" | "title"> & { title?: string; people_count?: number },
): Promise<RecentBillSplit[]> {
  if (!BILL_TOKEN_PATTERN.test(entry.token)) return listRecentBillSplits(userId);
  const next: RecentBillSplit = {
    token: entry.token,
    amount_minor: entry.amount_minor,
    currency: entry.currency,
    mode: entry.mode,
    title: entry.title ?? recentBillTitle(entry.amount_minor, entry.currency, entry.people_count),
    remembered_at: new Date().toISOString(),
  };
  const existing = await listRecentBillSplits(userId);
  const merged = [next, ...existing.filter((row) => row.token !== next.token)].slice(0, MAX_RECENT);
  try {
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(merged));
  } catch {
    // Ephemeral cache only — failure must not block split flow.
  }
  return merged;
}
