import { BILL_TOKEN_PATTERN, type BillSplitMode, type BillSplitSession } from "../../mobile/utils/billSplit";

/** undefined = another site route; start = public form; null = malformed token. */
export function billSplitRoute(path: string): string | null | undefined {
  if (path === "/split" || path === "/split/") return "start";
  if (path !== "/split" && !path.startsWith("/split/")) return undefined;
  return path.match(/^\/split\/([a-f0-9]{64})\/?$/)?.[1] ?? null;
}

export async function createGuestBillSplit(input: {
  amount: number; currency: string; people: string[]; mode: BillSplitMode; values: number[];
}): Promise<string> {
  const base = import.meta.env.VITE_SUPABASE_URL || import.meta.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  // This branch is local-only. Never send new bills to a hosted project, even
  // when the marketing build inherits hosted public configuration.
  let url: URL;
  try { url = new URL(base); }
  catch { throw new Error("Bill creation is temporarily unavailable."); }
  if (!key || !["http:", "https:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Bill creation is temporarily unavailable.");
  }
  const response = await fetch(`${url.origin}/rest/v1/rpc/create_guest_bill_split_session`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_amount_minor: input.amount, p_currency: input.currency, p_people: input.people,
      p_mode: input.mode, p_values: input.mode === "equal" ? null : input.values }),
    credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", redirect: "error",
  });
  if (!response.ok) throw new Error("Could not create this bill. Please try again.");
  const token: unknown = await response.json();
  if (typeof token !== "string" || !BILL_TOKEN_PATTERN.test(token)) throw new Error("Could not create this bill.");
  return token;
}

export async function requestBillSplit(token: string, participantId?: string): Promise<BillSplitSession | null> {
  if (!BILL_TOKEN_PATTERN.test(token)) return null;
  // The same public Supabase config as Expo. No service-role key or guest auth.
  const base = import.meta.env.VITE_SUPABASE_URL || import.meta.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) throw new Error("Bill sharing is temporarily unavailable. Please try again later.");
  const rpc = participantId ? "confirm_bill_split_share" : "get_bill_split_session";
  const response = await fetch(`${base.replace(/\/$/, "")}/rest/v1/rpc/${rpc}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: token, ...(participantId ? { p_participant_id: participantId } : {}) }),
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Couldn’t load or confirm this bill. Please try again.");
  return response.json() as Promise<BillSplitSession | null>;
}
