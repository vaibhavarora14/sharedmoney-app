import { isValidUUID } from './validation.ts';

export const SPLIT_SUM_TOLERANCE = 0.01;
export const MAX_SPLIT_AMOUNT = 1000000;

export interface SplitShare {
  participant_id: string;
  amount: number;
}

export interface TransactionSplitRow extends SplitShare {
  transaction_id: number;
}

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function roundMoney(amount: number): number {
  return fromCents(toCents(amount));
}

function allocateLargestRemainderCents(
  totalCents: number,
  weights: number[],
): number[] {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (weights.length === 0 || totalWeight <= 0) return [];

  const allocations = weights.map((weight, index) => {
    const raw = totalCents * weight;
    return {
      index,
      amount: Math.floor(raw / totalWeight),
      remainder: raw % totalWeight,
    };
  });
  let remaining = totalCents - allocations.reduce((sum, item) => sum + item.amount, 0);

  [...allocations]
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
    .forEach((allocation) => {
      if (remaining > 0) {
        allocations[allocation.index].amount += 1;
        remaining -= 1;
      }
    });

  return allocations.map((allocation) => allocation.amount);
}

export function calculateEqualSplits(
  totalAmount: number,
  participantIds: string[],
): SplitShare[] {
  const uniqueIds = [...new Set(participantIds)];
  if (uniqueIds.length === 0) return [];

  const cents = allocateLargestRemainderCents(
    toCents(totalAmount),
    uniqueIds.map(() => 1),
  );
  return uniqueIds.map((participantId, index) => ({
    participant_id: participantId,
    amount: fromCents(cents[index]),
  }));
}

export const MAX_SHARE_COUNT = 99;

export function clampShareCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_SHARE_COUNT, Math.max(1, Math.floor(value)));
}

export function calculateShareSplits(
  totalAmount: number,
  selectedIds: string[],
  shares: Record<string, number>,
): SplitShare[] {
  const uniqueIds = [...new Set(selectedIds)];
  if (uniqueIds.length === 0) return [];

  const weights = uniqueIds.map((id) => clampShareCount(shares[id] ?? 1));
  const cents = allocateLargestRemainderCents(toCents(totalAmount), weights);
  if (cents.length === 0) return [];

  return uniqueIds.map((participantId, index) => ({
    participant_id: participantId,
    amount: fromCents(cents[index]),
  }));
}

export function scaleSplitsToTotal(
  splits: SplitShare[],
  newTotal: number,
): SplitShare[] {
  if (splits.length === 0) return [];

  const oldCents = splits.map((split) => toCents(split.amount));
  const oldTotalCents = oldCents.reduce((sum, cents) => sum + cents, 0);
  if (oldTotalCents <= 0) {
    return calculateEqualSplits(
      newTotal,
      splits.map((split) => split.participant_id),
    );
  }

  const newTotalCents = toCents(newTotal);
  let allocated = 0;
  return splits.map((split, index) => {
    const nextCents = index === splits.length - 1
      ? newTotalCents - allocated
      : Math.round((oldCents[index] * newTotalCents) / oldTotalCents);
    allocated += nextCents;
    return {
      participant_id: split.participant_id,
      amount: fromCents(nextCents),
    };
  });
}

export function validateSplitSum(
  splits: Array<{ amount: number }>,
  transactionAmount: number,
): { valid: boolean; difference: number } {
  const sum = roundMoney(splits.reduce((acc, split) => acc + split.amount, 0));
  const difference = Math.abs(roundMoney(sum - transactionAmount));
  return {
    valid: difference <= SPLIT_SUM_TOLERANCE,
    difference,
  };
}

function isValidAmount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_SPLIT_AMOUNT
  );
}

export type ParsedCustomSplits =
  | { present: false }
  | { present: true; error: string }
  | { present: true; splits: SplitShare[] };

export function parseCustomSplits(raw: unknown): ParsedCustomSplits {
  if (raw === undefined || raw === null) {
    return { present: false };
  }

  if (!Array.isArray(raw)) {
    return { present: true, error: 'splits must be an array of { participant_id, amount }' };
  }

  if (raw.length === 0) {
    return { present: true, error: 'splits must be a non-empty array' };
  }

  const splits: SplitShare[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      return { present: true, error: 'each split must be an object' };
    }

    const participantId = (item as { participant_id?: unknown }).participant_id;
    const amount = (item as { amount?: unknown }).amount;

    if (typeof participantId !== 'string' || !isValidUUID(participantId)) {
      return { present: true, error: 'each split participant_id must be a valid UUID' };
    }
    if (seen.has(participantId)) {
      return { present: true, error: 'splits cannot include the same participant twice' };
    }
    if (!isValidAmount(amount)) {
      return { present: true, error: `split amounts must be positive numbers up to ${MAX_SPLIT_AMOUNT}` };
    }

    seen.add(participantId);
    splits.push({
      participant_id: participantId,
      amount: roundMoney(amount),
    });
  }

  return { present: true, splits };
}

export function resolveParticipantIdsForSplits(
  splitAmongParticipantIds: unknown,
  customSplits: SplitShare[] | null,
): { participantIds: string[]; error?: string } {
  const fromAmong = Array.isArray(splitAmongParticipantIds)
    ? [...new Set(splitAmongParticipantIds.filter((id): id is string => typeof id === 'string'))]
    : [];
  const fromCustom = customSplits?.map((split) => split.participant_id) ?? [];

  if (customSplits && fromAmong.length > 0) {
    const amongSet = new Set(fromAmong);
    const customSet = new Set(fromCustom);
    if (amongSet.size !== customSet.size || fromCustom.some((id) => !amongSet.has(id))) {
      return {
        participantIds: [],
        error: 'splits must include the same people as split_among_participant_ids',
      };
    }
    return { participantIds: fromCustom };
  }

  if (customSplits) {
    return { participantIds: fromCustom };
  }

  return { participantIds: fromAmong };
}

export function buildTransactionSplitRows(
  transactionId: number,
  totalAmount: number,
  participantIds: string[],
  customSplits: SplitShare[] | null,
): { splits: TransactionSplitRow[]; error?: string } {
  const uniqueIds = [...new Set(participantIds)];
  if (uniqueIds.length === 0) {
    return { splits: [] };
  }

  const shares = customSplits
    ? customSplits.map((split) => ({
      participant_id: split.participant_id,
      amount: roundMoney(split.amount),
    }))
    : calculateEqualSplits(totalAmount, uniqueIds);

  const sumCheck = validateSplitSum(shares, totalAmount);
  if (!sumCheck.valid) {
    return {
      splits: [],
      error: `Split amounts do not add up to the expense total. Difference: ${sumCheck.difference.toFixed(2)}`,
    };
  }

  return {
    splits: shares.map((split) => ({
      transaction_id: transactionId,
      participant_id: split.participant_id,
      amount: split.amount,
    })),
  };
}
