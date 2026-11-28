import type { Participant, Settlement, Transaction } from "../types";
import { formatPaidByLabel, resolveExpensePayers } from "./expensePayers";
import { exportPersonName } from "./groupExportNames";

export type GroupCsvMember = {
  id: string;
  name: string;
};

type CsvRow = {
  date: string;
  description: string;
  category: string;
  payer: string;
  amount: number;
  currency: string;
  shares: Record<string, number>;
};

/** Plain number for a CSV amount cell, e.g. 1250.5. No symbol and no thousands separator. */
export function formatCsvAmount(amount: number): string {
  if (!Number.isFinite(amount)) return "0";
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  return String(normalized);
}

function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Excel and Sheets run a text cell that starts with one of these as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

function csvTextField(value: string): string {
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return csvField(text);
}

function isoDate(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : value;
}

function currencyCode(value: string | null | undefined, fallback: string): string {
  const code = (value || fallback || "").trim().toUpperCase();
  return code || fallback.toUpperCase();
}

function columnNames(members: GroupCsvMember[]): string[] {
  const seen = new Map<string, number>();
  return members.map((member) => {
    const base = member.name.trim() || "Member";
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

function shareCells(members: GroupCsvMember[], shares: Record<string, number>): string[] {
  return members.map((member) => formatCsvAmount(shares[member.id] ?? 0));
}

/**
 * One spreadsheet of expenses and settlements.
 * Amounts stay in the currency stored on the row. A member who was not
 * part of a split gets 0. A settlement's share sits on the person who
 * received the payment; everyone else, including the payer, is 0.
 */
export function buildGroupCsv(input: {
  members: GroupCsvMember[];
  rows: CsvRow[];
}): string {
  const names = columnNames(input.members);
  const header = ["date", "description", "category", "payer", "amount", "currency", ...names];
  const sorted = [...input.rows].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.description !== b.description) return a.description < b.description ? -1 : 1;
    return a.payer < b.payer ? -1 : a.payer > b.payer ? 1 : 0;
  });
  const lines = [
    header.map(csvTextField).join(","),
    ...sorted.map((row) =>
      [
        csvField(row.date),
        csvTextField(row.description),
        csvTextField(row.category),
        csvTextField(row.payer),
        csvField(formatCsvAmount(row.amount)),
        csvField(row.currency),
        ...shareCells(input.members, row.shares).map(csvField),
      ].join(",")
    ),
  ];
  return `\uFEFF${lines.join("\n")}\n`;
}

function personById(participants: Participant[], id: string | null | undefined): Participant | undefined {
  if (!id) return undefined;
  return participants.find((person) => person.id === id);
}

function personByUserId(participants: Participant[], userId: string | null | undefined): Participant | undefined {
  if (!userId) return undefined;
  return participants.find((person) => person.user_id === userId);
}

function payerName(
  participants: Participant[],
  participantId: string | null | undefined,
  userId: string | null | undefined,
): string {
  return exportPersonName(personById(participants, participantId) ?? personByUserId(participants, userId));
}

function asAmount(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function columnParticipants(input: {
  members: Participant[];
  transactions: Transaction[];
  settlements: Settlement[];
  participants: Participant[];
}): Participant[] {
  const byId = new Map(input.participants.map((person) => [person.id, person]));
  const columns = [...input.members];
  const seen = new Set(columns.map((person) => person.id));
  const consider = (id: string | null | undefined) => {
    if (!id || seen.has(id)) return;
    const person = byId.get(id);
    if (!person) return;
    seen.add(id);
    columns.push(person);
  };
  for (const transaction of input.transactions) {
    if (transaction.type === "income") continue;
    consider(transaction.paid_by_participant_id);
    for (const payer of resolveExpensePayers(transaction)) consider(payer.participant_id);
    for (const split of transaction.splits ?? []) consider(split.participant_id);
  }
  for (const settlement of input.settlements) {
    consider(settlement.from_participant_id);
    consider(settlement.to_participant_id);
  }
  return columns;
}

export function buildGroupCsvDocument(input: {
  members: Participant[];
  transactions: Transaction[];
  settlements: Settlement[];
  participants: Participant[];
  defaultCurrency: string;
}): string {
  const members: GroupCsvMember[] = columnParticipants(input).map((member) => ({
    id: member.id,
    name: exportPersonName(member),
  }));
  const rows: CsvRow[] = [];

  for (const transaction of input.transactions) {
    if (transaction.type === "income") continue;
    const shares: Record<string, number> = {};
    for (const split of transaction.splits ?? []) {
      if (!split.participant_id || !Number.isFinite(split.amount)) continue;
      shares[split.participant_id] = (shares[split.participant_id] ?? 0) + asAmount(split.amount);
    }
    rows.push({
      date: isoDate(transaction.date),
      description: transaction.description ?? "",
      category: transaction.category?.trim() || "",
      payer: formatPaidByLabel(
        resolveExpensePayers(transaction).map((payer) => payerName(
          input.participants,
          payer.participant_id,
          payer.user_id,
        )),
      ) || payerName(
        input.participants,
        transaction.paid_by_participant_id,
        transaction.paid_by,
      ),
      amount: asAmount(transaction.amount),
      currency: currencyCode(transaction.currency, input.defaultCurrency),
      shares,
    });
  }

  for (const settlement of input.settlements) {
    const payeeId = settlement.to_participant_id
      || personByUserId(input.participants, settlement.to_user_id)?.id
      || "";
    const shares: Record<string, number> = {};
    if (payeeId) shares[payeeId] = asAmount(settlement.amount);
    const notes = settlement.notes?.trim() || "";
    rows.push({
      date: isoDate(settlement.created_at),
      description: notes || "Settlement",
      category: "Settlement",
      payer: payerName(
        input.participants,
        settlement.from_participant_id,
        settlement.from_user_id,
      ),
      amount: asAmount(settlement.amount),
      currency: currencyCode(settlement.currency, input.defaultCurrency),
      shares,
    });
  }

  return buildGroupCsv({ members, rows });
}

export function groupExportBasename(groupName: string): string {
  const cleaned = groupName
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "Group";
}

export function groupExportFilename(groupName: string, kind: "csv" | "pdf"): string {
  return `${groupExportBasename(groupName)}.${kind}`;
}

/** People who belong on the export, including someone who has left. */
export function participantsForExport(participants: Participant[]): Participant[] {
  return participants.filter((person) => person.type === "member" || person.type === "former");
}
