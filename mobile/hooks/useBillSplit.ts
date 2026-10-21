import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../supabase";
import { fetchWithAuth } from "../utils/api";
import { BILL_TOKEN_PATTERN, type BillSplitMode, type BillSplitSession } from "../utils/billSplit";
import { isBenignConnectivityError } from "../utils/networkErrors";
import type { ExistingPerson } from "../utils/peoplePicker";

/** Thrown when a bill-link fetch failed for connectivity reasons (Retry UI). */
export class BillSplitNetworkError extends Error {
  constructor(message = "You're offline") {
    super(message);
    this.name = "BillSplitNetworkError";
  }
}

export function useBillSplitPeople() {
  const { user } = useAuth();
  return useQuery<ExistingPerson[]>({
    queryKey: ["bill-split-known-people", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const response = await fetchWithAuth("/participants?directory=true");
      if (!response.ok) throw new Error("Could not load known people.");
      return response.json();
    },
    staleTime: 60_000,
  });
}

export async function createBillSplit(input: {
  amount: number; currency: string; people: string[]; mode: BillSplitMode; values: number[];
}): Promise<string> {
  const { data, error } = await supabase.rpc("create_bill_split_session", {
    p_amount_minor: input.amount, p_currency: input.currency, p_people: input.people,
    p_mode: input.mode, p_values: input.mode === "equal" ? null : input.values,
  });
  if (error) throw new Error("Could not create this bill. Please try again.");
  if (typeof data !== "string" || !BILL_TOKEN_PATTERN.test(data)) throw new Error("Could not create this bill.");
  return data;
}

export async function readBillSplit(token: string): Promise<BillSplitSession | null> {
  const { data, error } = await supabase.rpc("get_bill_split_session", { p_token: token });
  if (error) {
    // Dead/expired tokens return null data with no error from the RPC.
    // Preserve connectivity failures so the screen can show "You're offline" + Retry.
    if (isBenignConnectivityError(error)) {
      throw new BillSplitNetworkError();
    }
    throw new Error("Could not load this bill. Please try again.");
  }
  return data as BillSplitSession | null;
}

export async function confirmBillSplit(token: string, participantId: string): Promise<BillSplitSession | null> {
  const { data, error } = await supabase.rpc("confirm_bill_split_share", {
    p_token: token, p_participant_id: participantId,
  });
  if (error) throw new Error("Could not confirm your share. Please try again.");
  return data as BillSplitSession | null;
}
