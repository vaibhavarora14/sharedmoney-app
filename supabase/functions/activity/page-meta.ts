export interface ActivityPageMeta {
  total: number;
  has_more: boolean;
}

/**
 * Preserve the v1 activity envelope: `{ activities, total, has_more }`.
 * Store clients 2.60.1 / 2.68.0 page on has_more; total stays exact when
 * the count query succeeds.
 */
export function activityPageMeta(input: {
  offset: number;
  limit: number;
  pageLength: number;
  count: number | null;
  countError: boolean;
}): ActivityPageMeta {
  if (input.countError || input.count == null) {
    return {
      total: input.pageLength,
      has_more: input.pageLength >= input.limit,
    };
  }
  return {
    total: input.count,
    has_more: input.offset + input.pageLength < input.count,
  };
}
