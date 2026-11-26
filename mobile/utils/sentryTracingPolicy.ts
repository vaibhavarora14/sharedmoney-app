type HeaderMap = Record<string, unknown>;

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "apikey",
  "x-supabase-authorization",
]);

const SENSITIVE_QUERY_KEYS = new Set([
  "access_token",
  "refresh_token",
  "token",
  "auth",
  "code",
  "apikey",
]);

export type ScrubableRequestEvent = {
  request?: {
    url?: string;
    headers?: HeaderMap;
    [key: string]: unknown;
  };
  spans?: Array<{
    data?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  contexts?: {
    trace?: {
      data?: Record<string, unknown>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type ScrubableBreadcrumb = {
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

let routeListeners = new Set<(route: string) => void>();
let publishedRoute = "groups";

/**
 * Default 1.0 while production traffic is tiny. Expo inlines
 * `process.env.EXPO_PUBLIC_…` via direct member access — do not pass
 * `process.env` as an object from call sites that need bundler inlining.
 */
export function resolveSentryTracesSampleRate(input?: {
  env?: Record<string, string | undefined>;
}): number {
  const raw = input?.env
    ? input.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
    : process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE;
  const parsed = Number(raw ?? "1.0");
  if (!Number.isFinite(parsed) || parsed < 0) return 1.0;
  if (parsed > 1) return 1.0;
  return parsed;
}

/**
 * Hosts that should receive sentry-trace / baggage on outbound fetch.
 * Keeps URLs visible in spans; does not include secrets.
 */
export function resolveSentryTracePropagationTargets(input?: {
  supabaseUrl?: string;
  apiUrl?: string;
}): Array<string | RegExp> {
  const targets: Array<string | RegExp> = [];
  const supabaseUrl =
    input?.supabaseUrl ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const apiUrl = input?.apiUrl ?? process.env.EXPO_PUBLIC_API_URL;

  for (const candidate of [supabaseUrl, apiUrl]) {
    if (!candidate) continue;
    try {
      targets.push(new URL(candidate).host);
    } catch {
      // Ignore malformed env; tracing still works without propagation.
    }
  }

  // Always include common local Supabase ports for dev clients.
  targets.push("localhost", "127.0.0.1");
  return targets;
}

/** Whether an outbound URL should get a Sentry HTTP span + trace headers. */
export function shouldCreateSentryHttpSpan(
  url: string,
  targets: Array<string | RegExp> = resolveSentryTracePropagationTargets(),
): boolean {
  try {
    const host = new URL(url).host;
    return targets.some((target) => {
      if (typeof target === "string") {
        return host === target || host.endsWith(`.${target}`) || url.includes(target);
      }
      return target.test(url);
    });
  } catch {
    return false;
  }
}

export function getPublishedSentryRoute(): string {
  return publishedRoute;
}

export function subscribeSentryRoute(
  listener: (route: string) => void,
): () => void {
  routeListeners.add(listener);
  return () => {
    routeListeners.delete(listener);
  };
}

export function publishSentryRoute(route: string) {
  publishedRoute = route;
  for (const listener of routeListeners) {
    listener(route);
  }
}

function isSensitiveHeaderName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (SENSITIVE_HEADER_NAMES.has(normalized)) return true;
  if (normalized.startsWith("x-auth")) return true;
  if (normalized.includes("authorization")) return true;
  if (normalized.includes("api-key") || normalized.includes("apikey")) return true;
  if (normalized.includes("token") && normalized.includes("auth")) return true;
  return false;
}

function scrubHeaderMap(headers: HeaderMap | undefined): HeaderMap | undefined {
  if (!headers || typeof headers !== "object") return headers;
  const next: HeaderMap = {};
  for (const [key, value] of Object.entries(headers)) {
    if (isSensitiveHeaderName(key)) {
      next[key] = "[Filtered]";
      continue;
    }
    next[key] = value;
  }
  return next;
}

function scrubSpanData(data: Record<string, unknown> | undefined) {
  if (!data || typeof data !== "object") return data;
  const next: Record<string, unknown> = { ...data };
  for (const key of Object.keys(next)) {
    const lower = key.toLowerCase();
    if (
      lower.startsWith("http.request.header.") &&
      isSensitiveHeaderName(lower.slice("http.request.header.".length))
    ) {
      next[key] = "[Filtered]";
    }
  }
  return next;
}

function scrubUrlQuery(url: string | undefined): string | undefined {
  if (!url || typeof url !== "string") return url;
  try {
    const parsed = new URL(url);
    let changed = false;
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        // Use a token that survives URL serialization without percent-encoding.
        parsed.searchParams.set(key, "filtered");
        changed = true;
      }
    }
    return changed ? parsed.toString() : url;
  } catch {
    return url;
  }
}

/**
 * Keep request URLs for triage; strip auth headers / tokens from transactions.
 * Accepts Sentry Event shapes without depending on exact SDK generics.
 */
export function scrubSentryTransaction<T>(event: T): T | null {
  const scrubbable = event as ScrubableRequestEvent;
  if (scrubbable.request?.headers) {
    scrubbable.request = {
      ...scrubbable.request,
      headers: scrubHeaderMap(scrubbable.request.headers),
      url: scrubUrlQuery(scrubbable.request.url) ?? scrubbable.request.url,
    };
  }

  if (Array.isArray(scrubbable.spans)) {
    scrubbable.spans = scrubbable.spans.map((span) => {
      if (!span || typeof span !== "object") return span;
      if (!span.data) return span;
      return {
        ...span,
        data: scrubSpanData(span.data),
      };
    });
  }

  if (scrubbable.contexts?.trace && typeof scrubbable.contexts.trace === "object") {
    const trace = scrubbable.contexts.trace;
    if (trace.data) {
      scrubbable.contexts = {
        ...scrubbable.contexts,
        trace: {
          ...trace,
          data: scrubSpanData(trace.data),
        },
      };
    }
  }

  return event;
}

/** Same header/token scrubbing for error events that carry request context. */
export function scrubSentryErrorEvent<T>(event: T): T | null {
  const scrubbable = event as ScrubableRequestEvent;
  if (scrubbable.request?.headers) {
    scrubbable.request = {
      ...scrubbable.request,
      headers: scrubHeaderMap(scrubbable.request.headers),
      url: scrubUrlQuery(scrubbable.request.url) ?? scrubbable.request.url,
    };
  }
  return event;
}

export function scrubSentryBreadcrumb<T>(breadcrumb: T): T | null {
  const scrubbable = breadcrumb as ScrubableBreadcrumb;
  if (!scrubbable.data || typeof scrubbable.data !== "object") {
    return breadcrumb;
  }

  const data = { ...scrubbable.data };
  if (data.headers && typeof data.headers === "object") {
    data.headers = scrubHeaderMap(data.headers as HeaderMap);
  }
  for (const key of Object.keys(data)) {
    const lower = key.toLowerCase();
    if (isSensitiveHeaderName(lower) || lower.includes("authorization")) {
      data[key] = "[Filtered]";
    }
    if (lower === "url" && typeof data[key] === "string") {
      data[key] = scrubUrlQuery(data[key] as string);
    }
  }

  scrubbable.data = data;
  return breadcrumb;
}
