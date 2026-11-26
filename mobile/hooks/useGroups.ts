import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { Group, GroupWithMembers } from "../types";
import { fetchWithAuth } from "../utils/api";
import {
  hydrateGroupsListCache,
  seedGroupsListQuery,
  writeGroupsListCache,
} from "../utils/groupsListCache";
import { queryKeys } from "./queryKeys";

export async function fetchGroups(): Promise<Group[]> {
  const response = await fetchWithAuth("/groups?include_direct=1");
  if (!response.ok) {
    throw new Error(`Failed to fetch groups: ${response.status}`);
  }
  return response.json();
}

export async function fetchGroupDetails(groupId: string): Promise<GroupWithMembers> {
  const response = await fetchWithAuth(`/groups/${groupId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch group details: ${response.status}`);
  }
  return response.json();
}

export function useGroups(options?: { enabled?: boolean }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const enabled = options?.enabled !== false && !!user?.id;

  // Disk → RQ so the first paint can skip the empty-list spinner, then SWR.
  useEffect(() => {
    if (!enabled || !user?.id) return;
    let cancelled = false;
    void hydrateGroupsListCache(user.id, AsyncStorage).then((cached) => {
      if (cancelled || !cached?.length) return;
      seedGroupsListQuery(queryClient, user.id);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, user?.id, queryClient]);

  const query = useQuery<Group[], Error>({
    queryKey: queryKeys.groups,
    queryFn: async () => {
      const groups = await fetchGroups();
      if (user?.id) writeGroupsListCache(user.id, groups, AsyncStorage);
      return groups;
    },
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
    gcTime: 1000 * 60 * 60 * 24,
  });

  return {
    data: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error ?? null,
    refetch: query.refetch,
  };
}

export function useGroupDetails(groupId: string | null) {
  const { user } = useAuth();

  const query = useQuery<GroupWithMembers | null, Error>({
    queryKey: groupId ? queryKeys.group(groupId) : queryKeys.group(""),
    queryFn: () => fetchGroupDetails(groupId as string),
    enabled: !!user?.id && !!groupId,
    staleTime: 60_000,
  });

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetched: query.isFetched,
    error: query.error ?? null,
    refetch: query.refetch,
  };
}
