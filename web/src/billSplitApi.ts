import { BILL_TOKEN_PATTERN, type BillSplitSession } from "../../mobile/utils/billSplit";

/** undefined = another site route; null = a missing/malformed bill token. */
export function billSplitRoute(path: string): string | null | undefined {
  if (path !== "/split" && !path.startsWith("/split/")) return undefined;
  return path.match(/^\/split\/([a-f0-9]{64})\/?$/)?.[1] ?? null;
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
