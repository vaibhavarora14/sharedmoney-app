import { infiniteQueryOptions } from "@tanstack/react-query";
import type { ActivityFeedResponse } from "../types";
import { queryKeys } from "./queryKeys";

export const ACTIVITY_PAGE_SIZE = 50;

export function activityQueryOptions(
  groupId: string,
  fetchPage: (groupId: string, offset: number, limit: number) => Promise<ActivityFeedResponse>
) {
  return infiniteQueryOptions({
    // Keep paginated data separate from legacy single-page cache entries.
    queryKey: [...queryKeys.activity(groupId), "feed"] as const,
    queryFn: ({ pageParam }) => fetchPage(groupId, pageParam, ACTIVITY_PAGE_SIZE),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.has_more
        ? allPages.reduce((count, page) => count + page.activities.length, 0)
        : undefined,
    staleTime: 60_000,
  });
}
