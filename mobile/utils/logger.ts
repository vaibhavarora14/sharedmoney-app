import * as Sentry from "@sentry/react-native";

type LogLevel = "debug" | "info" | "warn" | "error";

export function log(
  message: string,
  data?: any,
  level: LogLevel = "info"
) {
  try {
    if (__DEV__) {
      // Keep console output in dev for easy debugging
      // eslint-disable-next-line no-console
      console.log(message, data || "");
    }

    // Always send lightweight breadcrumbs to Sentry (dev + prod)
    Sentry.addBreadcrumb({
      level: level === "warn" ? "warning" : (level as Exclude<LogLevel, "warn">),
      category: "app-log",
      message,
      data,
    });
  } catch (err) {
    // Never let telemetry failures break the app. In dev, surface a warning.
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn("Failed to log breadcrumb to Sentry:", err);
    }
  }
}

export function logError(
  error: unknown,
  context?: Record<string, any>
) {
  const err =
    error instanceof Error ? error : new Error(String(error ?? "Unknown error"));

  try {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error(err, context || "");
    }

    const tags =
      context?.tags && typeof context.tags === "object"
        ? (context.tags as Record<string, string>)
        : undefined;
    const { tags: _tags, ...extra } = context ?? {};

    Sentry.captureException(err, {
      extra,
      ...(tags ? { tags } : {}),
    });
  } catch (captureErr) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn("Failed to capture exception in Sentry:", captureErr);
    }
  }
}

