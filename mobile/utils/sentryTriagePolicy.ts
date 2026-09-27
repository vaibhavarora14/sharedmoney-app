export type AuthSessionTransition = "signed_in" | "signed_out" | "session_refresh";

export function resolveAuthSessionTransition(
  previousUserId: string | null | undefined,
  nextUserId: string | null | undefined,
): AuthSessionTransition | null {
  const hadUser = Boolean(previousUserId);
  const hasUser = Boolean(nextUserId);
  if (!hadUser && hasUser) return "signed_in";
  if (hadUser && !hasUser) return "signed_out";
  if (hadUser && hasUser && previousUserId === nextUserId) return "session_refresh";
  if (hadUser && hasUser && previousUserId !== nextUserId) {
    // Treat user swaps as a fresh sign-in for triage (logout crumb may be skipped).
    return "signed_in";
  }
  return null;
}

/**
 * Default mobile replay sample rates: keep error sessions useful, lower
 * always-on sampling to reduce iOS RAM / quota pressure.
 */
export function resolveSentryReplaySampleRates(input: {
  platform: string;
  env?: Record<string, string | undefined>;
}) {
  const env = input.env ?? {};
  const sessionDefault = input.platform === "ios" ? "0.02" : "0.05";
  return {
    replaysSessionSampleRate: Number(
      env.EXPO_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE ?? sessionDefault,
    ),
    replaysOnErrorSampleRate: Number(
      env.EXPO_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE ?? "1.0",
    ),
  };
}
