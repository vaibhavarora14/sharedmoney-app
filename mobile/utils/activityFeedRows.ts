import type { ActivityItem } from "../types";
import { groupActivitiesByDate } from "./activityDescriptions";

export type ActivityFeedHeaderEntry = {
  kind: "header";
  key: string;
  title: string;
};

export type ActivityFeedItemEntry = {
  kind: "item";
  key: string;
  activity: ActivityItem;
};

export type ActivityFeedEntry = ActivityFeedHeaderEntry | ActivityFeedItemEntry;

/** Flatten date-grouped activities into FlatList rows (headers + items). */
export function buildActivityFeedEntries(
  items: ActivityItem[],
): ActivityFeedEntry[] {
  const grouped = groupActivitiesByDate(items);
  const entries: ActivityFeedEntry[] = [];

  for (const [dateKey, activitiesForDate] of Object.entries(grouped)) {
    entries.push({
      kind: "header",
      key: `header-${dateKey}`,
      title: dateKey,
    });
    for (const activity of activitiesForDate) {
      entries.push({
        kind: "item",
        key: `activity-${activity.id}`,
        activity,
      });
    }
  }

  return entries;
}
