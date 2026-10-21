/**
 * Dev-only crash / bill-link preview deep links.
 *
 * Used for simulator screenshots and QA. Must never activate in production
 * web or release builds — pass `isDev === false` (or gate callers on `__DEV__`)
 * so query params like `?preview=crash-first` are ignored.
 */

export type DevPreviewKind =
  | "crash"
  | "crash-first"
  | "crash-repeat"
  | "crash-copied"
  | "bill-dead"
  | "bill-offline"
  | null;

const PREVIEW_QUERY_VALUES = new Set([
  "crash",
  "crash-first",
  "crash-repeat",
  "crash-copied",
  "bill-dead",
  "bill-offline",
]);

function previewFromPath(haystack: string): DevPreviewKind {
  if (haystack.includes("dev/crash-copied") || haystack.includes("dev-crash-copied")) {
    return "crash-copied";
  }
  if (haystack.includes("dev/crash-repeat") || haystack.includes("dev-crash-repeat")) {
    return "crash-repeat";
  }
  if (haystack.includes("dev/crash-first") || haystack.includes("dev-crash-first")) {
    return "crash-first";
  }
  if (haystack.includes("dev/crash") || haystack.includes("dev-crash")) {
    return "crash";
  }
  if (haystack.includes("dev/bill-offline") || haystack.includes("dev-bill-offline")) {
    return "bill-offline";
  }
  if (haystack.includes("dev/bill-dead") || haystack.includes("dev-bill-dead")) {
    return "bill-dead";
  }
  return null;
}

function previewFromQuery(url: string): DevPreviewKind {
  const match = /[?&#]preview=([a-z0-9-]+)/i.exec(url);
  if (!match) return null;
  const value = match[1].toLowerCase();
  if (PREVIEW_QUERY_VALUES.has(value)) {
    return value as Exclude<DevPreviewKind, null>;
  }
  return null;
}

/**
 * Resolve a QA preview kind from a deep-link URL.
 * Returns null whenever `isDev` is false — including production web / release.
 */
export function resolveDevPreview(
  url: string | null | undefined,
  isDev: boolean,
): DevPreviewKind {
  if (!isDev || !url) return null;
  return previewFromPath(url.toLowerCase()) ?? previewFromQuery(url);
}
