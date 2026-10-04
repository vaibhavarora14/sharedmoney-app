/** Issue 319: a bill session has no group, expense, or settlement identity. */
export type BillSplitMode = "equal" | "shares" | "unequal";
export const MAX_BILL_MINOR = 1_000_000_000;
export const BILL_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export interface BillSplitSession {
  amount_minor: number;
  currency: string;
  mode: BillSplitMode;
  participants: {
    id: string;
    display_name: string;
    amount_minor: number;
    confirmed: boolean;
  }[];
}

/** Parse decimal text without floating point multiplication or silent rounding. */
export function billAmountMinor(text: string): number | null {
  if (!/^\d+(?:\.\d{0,2})?$/.test(text.trim())) return null;
  const [whole, fraction = ""] = text.trim().split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(minor) && minor <= MAX_BILL_MINOR ? minor : null;
}

/** Integer allocation; shares use largest remainder, ties go to earlier people. */
export function allocateBillSplit(
  total: number,
  count: number,
  mode: BillSplitMode,
  values: number[] = [],
): number[] {
  if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_BILL_MINOR) {
    throw new Error("Enter an amount greater than zero (up to 10,000,000).");
  }
  if (!Number.isInteger(count) || count < 2 || count > 50) {
    throw new Error("Include yourself and 1–49 other people.");
  }
  if (!["equal", "shares", "unequal"].includes(mode)) throw new Error("Invalid split mode.");
  if (mode !== "equal" && (values.length !== count || values.some((n) =>
    !Number.isSafeInteger(n) || n <= 0 || n > (mode === "shares" ? 99 : MAX_BILL_MINOR)
  ))) {
    throw new Error(mode === "shares" ? "Use 1–99 shares per person." : "Enter a positive amount for each person.");
  }
  if (mode === "unequal") {
    if (values.reduce((sum, n) => sum + n, 0) !== total) {
      throw new Error("Exact amounts must add up to the total.");
    }
    return [...values];
  }
  const weights = mode === "equal" ? Array<number>(count).fill(1) : values;
  const weight = weights.reduce((sum, n) => sum + n, 0);
  const result = weights.map((n) => Math.floor(total * n / weight));
  const order = weights.map((n, i) => ({ i, remainder: total * n % weight }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  const leftover = total - result.reduce((sum, n) => sum + n, 0);
  for (const { i } of order.slice(0, leftover)) result[i]++;
  if (result.some((n) => n === 0)) throw new Error("Increase the total or adjust the people or shares so everyone has at least 0.01.");
  return result;
}

export function extractBillSplitToken(url: string | null | undefined): string | null {
  const match = url?.match(/(?:^|\/)(?:app\/)?split\/([a-f0-9]{64})(?:[/?#]|$)/);
  return match?.[1] ?? null;
}

export function billSplitUrl(token: string): string {
  if (!BILL_TOKEN_PATTERN.test(token)) throw new Error("Invalid bill link.");
  // Public Vite page, deliberately outside the authenticated Expo /app shell.
  return `https://sharedmoney.app/split/${token}`;
}

export function formatBillAmount(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toFixed(2)}`;
}
