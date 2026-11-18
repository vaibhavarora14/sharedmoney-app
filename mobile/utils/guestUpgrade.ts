import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../supabase";
import { fetchWithAuth } from "./api";
import { guestUpgradePath, type GuestUpgradePath } from "./guestMode";

const STASH_KEY = "sharedmoney.guestUpgrade";

export interface StashedGuestUpgrade {
  guestUserId: string;
  refreshToken: string;
  token: string;
  groupCount: number;
  expenseCount: number;
}

interface MintResult {
  token: string;
  group_count: number;
  expense_count: number;
}

export interface GuestMergePreview {
  groups: Array<{ id?: string; name: string; renamed?: boolean; note?: string | null }>;
  group_count: number;
  expense_count: number;
  payment_count: number;
}

export async function readStashedGuestUpgrade(): Promise<StashedGuestUpgrade | null> {
  const raw = await AsyncStorage.getItem(STASH_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StashedGuestUpgrade;
    if (!parsed.guestUserId || !parsed.token || !parsed.refreshToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearStashedGuestUpgrade(): Promise<void> {
  await AsyncStorage.removeItem(STASH_KEY);
}

async function postGuestAccount(body: Record<string, unknown>): Promise<unknown> {
  const response = await fetchWithAuth("/guest-account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

export async function mintAndStashGuestUpgrade(session: Session): Promise<StashedGuestUpgrade> {
  const minted = await postGuestAccount({ action: "token" }) as MintResult;
  const stashed: StashedGuestUpgrade = {
    guestUserId: session.user.id,
    refreshToken: session.refresh_token,
    token: minted.token,
    groupCount: minted.group_count ?? 0,
    expenseCount: minted.expense_count ?? 0,
  };
  await AsyncStorage.setItem(STASH_KEY, JSON.stringify(stashed));
  return stashed;
}

export async function previewGuestMerge(stash: StashedGuestUpgrade): Promise<GuestMergePreview> {
  return await postGuestAccount({
    action: "preview",
    guest_user_id: stash.guestUserId,
    token: stash.token,
  }) as GuestMergePreview;
}

export async function mergeStashedGuest(stash: StashedGuestUpgrade): Promise<void> {
  await postGuestAccount({
    action: "merge",
    guest_user_id: stash.guestUserId,
    token: stash.token,
  });
}

export async function discardStashedGuest(stash: StashedGuestUpgrade): Promise<void> {
  await postGuestAccount({
    action: "discard",
    guest_user_id: stash.guestUserId,
    token: stash.token,
  });
}

export async function deleteOwnGuestData(): Promise<void> {
  await postGuestAccount({ action: "delete" });
}

export async function restoreStashedGuestSession(stash: StashedGuestUpgrade): Promise<void> {
  await supabase.auth.refreshSession({ refresh_token: stash.refreshToken });
}

interface LinkError {
  message?: string;
  code?: string;
}

/**
 * Attach Google or Apple to the current anonymous user.
 * A conflict does not switch sessions; the caller signs into the existing account next.
 */
export async function linkGuestProvider(input: {
  provider: "google" | "apple";
  token?: string;
  nonce?: string;
  redirectTo?: string;
}): Promise<GuestUpgradePath> {
  const auth = supabase.auth as unknown as {
    linkIdentity: (credentials: Record<string, unknown>) => Promise<{ error: LinkError | null }>;
  };
  const credentials = input.token
    ? { provider: input.provider, token: input.token, nonce: input.nonce }
    : { provider: input.provider, options: { redirectTo: input.redirectTo, skipBrowserRedirect: false } };
  const { error } = await auth.linkIdentity(credentials);
  if (!error) {
    const { data } = await supabase.auth.getSession();
    return guestUpgradePath({
      sameUserId: true,
      stillAnonymous: data.session?.user.is_anonymous === true,
    });
  }
  return guestUpgradePath({
    errorCode: error.code ?? null,
    errorMessage: error.message ?? null,
    sameUserId: true,
    stillAnonymous: true,
  });
}

export async function linkGuestEmail(email: string, password: string): Promise<GuestUpgradePath> {
  const { error } = await supabase.auth.updateUser({ email, password });
  if (!error) {
    const { data } = await supabase.auth.getSession();
    return guestUpgradePath({
      sameUserId: true,
      stillAnonymous: data.session?.user.is_anonymous !== false && !data.session?.user.email,
    });
  }
  return guestUpgradePath({
    errorCode: (error as LinkError).code ?? null,
    errorMessage: error.message,
    sameUserId: false,
    stillAnonymous: true,
  });
}
