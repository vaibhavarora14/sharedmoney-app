import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  composeBalanceNudgePush,
  deliveryKey,
  isBalanceNudgeCadence,
  isCadenceDue,
  isMonthlyNudgeDay,
  isWeeklyNudgeDay,
  selectBalanceNudgeCandidates,
  utcDayKey,
  userGroupKey,
  type MemberOwedTotal,
} from './balance-nudges.ts';

function owed(overrides: Partial<MemberOwedTotal> = {}): MemberOwedTotal {
  return {
    group_id: 'group-1',
    group_name: 'Weekend Trip',
    user_id: 'user-owes',
    amount: 25,
    currency: 'USD',
    ...overrides,
  };
}

const monday = new Date('2026-11-16T09:00:00.000Z');
const tuesday = new Date('2026-11-17T09:00:00.000Z');
const first = new Date('2026-12-01T09:00:00.000Z');

Deno.test('cadence helpers use UTC days', () => {
  assertEquals(utcDayKey(monday), '2026-11-16');
  assertEquals(isWeeklyNudgeDay(monday), true);
  assertEquals(isWeeklyNudgeDay(tuesday), false);
  assertEquals(isMonthlyNudgeDay(first), true);
  assertEquals(isMonthlyNudgeDay(monday), false);
  assertEquals(isCadenceDue('off', monday), false);
  assertEquals(isCadenceDue('weekly', monday), true);
  assertEquals(isCadenceDue('weekly', tuesday), false);
  assertEquals(isCadenceDue('monthly', first), true);
  assertEquals(isCadenceDue('monthly', monday), false);
  assertEquals(isBalanceNudgeCadence('weekly'), true);
  assertEquals(isBalanceNudgeCadence('daily'), false);
});

Deno.test('selects members who owe above the threshold on a due cadence', () => {
  const selected = selectBalanceNudgeCandidates({
    owedTotals: [
      owed(),
      owed({ user_id: 'user-tiny', amount: 0.001, currency: 'EUR' }),
    ],
    groupCadenceById: new Map([['group-1', 'weekly']]),
    mutedUserGroupKeys: new Set(),
    emailedUserIds: new Set(),
    alreadyDeliveredKeys: new Set(),
    now: monday,
  });
  assertEquals(selected, [{
    userId: 'user-owes',
    groupId: 'group-1',
    groupName: 'Weekend Trip',
    amount: 25,
    currency: 'USD',
  }]);
});

Deno.test('skips muted users, same-day email recipients, and prior deliveries', () => {
  const base = {
    owedTotals: [owed()],
    groupCadenceById: new Map([['group-1', 'weekly']]) as Map<string, 'weekly'>,
    mutedUserGroupKeys: new Set<string>(),
    emailedUserIds: new Set<string>(),
    alreadyDeliveredKeys: new Set<string>(),
    now: monday,
  };
  assertEquals(selectBalanceNudgeCandidates({
    ...base,
    mutedUserGroupKeys: new Set([userGroupKey('user-owes', 'group-1')]),
  }), []);
  assertEquals(selectBalanceNudgeCandidates({
    ...base,
    emailedUserIds: new Set(['user-owes']),
  }), []);
  assertEquals(selectBalanceNudgeCandidates({
    ...base,
    alreadyDeliveredKeys: new Set([deliveryKey('user-owes', 'group-1', 'USD')]),
  }), []);
});

Deno.test('does not select anyone when the group cadence is off or not due', () => {
  assertEquals(selectBalanceNudgeCandidates({
    owedTotals: [owed()],
    groupCadenceById: new Map([['group-1', 'off']]),
    mutedUserGroupKeys: new Set(),
    emailedUserIds: new Set(),
    alreadyDeliveredKeys: new Set(),
    now: monday,
  }), []);
  assertEquals(selectBalanceNudgeCandidates({
    owedTotals: [owed()],
    groupCadenceById: new Map([['group-1', 'monthly']]),
    mutedUserGroupKeys: new Set(),
    emailedUserIds: new Set(),
    alreadyDeliveredKeys: new Set(),
    now: monday,
  }), []);
});

Deno.test('composeBalanceNudgePush names the group and amount and deep-links to settle', () => {
  const push = composeBalanceNudgePush({
    userId: 'user-owes',
    groupId: 'group-1',
    groupName: 'Weekend Trip',
    amount: 25,
    currency: 'USD',
  });
  assertEquals(push.title, 'Weekend Trip');
  assertEquals(push.body, 'You owe USD 25.00 in Weekend Trip');
  assertEquals(push.data, {
    schema_version: 1,
    route: 'settle',
    group_id: 'group-1',
  });
  assertEquals(push.body.toLowerCase().includes('whatsapp'), false);
});
