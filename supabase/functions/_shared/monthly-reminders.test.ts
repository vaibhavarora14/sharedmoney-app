import {
  aggregateMonthlyReminderEmails,
  buildGroupSettlementEdges,
  buildMemberOwedTotals,
  buildUpdateNudge,
  getDeliveryReservationMode,
  getPreviousMonthPeriodKey,
  UPDATE_NUDGE_SENTENCE,
  type ReminderLastSeenApp,
} from './monthly-reminders.ts';

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected, null, 2)}, got ${JSON.stringify(actual, null, 2)}`,
    );
  }
}

function assertThrows(fn: () => unknown, expectedMessage: string) {
  try {
    fn();
  } catch (err) {
    if (err instanceof Error && err.message.includes(expectedMessage)) {
      return;
    }
    throw err;
  }

  throw new Error(`Expected function to throw "${expectedMessage}"`);
}

const participants = [
  {
    id: 'alice-participant',
    group_id: 'group-1',
    user_id: 'alice-user',
    email: null,
    full_name: 'Alice',
    type: 'member',
  },
  {
    id: 'bob-participant',
    group_id: 'group-1',
    user_id: 'bob-user',
    email: null,
    full_name: 'Bob',
    type: 'member',
  },
  {
    id: 'cory-participant',
    group_id: 'group-1',
    user_id: 'cory-user',
    email: null,
    full_name: 'Cory',
    type: 'member',
  },
  {
    id: 'invite-participant',
    group_id: 'group-1',
    user_id: null,
    email: 'invite@example.com',
    full_name: null,
    type: 'invited',
  },
  {
    id: 'former-participant',
    group_id: 'group-1',
    user_id: 'former-user',
    email: null,
    full_name: 'Former',
    type: 'former',
  },
];

Deno.test('getPreviousMonthPeriodKey returns the previous calendar month', () => {
  assertEquals(getPreviousMonthPeriodKey(new Date('2026-09-01T09:00:00Z')), '2026-08');
  assertEquals(getPreviousMonthPeriodKey(new Date('2026-01-01T09:00:00Z')), '2025-12');
});

Deno.test('buildGroupSettlementEdges creates debtor-to-creditor settlement actions by currency', () => {
  const edges = buildGroupSettlementEdges({
    group: { id: 'group-1', name: 'Trip' },
    participants,
    userIdToEmail: new Map([
      ['alice-user', 'alice@example.com'],
      ['bob-user', 'bob@example.com'],
      ['cory-user', 'cory@example.com'],
      ['former-user', 'former@example.com'],
    ]),
    transactions: [
      {
        id: 1,
        group_id: 'group-1',
        amount: '90',
        currency: 'USD',
        paid_by_participant_id: 'alice-participant',
        transaction_splits: [
          { participant_id: 'alice-participant', amount: '30' },
          { participant_id: 'bob-participant', amount: '30' },
          { participant_id: 'cory-participant', amount: '30' },
        ],
      },
      {
        id: 2,
        group_id: 'group-1',
        amount: '60',
        currency: 'EUR',
        paid_by_participant_id: 'bob-participant',
        transaction_splits: [
          { participant_id: 'alice-participant', amount: '30' },
          { participant_id: 'bob-participant', amount: '30' },
        ],
      },
    ],
    settlements: [
      {
        id: 'settlement-1',
        group_id: 'group-1',
        from_participant_id: 'bob-participant',
        to_participant_id: 'alice-participant',
        amount: '10',
        currency: 'USD',
      },
    ],
  });

  assertEquals(edges, [
    {
      group_id: 'group-1',
      group_name: 'Trip',
      from_participant_id: 'cory-participant',
      from_user_id: 'cory-user',
      from_email: 'cory@example.com',
      from_name: 'Cory',
      to_participant_id: 'alice-participant',
      to_user_id: 'alice-user',
      to_email: 'alice@example.com',
      to_name: 'Alice',
      amount: 30,
      currency: 'USD',
    },
    {
      group_id: 'group-1',
      group_name: 'Trip',
      from_participant_id: 'bob-participant',
      from_user_id: 'bob-user',
      from_email: 'bob@example.com',
      from_name: 'Bob',
      to_participant_id: 'alice-participant',
      to_user_id: 'alice-user',
      to_email: 'alice@example.com',
      to_name: 'Alice',
      amount: 20,
      currency: 'USD',
    },
    {
      group_id: 'group-1',
      group_name: 'Trip',
      from_participant_id: 'alice-participant',
      from_user_id: 'alice-user',
      from_email: 'alice@example.com',
      from_name: 'Alice',
      to_participant_id: 'bob-participant',
      to_user_id: 'bob-user',
      to_email: 'bob@example.com',
      to_name: 'Bob',
      amount: 30,
      currency: 'EUR',
    },
  ]);
});

Deno.test('buildGroupSettlementEdges skips invited, former, no-email, and near-zero actions', () => {
  const edges = buildGroupSettlementEdges({
    group: { id: 'group-1', name: 'House' },
    participants,
    userIdToEmail: new Map([
      ['alice-user', 'alice@example.com'],
      ['bob-user', 'bob@example.com'],
      ['cory-user', ''],
      ['former-user', 'former@example.com'],
    ]),
    transactions: [
      {
        id: 1,
        group_id: 'group-1',
        amount: 0.02,
        currency: 'USD',
        paid_by_participant_id: 'alice-participant',
        transaction_splits: [
          { participant_id: 'alice-participant', amount: 0.01 },
          { participant_id: 'bob-participant', amount: 0.01 },
        ],
      },
      {
        id: 2,
        group_id: 'group-1',
        amount: 30,
        currency: 'USD',
        paid_by_participant_id: 'invite-participant',
        transaction_splits: [
          { participant_id: 'alice-participant', amount: 15 },
          { participant_id: 'invite-participant', amount: 15 },
        ],
      },
      {
        id: 3,
        group_id: 'group-1',
        amount: 30,
        currency: 'USD',
        paid_by_participant_id: 'former-participant',
        transaction_splits: [
          { participant_id: 'bob-participant', amount: 15 },
          { participant_id: 'former-participant', amount: 15 },
        ],
      },
      {
        id: 4,
        group_id: 'group-1',
        amount: 30,
        currency: 'USD',
        paid_by_participant_id: 'cory-participant',
        transaction_splits: [
          { participant_id: 'alice-participant', amount: 15 },
          { participant_id: 'cory-participant', amount: 15 },
        ],
      },
    ],
    settlements: [],
  });

  assertEquals(edges, []);
});

Deno.test('buildMemberOwedTotals includes debts to name-only people and skips creditors', () => {
  const input = {
    group: { id: 'group-1', name: 'House' },
    participants: [
      ...participants,
      {
        id: 'guest-participant',
        group_id: 'group-1',
        user_id: null,
        email: null,
        full_name: 'Roommate',
        type: 'guest',
      },
    ],
    userIdToEmail: new Map([
      ['alice-user', 'alice@example.com'],
      ['bob-user', 'bob@example.com'],
    ]),
    transactions: [
      {
        id: 1,
        group_id: 'group-1',
        amount: 40,
        currency: 'USD',
        paid_by_participant_id: 'guest-participant',
        transaction_splits: [
          { participant_id: 'alice-participant', amount: 20 },
          { participant_id: 'guest-participant', amount: 20 },
        ],
      },
    ],
    settlements: [],
  };

  assertEquals(buildGroupSettlementEdges(input), []);
  assertEquals(buildMemberOwedTotals(input), [
    {
      group_id: 'group-1',
      group_name: 'House',
      user_id: 'alice-user',
      amount: 20,
      currency: 'USD',
    },
  ]);
});

Deno.test('aggregateMonthlyReminderEmails creates one digest per user across roles and groups', () => {
  const emails = aggregateMonthlyReminderEmails({
    periodKey: '2026-08',
    appUrl: 'https://app.example.com',
    logoUrl: 'https://assets.example.com/sharedmoney-logo.png',
    edges: [
      {
        group_id: 'group-1',
        group_name: 'Trip',
        from_participant_id: 'alice-participant',
        from_user_id: 'alice-user',
        from_email: 'alice@example.com',
        from_name: 'Alice',
        to_participant_id: 'bob-participant',
        to_user_id: 'bob-user',
        to_email: 'bob@example.com',
        to_name: 'Bob',
        amount: 12.5,
        currency: 'USD',
      },
      {
        group_id: 'group-2',
        group_name: 'House',
        from_participant_id: 'cory-participant',
        from_user_id: 'cory-user',
        from_email: 'cory@example.com',
        from_name: 'Cory',
        to_participant_id: 'alice-participant-2',
        to_user_id: 'alice-user',
        to_email: 'alice@example.com',
        to_name: 'Alice',
        amount: 8,
        currency: 'EUR',
      },
    ],
  });

  assertEquals(emails.map((email) => email.user_id).sort(), [
    'alice-user',
    'bob-user',
    'cory-user',
  ]);

  const alice = emails.find((email) => email.user_id === 'alice-user');
  assertEquals(alice?.to, 'alice@example.com');
  assertEquals(alice?.actions.map((action) => action.direction), ['owe', 'owed']);
  assertEquals(alice?.subject, 'SharedMoney pending balances for August 2026');
  assertEquals(alice?.html.includes('src="https://assets.example.com/sharedmoney-logo.png"'), true);
  assertEquals(alice?.html.includes('href="https://app.example.com/groups/group-1"'), true);
  assertEquals(alice?.html.includes('SharedMoney'), true);
  assertEquals(alice?.html.includes('Time for a quick balance tidy-up'), true);
  assertEquals(alice?.html.includes('New month, clean slate energy.'), true);
  assertEquals(alice?.html.includes('You owe USD 12.50 to Bob in Trip'), true);
  assertEquals(alice?.html.includes('You are owed EUR 8.00 by Cory in House'), true);
  assertEquals(alice?.text.includes('A tiny money nudge from SharedMoney.'), true);
  assertEquals(alice?.text.includes('A little settle-up now keeps future you from doing awkward math later.'), true);
  assertEquals(alice?.html.includes(UPDATE_NUDGE_SENTENCE), false);
  assertEquals(alice?.text.includes(UPDATE_NUDGE_SENTENCE), false);
  assertEquals(alice?.html.includes('utm_campaign=update_nudge'), false);
});

Deno.test('aggregateMonthlyReminderEmails falls back to app icon for logo', () => {
  const emails = aggregateMonthlyReminderEmails({
    periodKey: '2026-08',
    appUrl: 'https://app.example.com/',
    edges: [
      {
        group_id: 'group-1',
        group_name: 'Trip',
        from_participant_id: 'alice-participant',
        from_user_id: 'alice-user',
        from_email: 'alice@example.com',
        from_name: 'Alice',
        to_participant_id: 'bob-participant',
        to_user_id: 'bob-user',
        to_email: 'bob@example.com',
        to_name: 'Bob',
        amount: 12.5,
        currency: 'USD',
      },
    ],
  });

  assertEquals(emails[0].html.includes('src="https://app.example.com/icon.png"'), true);
});

Deno.test('aggregateMonthlyReminderEmails rejects legacy Expo app URLs', () => {
  assertThrows(
    () =>
      aggregateMonthlyReminderEmails({
        periodKey: '2026-08',
        appUrl: 'https://share-money.expo.app',
        edges: [
          {
            group_id: 'group-1',
            group_name: 'Trip',
            from_participant_id: 'alice-participant',
            from_user_id: 'alice-user',
            from_email: 'alice@example.com',
            from_name: 'Alice',
            to_participant_id: 'bob-participant',
            to_user_id: 'bob-user',
            to_email: 'bob@example.com',
            to_name: 'Bob',
            amount: 12.5,
            currency: 'USD',
          },
        ],
      }),
    'legacy Expo redirect host',
  );
});

const PLAY_NUDGE_URL =
  'https://play.google.com/store/apps/details?id=com.vaibhavarora.sharemoney&utm_campaign=update_nudge';
const APP_STORE_NUDGE_URL =
  'https://apps.apple.com/app/id6755923591?utm_campaign=update_nudge';

const nudgeEdge = {
  group_id: 'group-1',
  group_name: 'Trip',
  from_participant_id: 'alice-participant',
  from_user_id: 'alice-user',
  from_email: 'alice@example.com',
  from_name: 'Alice',
  to_participant_id: 'bob-participant',
  to_user_id: 'bob-user',
  to_email: 'bob@example.com',
  to_name: 'Bob',
  amount: 12.5,
  currency: 'USD',
};

function reminderFor(
  userId: string,
  lastSeenByUserId?: ReadonlyMap<string, ReminderLastSeenApp | null>,
) {
  const emails = aggregateMonthlyReminderEmails({
    periodKey: '2026-08',
    appUrl: 'https://app.example.com',
    edges: [nudgeEdge],
    lastSeenByUserId,
  });
  const email = emails.find((entry) => entry.user_id === userId);
  if (!email) throw new Error(`missing reminder for ${userId}`);
  return email;
}

function assertNudgeAbsent(email: { html: string; text: string }) {
  assertEquals(email.html.includes(UPDATE_NUDGE_SENTENCE), false);
  assertEquals(email.text.includes(UPDATE_NUDGE_SENTENCE), false);
  assertEquals(email.html.includes('utm_campaign'), false);
  assertEquals(email.text.includes('utm_campaign'), false);
  assertEquals(email.html.includes('play.google.com'), false);
  assertEquals(email.text.includes('apps.apple.com'), false);
}

Deno.test('update nudge is one line for versions below 2.46.0 and prefers the known store', () => {
  const android = reminderFor('alice-user', new Map([
    ['alice-user', { appVersion: '2.30.6', platform: 'android' }],
  ]));
  assertEquals(android.html.includes(UPDATE_NUDGE_SENTENCE), true);
  assertEquals(android.text.includes(UPDATE_NUDGE_SENTENCE), true);
  assertEquals(android.text.includes(`Google Play: ${PLAY_NUDGE_URL}`), true);
  assertEquals(android.text.includes('apps.apple.com'), false);
  assertEquals(android.text.includes('utm_source'), false);
  assertEquals(android.text.includes('utm_medium'), false);
  assertEquals(
    android.html.includes(PLAY_NUDGE_URL.replaceAll('&', '&amp;')),
    true,
  );
  assertEquals(android.html.includes('apps.apple.com'), false);
  assertNudgeAbsent(reminderFor('bob-user', new Map([
    ['alice-user', { appVersion: '2.30.6', platform: 'android' }],
  ])));

  const ios = reminderFor('alice-user', new Map([
    ['alice-user', { appVersion: '2.32.0', platform: 'ios' }],
  ]));
  assertEquals(ios.text.includes(`App Store: ${APP_STORE_NUDGE_URL}`), true);
  assertEquals(ios.text.includes('play.google.com'), false);
  assertEquals(ios.html.includes(APP_STORE_NUDGE_URL), true);

  const both = reminderFor('alice-user', new Map([
    ['alice-user', { appVersion: '2.9.0' }],
  ]));
  assertEquals(both.text.includes(`Google Play: ${PLAY_NUDGE_URL}`), true);
  assertEquals(both.text.includes(`App Store: ${APP_STORE_NUDGE_URL}`), true);
  assertEquals(both.text.split('\n').filter((line) => line.includes(UPDATE_NUDGE_SENTENCE)).length, 1);
});

Deno.test('update nudge is omitted at 2.46.0, above it, and when version is missing', () => {
  const cases: Array<ReminderLastSeenApp | null> = [
    { appVersion: '2.46.0', platform: 'android' },
    { appVersion: '2.46.1', platform: 'ios' },
    { appVersion: '2.48.0' },
    { appVersion: null, platform: 'android' },
    { appVersion: '  ', platform: 'ios' },
    { appVersion: '2.46', platform: 'android' },
    { appVersion: 'v2.30.6', platform: 'ios' },
    null,
  ];

  for (const lastSeen of cases) {
    assertNudgeAbsent(reminderFor('alice-user', new Map([['alice-user', lastSeen]])));
  }

  assertNudgeAbsent(reminderFor('alice-user'));
  assertEquals(buildUpdateNudge({ appVersion: '2.45.9', platform: 'android' })?.text.includes(PLAY_NUDGE_URL), true);
  assertEquals(buildUpdateNudge({ appVersion: '2.46.0', platform: 'android' }), null);
  assertEquals(buildUpdateNudge(undefined), null);
});

Deno.test('getDeliveryReservationMode skips duplicates but allows failed retries', () => {
  assertEquals(getDeliveryReservationMode(), 'create');
  assertEquals(getDeliveryReservationMode({ status: 'sent' }), 'skip_duplicate');
  assertEquals(getDeliveryReservationMode({ status: 'pending' }), 'skip_duplicate');
  assertEquals(getDeliveryReservationMode({ status: 'failed' }), 'retry_failed');
});
