import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import type { ActivityFeedResponse, ActivityItem } from "../types.ts";
import { activityQueryOptions } from "./activityQuery.ts";
import { queryKeys } from "./queryKeys.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("prefetched activity mounts and loads older pages alongside legacy cache", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const firstPage: ActivityFeedResponse = {
    activities: Array.from({ length: 50 }, (_, i) => ({ id: String(i) } as ActivityItem)),
    total: 51,
    has_more: true,
  };
  const lastPage: ActivityFeedResponse = {
    activities: [{ id: "50" } as ActivityItem], total: 51, has_more: false,
  };
  const offsets: number[] = [];
  const options = activityQueryOptions("group-a", async (groupId, offset, limit) => {
    assert(groupId === "group-a" && limit === 50, "wrong request parameters");
    offsets.push(offset);
    return offset === 0 ? firstPage : lastPage;
  });
  // Existing single-page entries must not be consumed by the infinite observer.
  client.setQueryData(queryKeys.activity("group-a"), firstPage);
  try {
    await client.prefetchInfiniteQuery(options);
    const observer = new InfiniteQueryObserver(client, options);
    const initial = observer.getCurrentResult();
    assert(initial.data?.pages[0] === firstPage, "prefetch did not seed pages");
    assert(initial.hasNextPage, "older activity should be available");
    const next = await observer.fetchNextPage();
    assert(next.data?.pages.flatMap((page) => page.activities).length === 51, "missing older activity");
    assert(!next.hasNextPage, "pagination should stop at the last page");
    assert(JSON.stringify(offsets) === "[0,50]", "prefetch should be reused and next offset should be 50");
    await client.invalidateQueries({ queryKey: queryKeys.activity("group-a") });
    assert(client.getQueryState(options.queryKey)?.isInvalidated, "group invalidation missed infinite feed");
    observer.destroy();
  } finally {
    client.clear();
  }
});

Deno.test("activity infinite query keeps paging while has_more is true", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const page = (offset: number, hasMore: boolean): ActivityFeedResponse => ({
    activities: Array.from({ length: 50 }, (_, i) => ({
      id: String(offset + i),
    } as ActivityItem)),
    total: 150,
    has_more: hasMore,
  });
  const offsets: number[] = [];
  const options = activityQueryOptions("group-uncapped", async (_groupId, offset) => {
    offsets.push(offset);
    return page(offset, offset < 100);
  });

  try {
    await client.prefetchInfiniteQuery(options);
    const observer = new InfiniteQueryObserver(client, options);
    while (observer.getCurrentResult().hasNextPage) {
      await observer.fetchNextPage();
    }
    const pages = observer.getCurrentResult().data?.pages ?? [];
    assert(pages.length === 3, `expected 3 pages, got ${pages.length}`);
    assert(JSON.stringify(offsets) === "[0,50,100]", "should page through the full history");
    observer.destroy();
  } finally {
    client.clear();
  }
});
