import { formatCurrency } from "./currency";

export type SettleShareLine = {
  counterpartyName: string;
  direction: "pay" | "receive";
  amount: number;
  currency: string;
  groupName?: string | null;
};

export function buildSettleShareMessage(input: {
  lines: SettleShareLine[];
  paymentUrl?: string | null;
}): string {
  const lines = input.lines
    .filter((line) => Math.abs(line.amount) >= 0.005)
    .map((line) => {
      const name = line.counterpartyName.trim() || "Someone";
      const group = line.groupName?.trim();
      const groupSuffix = group ? ` in ${group}` : "";
      const amount = formatCurrency(Math.abs(line.amount), line.currency);

      if (line.direction === "pay") {
        return `You owe ${name} ${amount}${groupSuffix}.`;
      }

      return `${name} owes you ${amount}${groupSuffix}.`;
    });

  if (lines.length === 0) return "";

  const message = lines.join("\n");
  const paymentUrl = input.paymentUrl?.trim();
  return paymentUrl ? `${message}\n\n${paymentUrl}` : message;
}
