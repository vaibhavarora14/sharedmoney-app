import { assertEquals } from 'jsr:@std/assert@1';
import {
  calculateEqualSplits,
  calculateShareSplits,
  validateSplitSum,
} from './splits.ts';
import {
  buildTransactionPayerRows,
  parseCustomPayers,
  resolveExpensePayers,
} from './payers.ts';

const ALICE = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';
const CHARLIE = '33333333-3333-3333-3333-333333333333';

Deno.test('exact payer amounts that add up are accepted', () => {
  const parsed = parseCustomPayers([
    { participant_id: ALICE, amount: 3000 },
    { participant_id: BOB, amount: 1800 },
  ]);
  assertEquals(parsed, {
    present: true,
    splits: [
      { participant_id: ALICE, amount: 3000 },
      { participant_id: BOB, amount: 1800 },
    ],
  });
  const rows = buildTransactionPayerRows(
    9,
    4800,
    [ALICE, BOB],
    parsed.present && 'splits' in parsed ? parsed.splits : null,
  );
  assertEquals(rows.error, undefined);
  assertEquals(rows.payers, [
    { transaction_id: 9, participant_id: ALICE, amount: 3000 },
    { transaction_id: 9, participant_id: BOB, amount: 1800 },
  ]);
});

Deno.test('payer amounts that miss the total are rejected', () => {
  const rows = buildTransactionPayerRows(
    9,
    4800,
    [ALICE, BOB],
    [
      { participant_id: ALICE, amount: 3000 },
      { participant_id: BOB, amount: 1000 },
    ],
  );
  assertEquals(rows.payers, []);
  assertEquals(typeof rows.error, 'string');
});

Deno.test('share weights convert with the same remainder rule as splits', () => {
  const shares = calculateShareSplits(100, [ALICE, BOB, CHARLIE], {
    [ALICE]: 2,
    [BOB]: 1,
    [CHARLIE]: 1,
  });
  assertEquals(shares, [
    { participant_id: ALICE, amount: 50 },
    { participant_id: BOB, amount: 25 },
    { participant_id: CHARLIE, amount: 25 },
  ]);
  assertEquals(validateSplitSum(shares, 100).valid, true);

  const leftover = calculateShareSplits(10.01, [ALICE, BOB, CHARLIE], {
    [ALICE]: 1,
    [BOB]: 1,
    [CHARLIE]: 1,
  });
  assertEquals(leftover, calculateEqualSplits(10.01, [ALICE, BOB, CHARLIE]));
  assertEquals(validateSplitSum(leftover, 10.01).valid, true);
});

Deno.test('missing payer rows fall back to the single paid_by column without drift', () => {
  assertEquals(
    resolveExpensePayers({
      amount: 90,
      paid_by_participant_id: ALICE,
    }),
    [{ participant_id: ALICE, amount: 90 }],
  );
  assertEquals(
    resolveExpensePayers({
      amount: '90.00',
      paid_by_participant_id: ALICE,
      transaction_payers: [],
    }),
    [{ participant_id: ALICE, amount: 90 }],
  );
});

Deno.test('stored payer rows win over paid_by_participant_id', () => {
  assertEquals(
    resolveExpensePayers({
      amount: 4800,
      paid_by_participant_id: ALICE,
      transaction_payers: [
        { participant_id: ALICE, amount: 3000 },
        { participant_id: BOB, amount: 1800 },
      ],
    }),
    [
      { participant_id: ALICE, amount: 3000 },
      { participant_id: BOB, amount: 1800 },
    ],
  );
});
