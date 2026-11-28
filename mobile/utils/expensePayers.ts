import { roundMoney } from "./splits";
import { formatShareCurrency } from "./settleShareMessage";

export type ExpensePayerShare = {
  participant_id: string;
  amount: number;
  user_id?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
};

export type ExpensePayerSource = {
  amount?: number | string | null;
  paid_by?: string | null;
  paid_by_participant_id?: string | null;
  payers?: Array<{
    participant_id?: string | null;
    user_id?: string | null;
    amount?: number | string | null;
    full_name?: string | null;
    avatar_url?: string | null;
  }> | null;
  transaction_payers?: Array<{
    participant_id?: string | null;
    user_id?: string | null;
    amount?: number | string | null;
    full_name?: string | null;
    avatar_url?: string | null;
  }> | null;
};

function parseAmount(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseFloat(value);
  return Number.NaN;
}

/**
 * Prefer stored payer rows. Fall back to the single paid_by column so
 * existing expenses stay readable without a client-side backfill.
 */
export function resolveExpensePayers(expense: ExpensePayerSource): ExpensePayerShare[] {
  const rows = (expense.payers && expense.payers.length > 0)
    ? expense.payers
    : (expense.transaction_payers && expense.transaction_payers.length > 0)
      ? expense.transaction_payers
      : [];
  const fromRows: ExpensePayerShare[] = [];
  for (const row of rows) {
    if (!row?.participant_id) continue;
    const amount = parseAmount(row.amount);
    if (!Number.isFinite(amount)) continue;
    fromRows.push({
      participant_id: row.participant_id,
      user_id: row.user_id,
      amount: roundMoney(amount),
      ...(row.full_name != null ? { full_name: row.full_name } : {}),
      ...(row.avatar_url != null ? { avatar_url: row.avatar_url } : {}),
    });
  }
  if (fromRows.length > 0) return fromRows;
  if (!expense.paid_by_participant_id) return [];
  const total = parseAmount(expense.amount);
  if (!Number.isFinite(total)) return [];
  return [{
    participant_id: expense.paid_by_participant_id,
    user_id: expense.paid_by,
    amount: roundMoney(total),
  }];
}

export function viewerPaidAmount(
  payers: ExpensePayerShare[],
  viewer: { participantId?: string | null; userId?: string | null },
): number {
  return roundMoney(
    payers.reduce((sum, payer) => {
      const byParticipant = viewer.participantId
        && payer.participant_id === viewer.participantId;
      const byUser = viewer.userId && payer.user_id && payer.user_id === viewer.userId;
      return sum + (byParticipant || byUser ? payer.amount : 0);
    }, 0),
  );
}

/** List subline: "Asha paid ₹4,800" / "Asha + 1 paid ₹4,800" / "3 people paid ₹4,800". */
export function formatPayerLine(input: {
  payerNames: string[];
  amount: number;
  currency: string;
}): string {
  const amount = formatShareCurrency(input.amount, input.currency);
  const names = input.payerNames.map((name) => name.trim()).filter(Boolean);
  if (names.length <= 1) return `${names[0] || "Someone"} paid ${amount}`;
  if (names.length === 2) return `${names[0]} + 1 paid ${amount}`;
  return `${names.length} people paid ${amount}`;
}

/** Detail / activity: "Asha" / "Asha and Rohan" / "3 people". */
export function formatPaidByLabel(names: string[]): string {
  const cleaned = names.map((name) => name.trim()).filter(Boolean);
  if (cleaned.length <= 1) return cleaned[0] || "Someone";
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.length} people`;
}

export function formatActivityPayers(
  names: string[],
  amount: number,
  currency: string,
): string {
  const money = formatShareCurrency(amount, currency);
  const cleaned = names.map((name) => name.trim()).filter(Boolean);
  if (cleaned.length <= 1) return `${cleaned[0] || "Someone"} paid ${money}`;
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]} paid ${money}`;
  return `${cleaned.length} people paid ${money}`;
}
