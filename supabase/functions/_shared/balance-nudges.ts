/**
 * Per-group automatic balance nudges (#417).
 *
 * Default cadence is off. Weekly nudges go out on Mondays 09:00 UTC.
 * Monthly nudges go out on the 1st at 09:00 UTC. Delivery is push or
 * existing monthly email dedupe only — WhatsApp is out of scope.
 */
import { formatReminderMoney, MIN_ACTIONABLE_BALANCE } from './monthly-reminders.ts';

export const BALANCE_NUDGE_CADENCES = ['off', 'weekly', 'monthly'] as const;
export type BalanceNudgeCadence = (typeof BALANCE_NUDGE_CADENCES)[number];

export const BALANCE_NUDGE_DEFAULT_CADENCE: BalanceNudgeCadence = 'off';
export const BALANCE_NUDGE_THRESHOLD = MIN_ACTIONABLE_BALANCE;

export interface MemberOwedTotal {
  group_id: string;
  group_name: string;
  user_id: string;
  amount: number;
  currency: string;
}

export function isBalanceNudgeCadence(value: unknown): value is BalanceNudgeCadence {
  return value === 'off' || value === 'weekly' || value === 'monthly';
}

export function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function isWeeklyNudgeDay(now: Date): boolean {
  return now.getUTCDay() === 1;
}

export function isMonthlyNudgeDay(now: Date): boolean {
  return now.getUTCDate() === 1;
}

export function isCadenceDue(cadence: BalanceNudgeCadence, now: Date): boolean {
  if (cadence === 'weekly') return isWeeklyNudgeDay(now);
  if (cadence === 'monthly') return isMonthlyNudgeDay(now);
  return false;
}

export interface BalanceNudgeCandidate {
  userId: string;
  groupId: string;
  groupName: string;
  amount: number;
  currency: string;
}

export interface SelectBalanceNudgeInput {
  owedTotals: MemberOwedTotal[];
  groupCadenceById: ReadonlyMap<string, BalanceNudgeCadence>;
  mutedUserGroupKeys: ReadonlySet<string>;
  emailedUserIds: ReadonlySet<string>;
  alreadyDeliveredKeys: ReadonlySet<string>;
  now: Date;
  threshold?: number;
}

export function userGroupKey(userId: string, groupId: string): string {
  return `${userId}:${groupId}`;
}

export function deliveryKey(userId: string, groupId: string, currency: string): string {
  return `${userId}:${groupId}:${currency}`;
}

export function selectBalanceNudgeCandidates(
  input: SelectBalanceNudgeInput,
): BalanceNudgeCandidate[] {
  const threshold = input.threshold ?? BALANCE_NUDGE_THRESHOLD;
  const selected: BalanceNudgeCandidate[] = [];

  for (const total of input.owedTotals) {
    if (!isCadenceDue(input.groupCadenceById.get(total.group_id) ?? 'off', input.now)) {
      continue;
    }
    if (!total.user_id || total.amount < threshold) continue;
    if (input.mutedUserGroupKeys.has(userGroupKey(total.user_id, total.group_id))) continue;
    if (input.emailedUserIds.has(total.user_id)) continue;
    if (input.alreadyDeliveredKeys.has(deliveryKey(total.user_id, total.group_id, total.currency))) {
      continue;
    }
    selected.push({
      userId: total.user_id,
      groupId: total.group_id,
      groupName: total.group_name,
      amount: total.amount,
      currency: total.currency,
    });
  }

  return selected;
}

export function composeBalanceNudgePush(candidate: BalanceNudgeCandidate): {
  title: string;
  body: string;
  data: Record<string, string | number>;
} {
  const amount = formatReminderMoney(candidate.amount, candidate.currency);
  return {
    title: candidate.groupName,
    body: `You owe ${amount} in ${candidate.groupName}`,
    data: {
      schema_version: 1,
      route: 'settle',
      group_id: candidate.groupId,
    },
  };
}
