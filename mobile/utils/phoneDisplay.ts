/**
 * Display formatting for E.164 phone numbers on WhatsApp OTP screens.
 */

const KNOWN_DIAL_CODES = [
  "971",
  "966",
  "358",
  "353",
  "351",
  "61",
  "64",
  "65",
  "81",
  "82",
  "84",
  "86",
  "90",
  "91",
  "92",
  "93",
  "94",
  "95",
  "98",
  "20",
  "27",
  "30",
  "31",
  "32",
  "33",
  "34",
  "36",
  "39",
  "40",
  "41",
  "43",
  "44",
  "45",
  "46",
  "47",
  "48",
  "49",
  "51",
  "52",
  "53",
  "54",
  "55",
  "56",
  "57",
  "58",
  "60",
  "62",
  "63",
  "66",
  "7",
  "1",
].sort((a, b) => b.length - a.length);

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function groupNational(national: string, dialCode: string): string {
  // India mobiles: +91 98765 43210
  if (dialCode === "91" && national.length === 10) {
    return `${national.slice(0, 5)} ${national.slice(5)}`;
  }
  // NANP: +1 415 555 2671
  if (dialCode === "1" && national.length === 10) {
    return `${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
  }
  // UK-ish 10–11 digit national: groups of 4 then remainder
  if (national.length >= 8) {
    const parts: string[] = [];
    let i = 0;
    while (i < national.length) {
      const size = national.length - i > 4 ? 4 : national.length - i;
      parts.push(national.slice(i, i + size));
      i += size;
    }
    return parts.join(" ");
  }
  return national;
}

/**
 * Formats national digits as the user types (spaces only; no dial code).
 * India: "98765 43210". NANP: "415 555 2671".
 */
export function formatNationalAsYouType(
  nationalInput: string,
  dialCode: string,
): string {
  const digits = digitsOnly(nationalInput);
  const code = dialCode.replace(/\D/g, "");

  if (code === "91") {
    if (digits.length <= 5) return digits;
    return `${digits.slice(0, 5)} ${digits.slice(5, 10)}`;
  }

  if (code === "1") {
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) {
      return `${digits.slice(0, 3)} ${digits.slice(3)}`;
    }
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 10)}`;
  }

  if (digits.length <= 4) return digits;
  const parts: string[] = [];
  let i = 0;
  while (i < digits.length) {
    const size = digits.length - i > 4 ? 4 : digits.length - i;
    parts.push(digits.slice(i, i + size));
    i += size;
  }
  return parts.join(" ");
}

/**
 * Formats an E.164 number for UI copy, e.g. '+91 98765 43210'.
 * Returns the trimmed input when it is not a usable E.164 string.
 */
export function formatE164ForDisplay(phoneE164: string): string {
  const trimmed = phoneE164.trim();
  if (!trimmed.startsWith("+")) return trimmed;

  const digits = digitsOnly(trimmed);
  if (digits.length < 8) return trimmed;

  const dialCode = KNOWN_DIAL_CODES.find((code) => digits.startsWith(code));
  if (!dialCode) {
    return `+${digits}`;
  }

  const national = digits.slice(dialCode.length);
  if (!national) return `+${dialCode}`;

  return `+${dialCode} ${groupNational(national, dialCode)}`;
}

/** Matches edge OTP_RESEND_COOLDOWN_MS (60s). */
export const WHATSAPP_OTP_RESEND_COOLDOWN_SECONDS = 60;

/** e.g. 30 → "0:30", 600 → "10:00" */
export function formatMmSs(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** e.g. 30 → "Resend in 0:30", 60 → "Resend in 1:00" */
export function formatResendCountdown(seconds: number): string {
  return `Resend in ${formatMmSs(seconds)}`;
}

/** e.g. 600 → "Try again in 10:00" */
export function formatTryAgainCountdown(seconds: number): string {
  return `Try again in ${formatMmSs(seconds)}`;
}

/** User-facing copy when WhatsApp delivery fails (no Meta/test-recipient wording). */
export const WHATSAPP_SEND_FAILED_USER_MESSAGE =
  "We couldn't send a code to this number. Check it's on WhatsApp, or use another sign-in method.";

export const WHATSAPP_SEND_FAILED_LINK_LABEL = "use another sign-in method";

/** Dev/preview-only hint — never show in production user copy. */
export const WHATSAPP_SEND_FAILED_DEV_HINT =
  "Confirm the number is a Meta allowlisted test recipient and (for text delivery) has opened the 24h window.";
