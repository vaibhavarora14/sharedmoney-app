import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  balancesPublicAction,
  hasPublicYouOwePii,
  toPublicYouOweView,
} from './public-you-owe.ts';

Deno.test('balancesPublicAction reads /balances/you-owe with or without the functions prefix', () => {
  assertEquals(balancesPublicAction('/functions/v1/balances/you-owe'), 'you-owe');
  assertEquals(balancesPublicAction('/balances/share-links'), 'share-links');
  assertEquals(balancesPublicAction('/balances'), null);
  assertEquals(balancesPublicAction('/groups/you-owe'), null);
});

Deno.test('toPublicYouOweView keeps only the viewer amount and never copies PII fields', () => {
  const view = toPublicYouOweView(
    [
      {
        participant_id: 'viewer',
        amount: -20.5,
        currency: 'USD',
        user_id: 'user-1',
        email: 'maya@example.com',
        full_name: 'Maya',
        avatar_url: 'https://example.com/maya.png',
      },
      {
        participant_id: 'host',
        amount: 20.5,
        currency: 'USD',
        user_id: 'user-2',
        email: 'host@example.com',
        full_name: 'Host',
      },
    ],
    ['viewer'],
    '2026-11-28T00:00:00.000Z',
  );
  assertEquals(view, {
    even: false,
    amounts: [{ currency: 'USD', amount: 20.5, direction: 'you_owe' }],
    expires_at: '2026-11-28T00:00:00.000Z',
  });
  assertEquals(hasPublicYouOwePii(view), false);
});

Deno.test('toPublicYouOweView treats a near-zero balance as even', () => {
  const view = toPublicYouOweView(
    [{ participant_id: 'viewer', amount: 0.004, currency: 'INR' }],
    ['viewer'],
    '2026-11-28T00:00:00.000Z',
  );
  assertEquals(view.even, true);
  assertEquals(view.amounts, []);
});
