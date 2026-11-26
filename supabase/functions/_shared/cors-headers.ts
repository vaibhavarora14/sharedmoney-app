export const CORS_ALLOW_HEADERS_DEFAULT =
  "authorization, x-client-info, apikey, content-type, x-app-version, prefer, x-region";

/**
 * Browser preflights send Access-Control-Request-Headers. Echo those, but always
 * include the default set so `x-region` is allowed even when a client omits it
 * from the request list.
 */
export function resolveAllowHeaders(
  requestedHeaders: string | null | undefined,
): string {
  const requested = (requestedHeaders ?? "")
    .split(",")
    .map((header) => header.trim())
    .filter((header) => header.length > 0);
  const seen = new Set(requested.map((header) => header.toLowerCase()));
  const merged = [...requested];
  for (const header of CORS_ALLOW_HEADERS_DEFAULT.split(",").map((value) => value.trim())) {
    if (!seen.has(header.toLowerCase())) {
      merged.push(header);
      seen.add(header.toLowerCase());
    }
  }
  return merged.join(", ");
}
