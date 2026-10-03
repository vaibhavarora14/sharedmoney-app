import { formatCurrency } from "./currency";

export type SettleHandoffPackKind = "US" | "IN" | "EU" | "BR" | "GENERIC";

export type SettleHandoffCountryInput = {
  overrideCountryCode?: string | null;
  profileCountryCode?: string | null;
  localeCountryCode?: string | null;
};

export type SettleHandoffDetails = {
  venmoHandle?: string | null;
  cashAppCashtag?: string | null;
  paypalMe?: string | null;
  upiVpa?: string | null;
  iban?: string | null;
  ibanName?: string | null;
  pixKey?: string | null;
  countryOverride?: string | null;
};

export type SettleHandoffLine = {
  counterpartyName: string;
  direction: "pay" | "receive";
  amount: number;
  currency: string;
  groupName?: string | null;
};

export type SettleHandoffAction =
  | {
      id: "venmo" | "cash-app" | "paypal" | "upi-open";
      kind: "open";
      label: string;
      url: string;
    }
  | {
      id: "zelle" | "upi-copy" | "iban" | "pix" | "amount";
      kind: "copy";
      label: string;
      copyText: string;
    };

export type SettleHandoffPack = {
  countryCode: string;
  pack: SettleHandoffPackKind;
  countryLabel: string;
  copyText: string;
  shareUrl: string | null;
  actions: SettleHandoffAction[];
};

export type BuildSettleHandoffInput = {
  lines: SettleHandoffLine[];
  counterpartyName: string;
  currentUserName?: string | null;
  details?: SettleHandoffDetails | null;
  country?: SettleHandoffCountryInput;
};

const EU_COUNTRY_CODES = new Set([
  "AT",
  "BE",
  "DE",
  "DK",
  "ES",
  "FI",
  "FR",
  "GR",
  "IE",
  "IT",
  "LU",
  "NL",
  "NO",
  "PL",
  "PT",
  "SE",
]);

const COUNTRY_LABELS: Record<SettleHandoffPackKind, string> = {
  US: "United States",
  IN: "India",
  EU: "Euro area",
  BR: "Brazil",
  GENERIC: "Other",
};

function normalizeCountryCode(code?: string | null): string | null {
  const normalized = (code ?? "").trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

function packForCountryCode(code: string): SettleHandoffPackKind {
  if (code === "US") return "US";
  if (code === "IN") return "IN";
  if (code === "BR") return "BR";
  if (code === "EU" || EU_COUNTRY_CODES.has(code)) return "EU";
  return "GENERIC";
}

export function resolveSettleHandoffCountry(
  input: SettleHandoffCountryInput,
): { countryCode: string; pack: SettleHandoffPackKind; countryLabel: string } {
  const selected = normalizeCountryCode(input.overrideCountryCode)
    ?? normalizeCountryCode(input.profileCountryCode)
    ?? normalizeCountryCode(input.localeCountryCode)
    ?? "US";
  const pack = packForCountryCode(selected);

  return {
    countryCode: selected,
    pack,
    countryLabel: COUNTRY_LABELS[pack],
  };
}

export function settleHandoffPersonKey(person: {
  userId?: string | null;
  email?: string | null;
  displayName?: string | null;
}): string {
  const userId = (person.userId ?? "").trim();
  if (userId) return `user:${userId}`;

  const email = (person.email ?? "").trim().toLowerCase();
  if (email) return `email:${email}`;

  const name = (person.displayName ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return name ? `name:${name}` : "name:someone";
}

export function settleHandoffSelfKey(): string {
  return "self";
}

function cleanText(value?: string | null): string {
  return (value ?? "").trim();
}

function significantLines(lines: SettleHandoffLine[]): SettleHandoffLine[] {
  return lines.filter((line) => Math.abs(line.amount) >= 0.005);
}

function paymentAmount(lines: SettleHandoffLine[]): {
  canBuildLink: boolean;
  direction: "pay" | "receive" | "mixed";
  amount: number;
  currency: string;
} {
  const visible = significantLines(lines);
  if (visible.length === 0) {
    return { canBuildLink: false, direction: "mixed", amount: 0, currency: "USD" };
  }

  const directions = new Set(visible.map((line) => line.direction));
  const currencies = new Set(visible.map((line) => line.currency.toUpperCase()));
  const direction = directions.size === 1 ? visible[0].direction : "mixed";
  const currency = currencies.size === 1 ? visible[0].currency.toUpperCase() : visible[0].currency;
  const amount = visible.reduce((sum, line) => sum + Math.abs(line.amount), 0);

  return {
    canBuildLink: direction !== "mixed" && currencies.size === 1,
    direction,
    amount,
    currency,
  };
}

function formatUrlAmount(amount: number): string {
  return Math.abs(amount).toFixed(2);
}

function noteForLines(lines: SettleHandoffLine[], counterpartyName: string): string {
  const groups = Array.from(new Set(
    significantLines(lines)
      .map((line) => cleanText(line.groupName))
      .filter(Boolean),
  ));
  const suffix = groups.length > 0 ? groups.join(" + ") : cleanText(counterpartyName) || "settlement";
  return `SharedMoney ${suffix}`;
}

function payeeNameFor(
  lines: SettleHandoffLine[],
  counterpartyName: string,
  currentUserName?: string | null,
): string {
  const summary = paymentAmount(lines);
  if (summary.direction === "receive") {
    return cleanText(currentUserName) || "you";
  }
  return cleanText(counterpartyName) || "Someone";
}

function genericCopy(input: BuildSettleHandoffInput, note: string): string {
  const summary = paymentAmount(input.lines);
  if (summary.canBuildLink) {
    const payeeName = payeeNameFor(input.lines, input.counterpartyName, input.currentUserName);
    return `Pay ${payeeName} ${formatCurrency(summary.amount, summary.currency)}. ${note}.`;
  }

  const briefLines = significantLines(input.lines).slice(0, 3).map((line) => {
    const name = cleanText(line.counterpartyName) || cleanText(input.counterpartyName) || "Someone";
    const amount = formatCurrency(Math.abs(line.amount), line.currency);
    return line.direction === "pay" ? `You owe ${name} ${amount}` : `${name} owes you ${amount}`;
  });

  if (briefLines.length === 0) return `${note}.`;
  return `${briefLines.join("; ")}. ${note}.`;
}

function encodeParam(value: string): string {
  return encodeURIComponent(value);
}

function extractPaymentHandle(
  raw: string | null | undefined,
  provider: "venmo" | "cash-app" | "paypal",
): string | null {
  const trimmed = cleanText(raw);
  if (!trimmed) return null;

  let candidate = trimmed;
  if (/^https?:\/\//i.test(candidate)) {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      return null;
    }

    if (provider === "venmo" && parsed.host !== "venmo.com") return null;
    if (provider === "cash-app" && parsed.host !== "cash.app") return null;
    if (provider === "paypal" && parsed.host !== "paypal.me") return null;

    const parts = parsed.pathname.split("/").filter(Boolean);
    if (provider === "venmo") {
      candidate = parts[0] === "u" ? parts[1] ?? "" : parts[0] ?? "";
    } else {
      candidate = parts[0] ?? "";
    }
  }

  candidate = candidate.replace(/^[@$]+/, "").trim();
  if (!/^[A-Za-z0-9._-]+$/.test(candidate)) return null;
  return candidate;
}

function validUpiVpa(value?: string | null): string | null {
  const vpa = cleanText(value);
  if (!/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/.test(vpa)) return null;
  return vpa;
}

function buildUpiUrl(vpa: string, payeeName: string, amount: number, currency: string, note: string): string {
  return `upi://pay?pa=${encodeParam(vpa)}&pn=${encodeParam(payeeName)}&am=${formatUrlAmount(amount)}&cu=${encodeParam(currency.toUpperCase())}&tn=${encodeParam(note)}`;
}

function withAmountCopy(actions: SettleHandoffAction[], copyText: string): SettleHandoffAction[] {
  return [
    ...actions,
    { id: "amount", kind: "copy", label: "Copy amount", copyText },
  ];
}

export function buildSettleHandoffPack(input: BuildSettleHandoffInput): SettleHandoffPack {
  const details = input.details ?? {};
  const country = resolveSettleHandoffCountry({
    ...input.country,
    overrideCountryCode: details.countryOverride ?? input.country?.overrideCountryCode,
  });
  const note = noteForLines(input.lines, input.counterpartyName);
  const summary = paymentAmount(input.lines);
  const payeeName = payeeNameFor(input.lines, input.counterpartyName, input.currentUserName);
  const fallbackCopy = genericCopy(input, note);

  if (country.pack === "US") {
    const actions: SettleHandoffAction[] = [];
    const canOpen = summary.canBuildLink;

    if (canOpen) {
      const amount = formatUrlAmount(summary.amount);
      const venmo = extractPaymentHandle(details.venmoHandle, "venmo");
      const cashApp = extractPaymentHandle(details.cashAppCashtag, "cash-app");
      const paypal = extractPaymentHandle(details.paypalMe, "paypal");

      if (venmo) {
        actions.push({
          id: "venmo",
          kind: "open",
          label: "Open Venmo",
          url: `https://venmo.com/u/${encodeParam(venmo)}?txn=pay&amount=${amount}&note=${encodeParam(note)}`,
        });
      }
      if (cashApp) {
        actions.push({
          id: "cash-app",
          kind: "open",
          label: "Open Cash App",
          url: `https://cash.app/$${encodeParam(cashApp)}/${amount}`,
        });
      }
      if (paypal) {
        actions.push({
          id: "paypal",
          kind: "open",
          label: "Open PayPal",
          url: `https://paypal.me/${encodeParam(paypal)}/${amount}`,
        });
      }
    }

    const zelleCopy = `${fallbackCopy} For Zelle, open your bank app and use the recipient's Zelle details.`;
    actions.push({ id: "zelle", kind: "copy", label: "Copy Zelle", copyText: zelleCopy });

    return {
      ...country,
      copyText: fallbackCopy,
      shareUrl: actions.find((action) => action.kind === "open")?.url ?? null,
      actions: withAmountCopy(actions, fallbackCopy),
    };
  }

  if (country.pack === "IN") {
    const vpa = validUpiVpa(details.upiVpa);
    if (vpa && summary.canBuildLink) {
      const upiUrl = buildUpiUrl(vpa, payeeName, summary.amount, summary.currency, note);
      const copyText = `${vpa} ${formatCurrency(summary.amount, summary.currency)}. ${note}.`;
      return {
        ...country,
        copyText,
        shareUrl: upiUrl,
        actions: withAmountCopy([
          { id: "upi-open", kind: "open", label: "Open UPI", url: upiUrl },
          { id: "upi-copy", kind: "copy", label: "Copy UPI", copyText },
        ], fallbackCopy),
      };
    }

    return {
      ...country,
      copyText: fallbackCopy,
      shareUrl: null,
      actions: withAmountCopy([], fallbackCopy),
    };
  }

  if (country.pack === "EU") {
    const iban = cleanText(details.iban);
    const ibanName = cleanText(details.ibanName) || payeeName;
    const copyText = iban
      ? `IBAN ${iban}. Name ${ibanName}. ${summary.canBuildLink ? formatCurrency(summary.amount, summary.currency) : ""}. Reference ${note}.`.replace(/\s+\./g, ".")
      : fallbackCopy;

    return {
      ...country,
      copyText,
      shareUrl: null,
      actions: withAmountCopy(
        iban ? [{ id: "iban", kind: "copy", label: "Copy IBAN", copyText }] : [],
        fallbackCopy,
      ),
    };
  }

  if (country.pack === "BR") {
    const pixKey = cleanText(details.pixKey);
    const copyText = pixKey
      ? `Pix ${pixKey}. ${summary.canBuildLink ? formatCurrency(summary.amount, summary.currency) : ""}. ${note}.`.replace(/\s+\./g, ".")
      : fallbackCopy;

    return {
      ...country,
      copyText,
      shareUrl: null,
      actions: withAmountCopy(
        pixKey ? [{ id: "pix", kind: "copy", label: "Copy Pix", copyText }] : [],
        fallbackCopy,
      ),
    };
  }

  return {
    ...country,
    copyText: fallbackCopy,
    shareUrl: null,
    actions: withAmountCopy([], fallbackCopy),
  };
}
