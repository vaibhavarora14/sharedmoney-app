import { verifyAuth } from '../_shared/auth.ts';
import { guestSignInRequiredResponse } from '../_shared/guest.ts';
import { createErrorResponse, handleError } from '../_shared/error-handler.ts';
import { log } from '../_shared/logger.ts';
import { createEmptyResponse, createSuccessResponse } from '../_shared/response.ts';
import { isValidDate, isValidUUID, validateBodySize } from '../_shared/validation.ts';

/**
 * Import Splitwise Edge Function
 *
 * Bulk-imports a Splitwise group export (parsed client-side) into a
 * SharedMoney group in a single request:
 * - POST /import-splitwise - Create expenses (with exact per-participant
 *   splits) and settlements. The /transactions endpoint also accepts exact
 *   splits when creating or updating a single expense.
 *
 * The client parses the Splitwise CSV, maps Splitwise members to group
 * participants and sends resolved participant IDs. If any insert fails,
 * previously inserted rows from the same request are rolled back so the
 * import is all-or-nothing.
 *
 * @route /functions/v1/import-splitwise
 * @requires Authentication
 */

interface ImportSplit {
  participant_id: string;
  amount: number;
}

interface ImportExpense {
  description: string;
  date: string; // YYYY-MM-DD
  category?: string | null;
  currency: string; // 3-letter code
  amount: number;
  paid_by_participant_id: string;
  splits: ImportSplit[];
}

interface ImportSettlement {
  from_participant_id: string;
  to_participant_id: string;
  amount: number;
  currency: string; // 3-letter code
  notes?: string | null;
}

interface ImportRequest {
  group_id: string;
  expenses: ImportExpense[];
  settlements: ImportSettlement[];
}

const MAX_IMPORT_ITEMS = 2000;
const MAX_AMOUNT = 1000000;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_CATEGORY_LENGTH = 50; // transactions.category is VARCHAR(50)
const MAX_NOTES_LENGTH = 1000;
const SPLIT_SUM_TOLERANCE = 0.02;

function isValidAmount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_AMOUNT
  );
}

function isValidCurrency(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z]{3}$/.test(value);
}

/** Returns an error message for the expense at `index`, or null if valid. */
function validateExpense(expense: ImportExpense, index: number): string | null {
  const label = `Expense ${index + 1}`;

  if (
    typeof expense.description !== 'string' ||
    expense.description.trim().length === 0 ||
    expense.description.length > MAX_DESCRIPTION_LENGTH
  ) {
    return `${label}: description must be a non-empty string (max ${MAX_DESCRIPTION_LENGTH} characters)`;
  }
  if (typeof expense.date !== 'string' || !isValidDate(expense.date)) {
    return `${label}: invalid date format (expected YYYY-MM-DD)`;
  }
  if (
    expense.category !== undefined &&
    expense.category !== null &&
    (typeof expense.category !== 'string' || expense.category.length > MAX_CATEGORY_LENGTH)
  ) {
    return `${label}: category must be a string (max ${MAX_CATEGORY_LENGTH} characters)`;
  }
  if (!isValidCurrency(expense.currency)) {
    return `${label}: currency must be a 3-character code (e.g., USD)`;
  }
  if (!isValidAmount(expense.amount)) {
    return `${label}: amount must be a positive number up to ${MAX_AMOUNT}`;
  }
  if (
    typeof expense.paid_by_participant_id !== 'string' ||
    !isValidUUID(expense.paid_by_participant_id)
  ) {
    return `${label}: paid_by_participant_id must be a valid UUID`;
  }
  if (!Array.isArray(expense.splits) || expense.splits.length === 0) {
    return `${label}: splits must be a non-empty array`;
  }

  const seenParticipants = new Set<string>();
  let splitSum = 0;
  for (const split of expense.splits) {
    if (!split || typeof split !== 'object') {
      return `${label}: each split must be an object`;
    }
    if (typeof split.participant_id !== 'string' || !isValidUUID(split.participant_id)) {
      return `${label}: split participant_id must be a valid UUID`;
    }
    if (seenParticipants.has(split.participant_id)) {
      return `${label}: duplicate participant in splits`;
    }
    seenParticipants.add(split.participant_id);
    if (!isValidAmount(split.amount)) {
      return `${label}: split amounts must be positive numbers up to ${MAX_AMOUNT}`;
    }
    splitSum += split.amount;
  }

  if (Math.abs(splitSum - expense.amount) > SPLIT_SUM_TOLERANCE) {
    return `${label}: split amounts (${splitSum.toFixed(2)}) do not add up to the expense amount (${expense.amount.toFixed(2)})`;
  }

  return null;
}

/** Returns an error message for the settlement at `index`, or null if valid. */
function validateSettlement(settlement: ImportSettlement, index: number): string | null {
  const label = `Settlement ${index + 1}`;

  if (
    typeof settlement.from_participant_id !== 'string' ||
    !isValidUUID(settlement.from_participant_id)
  ) {
    return `${label}: from_participant_id must be a valid UUID`;
  }
  if (
    typeof settlement.to_participant_id !== 'string' ||
    !isValidUUID(settlement.to_participant_id)
  ) {
    return `${label}: to_participant_id must be a valid UUID`;
  }
  if (settlement.from_participant_id === settlement.to_participant_id) {
    return `${label}: from and to participants must be different`;
  }
  if (!isValidAmount(settlement.amount)) {
    return `${label}: amount must be a positive number up to ${MAX_AMOUNT}`;
  }
  if (!isValidCurrency(settlement.currency)) {
    return `${label}: currency must be a 3-character code (e.g., USD)`;
  }
  if (
    settlement.notes !== undefined &&
    settlement.notes !== null &&
    (typeof settlement.notes !== 'string' || settlement.notes.length > MAX_NOTES_LENGTH)
  ) {
    return `${label}: notes must be a string (max ${MAX_NOTES_LENGTH} characters)`;
  }

  return null;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return createEmptyResponse(200, req);
  }

  try {
    if (req.method !== 'POST') {
      return createErrorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED', undefined, req);
    }

    const body = await req.text().catch(() => null);
    const bodySizeValidation = validateBodySize(body);
    if (!bodySizeValidation.valid) {
      return createErrorResponse(413, bodySizeValidation.error || 'Request body too large', 'VALIDATION_ERROR', undefined, req);
    }

    let authResult;
    try {
      authResult = await verifyAuth(req);
    } catch (authError) {
      return handleError(authError, 'authentication', req);
    }

    const { user, supabase } = authResult;
    if (authResult.isAnonymous) {
      return guestSignInRequiredResponse(req);
    }

    if (!body) {
      return createErrorResponse(400, 'Request body is required', 'VALIDATION_ERROR', undefined, req);
    }

    let importData: ImportRequest;
    try {
      importData = JSON.parse(body);
    } catch {
      return createErrorResponse(400, 'Invalid JSON in request body', 'VALIDATION_ERROR', undefined, req);
    }

    if (!importData.group_id || !isValidUUID(importData.group_id)) {
      return createErrorResponse(400, 'Invalid group_id format. Expected UUID.', 'VALIDATION_ERROR', undefined, req);
    }

    const expenses = Array.isArray(importData.expenses) ? importData.expenses : [];
    const settlements = Array.isArray(importData.settlements) ? importData.settlements : [];

    if (expenses.length === 0 && settlements.length === 0) {
      return createErrorResponse(400, 'Nothing to import: provide at least one expense or settlement', 'VALIDATION_ERROR', undefined, req);
    }

    if (expenses.length + settlements.length > MAX_IMPORT_ITEMS) {
      return createErrorResponse(400, `Too many items to import (max ${MAX_IMPORT_ITEMS} per request)`, 'VALIDATION_ERROR', undefined, req);
    }

    for (let i = 0; i < expenses.length; i++) {
      const error = validateExpense(expenses[i], i);
      if (error) {
        return createErrorResponse(400, error, 'VALIDATION_ERROR', undefined, req);
      }
    }

    for (let i = 0; i < settlements.length; i++) {
      const error = validateSettlement(settlements[i], i);
      if (error) {
        return createErrorResponse(400, error, 'VALIDATION_ERROR', undefined, req);
      }
    }

    // Caller must be an active member of the group
    const { data: membership, error: membershipError } = await supabase
      .from('group_members')
      .select('id')
      .eq('group_id', importData.group_id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single();

    if (membershipError || !membership) {
      return createErrorResponse(403, 'You must be an active member of the group to import expenses', 'PERMISSION_DENIED', undefined, req);
    }

    // All referenced participants must belong to the group
    const referencedParticipantIds = new Set<string>();
    expenses.forEach((expense) => {
      referencedParticipantIds.add(expense.paid_by_participant_id);
      expense.splits.forEach((split) => referencedParticipantIds.add(split.participant_id));
    });
    settlements.forEach((settlement) => {
      referencedParticipantIds.add(settlement.from_participant_id);
      referencedParticipantIds.add(settlement.to_participant_id);
    });

    const { data: participants, error: participantsError } = await supabase
      .from('participants')
      .select('id')
      .eq('group_id', importData.group_id)
      .in('id', Array.from(referencedParticipantIds));

    if (participantsError) {
      return handleError(participantsError, 'validating participants', req);
    }

    const foundParticipantIds = new Set((participants || []).map((p: { id: string }) => p.id));
    const invalidParticipantIds = Array.from(referencedParticipantIds).filter(
      (id) => !foundParticipantIds.has(id)
    );
    if (invalidParticipantIds.length > 0) {
      return createErrorResponse(400, `Invalid participant_ids: ${invalidParticipantIds.join(', ')}`, 'VALIDATION_ERROR', undefined, req);
    }

    // Insert transactions in bulk. Postgres INSERT ... RETURNING preserves the
    // order of the VALUES list, so returned ids line up with `expenses`.
    let insertedTransactionIds: number[] = [];

    if (expenses.length > 0) {
      const transactionRows = expenses.map((expense) => ({
        user_id: user.id,
        amount: expense.amount,
        description: expense.description.trim(),
        date: expense.date,
        type: 'expense',
        category: expense.category?.trim() || null,
        group_id: importData.group_id,
        currency: expense.currency.toUpperCase(),
        paid_by_participant_id: expense.paid_by_participant_id,
      }));

      const { data: insertedTransactions, error: transactionsInsertError } = await supabase
        .from('transactions')
        .insert(transactionRows)
        .select('id');

      if (transactionsInsertError || !insertedTransactions || insertedTransactions.length !== expenses.length) {
        return handleError(
          transactionsInsertError || new Error('Transaction insert returned unexpected row count'),
          'importing transactions',
          req
        );
      }

      insertedTransactionIds = insertedTransactions.map((t: { id: number }) => t.id);

      const splitRows = expenses.flatMap((expense, index) =>
        expense.splits.map((split) => ({
          transaction_id: insertedTransactionIds[index],
          participant_id: split.participant_id,
          amount: split.amount,
        }))
      );

      const { error: splitsInsertError } = await supabase
        .from('transaction_splits')
        .insert(splitRows);

      if (splitsInsertError) {
        await rollbackTransactions(supabase, insertedTransactionIds);
        log.error('Failed to insert splits during Splitwise import', 'import-splitwise', {
          groupId: importData.group_id,
          error: splitsInsertError.message,
          code: splitsInsertError.code,
        });
        return createErrorResponse(500, 'Failed to import expense splits', 'IMPORT_ERROR', undefined, req);
      }
    }

    if (settlements.length > 0) {
      const settlementRows = settlements.map((settlement) => ({
        group_id: importData.group_id,
        from_participant_id: settlement.from_participant_id,
        to_participant_id: settlement.to_participant_id,
        amount: settlement.amount,
        currency: settlement.currency.toUpperCase(),
        notes: settlement.notes?.trim() || null,
        created_by: user.id,
      }));

      const { error: settlementsInsertError } = await supabase
        .from('settlements')
        .insert(settlementRows);

      if (settlementsInsertError) {
        // Keep the import all-or-nothing: undo the transactions inserted above
        // (splits are removed via ON DELETE CASCADE).
        await rollbackTransactions(supabase, insertedTransactionIds);
        log.error('Failed to insert settlements during Splitwise import', 'import-splitwise', {
          groupId: importData.group_id,
          error: settlementsInsertError.message,
          code: settlementsInsertError.code,
        });
        return createErrorResponse(500, 'Failed to import settlements', 'IMPORT_ERROR', undefined, req);
      }
    }

    log.info('Splitwise import completed', 'import-splitwise', {
      groupId: importData.group_id,
      expenses: expenses.length,
      settlements: settlements.length,
    });

    return createSuccessResponse(
      {
        imported_expenses: expenses.length,
        imported_settlements: settlements.length,
      },
      201,
      0,
      req
    );
  } catch (error: unknown) {
    return handleError(error, 'import-splitwise handler', req);
  }
});

// deno-lint-ignore no-explicit-any
async function rollbackTransactions(supabase: any, transactionIds: number[]): Promise<void> {
  if (transactionIds.length === 0) return;

  const { error } = await supabase
    .from('transactions')
    .delete()
    .in('id', transactionIds);

  if (error) {
    log.error('Failed to rollback transactions after import failure', 'import-splitwise', {
      transactionIds,
      error: error.message,
      code: error.code,
    });
  }
}
