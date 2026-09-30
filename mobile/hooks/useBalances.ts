import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../contexts/AuthContext";
import { BalancesResponse, GroupStatsResponse } from "../types";
import { fetchWithAuth } from "../utils/api";
import { queryKeys } from "./queryKeys";

export type UseBalancesOptions = {
  /** When true and groupId is set, fetch include_stats=true (single round-trip). */
  includeStats?: boolean;
  /** Defaults to true when the user is signed in. */
  enabled?: boolean;
};

export async function fetchBalances(
  groupId?: string | null,
  includeStats = false
): Promise<BalancesResponse> {
  let endpoint = groupId ? `/balances?group_id=${groupId}` : "/balances";
  if (groupId && includeStats) {
    endpoint += (endpoint.includes("?") ? "&" : "?") + "include_stats=true";
  }
  const response = await fetchWithAuth(endpoint);
  if (!response.ok) {
    throw new Error(`Failed to fetch balances: ${response.status}`);
  }
  return response.json();
}

export function useBalances(
  groupId?: string | null,
  options?: UseBalancesOptions
) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const includeStats = Boolean(groupId) && Boolean(options?.includeStats);
  const enabledOption = options?.enabled;

  const query = useQuery<BalancesResponse, Error>({
    // Use "all" for global fetch to differentiate from specific group fetches
    queryKey: groupId ? queryKeys.balances(groupId) : ["balances", "all"],
    queryFn: async () => {
      const data = await fetchBalances(groupId, includeStats);
      if (includeStats && groupId && data.group_stats) {
        queryClient.setQueryData(queryKeys.groupStats(groupId), data.group_stats);
      }
      return data;
    },
    enabled:
      !!user?.id &&
      (enabledOption !== false) &&
      (!!groupId || groupId === null || groupId === undefined),
    staleTime: 30_000,
  });

  return {
    data: query.data ?? { group_balances: [], overall_balances: [] },
    groupStats: (query.data?.group_stats ?? null) as GroupStatsResponse | null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error ?? null,
    refetch: query.refetch,
  };
}

export async function fetchGroupStats(groupId: string): Promise<GroupStatsResponse> {
  const data = await fetchBalances(groupId, true);
  if (!data.group_stats) {
    throw new Error("Group stats payload is missing");
  }
  return data.group_stats;
}

/**
 * Prefer useBalances(groupId, { includeStats: true }) on screens that also need
 * balances — that avoids a duplicate /balances round-trip. This hook remains for
 * callers that only need stats and seeds the balances cache when it fetches.
 */
export function useGroupStats(groupId?: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery<GroupStatsResponse, Error>({
    queryKey: groupId ? queryKeys.groupStats(groupId) : queryKeys.groupStats(""),
    queryFn: async () => {
      const data = await fetchBalances(groupId as string, true);
      if (!data.group_stats) {
        throw new Error("Group stats payload is missing");
      }
      queryClient.setQueryData(queryKeys.balances(groupId as string), data);
      return data.group_stats;
    },
    enabled: !!user?.id && !!groupId,
    staleTime: 30_000,
  });

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error ?? null,
    refetch: query.refetch,
  };
}
