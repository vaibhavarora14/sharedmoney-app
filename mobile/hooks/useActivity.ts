import { useInfiniteQuery } from "@tanstack/react-query";
import { useAuth } from "../contexts/AuthContext";
import { ActivityFeedResponse } from "../types";
import { fetchWithAuth } from "../utils/api";
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
  const enabledOption = options?.enabled;

  const query = useInfiniteQuery({
    ...activityQueryOptions(groupId ?? "", fetchActivityPage),
    enabled: !!user?.id && !!groupId && enabledOption !== false,
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
