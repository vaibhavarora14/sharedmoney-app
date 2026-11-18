/**
 * Latest ledger activity for the groups list.
 * The client turns `at` into the relative time on the row.
 */
export type GroupRecencyAction = "added" | "edited" | "removed" | "settled";

export interface GroupLastActivity {
  actor: string;
  action: GroupRecencyAction;
  subject: string | null;
  at: string;
  /** Settlement note or expense title, when the row has one. */
  detail?: string;
  /** True when the viewer is the payer on a settlement. */
  viewerPaid?: boolean;
}

export interface HistoryActivityRow {
  group_id: string;
  action: string;
  activity_type: string;
  changed_by: string;
  changed_at: string;
  changes: unknown;
  snapshot: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstName(fullName: string | null | undefined, viewer: boolean): string {
  if (viewer) return "You";
  const trimmed = (fullName ?? "").trim();
  if (!trimmed) return "Someone";
  return trimmed.split(/\s+/)[0] || "Someone";
}

function isoTimestamp(value: string): string {
  const trimmed = value.trim();
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString();
  }
  const parsed = new Date(`${trimmed.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString();
}

function listAction(activityType: string, action: string): GroupRecencyAction | null {
  if (activityType === "settlement" && action === "created") return "settled";
  if (action === "created") return "added";
  if (action === "updated") return "edited";
  if (action === "deleted") return "removed";
  return null;
}

function expenseTitle(snapshot: Record<string, unknown> | null, changes: Record<string, unknown> | null): string | null {
  const transaction = asRecord(changes?.transaction);
  const diff = asRecord(asRecord(changes?.diff)?.description);
  return stringField(snapshot, "description")
    ?? stringField(transaction, "description")
    ?? stringField(diff, "new");
}

function partyId(
  snapshot: Record<string, unknown> | null,
  changes: Record<string, unknown> | null,
  key: "from_user_id" | "to_user_id" | "from_participant_id" | "to_participant_id",
): string | null {
  const settlement = asRecord(changes?.settlement);
  return stringField(snapshot, key) ?? stringField(settlement, key);
}

function otherParty(
  row: HistoryActivityRow,
  snapshot: Record<string, unknown> | null,
  changes: Record<string, unknown> | null,
): string | null {
  const from = partyId(snapshot, changes, "from_user_id")
    ?? partyId(snapshot, changes, "from_participant_id");
  const to = partyId(snapshot, changes, "to_user_id")
    ?? partyId(snapshot, changes, "to_participant_id");
  if (row.changed_by && row.changed_by === from && to) return to;
  if (row.changed_by && row.changed_by === to && from) return from;
  return to ?? from;
}

export function collectActivityNameIds(rows: HistoryActivityRow[]): { userIds: string[]; participantIds: string[] } {
  const userIds = new Set<string>();
  const participantIds = new Set<string>();
  for (const row of rows) {
    if (row.changed_by) userIds.add(row.changed_by);
    const snapshot = asRecord(row.snapshot);
    const changes = asRecord(row.changes);
    for (const key of ["from_user_id", "to_user_id"] as const) {
      const id = partyId(snapshot, changes, key);
      if (id) userIds.add(id);
    }
    for (const key of ["from_participant_id", "to_participant_id"] as const) {
      const id = partyId(snapshot, changes, key);
      if (id) participantIds.add(id);
    }
  }
  return { userIds: [...userIds], participantIds: [...participantIds] };
}

export function lastActivityByGroup(
  rows: HistoryActivityRow[],
  names: Map<string, string | null>,
  viewerId: string,
): Map<string, GroupLastActivity> {
  const byGroup = new Map<string, GroupLastActivity>();
  for (const row of rows) {
    if (!row.group_id || byGroup.has(row.group_id)) continue;
    const action = listAction(row.activity_type, row.action);
    if (!action) continue;
    const snapshot = asRecord(row.snapshot);
    const changes = asRecord(row.changes);
    let subject: string | null = null;
    let detail: string | undefined;
    let viewerPaid: boolean | undefined;
    if (action === "settled") {
      const other = otherParty(row, snapshot, changes);
      if (other) {
        subject = other === viewerId ? "you" : firstName(names.get(other), false);
        if (subject === "Someone") subject = null;
      }
      const settlement = asRecord(changes?.settlement);
      const notes = stringField(snapshot, "notes") ?? stringField(settlement, "notes");
      if (notes) detail = notes;
      const fromUser = partyId(snapshot, changes, "from_user_id");
      if (fromUser) viewerPaid = fromUser === viewerId;
    } else {
      subject = expenseTitle(snapshot, changes);
    }
    byGroup.set(row.group_id, {
      actor: firstName(names.get(row.changed_by), row.changed_by === viewerId),
      action,
      subject,
      at: isoTimestamp(row.changed_at),
      ...(detail ? { detail } : {}),
      ...(viewerPaid !== undefined ? { viewerPaid } : {}),
    });
  }
  return byGroup;
}
