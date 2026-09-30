import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../supabase";
import { GroupInvitation } from "../types";
import { fetchWithAuth } from "../utils/api";
import {
  normalizeRedeemInviteLinkResult,
  type RedeemInviteLinkResult,
} from "../utils/groupJoinedAnalytics";
import { queryKeys } from "./queryKeys";

export interface CreateShareLinkOptions {
  groupId: string;
  /** How many users the link can admit (1-100). Default 1. */
  maxUses?: number;
  /** Link validity in days (1-90). Default 7. */
  validDays?: number;
}

/**
 * Creates a shareable invite link for a group with configurable limits.
 * @returns the secret link token (64 hex chars)
 */
export async function createGroupShareLinkRPC({
  groupId,
  maxUses = 1,
  validDays = 7,
}: CreateShareLinkOptions): Promise<string> {
  const { data, error } = await supabase.rpc("create_group_share_link", {
    p_group_id: groupId,
    p_max_uses: maxUses,
    p_valid_days: validDays,
  });

  if (error) throw error;
  return data as string;
}

// Note: the anon-safe `get_group_invite_preview` RPC still exists server-side
// (harmless, usable by tooling); the app no longer shows a preview screen.

export type { RedeemInviteLinkResult };

/**
 * Atomically redeems a single-use invite link for the signed-in user.
 * Authorization happens server-side via auth.uid().
 */
export async function redeemGroupInviteLinkRPC(
  token: string
): Promise<RedeemInviteLinkResult> {
  const { data, error } = await supabase.rpc("redeem_group_invite_link", {
    p_token: token,
  });
  if (error) throw error;
  return normalizeRedeemInviteLinkResult(data);
}

/**
 * List invitations addressed to the signed-in user's email (all statuses).
 * Used to attribute email-invite joins that were accepted server-side at signup.
 */
export async function fetchInvitationsForEmail(
  email: string,
): Promise<GroupInvitation[]> {
  const response = await fetchWithAuth(
    `/invitations?email=${encodeURIComponent(email.trim().toLowerCase())}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch invitations: ${response.status}`);
  }
  return response.json();
}

export function useCreateGroupShareLink() {
  return useMutation({
    mutationFn: createGroupShareLinkRPC,
  });
}

export async function fetchGroupInvitations(
  groupId: string
): Promise<GroupInvitation[]> {
  const response = await fetchWithAuth(`/invitations?group_id=${groupId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch invitations: ${response.status}`);
  }
  return response.json();
}

export type UseGroupInvitationsOptions = {
  /** When false, defer until the People/members surface is open. Default true. */
  enabled?: boolean;
};

export function useGroupInvitations(
  groupId: string | null,
  options?: UseGroupInvitationsOptions
) {
  const { user } = useAuth();
  const enabledOption = options?.enabled;

  const query = useQuery<GroupInvitation[], Error>({
    // Guarded by `enabled`, so groupId is always non-null inside queryFn
    queryKey: groupId ? queryKeys.invitations(groupId) : queryKeys.invitations(""),
    queryFn: () => fetchGroupInvitations(groupId as string),
    enabled: !!user?.id && !!groupId && enabledOption !== false,
    // Use placeholderData so initial load still reports isLoading=true
    placeholderData: [],
    staleTime: 60_000,
  });

  return {
    data: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error ?? null,
    refetch: query.refetch,
  };
}

export function useCancelInvitation(onSuccess?: () => void) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (variables: { invitationId: string; groupId: string }) => {
      const response = await fetchWithAuth(
        `/invitations/${variables.invitationId}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        throw new Error("Failed to cancel invitation");
      }

      return variables;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.invitations(data.groupId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.group(data.groupId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.participants(data.groupId) });
      onSuccess?.();
    },
  });

  return {
    mutate: mutation.mutateAsync,
    isLoading: mutation.isPending,
    error: (mutation.error as Error | null) ?? null,
  };
}
