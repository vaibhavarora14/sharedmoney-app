/**
 * Validates UUID format
 */
export function isValidUUID(uuid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
}

/** Actionable copy when an invite/add email fails format checks. */
export const EMAIL_FORMAT_ERROR =
  "Enter a valid email like name@example.com.";

export const DEFAULT_PHONE_COUNTRY_CODE = "IN";

export const PHONE_FORMAT_ERROR =
  "Enter a valid phone number with area code.";

const E164_REGEX = /^\+[1-9]\d{7,14}$/;

const COUNTRY_DIAL_CODES: Record<string, string> = {
  US: "+1",
  IN: "+91",
  GB: "+44",
  CA: "+1",
  AU: "+61",
  DE: "+49",
  FR: "+33",
  IT: "+39",
  ES: "+34",
  BR: "+55",
  MX: "+52",
  JP: "+81",
  CN: "+86",
  KR: "+82",
  SG: "+65",
  AE: "+971",
  SA: "+966",
  ZA: "+27",
  NZ: "+64",
};

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function defaultDialCode(countryCode?: string | null): string {
  const normalized = countryCode?.trim().toUpperCase() ||
    DEFAULT_PHONE_COUNTRY_CODE;
  return COUNTRY_DIAL_CODES[normalized] ??
    COUNTRY_DIAL_CODES[DEFAULT_PHONE_COUNTRY_CODE];
}

/**
 * Practical email format check for invites and member emails.
 * Rejects clearly invalid addresses without over-restricting uncommon-but-legal TLDs.
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

/**
 * Validates date format (YYYY-MM-DD)
 */
export function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

/**
 * Validates transaction data
 */
export interface TransactionValidationResult {
  valid: boolean;
  error?: string;
}

export function validateTransactionData(data: {
  amount?: number;
  description?: string;
  date?: string;
  type?: 'income' | 'expense';
  group_id?: string;
  currency?: string;
}): TransactionValidationResult {
  if (data.amount !== undefined) {
    if (typeof data.amount !== 'number' || isNaN(data.amount) || data.amount <= 0) {
      return { valid: false, error: 'Amount must be a positive number' };
    }
    if (data.amount > 1000000) {
      return { valid: false, error: 'Amount exceeds maximum limit (1,000,000)' };
    }
  }

  if (data.description !== undefined) {
    if (typeof data.description !== 'string') {
      return { valid: false, error: 'Description must be a string' };
    }
    if (data.description.length === 0) {
      return { valid: false, error: 'Description cannot be empty' };
    }
    if (data.description.length > 1000) {
      return { valid: false, error: 'Description too long (max 1000 characters)' };
    }
  }

  if (data.date !== undefined) {
    if (!isValidDate(data.date)) {
      return { valid: false, error: 'Invalid date format (expected YYYY-MM-DD)' };
    }
  }

  if (data.type !== undefined) {
    if (data.type !== 'income' && data.type !== 'expense') {
      return { valid: false, error: 'Type must be either "income" or "expense"' };
    }
  }

  if (data.group_id !== undefined && data.group_id !== null) {
    if (!isValidUUID(data.group_id)) {
      return { valid: false, error: 'Invalid group_id format. Expected UUID.' };
    }
  }

  if (data.currency !== undefined && data.currency !== null) {
    if (typeof data.currency !== 'string' || data.currency.length !== 3) {
      return { valid: false, error: 'Currency must be a 3-character code (e.g., USD)' };
    }
  }

  return { valid: true };
}

/**
 * Validates group data
 */
export function validateGroupData(data: {
  name?: string;
  description?: string | null;
}): TransactionValidationResult {
  if (data.name !== undefined) {
    if (typeof data.name !== 'string') {
      return { valid: false, error: 'Name must be a string' };
    }
    const trimmed = data.name.trim();
    if (trimmed.length === 0) {
      return { valid: false, error: 'Name cannot be empty' };
    }
    if (trimmed.length > 255) {
      return { valid: false, error: 'Name too long (max 255 characters)' };
    }
  }

  if (data.description !== undefined && data.description !== null) {
    if (typeof data.description !== 'string') {
      return { valid: false, error: 'Description must be a string' };
    }
    if (data.description.length > 5000) {
      return { valid: false, error: 'Description too long (max 5000 characters)' };
    }
  }

  return { valid: true };
}

/**
 * Validates settlement data
 */
export function validateSettlementData(data: {
  group_id?: string;
  from_participant_id?: string;
  to_participant_id?: string;
  amount?: number;
  currency?: string;
}): TransactionValidationResult {
  if (data.group_id !== undefined && !isValidUUID(data.group_id)) {
    return { valid: false, error: 'Invalid group_id format. Expected UUID.' };
  }

  if (data.from_participant_id !== undefined && !isValidUUID(data.from_participant_id)) {
    return { valid: false, error: 'Invalid from_participant_id format. Expected UUID.' };
  }

  if (data.to_participant_id !== undefined && !isValidUUID(data.to_participant_id)) {
    return { valid: false, error: 'Invalid to_participant_id format. Expected UUID.' };
  }

  if (data.amount !== undefined) {
    if (typeof data.amount !== 'number' || isNaN(data.amount) || data.amount <= 0) {
      return { valid: false, error: 'Amount must be a positive number' };
    }
    if (data.amount > 1000000) {
      return { valid: false, error: 'Amount exceeds maximum limit (1,000,000)' };
    }
  }

  if (data.currency !== undefined && data.currency !== null) {
    if (typeof data.currency !== 'string' || data.currency.length !== 3) {
      return { valid: false, error: 'Currency must be a 3-character code (e.g., USD)' };
    }
  }

  return { valid: true };
}

/**
 * Validates request body size
 */
export function validateBodySize(body: string | null, maxSize: number = 1024 * 1024): TransactionValidationResult {
  if (!body) {
    return { valid: true };
  }
  
  if (body.length > maxSize) {
    return { valid: false, error: `Request body too large (max ${maxSize} bytes)` };
  }

  return { valid: true };
}
