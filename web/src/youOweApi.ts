export const YOU_OWE_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export type PublicYouOweLine = {
  currency: string;
  amount: number;
  direction: "you_owe" | "owed";
};

export type PublicYouOweView = {
  even: boolean;
  amounts: PublicYouOweLine[];
  expires_at: string;
};

/** undefined = another site route; null = malformed token. */
export function youOweRoute(path: string): string | null | undefined {
  if (path !== "/owe" && !path.startsWith("/owe/")) return undefined;
  return path.match(/^\/owe\/([a-f0-9]{64})\/?$/)?.[1] ?? null;
}

export function formatYouOweAmount(line: PublicYouOweLine): string {
  return `${line.currency} ${line.amount.toFixed(2)}`;
}

export function youOweHeadline(view: PublicYouOweView): string {
  if (view.even || view.amounts.length === 0) return "You're even";
  const first = view.amounts[0];
  const lead = first.direction === "you_owe" ? "You owe" : "You're owed";
  if (view.amounts.length === 1) return `${lead} ${formatYouOweAmount(first)}`;
  return view.amounts
    .map((line) => `${line.direction === "you_owe" ? "You owe" : "You're owed"} ${formatYouOweAmount(line)}`)
    .join(" and ");
}

export async function requestPublicYouOwe(token: string): Promise<PublicYouOweView | null> {
  if (!YOU_OWE_TOKEN_PATTERN.test(token)) return null;
  const base = import.meta.env.VITE_SUPABASE_URL || import.meta.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) throw new Error("This page is temporarily unavailable.");
  const response = await fetch(`${base.replace(/\/$/, "")}/functions/v1/balances/you-owe?token=${token}`, {
    method: "GET",
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("This page is temporarily unavailable.");
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object") return null;
  const view = payload as PublicYouOweView;
  if (typeof view.even !== "boolean" || !Array.isArray(view.amounts) || typeof view.expires_at !== "string") {
    return null;
  }
  return view;
}
