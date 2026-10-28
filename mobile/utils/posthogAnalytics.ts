import AsyncStorage from "@react-native-async-storage/async-storage";
import PostHog from "posthog-react-native";
import { Platform } from "react-native";
import { resolvePostHogEnvConfig } from "./posthogConfig";
import { ANALYTICS_EVENTS } from "./posthogEvents";
import {
  analyticsPersonPropertiesKey,
  buildAnalyticsPersonProperties,
  isSeedAuthUserId,
  type AnalyticsPersonProperties,
} from "./posthogIdentity";

type AnalyticsProperties = Record<
  string,
  string | number | boolean | null | undefined
>;

let client: PostHog | null = null;
let identifiedUserId: string | null = null;
let identifiedPersonKey: string | null = null;
let appOpenCaptured = false;
/** When a local seed/E2E auth user is signed in, drop all product captures. */
let suppressCaptureForSeedUser = false;

function sanitizeProperties(
  properties?: AnalyticsProperties,
): Record<string, string | number | boolean | null> | undefined {
  if (!properties) return undefined;

  const cleaned: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

/**
 * Initialize PostHog once at startup when EXPO_PUBLIC_POSTHOG_KEY is set.
 * No-ops safely when the key is missing (mirrors Sentry DSN gating).
 */
export function initializePostHog(): boolean {
  const config = resolvePostHogEnvConfig();

  if (!config.enabled || !config.key) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn(
        "[PostHog] EXPO_PUBLIC_POSTHOG_KEY is not set; PostHog will not be initialized.",
      );
    }
    return false;
  }

  if (client) {
    return true;
  }

  client = new PostHog(config.key, {
    host: config.host,
    // Lifecycle Application Opened / Backgrounded; we also emit mobile_app_opened.
    captureAppLifecycleEvents: true,
    enableSessionReplay: false,
    // Avoid expo-file-system legacy write deprecations on Expo SDK 54.
    customStorage: AsyncStorage,
  });

  if (!appOpenCaptured) {
    client.capture(ANALYTICS_EVENTS.MOBILE_APP_OPENED, {
      platform: Platform.OS,
    });
    appOpenCaptured = true;
  }

  return true;
}

export function isPostHogInitialized(): boolean {
  return client !== null;
}

export function captureAnalyticsEvent(
  event: string,
  properties?: AnalyticsProperties,
): void {
  if (!client || suppressCaptureForSeedUser) return;
  client.capture(event, sanitizeProperties(properties));
}

/**
 * Capture a product/activation event only after the signed-in auth user is the
 * PostHog distinct_id. Skips seed/E2E identities and unsigned-in callers so
 * funnels are not polluted by anonymous or placeholder ids.
 */
export function captureIdentifiedAnalyticsEvent(
  userId: string | null | undefined,
  event: string,
  properties?: AnalyticsProperties,
  person?: AnalyticsPersonProperties,
): void {
  if (!client || !userId) return;
  if (isSeedAuthUserId(userId)) return;

  if (identifiedUserId !== userId) {
    identifyAnalyticsUser(userId, person);
  }

  // identifyAnalyticsUser no-ops for seed users; refuse capture if identity
  // still does not match the signed-in auth user.
  if (identifiedUserId !== userId) return;

  captureAnalyticsEvent(event, properties);
}

export function captureScreenView(screen: string): void {
  if (!client || !screen) return;
  captureAnalyticsEvent(ANALYTICS_EVENTS.MOBILE_SCREEN_VIEWED, {
    screen,
    platform: Platform.OS,
  });
}

/**
 * Identify with the Supabase auth user id and set searchable person props
 * (email/name) so support can find users in PostHog persons search / HogQL.
 *
 * Local seed UUIDs from supabase/seed.sql are never identified — Maestro and
 * local release builds often share the Production PostHog key.
 */
export function identifyAnalyticsUser(
  userId: string,
  person?: AnalyticsPersonProperties,
): void {
  if (!client || !userId) return;

  if (isSeedAuthUserId(userId)) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn(
        "[PostHog] Skipping identify for local seed auth user id; " +
          "seed identities must not appear in SharedMoney Production.",
      );
    }
    return;
  }

  const personProperties = buildAnalyticsPersonProperties(person);
  const nextPersonKey = analyticsPersonPropertiesKey(personProperties);
  if (
    identifiedUserId === userId &&
    identifiedPersonKey === nextPersonKey
  ) {
    return;
  }

  // RN SDK: second arg is person properties ($set), e.g. { email, name }.
  if (personProperties) {
    client.identify(userId, personProperties);
  } else {
    client.identify(userId);
  }
  identifiedUserId = userId;
  identifiedPersonKey = nextPersonKey;
  suppressCaptureForSeedUser = false;
}

export function resetAnalyticsUser(): void {
  if (!client) return;
  client.reset();
  identifiedUserId = null;
  identifiedPersonKey = null;
}

/**
 * Keep PostHog identity aligned with auth. Fires auth_succeeded only when the
 * distinct user id changes (not on token refresh).
 */
export function syncAnalyticsAuth(
  userId: string | null,
  properties?: {
    auth_provider?: string;
    email?: string;
    name?: string;
  },
): void {
  if (!client) return;

  if (userId) {
    // Never attach seed/E2E identities to Production analytics — and do not
    // leave product events on the anonymous distinct_id either.
    if (isSeedAuthUserId(userId)) {
      suppressCaptureForSeedUser = true;
      if (identifiedUserId) {
        resetAnalyticsUser();
      }
      return;
    }

    suppressCaptureForSeedUser = false;
    const isNewIdentity = identifiedUserId !== userId;
    identifyAnalyticsUser(userId, {
      email: properties?.email,
      name: properties?.name,
    });
    if (isNewIdentity) {
      captureAnalyticsEvent(ANALYTICS_EVENTS.AUTH_SUCCEEDED, {
        auth_provider: properties?.auth_provider || "unknown",
        platform: Platform.OS,
      });
    }
    return;
  }

  suppressCaptureForSeedUser = false;
  if (identifiedUserId) {
    resetAnalyticsUser();
  }
}
