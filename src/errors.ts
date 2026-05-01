/**
 * Typed error hierarchy for the Autousers CLI.
 *
 * The dispatcher in `src/index.ts` catches these and renders a friendly
 * recovery hint to stderr instead of dumping a raw stack trace. We mirror
 * the shape of `mcp/src/client.ts` so the same error semantics travel
 * across both packages — anyone who's used `@autousers/mcp` already knows
 * what these mean.
 */

/**
 * Resolve the public docs URL pointed at by the `recoveryHint` of a
 * {@link MissingApiKeyError}. We pull this from the same env var the API
 * client uses so a CLI pointed at a self-hosted dev cluster reports its own
 * `/settings/api-keys` page rather than always sending users to prod.
 */
function apiKeysUrl(): string {
  const base =
    process.env.AUTOUSERS_BASE_URL?.replace(/\/+$/, "") ??
    "https://app.autousers.ai";
  return `${base}/settings/api-keys`;
}

/**
 * Thrown by the API client when no `ak_live_*` key has been resolved by the
 * time a request is dispatched. The dispatcher prints the `recoveryHint`
 * verbatim to stderr and exits non-zero, so the user sees one actionable
 * sentence — not a stack trace.
 */
export class MissingApiKeyError extends Error {
  /** URL the user should visit to mint a key. */
  public readonly recoveryHint: string;

  constructor(message?: string) {
    const url = apiKeysUrl();
    super(
      message ??
        `Missing Autousers API key. Mint one at ${url} and either run ` +
          `\`autousers login\`, set AUTOUSERS_API_KEY, or pass --key ak_live_...`
    );
    this.name = "MissingApiKeyError";
    this.recoveryHint = url;
  }
}

/**
 * Thrown when the API returns a non-2xx response. Carries the HTTP status,
 * the request id (for support tickets), and the structured error body so
 * callers can render targeted messages (e.g. "your key is missing the
 * `evaluations:write` scope").
 */
export class AutousersApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly requestId: string | null,
    public readonly type?: string,
    public readonly param?: string
  ) {
    super(message);
    this.name = "AutousersApiError";
  }
}

/**
 * Thrown by the OAuth browser-flow orchestrator when something inside the
 * flow itself fails — DCR rejected the redirect URI, the AS bounced
 * `?error=access_denied` to the callback, the user closed the tab and we
 * timed out, etc. Distinct from `MissingApiKeyError` (which is the
 * "no token at all" case) and `AutousersApiError` (which is a 4xx/5xx
 * from `/api/v1/*`).
 *
 * The dispatcher prints `err.message` verbatim to stderr — keep messages
 * actionable ("OAuth callback timed out after 300s") rather than raw.
 */
export class OAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthError";
  }
}
