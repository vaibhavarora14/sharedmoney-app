import { formatCurrency } from "./currency";
import { isValidE164Phone, normalizePhoneToE164 } from "./phoneValidation";

export type SettleShareLine = {
  counterpartyName: string;
  direction: "pay" | "receive";
  amount: number;
  currency: string;
  groupName?: string | null;
};

export type SettleSummaryEdge = {
  fromName: string;
  toName: string;
  amount: number;
  currency: string;
};

/** First token of a display name, falling back to the full trimmed string. */
export function settleFirstName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0] || trimmed;
}

/**
 * Digits-only international number for WhatsApp (`wa.me` / `whatsapp://send`).
 * Accepts E.164 (`+9198…`) or already-digit international forms; rejects empty /
 * too-short values. Does not prepend a country code when the input is already a
 * full international digit string.
 */
export function whatsAppPhoneDigits(
  phone: string | null | undefined,
): string | null {
  if (phone == null) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("+")) {
    const e164 = normalizePhoneToE164(trimmed);
    if (!e164) return null;
    return e164.replace(/\D/g, "");
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  if (digits.startsWith("0")) return null;

  // Already a full international number (no leading +).
  if (isValidE164Phone(`+${digits}`)) return digits;

  const e164 = normalizePhoneToE164(trimmed);
  if (!e164) return null;
  return e164.replace(/\D/g, "");
}

export function buildWhatsAppMeUrl(phoneDigits: string, text: string): string {
  const digits = phoneDigits.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function buildWhatsAppSendUrl(phoneDigits: string, text: string): string {
  const digits = phoneDigits.replace(/\D/g, "");
  return `whatsapp://send?phone=${digits}&text=${encodeURIComponent(text)}`;
}

/**
 * Per-person remind copy (second person). Link on its own final line.
 * No payment / "Pay to" wording.
 */
export function buildSettleRemindMessage(input: {
  counterpartyName: string;
  amount: number;
  currency: string;
  groupName: string;
  settleLink: string;
}): string {
  const first = settleFirstName(input.counterpartyName);
  const group = input.groupName.trim() || "the group";
  const amount = formatCurrency(Math.abs(input.amount), input.currency);
  const link = input.settleLink.trim();
  const body =
    `Hi ${first}, quick one from ${group}: you owe me ${amount}. No rush. Once you've paid, tap to mark it settled:`;
  return link ? `${body}\n${link}` : body;
}

function isViewerLabel(name: string): boolean {
  return name.trim().toLowerCase() === "you";
}

/** One settle-up line; conjugates pay/pays and lowercases "you" as payee. */
export function formatSettleSummaryEdgeLine(edge: SettleSummaryEdge): string {
  const from = edge.fromName.trim() || "Someone";
  const to = edge.toName.trim() || "Someone";
  const amount = formatCurrency(Math.abs(edge.amount), edge.currency);
  const fromIsYou = isViewerLabel(from);
  const toIsYou = isViewerLabel(to);

  if (fromIsYou) {
    return `You pay ${toIsYou ? "you" : to} ${amount}`;
  }
  if (toIsYou) {
    return `${from} pays you ${amount}`;
  }
  return `${from} pays ${to} ${amount}`;
}

/**
 * Whole-group settle-up summary. Words, no arrows. Link on its own final line.
 * Current user reads as "You pay …" / "… pays you" (not "You pays" / "pays You").
 */
export function buildSettleSummaryMessage(input: {
  groupName: string;
  edges: SettleSummaryEdge[];
  groupLink: string;
}): string {
  const group = input.groupName.trim() || "Group";
  const lines = input.edges
    .filter((edge) => Math.abs(edge.amount) >= 0.005)
    .map((edge) => formatSettleSummaryEdgeLine(edge));

  if (lines.length === 0) return "";

  const link = input.groupLink.trim();
  const body = `${group}, settle-up:\n${lines.join("\n")}`;
  return link ? `${body}\n${link}` : body;
}

/**
 * @deprecated Prefer {@link buildSettleRemindMessage} / {@link buildSettleSummaryMessage}.
 * Kept for call sites that still pass legacy per-row lines; maps receive → remind copy
 * without a settle link when none is provided.
 */
export function buildSettleShareMessage(input: {
  lines: SettleShareLine[];
  paymentUrl?: string | null;
  settleLink?: string | null;
}): string {
  const usable = input.lines.filter((line) => Math.abs(line.amount) >= 0.005);
  if (usable.length === 0) return "";

  const settleLink = input.settleLink?.trim() || "";
  const paymentUrl = input.paymentUrl?.trim() || "";

  if (usable.length === 1 && usable[0].direction === "receive") {
    const line = usable[0];
    return buildSettleRemindMessage({
      counterpartyName: line.counterpartyName,
      amount: line.amount,
      currency: line.currency,
      groupName: line.groupName?.trim() || "the group",
      settleLink: settleLink || paymentUrl,
    });
  }

  const parts = usable.map((line) => {
    const name = line.counterpartyName.trim() || "Someone";
    const group = line.groupName?.trim();
    const groupSuffix = group ? ` in ${group}` : "";
    const amount = formatCurrency(Math.abs(line.amount), line.currency);
    if (line.direction === "pay") {
      return `You owe ${name} ${amount}${groupSuffix}.`;
    }
    return `${name} owes you ${amount}${groupSuffix}.`;
  });

  let message = parts.join("\n");
  const trailing = settleLink || paymentUrl;
  if (trailing) message = `${message}\n\n${trailing}`;
  return message;
}
