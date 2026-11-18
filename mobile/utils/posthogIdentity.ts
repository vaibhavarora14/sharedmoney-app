/**
 * Pure PostHog identity helpers (no RN / SDK imports) so Deno unit tests can
 * cover seed-user gating and person-property shaping.
 */

/** Fixed auth.users ids from supabase/seed.sql (Maestro / local E2E). */
export const SEED_AUTH_USER_IDS = new Set([
  "11111111-1111-1111-1111-111111111111", // alice@test.com
  "22222222-2222-2222-2222-222222222222", // bob@test.com
  "33333333-3333-3333-3333-333333333333", // charlie@test.com
  "44444444-4444-4444-4444-444444444444", // diana@test.com
]);

export type AnalyticsPersonProperties = {
  email?: string;
  name?: string;
  /** True while the Supabase user is anonymous. False after they link or merge. */
  is_guest?: boolean;
};

/**
 * Local seed identities must never become PostHog distinct_ids when a build
 * points at SharedMoney Production (common for Maestro release builds).
 */
export function isSeedAuthUserId(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return SEED_AUTH_USER_IDS.has(userId);
}

/** Trim and drop empty person props before identify(). */
export function buildAnalyticsPersonProperties(
  input?: AnalyticsPersonProperties | null,
): AnalyticsPersonProperties | undefined {
  if (!input) return undefined;

  const props: AnalyticsPersonProperties = {};
  const email = input.email?.trim();
  const name = input.name?.trim();
  if (email) props.email = email;
  if (name) props.name = name;
  if (input.is_guest === true || input.is_guest === false) {
    props.is_guest = input.is_guest;
  }

  return Object.keys(props).length > 0 ? props : undefined;
}

/** Stable key so we re-identify when email/name appear after the first call. */
export function analyticsPersonPropertiesKey(
  props?: AnalyticsPersonProperties | null,
): string {
  if (!props) return "";
  const guest = props.is_guest === true ? "1" : props.is_guest === false ? "0" : "";
  return `email=${props.email ?? ""}|name=${props.name ?? ""}|guest=${guest}`;
}

/**
 * Resolve a display name from Supabase auth user_metadata without inventing
 * values when the provider left the fields empty.
 */
export function resolveAuthDisplayName(
  userMetadata: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!userMetadata) return undefined;

  for (const key of ["full_name", "name"] as const) {
    const value = userMetadata[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  const given =
    typeof userMetadata.given_name === "string"
      ? userMetadata.given_name.trim()
      : "";
  const family =
    typeof userMetadata.family_name === "string"
      ? userMetadata.family_name.trim()
      : "";
  const combined = `${given} ${family}`.trim();
  return combined || undefined;
}
