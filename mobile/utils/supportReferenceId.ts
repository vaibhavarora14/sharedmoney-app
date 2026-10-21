/**
 * Support reference IDs shown on repeat crash screens.
 *
 * Format: `SM-XXXX-XX` using 6 Crockford-style base32 characters, excluding
 * ambiguous glyphs 0/O/1/I/L so agents can read them over the phone.
 */

/**
 * Crockford base32 without ambiguous glyphs 0/O/1/I/L (also drops U, per Crockford).
 * Length 30 — use modulo alphabet length when sampling.
 */
export const SUPPORT_REFERENCE_ALPHABET =
  "23456789ABCDEFGHJKMNPQRSTVWXYZ";

const SUPPORT_REFERENCE_PATTERN =
  /^SM-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{2}$/;

function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const cryptoObj = typeof globalThis !== "undefined"
    ? (globalThis as { crypto?: Crypto }).crypto
    : undefined;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
    return bytes;
  }
  for (let i = 0; i < length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/** Format six alphabet chars as `SM-XXXX-XX`. */
export function formatSupportReferenceId(chars: string): string {
  const normalized = chars.trim().toUpperCase();
  if (normalized.length !== 6) {
    throw new Error("support reference id requires exactly 6 characters");
  }
  for (const char of normalized) {
    if (!SUPPORT_REFERENCE_ALPHABET.includes(char)) {
      throw new Error(`invalid support reference character: ${char}`);
    }
  }
  return `SM-${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

export function isValidSupportReferenceId(id: string): boolean {
  return SUPPORT_REFERENCE_PATTERN.test(id.trim().toUpperCase());
}

/**
 * Generate a new support reference ID.
 * Pass `randomBytes` in tests for determinism (needs length >= 6).
 */
export function generateSupportReferenceId(
  randomBytes?: Uint8Array,
): string {
  const bytes = randomBytes && randomBytes.length >= 6
    ? randomBytes
    : getRandomBytes(6);
  const radix = SUPPORT_REFERENCE_ALPHABET.length;
  let chars = "";
  for (let i = 0; i < 6; i++) {
    chars += SUPPORT_REFERENCE_ALPHABET[bytes[i]! % radix];
  }
  return formatSupportReferenceId(chars);
}
