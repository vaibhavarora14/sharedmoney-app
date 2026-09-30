/**
 * Practical email format checks for invite / add-person flows.
 * Mirrors supabase/functions/_shared/validation.ts — keep both in sync.
 */

/** Actionable copy when an invite/add email fails format checks. */
export const EMAIL_FORMAT_ERROR =
  "Enter a valid email like name@example.com.";

/**
 * Rejects clearly invalid addresses without over-restricting uncommon-but-legal TLDs.
 * Empty / whitespace-only values are invalid here; callers that treat email as
 * optional should skip this when the field is blank.
 */
export function isValidEmail(email: string): boolean {
  if (typeof email !== "string") return false;
  const value = email.trim();
  if (!value || value.length > 254) return false;
  if (value.includes("..")) return false;

  const at = value.lastIndexOf("@");
  if (at <= 0 || at !== value.indexOf("@")) return false;

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (!local || local.length > 64) return false;
  if (local.startsWith(".") || local.endsWith(".")) return false;
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return false;

  const labels = domain.split(".");
  if (labels.length < 2) return false;
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (!label || label.length > 63) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
    if (!/^[A-Za-z0-9-]+$/.test(label)) return false;
    // Public TLDs are at least 2 characters; do not invent a fixed allow-list.
    if (i === labels.length - 1 && label.length < 2) return false;
  }

  return true;
}

/**
 * Returns actionable inline error copy when `email` is non-empty but invalid.
 * Blank email is allowed for name-only add-person paths.
 */
export function getOptionalEmailFormatError(
  email: string | null | undefined,
): string | null {
  if (email === undefined || email === null) return null;
  const trimmed = email.trim();
  if (!trimmed) return null;
  return isValidEmail(trimmed) ? null : EMAIL_FORMAT_ERROR;
}
