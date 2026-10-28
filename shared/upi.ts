/** Optional UPI VPA helpers for Profile + settle Pay via UPI. */

export const UPI_ID_MAX_LENGTH = 80;

export const UPI_ID_FORMAT_ERROR = "Enter a UPI ID like name@okhdfc.";

export const PAY_VIA_UPI_LABEL = "Pay via UPI";

export const UPI_ID_PROFILE_HELPER =
  "Group members can see this so they can pay you.";

export const UPI_ID_PLACEHOLDER = "name@okhdfc";

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

export type UpiPayUriInput = {
  vpa: string;
  payeeName: string;
  amount: number;
  groupName: string;
};

/**
 * Builds `upi://pay?pa=&pn=&am=&cu=INR&tn=` with every value URL-encoded.
 * `am` is always two decimal places. SharedMoney does not move money.
 */
export function buildUpiPayUri(input: UpiPayUriInput): string {
  const vpa = normalizeUpiId(input.vpa);
  if (!vpa) {
    throw new Error(UPI_ID_FORMAT_ERROR);
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Amount must be greater than 0");
  }
  const payeeName = input.payeeName.trim() || "SharedMoney";
  const groupName = input.groupName.trim() || "group";
  const amount = input.amount.toFixed(2);
  const note = `SharedMoney: ${groupName}`;
  const query = [
    `pa=${encodeURIComponent(vpa)}`,
    `pn=${encodeURIComponent(payeeName)}`,
    `am=${encodeURIComponent(amount)}`,
    "cu=INR",
    `tn=${encodeURIComponent(note)}`,
  ].join("&");
  return `upi://pay?${query}`;
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

export function askAddUpiIdHint(firstName: string): string {
  const name = firstName.trim() || "them";
  return `Ask ${name} to add a UPI ID`;
}
