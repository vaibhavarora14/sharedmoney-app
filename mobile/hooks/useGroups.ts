import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { Group, GroupWithMembers } from "../types";
import { fetchWithAuth } from "../utils/api";
import { queryKeys } from "./queryKeys";

const groupsCacheKey = (userId: string) => `sm:rq-groups:${userId}`;

async function readGroupsCache(userId: string): Promise<Group[] | null> {
  try {
    const raw = await AsyncStorage.getItem(groupsCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed as Group[];
  } catch {
    return null;
  }
}

function writeGroupsCache(userId: string, groups: Group[]): void {
  AsyncStorage.setItem(groupsCacheKey(userId), JSON.stringify(groups)).catch(
    () => {}
  );
}

export async function fetchGroups(): Promise<Group[]> {
  const response = await fetchWithAuth("/groups");
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

export function useGroups() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Warm RQ from AsyncStorage so cold start can skip the empty-list spinner.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void readGroupsCache(user.id).then((cached) => {
      if (cancelled || !cached?.length) return;
      const existing = queryClient.getQueryData<Group[]>(queryKeys.groups);
      if (!existing || existing.length === 0) {
        queryClient.setQueryData(queryKeys.groups, cached);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id, queryClient]);

  const query = useQuery<Group[], Error>({
    queryKey: queryKeys.groups,
    queryFn: async () => {
      const groups = await fetchGroups();
      if (user?.id) writeGroupsCache(user.id, groups);
      return groups;
    },
    enabled: !!user?.id,
    staleTime: 60_000,
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
    // Guarded by `enabled`, so groupId is always non-null inside queryFn
    queryKey: groupId ? queryKeys.group(groupId) : queryKeys.group(""),
    queryFn: () => fetchGroupDetails(groupId as string),
    enabled: !!user?.id && !!groupId,
    staleTime: 60_000,
  });

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error ?? null,
    refetch: query.refetch,
  };
}
