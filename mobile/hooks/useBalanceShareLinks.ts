import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase";
import { getBalanceShareLinkUrl, isPublicYouOweEnabled, PUBLIC_YOU_OWE_FLAG } from "../utils/publicYouOwe";
import { queryKeys } from "./queryKeys";

export type BalanceShareLink = {
  id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
};

export function usePublicYouOweFlag() {
  const query = useQuery({
    queryKey: ["app-feature-flag", PUBLIC_YOU_OWE_FLAG],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_app_feature_enabled", { p_key: PUBLIC_YOU_OWE_FLAG });
      if (error) throw error;
      return data === true;
    },
    staleTime: 60_000,
  });
  return {
    enabled: isPublicYouOweEnabled(query.data),
    isLoading: query.isLoading,
  };
}

export function useBalanceShareLinks(groupId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const listKey = ["balance-share-links", groupId];

  const list = useQuery({
    queryKey: listKey,
    enabled: enabled && Boolean(groupId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_balance_share_links", { p_group_id: groupId });
      if (error) throw error;
      return (data || []) as BalanceShareLink[];
    },
  });

  const createLink = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("create_balance_share_link", { p_group_id: groupId });
      if (error) throw error;
      if (typeof data !== "string") throw new Error("Could not create this link.");
      return getBalanceShareLinkUrl(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listKey });
      void queryClient.invalidateQueries({ queryKey: queryKeys.group(groupId) });
    },
  });

  const revokeLink = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("revoke_balance_share_link", { p_id: id });
      if (error) throw error;
      return data === true;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listKey });
    },
  });

  return { list, createLink, revokeLink };
}
