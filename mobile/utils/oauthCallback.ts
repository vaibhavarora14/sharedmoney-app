export type OAuthCallback =
  | { status: "tokens"; accessToken: string; refreshToken: string }
  | { status: "code"; code: string }
  | { status: "error"; error: string }
  | { status: "missing" };

function paramsFromQuery(urlWithoutHash: string): URLSearchParams {
  try {
    return new URL(urlWithoutHash).searchParams;
  } catch {
    const query = urlWithoutHash.split("?")[1];
    return new URLSearchParams(query ?? "");
  }
}

function tokensFrom(params: URLSearchParams): {
  status: "tokens";
  accessToken: string;
  refreshToken: string;
} | null {
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return null;
  return { status: "tokens", accessToken, refreshToken };
}

/**
 * Read a Google/Supabase OAuth redirect. Implicit tokens may be in the hash
 * or query; PKCE returns `code`; provider failures return `error`.
 */
export function parseOAuthCallbackUrl(url: string): OAuthCallback {
  const hashIndex = url.indexOf("#");
  const withoutHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hashParams = new URLSearchParams(
    hashIndex === -1 ? "" : url.slice(hashIndex + 1),
  );
  const queryParams = paramsFromQuery(withoutHash);

  const hashTokens = tokensFrom(hashParams);
  if (hashTokens) return hashTokens;

  const queryTokens = tokensFrom(queryParams);
  if (queryTokens) return queryTokens;

  const hashError = hashParams.get("error");
  if (hashError) return { status: "error", error: hashError };

  const queryError = queryParams.get("error");
  if (queryError) return { status: "error", error: queryError };

  const code = queryParams.get("code") || hashParams.get("code");
  if (code) return { status: "code", code };

  return { status: "missing" };
}
