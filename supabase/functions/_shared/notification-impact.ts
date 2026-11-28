export type NotificationAction = "created" | "updated" | "deleted";

export interface ExpenseParticipantSnapshot {
  participantId: string;
  userId: string | null;
  share: number;
}

export interface ExpensePayerSnapshot {
  participantId: string;
  amount: number;
}

export interface ExpenseSnapshot {
  id: number;
  groupId: string;
  groupName: string;
  description: string;
  type: "expense" | "income";
  amount: number;
  currency: string;
  payerParticipantId: string | null;
  payers?: ExpensePayerSnapshot[];
  participants: ExpenseParticipantSnapshot[];
}

export interface FinancialPosition {
  participantId: string;
  currency: string;
  isPayer: boolean;
  shareMinor: number;
  paidMinor: number;
  netMinor: number;
  payerParticipantId: string | null;
}

export interface NotificationImpact {
  userId: string;
  before: FinancialPosition | null;
  after: FinancialPosition | null;
}

interface BuildNotificationImpactsInput {
  actorUserId: string;
  action: NotificationAction;
  before: ExpenseSnapshot | null;
  after: ExpenseSnapshot | null;
}

function toMinorUnits(amount: number): number {
  return Math.round((Number.isFinite(amount) ? amount : 0) * 100);
}

function paidAmountFor(snapshot: ExpenseSnapshot, participantId: string): number {
  if (snapshot.payers && snapshot.payers.length > 0) {
    return snapshot.payers
      .filter((payer) => payer.participantId === participantId)
      .reduce((sum, payer) => sum + payer.amount, 0);
  }
  return participantId === snapshot.payerParticipantId ? snapshot.amount : 0;
}

function buildPositions(
  snapshot: ExpenseSnapshot | null,
): Map<string, FinancialPosition> {
  const positions = new Map<string, FinancialPosition>();
  if (!snapshot || snapshot.type !== "expense") return positions;

  for (const participant of snapshot.participants) {
    if (!participant.userId) continue;
    const paid = paidAmountFor(snapshot, participant.participantId);
    const isPayer = paid > 0;
    const shareMinor = toMinorUnits(participant.share);
    const paidMinor = toMinorUnits(paid);
    positions.set(participant.userId, {
      participantId: participant.participantId,
      currency: snapshot.currency,
      isPayer,
      shareMinor,
      paidMinor,
      netMinor: paidMinor - shareMinor,
      payerParticipantId: snapshot.payerParticipantId,
    });
  }

  return positions;
}

function positionsDiffer(
  before: FinancialPosition | null,
  after: FinancialPosition | null,
): boolean {
  if (!before && !after) return false;
  if (!before || !after) return (before?.netMinor ?? 0) !== (after?.netMinor ?? 0);
  if (before.currency !== after.currency) {
    return before.netMinor !== 0 || after.netMinor !== 0;
  }
  return before.netMinor !== after.netMinor;
}

export function buildNotificationImpacts({
  actorUserId,
  action,
  before,
  after,
}: BuildNotificationImpactsInput): NotificationImpact[] {
  if (action === "created" && after?.type !== "expense") return [];
  if (action === "deleted" && before?.type !== "expense") return [];
  if (
    action === "updated" &&
    (before?.type !== "expense" || after?.type !== "expense")
  ) {
    return [];
  }

  const beforePositions = buildPositions(before);
  const afterPositions = buildPositions(after);
  const userIds = new Set([...beforePositions.keys(), ...afterPositions.keys()]);

  return [...userIds]
    .filter((userId) => userId !== actorUserId)
    .sort()
    .map((userId) => ({
      userId,
      before: beforePositions.get(userId) ?? null,
      after: afterPositions.get(userId) ?? null,
    }))
    .filter(({ before: oldPosition, after: newPosition }) =>
      positionsDiffer(oldPosition, newPosition)
    );
}
