import { getCountryByCode } from "./countryCodes";

export const DEFAULT_PHONE_COUNTRY_CODE = "IN";

export const PHONE_FORMAT_ERROR =
  "Enter a valid phone number with area code.";

const E164_REGEX = /^\+[1-9]\d{7,14}$/;

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function defaultDialCode(countryCode?: string | null): string {
  const normalizedCode = countryCode?.trim().toUpperCase() ||
    DEFAULT_PHONE_COUNTRY_CODE;
  return getCountryByCode(normalizedCode)?.dialCode ??
    getCountryByCode(DEFAULT_PHONE_COUNTRY_CODE)?.dialCode ??
    "+91";
}

export function isValidE164Phone(phone: string): boolean {
  return E164_REGEX.test(phone.trim());
}

export function normalizePhoneToE164(
  phone: string,
  countryCode?: string | null,
): string | null {
  const trimmed = phone.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("+")) {
    const normalized = `+${digitsOnly(trimmed)}`;
    return isValidE164Phone(normalized) ? normalized : null;
  }

  const nationalDigits = digitsOnly(trimmed).replace(/^0+/, "");
  if (!nationalDigits) return null;

  const normalized = `${defaultDialCode(countryCode)}${nationalDigits}`;
  return isValidE164Phone(normalized) ? normalized : null;
}

export function getOptionalPhoneFormatError(
  phone: string | null | undefined,
  countryCode?: string | null,
): string | null {
  if (phone === undefined || phone === null) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;
  return normalizePhoneToE164(trimmed, countryCode)
    ? null
    : PHONE_FORMAT_ERROR;
}
