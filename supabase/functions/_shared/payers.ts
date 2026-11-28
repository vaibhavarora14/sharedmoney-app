import {
  buildTransactionSplitRows,
  parseCustomSplits,
  roundMoney,
  type ParsedCustomSplits,
  type SplitShare,
  type TransactionSplitRow,
} from './splits.ts';

export type PayerShare = SplitShare;
export type TransactionPayerRow = TransactionSplitRow;

function parseAmount(value: number | string | null | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number.parseFloat(value);
  return Number.NaN;
}

export type ExpensePayerSource = {
  amount?: number | string | null;
  paid_by_participant_id?: string | null;
  payers?: Array<{ participant_id?: string | null; amount?: number | string | null }> | null;
  transaction_payers?: Array<{
    participant_id?: string | null;
    amount?: number | string | null;
  }> | null;
};

/**
 * Resolve who paid how much. Prefer stored payer rows; fall back to the
 * single `paid_by_participant_id` column so pre-migration expenses keep working.
 */
export function resolveExpensePayers(expense: ExpensePayerSource): PayerShare[] {
  const rows = (expense.payers && expense.payers.length > 0)
    ? expense.payers
    : (expense.transaction_payers && expense.transaction_payers.length > 0)
      ? expense.transaction_payers
      : [];
  const fromRows: PayerShare[] = [];
  for (const row of rows) {
    if (!row?.participant_id) continue;
    const amount = parseAmount(row.amount);
    if (!Number.isFinite(amount)) continue;
    fromRows.push({
      participant_id: row.participant_id,
      amount: roundMoney(amount),
    });
  }
  if (fromRows.length > 0) return fromRows;

  if (!expense.paid_by_participant_id) return [];
  const total = parseAmount(expense.amount);
  if (!Number.isFinite(total)) return [];
  return [{
    participant_id: expense.paid_by_participant_id,
    amount: roundMoney(total),
  }];
}

function rewriteAllocationError(message: string): string {
  return message
    .replace(/Split amounts/g, 'Payer amounts')
    .replace(/splits/g, 'payers')
    .replace(/split /g, 'payer ');
}

export function parseCustomPayers(raw: unknown): ParsedCustomSplits {
  const parsed = parseCustomSplits(raw);
  if (parsed.present && 'error' in parsed) {
    return { present: true, error: rewriteAllocationError(parsed.error) };
  }
  return parsed;
}

export function buildTransactionPayerRows(
  transactionId: number,
  totalAmount: number,
  participantIds: string[],
  customPayers: SplitShare[] | null,
): { payers: TransactionPayerRow[]; error?: string } {
  const built = buildTransactionSplitRows(
    transactionId,
    totalAmount,
    participantIds,
    customPayers,
  );
  if (built.error) {
    return { payers: [], error: rewriteAllocationError(built.error) };
  }
  return { payers: built.splits };
}
