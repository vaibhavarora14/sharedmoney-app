/** Default US Cloud ingest host for SharedMoney Production. */
export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

export type PostHogEnvInput = {
  EXPO_PUBLIC_POSTHOG_KEY?: string;
  EXPO_PUBLIC_POSTHOG_HOST?: string;
};

export type PostHogEnvConfig = {
  key: string | null;
  host: string;
  enabled: boolean;
};

/**
 * Resolve PostHog env for the mobile client.
 * Analytics stay disabled when EXPO_PUBLIC_POSTHOG_KEY is unset (same pattern as Sentry DSN).
 *
 * When `env` is omitted, read `process.env.EXPO_PUBLIC_…` via direct member
 * access so Expo/Metro can inline the values. Prefer passing an explicit bag
 * only in tests.
 */
export function resolvePostHogEnvConfig(
  env?: PostHogEnvInput,
): PostHogEnvConfig {
  const key = (
    env
      ? env.EXPO_PUBLIC_POSTHOG_KEY
      : process.env.EXPO_PUBLIC_POSTHOG_KEY
  )?.trim() || null;
  const host = (
    env
      ? env.EXPO_PUBLIC_POSTHOG_HOST
      : process.env.EXPO_PUBLIC_POSTHOG_HOST
  )?.trim() || DEFAULT_POSTHOG_HOST;
  return {
    key,
    host,
    enabled: Boolean(key),
  };
}

export function isPostHogConfigured(env?: PostHogEnvInput): boolean {
  return resolvePostHogEnvConfig(env).enabled;
}
