import AsyncStorage from "@react-native-async-storage/async-storage";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { ActivityFeedResponse } from "../types";
import { fetchWithAuth } from "../utils/api";
import { rememberGroupActivity, seedGroupOpenQueries } from "../utils/groupOpenCache";
import { activityQueryOptions, ACTIVITY_PAGE_SIZE } from "./activityQuery";

export async function fetchActivityPage(
  groupId: string,
  offset: number = 0,
  limit: number = ACTIVITY_PAGE_SIZE
): Promise<ActivityFeedResponse> {
  const response = await fetchWithAuth(
    `/activity?group_id=${groupId}&limit=${limit}&offset=${offset}`
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch activity: ${response.status}`);
  }
  return response.json();
}

export type UseActivityOptions = {
  /** When false, skip the network until the Activity tab is focused. Default true. */
  enabled?: boolean;
};

export function useActivity(
  groupId?: string | null,
  options?: UseActivityOptions
) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const enabledOption = options?.enabled;

  const userId = user?.id;

  useEffect(() => {
    if (!userId || !groupId) return;
    seedGroupOpenQueries(queryClient, userId, groupId);
  }, [groupId, queryClient, userId]);

  const fetchPage = useCallback(
    async (id: string, offset: number, limit: number) => {
      const page = await fetchActivityPage(id, offset, limit);
      if (offset === 0 && userId) {
        void rememberGroupActivity(AsyncStorage, userId, id, page);
      }
      return page;
    },
    [userId],
  );

  const query = useInfiniteQuery({
    ...activityQueryOptions(groupId ?? "", fetchPage),
    enabled: !!userId && !!groupId && enabledOption !== false,
  });

  const pages = query.data?.pages || [];
  const flattenedActivities = pages.flatMap((page) => page?.activities || []);
  const total = pages[0]?.total ?? flattenedActivities.length;
  const hasMore = query.hasNextPage;

  return {
    data: { activities: flattenedActivities },
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    error: query.error ?? null,
    total,
    hasMore,
    refetch: query.refetch,
  };
}
