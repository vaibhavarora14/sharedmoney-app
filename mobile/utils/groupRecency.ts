/**
 * Recency line for a group row. Names, amounts, and `last_activity` can come
 * from the groups-list disk cache; the list still refreshes in the background.
 */
export type GroupRecencyAction = "added" | "edited" | "removed" | "settled";

export interface GroupLastActivity {
  actor: string;
  action: GroupRecencyAction;
  subject: string | null;
  /** ISO timestamp. The row formats the relative time from this. */
  at: string;
  /** Settlement note or expense title, when the row has one. */
  detail?: string;
  /** True when the viewer is the payer on a settlement. */
  viewerPaid?: boolean;
}

export function groupsWithoutRecency<T extends { last_activity?: unknown }>(
  groups: T[],
): Omit<T, "last_activity">[] {
  return groups.map((group) => {
    const { last_activity: _activity, ...rest } = group;
    return rest;
  });
}

function formatRelative(atIso: string, now: Date): string {
  const at = new Date(atIso);
  const diff = now.getTime() - at.getTime();
  if (!Number.isFinite(diff) || diff < 60_000) return "now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `${days}d`;
  const month = at.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  return `${at.getUTCDate()} ${month}`;
}

function formatQuietDate(createdAt: string): string | null {
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return null;
  const month = at.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  return `${at.getUTCDate()} ${month}`;
}

export function formatGroupRecencyLine(activity: GroupLastActivity, now: Date): string {
  const when = formatRelative(activity.at, now);
  const subject = activity.subject?.trim() || null;
  switch (activity.action) {
    case "settled":
      if (activity.actor === "You" && subject) return `You settled with ${subject} · ${when}`;
      if (subject) return `${activity.actor} settled with ${subject} · ${when}`;
      return `${activity.actor} settled · ${when}`;
    case "added":
    case "edited":
    case "removed":
      if (subject) return `${activity.actor} ${activity.action} ${subject} · ${when}`;
      return `${activity.actor} ${activity.action} an expense · ${when}`;
    default: {
      const _never: never = activity.action;
      return _never;
    }
  }
}

/** Note and relative time for a Direct row. Falls back to the group recency line. */
export function directActivitySubtitle(
  activity: GroupLastActivity | null | undefined,
  now: Date,
): string | null {
  if (!activity) return null;
  const when = formatRelative(activity.at, now);
  const note = activity.detail?.trim()
    || (activity.action !== "settled" ? activity.subject?.trim() : "")
    || "";
  if (note) return `${note} · ${when}`;
  return formatGroupRecencyLine(activity, now);
}

export function groupRecencyLine(
  group: { last_activity?: GroupLastActivity | null; created_at?: string },
  now: Date,
): string | null {
  if (!Object.prototype.hasOwnProperty.call(group, "last_activity")) return null;
  if (group.last_activity == null) {
    const quiet = group.created_at ? formatQuietDate(group.created_at) : null;
    return quiet ? `Quiet since ${quiet}` : "Quiet";
  }
  return formatGroupRecencyLine(group.last_activity, now);
}
