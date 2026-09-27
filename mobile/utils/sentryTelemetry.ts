import * as Sentry from "@sentry/react-native";
import * as Device from "expo-device";
import { AppStateStatus, Platform } from "react-native";
import type { AuthSessionTransition } from "./sentryTriagePolicy";

export type SentryListCountKind =
  | "ledger"
  | "activity"
  | "groups";

type BreadcrumbLevel = "fatal" | "error" | "warning" | "log" | "info" | "debug";

function safeSetTag(key: string, value: string) {
  try {
    Sentry.setTag(key, value);
  } catch {
    // Telemetry must never break the app.
  }
}

function safeBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
  level: BreadcrumbLevel = "info",
) {
  try {
    Sentry.addBreadcrumb({
      category,
      message,
      level,
      data,
    });
  } catch {
    // Telemetry must never break the app.
  }
}

/**
 * Attach stable device / OS / total-memory triage fields.
 *
 * WatchdogTermination events often omit volatile native contexts (free memory,
 * battery, orientation). Tags + a dedicated context still help on the reporting
 * launch and on any event that carries the current scope. Breadcrumbs are also
 * written because Cocoa persists them for the next-launch watchdog report.
 */
export function applySentryDeviceTriageContext() {
  const model =
    Device.modelName ||
    Device.modelId ||
    Device.deviceName ||
    "unknown";
  const osName = Device.osName || Platform.OS;
  const osVersion = Device.osVersion ? String(Device.osVersion) : "unknown";
  const totalMemory = Device.totalMemory;
  const totalMemoryMb =
    typeof totalMemory === "number" && Number.isFinite(totalMemory)
      ? Math.round(totalMemory / (1024 * 1024))
      : null;

  safeSetTag("device_model", model);
  safeSetTag("os_name", osName);
  safeSetTag("os_version", osVersion);
  if (totalMemoryMb != null) {
    safeSetTag("device_total_memory_mb", String(totalMemoryMb));
  }

  try {
    Sentry.setContext("device_triage", {
      model,
      brand: Device.brand ?? undefined,
      manufacturer: Device.manufacturer ?? undefined,
      os_name: osName,
      os_version: osVersion,
      total_memory_bytes: totalMemory ?? undefined,
      total_memory_mb: totalMemoryMb ?? undefined,
      is_device: Device.isDevice,
      platform: Platform.OS,
    });
  } catch {
    // Telemetry must never break the app.
  }

  safeBreadcrumb(
    "device",
    "Device triage context attached",
    {
      model,
      os_name: osName,
      os_version: osVersion,
      ...(totalMemoryMb != null ? { total_memory_mb: totalMemoryMb } : {}),
      is_device: Device.isDevice,
    },
    "debug",
  );
}

export function setSentryAppStateTag(appState: AppStateStatus) {
  safeSetTag("app_state", appState);
  safeBreadcrumb("app.lifecycle", `AppState → ${appState}`, { app_state: appState });
}

export function setSentryRouteTag(route: string) {
  safeSetTag("route", route);
  safeBreadcrumb("navigation", `Route → ${route}`, { route }, "debug");
}

/**
 * PII-safe list-size breadcrumb + tag. Counts only — never names/emails.
 */
export function recordSentryListCounts(
  kind: SentryListCountKind,
  counts: {
    itemCount: number;
    pageCount?: number;
    hasNextPage?: boolean;
  },
) {
  const tagKey =
    kind === "ledger"
      ? "ledger_item_count"
      : kind === "activity"
        ? "activity_item_count"
        : "groups_count";

  safeSetTag(tagKey, String(counts.itemCount));
  if (typeof counts.pageCount === "number") {
    safeSetTag(`${kind}_page_count`, String(counts.pageCount));
  }

  safeBreadcrumb(
    "ui.list",
    `${kind} list size`,
    {
      kind,
      item_count: counts.itemCount,
      ...(typeof counts.pageCount === "number"
        ? { page_count: counts.pageCount }
        : {}),
      ...(typeof counts.hasNextPage === "boolean"
        ? { has_next_page: counts.hasNextPage }
        : {}),
    },
    "debug",
  );
}

export function recordSentryRealtimeChannel(
  action: "subscribe" | "unsubscribe",
  groupId: string,
) {
  // Truncated id keeps triage useful without dumping full UUIDs into tags.
  const groupIdHint = groupId.slice(0, 8);
  safeBreadcrumb(
    "realtime",
    `Realtime channel ${action}`,
    { action, group_id_hint: groupIdHint },
    "info",
  );
}

export function recordSentryAuthSessionTransition(
  transition: AuthSessionTransition,
) {
  safeSetTag("auth_session", transition === "signed_out" ? "none" : "active");
  safeBreadcrumb(
    "auth",
    `Auth session ${transition}`,
    { transition },
    "info",
  );
}
