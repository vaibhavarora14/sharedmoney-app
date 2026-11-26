import * as Sentry from "@sentry/react-native";
import { publishSentryRoute } from "./sentryTracingPolicy";

/**
 * Custom-router navigation transaction. SharedMoney does not use React
 * Navigation, so `reactNavigationIntegration` cannot attach here.
 */
export function recordSentryRouteNavigation(route: string): void {
  try {
    Sentry.startIdleNavigationSpan({
      name: route,
      op: "navigation",
      attributes: {
        "route.name": route,
      },
    });
  } catch {
    // Telemetry must never break navigation.
  }
  publishSentryRoute(route);
}

export {
  getPublishedSentryRoute,
  resolveSentryTracePropagationTargets,
  resolveSentryTracesSampleRate,
  scrubSentryBreadcrumb,
  scrubSentryErrorEvent,
  scrubSentryTransaction,
  shouldCreateSentryHttpSpan,
  subscribeSentryRoute,
} from "./sentryTracingPolicy";
