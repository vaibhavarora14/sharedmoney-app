import { isValidDate, isValidUUID } from './validation.ts';

export type ClientRequestIdResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string };

/** A missing key is fine. A present key must be a UUID so retries can find the row. */
export function parseClientRequestId(value: unknown): ClientRequestIdResult {
  if (value == null || value === '') return { ok: true, id: null };
  if (typeof value !== 'string' || !isValidUUID(value)) {
    return { ok: false, error: 'client_request_id must be a UUID' };
  }
  return { ok: true, id: value };
}

/**
 * Quick settle dates are today or earlier in the user's calendar.
 * Allow the next UTC day so a local "today" is not rejected near midnight.
 */
export function isoDateWithinHorizon(date: string, now = new Date()): boolean {
  if (!isValidDate(date)) return false;
  const latest = new Date(now.getTime() + 36 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return date <= latest;
}

export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { code?: unknown }).code === '23505';
}
