/** Optional UPI VPA helpers for Profile + settle Pay via UPI. */

export const UPI_ID_MAX_LENGTH = 80;

/** Format hint only (no example VPA in the string). */
export const UPI_ID_FORMAT_ERROR = "Use name@handle.";

export const PAY_VIA_UPI_LABEL = "Pay via UPI";

export const UPI_ID_PROFILE_HELPER = "Group members can see this.";

export const YES_RECORD_IT_LABEL = "Yes, record it";

export const NOT_YET_LABEL = "Not yet";

export const COPY_UPI_ID_LABEL = "Copy UPI ID";

/** Shown for ~2s after copying a VPA on web/Android sheet Copy row. */
export const COPIED_UPI_LABEL = "✓ Copied";

/** Inline settle confirmation after iOS copy (zero apps or ActionSheet). */
export const UPI_ID_COPIED_LABEL = "UPI ID copied";

/** Soft cap for UPI `tn` (NPCI-friendly). */
export const UPI_NOTE_MAX_LENGTH = 50;

/**
 * Local part + handle, no spaces. Local: alnum with . _ - inside.
 * Handle: starts with a letter (okhdfc, ybl, paytm).
 */
const VPA_REGEX =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,62}[a-zA-Z0-9])?@[a-zA-Z][a-zA-Z0-9]{1,63}$/;

/** Trim, lowercase, validate. Empty input becomes null (clear). */
export function normalizeUpiId(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (/\s/.test(trimmed)) return null;
  if (trimmed.length > UPI_ID_MAX_LENGTH) return null;
  if (!VPA_REGEX.test(trimmed)) return null;
  return trimmed;
}

/** Null when empty or valid; otherwise actionable format copy. */
export function getOptionalUpiIdFormatError(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  if (!value.trim()) return null;
  return normalizeUpiId(value) ? null : UPI_ID_FORMAT_ERROR;
}

/** `SharedMoney · {group}` truncated to about 50 characters. */
export function buildUpiPayNote(groupName: string): string {
  const group = groupName.trim() || "group";
  const prefix = "SharedMoney · ";
  const budget = UPI_NOTE_MAX_LENGTH - prefix.length;
  if (budget <= 0) return "SharedMoney".slice(0, UPI_NOTE_MAX_LENGTH);
  if (group.length <= budget) return `${prefix}${group}`;
  if (budget <= 1) return `${prefix}${group.slice(0, budget)}`;
  return `${prefix}${group.slice(0, Math.max(0, budget - 3))}...`;
}

export type UpiPayUriInput = {
  vpa: string;
  payeeName: string;
  amount: number;
  groupName: string;
};

/** Shared query string for `upi://` and per-app pay deep links. */
export function buildUpiPayQuery(input: UpiPayUriInput): string {
  const vpa = normalizeUpiId(input.vpa);
  if (!vpa) {
    throw new Error(UPI_ID_FORMAT_ERROR);
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Amount must be greater than 0");
  }
  const payeeName = input.payeeName.trim() || "SharedMoney";
  const amount = input.amount.toFixed(2);
  const note = buildUpiPayNote(input.groupName);
  return [
    `pa=${encodeURIComponent(vpa)}`,
    `pn=${encodeURIComponent(payeeName)}`,
    `am=${encodeURIComponent(amount)}`,
    "cu=INR",
    `tn=${encodeURIComponent(note)}`,
  ].join("&");
}

/**
 * Builds `upi://pay?pa=&pn=&am=&cu=INR&tn=` with every value URL-encoded.
 * `am` is always two decimal places. SharedMoney does not move money.
 */
export function buildUpiPayUri(input: UpiPayUriInput): string {
  return `upi://pay?${buildUpiPayQuery(input)}`;
}

export type UpiAppId = "gpay" | "phonepe" | "paytm" | "bhim";

export type UpiAppDefinition = {
  id: UpiAppId;
  label: string;
  /** Scheme used for `canOpenURL` / LSApplicationQueriesSchemes. */
  scheme: string;
  /** Base URL before `?pa=…` (no trailing `?`). */
  payBase: string;
};

/** Installed-app picker targets (iOS has no generic upi:// chooser). */
export const UPI_APPS: readonly UpiAppDefinition[] = [
  { id: "gpay", label: "GPay", scheme: "tez", payBase: "tez://upi/pay" },
  {
    id: "phonepe",
    label: "PhonePe",
    scheme: "phonepe",
    payBase: "phonepe://pay",
  },
  {
    id: "paytm",
    label: "Paytm",
    scheme: "paytmmp",
    payBase: "paytmmp://pay",
  },
  { id: "bhim", label: "BHIM", scheme: "bhim", payBase: "bhim://upi/pay" },
] as const;

/** Schemes to declare for canOpenURL (plus WhatsApp for settle remind). */
export const UPI_QUERY_SCHEMES: readonly string[] = [
  ...UPI_APPS.map((app) => app.scheme),
  "gpay",
  "whatsapp",
];

export function buildUpiAppPayUri(
  app: UpiAppDefinition,
  input: UpiPayUriInput,
): string {
  return `${app.payBase}?${buildUpiPayQuery(input)}`;
}

/** True when a upi:// deep link is likely to open (native or mobile web). */
export function canUseUpiDeepLink(
  platform: string,
  userAgent?: string | null,
): boolean {
  if (platform !== "web") return true;
  const ua = userAgent ?? "";
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

/** Desktop / non-mobile web: show VPA + Copy (+ QR), not deep links. */
export function isDesktopWebUpiSurface(
  platform: string,
  userAgent?: string | null,
): boolean {
  return platform === "web" && !canUseUpiDeepLink(platform, userAgent);
}

/** iOS needs an explicit app picker; Android can use system upi://. */
export function needsUpiAppPicker(platform: string): boolean {
  return platform === "ios";
}

export function formatPayeeUpiLine(name: string, upiId: string): string {
  const display = name.trim() || "them";
  return `To ${display} · ${upiId}`;
}

export function formatDidYouPayQuestion(
  name: string,
  amountLabel: string,
): string {
  const display = name.trim() || "them";
  return `Did you pay ${display} ${amountLabel}?`;
}
