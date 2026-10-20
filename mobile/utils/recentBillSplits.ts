import AsyncStorage from "@react-native-async-storage/async-storage";
import { BILL_TOKEN_PATTERN, type BillSplitMode, type BillSplitSession } from "./billSplit";
import { formatCurrency } from "./currency";

const STORAGE_KEY = "recent-bill-splits-v2";
const LAST_CURRENCY_KEY = "last-bill-split-currency";
/** Persist enough history that the split screen can show 3 + “See all”. */
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
  /**
   * Local settlement tracking (no hosted DB). True when every participant has
   * confirmed their share, or the viewer’s net is zero.
   */
  settled: boolean;
  /**
   * Signed minor units from the viewer’s perspective on this one-time bill.
   * Positive = you’re owed; negative = you owe. Honest local estimate only.
   */
  your_net_minor: number;
  /** @deprecated kept for v1 migrations */
  title?: string;
}

export interface OneTimeBillsHomeSummary {
  net_minor: number;
  currency: string;
  unsettled_count: number;
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
    typeof row.settled === "boolean" &&
    typeof row.your_net_minor === "number" &&
    (row.mode === "equal" || row.mode === "shares" || row.mode === "unequal")
  );
}

/** Creator paid the total; net owed to them is total − their share. */
export function creatorNetMinor(amountMinor: number, peopleCount: number): number {
  const count = Math.max(2, peopleCount);
  const yourShare = Math.floor(amountMinor / count);
  return amountMinor - yourShare;
}

/** Migrate v1/v2 rows that lack settlement fields into the current shape. */
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
  const people_count = typeof row.people_count === "number" ? row.people_count : 2;
  const settled = typeof row.settled === "boolean" ? row.settled : false;
  const your_net_minor = typeof row.your_net_minor === "number"
    ? row.your_net_minor
    : settled
      ? 0
      : creatorNetMinor(row.amount_minor, people_count);
  return {
    token: row.token,
    amount_minor: row.amount_minor,
    currency: row.currency,
    mode,
    identity,
    people_count,
    remembered_at: row.remembered_at,
    settled,
    your_net_minor,
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
  if (payee) return `With ${payee.slice(0, 96)}`;
  const creator = input.creatorName?.trim();
  if (creator) return `With ${creator.slice(0, 96)}`;
  return "Bill";
}

/** Derive local settled + net from a live session (creator = index 0). */
export function settlementFromBillSession(
  session: BillSplitSession,
  viewerParticipantId?: string | null,
): { settled: boolean; your_net_minor: number } {
  const settled = session.participants.length > 0
    && session.participants.every((person) => person.confirmed);
  if (settled) return { settled: true, your_net_minor: 0 };

  const viewer = viewerParticipantId
    ? session.participants.find((person) => person.id === viewerParticipantId)
    : session.participants[0];
  if (!viewer) {
    return {
      settled: false,
      your_net_minor: creatorNetMinor(session.amount_minor, session.participants.length),
    };
  }
  // Creator (first participant) paid the total → owed everyone else’s shares.
  if (viewer.id === session.participants[0]?.id) {
    const others = session.amount_minor - viewer.amount_minor;
    return { settled: false, your_net_minor: others };
  }
  // Other participants owe their share until confirmed.
  return {
    settled: viewer.confirmed,
    your_net_minor: viewer.confirmed ? 0 : -viewer.amount_minor,
  };
}

/**
 * Home quiet row: one net across unsettled local bills.
 * Picks the currency with the largest absolute unsettled net (honest, no FX).
 */
export function summarizeUnsettledOneTimeBills(
  bills: RecentBillSplit[],
): OneTimeBillsHomeSummary | null {
  const unsettled = bills.filter((bill) => !bill.settled && Math.abs(bill.your_net_minor) >= 1);
  if (unsettled.length === 0) return null;

  const byCurrency = new Map<string, number>();
  for (const bill of unsettled) {
    const code = bill.currency.toUpperCase();
    byCurrency.set(code, (byCurrency.get(code) ?? 0) + bill.your_net_minor);
  }
  let currency = unsettled[0].currency.toUpperCase();
  let net_minor = byCurrency.get(currency) ?? 0;
  for (const [code, net] of byCurrency) {
    if (Math.abs(net) > Math.abs(net_minor)) {
      currency = code;
      net_minor = net;
    }
  }
  if (Math.abs(net_minor) < 1) return null;
  return {
    net_minor,
    currency,
    unsettled_count: unsettled.length,
  };
}

export async function listRecentBillSplits(userId: string): Promise<RecentBillSplit[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(coerceRecentBill)
      .filter((row): row is RecentBillSplit => !!row)
      .sort((a, b) => Date.parse(b.remembered_at) - Date.parse(a.remembered_at))
      .slice(0, MAX_STORED);
  } catch {
    return [];
  }
}

/** Keep recent bills so a closed bill can be reopened from the split screen. */
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
    settled?: boolean;
    your_net_minor?: number;
  },
): Promise<RecentBillSplit[]> {
  if (!BILL_TOKEN_PATTERN.test(entry.token)) return listRecentBillSplits(userId);
  const people_count = entry.people_count && entry.people_count > 0 ? entry.people_count : 2;
  const settled = entry.settled ?? false;
  const your_net_minor = entry.your_net_minor
    ?? (settled ? 0 : creatorNetMinor(entry.amount_minor, people_count));
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
    people_count,
    remembered_at: new Date().toISOString(),
    settled,
    your_net_minor,
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

/** Patch settlement fields after a confirm/read without bumping remembered_at order. */
export async function updateRecentBillSettlement(
  userId: string,
  token: string,
  patch: { settled: boolean; your_net_minor: number },
): Promise<RecentBillSplit[]> {
  const existing = await listRecentBillSplits(userId);
  const merged = existing.map((row) =>
    row.token === token
      ? { ...row, settled: patch.settled, your_net_minor: patch.your_net_minor }
      : row,
  );
  try {
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(merged));
  } catch {
    // ignore
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
