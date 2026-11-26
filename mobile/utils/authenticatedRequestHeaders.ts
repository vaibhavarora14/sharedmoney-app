import { EDGE_REGION, EDGE_REGION_HEADER } from "./edgeRegion";

function extraHeaders(init?: HeadersInit): Record<string, string> {
  if (!init) return {};
  if (init instanceof Headers) {
    const out: Record<string, string> = {};
    init.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(init)) {
    return Object.fromEntries(init);
  }
  return { ...init };
}

/**
 * Headers for every edge-function call. Region pin is applied last so callers
 * cannot drop `x-region` by passing their own headers object.
 */
export function authenticatedRequestHeaders(
  token: string,
  appVersion: string,
  extra?: HeadersInit,
): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-App-Version": appVersion,
    ...extraHeaders(extra),
    [EDGE_REGION_HEADER]: EDGE_REGION,
  };
}
