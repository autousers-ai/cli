/**
 * Thin fetch wrapper for the Autousers v1 REST API.
 *
 * Bearer resolution
 * -----------------
 * The CLI now supports two bearer modes (set up by the v0.2 OAuth flow):
 *
 *   1. **Paste mode**  — `ak_live_*` API key, the same shape minted at
 *      `https://app.autousers.ai/settings/api-keys`. Used when the user
 *      passes `--key`, sets `AUTOUSERS_API_KEY`, or runs
 *      `autousers login --key ak_live_...`.
 *   2. **OAuth mode**  — short-lived HS256 JWT plus a refresh token + DCR
 *      `client_id`, all persisted to `~/.autousers/config.json`. Set by
 *      `autousers login` (browser flow). On 401 we transparently refresh
 *      via `/oauth/token` and retry the original request once.
 *
 * The two modes share the same wire path (Authorization: Bearer ...) so
 * the API doesn't need to know which the caller used. The differentiator
 * is whether the client is constructed with a `refreshContext`.
 *
 * Mirror of `mcp/src/client.ts` for paste mode — same error shape
 * (MissingApiKeyError / AutousersApiError), same env-var precedence
 * (explicit → env → fallback), same User-Agent convention.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  clearOAuthFields,
  getBaseUrl,
  readConfig,
  writeConfig,
  type CliConfig,
} from "./config.js";
import { AutousersApiError, MissingApiKeyError, OAuthError } from "./errors.js";
import type { TokenSet } from "./oauth.js";

/**
 * Read the package version off disk at module load. We cannot use
 * `import pkg from "../package.json" with { type: "json" }` here because
 * `tsc` with NodeNext will copy the import attribute through to the emitted
 * `.js`, but Node's JSON-import parser refuses paths that climb out of the
 * `rootDir` (`../package.json` is one level above `src/`). Reading the
 * file with `fs` at runtime is the same trick `npm` itself uses internally,
 * and avoids a duplicated version constant.
 */
function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/client.js → dist/../package.json
    const pkgPath = resolve(here, "..", "package.json");
    const raw = readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** CLI version, surfaced both in the User-Agent and the `--version` flag. */
export const CLI_VERSION = readPackageVersion();

/** Stable User-Agent so the API can attribute traffic to the CLI. */
const USER_AGENT = `autousers-cli/${CLI_VERSION}`;

/** Window before declared `expiresAt` at which we proactively refresh. */
const PROACTIVE_REFRESH_SKEW_MS = 30 * 1000;

/** Shape of an API error body — `{ error: { message, type?, param? } }`. */
export interface AutousersApiErrorBody {
  error?: {
    message?: string;
    type?: string;
    param?: string;
  };
}

/**
 * The bits the client needs to perform a refresh-on-401. When present,
 * 401s trigger a `/oauth/token` exchange, the new token set is written
 * back via `onRefresh`, and the original request retries once.
 */
export interface RefreshContext {
  refreshToken: string;
  clientId: string;
  /** Persist the rotated token-set to disk. Awaited before retry. */
  onRefresh: (next: TokenSet) => Promise<void>;
}

/** Options accepted by the {@link AutousersClient} constructor. */
export interface AutousersClientOptions {
  /** Resolved bearer token (either an `ak_live_*` key or an OAuth JWT). */
  bearer: string;
  /** Override the API host. Defaults to env / `https://app.autousers.ai`. */
  baseUrl?: string | undefined;
  /**
   * When present, 401s trigger a refresh-on-401 retry. Omit for paste-
   * mode keys — they don't have a refresh token and 401s mean "the key
   * was revoked", not "your access token expired".
   */
  refreshContext?: RefreshContext | undefined;
}

/** Resolve the upstream `/api/v1` base URL. */
function normalizeBaseUrl(explicit?: string): string {
  if (explicit && explicit.length > 0) return explicit.replace(/\/+$/, "");
  const fromEnv = process.env.AUTOUSERS_BASE_URL;
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/+$/, "");
  return "https://app.autousers.ai";
}

/**
 * Thin HTTP client over `/api/v1/*`. Subcommands construct one per
 * invocation rather than sharing a global singleton; that way the
 * `--key` / `--base-url` flags can override per-call without thread-local
 * gymnastics.
 */
export class AutousersClient {
  private bearer: string;
  public readonly baseUrl: string;
  private readonly refreshContext: RefreshContext | undefined;
  /**
   * In-process refresh dedupe. Concurrent requests that all hit 401
   * await the same refresh promise rather than each spawning their own
   * `/oauth/token` round-trip and rotating the refresh token N times
   * (which would invalidate N-1 of them via the chain-revoke path).
   */
  private refreshing: Promise<void> | null = null;

  constructor(options: AutousersClientOptions) {
    if (!options.bearer || options.bearer.length === 0) {
      throw new MissingApiKeyError();
    }
    this.bearer = options.bearer;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.refreshContext = options.refreshContext;
  }

  /** GET `/api/v1/<path>`, return parsed JSON. */
  public get<T = unknown>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  /** POST `/api/v1/<path>` with a JSON body, return parsed JSON. */
  public post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  /** PATCH `/api/v1/<path>` with a JSON body, return parsed JSON. */
  public patch<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }

  /** DELETE `/api/v1/<path>`. Returns parsed JSON or `undefined` for 204. */
  public delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  /**
   * Workhorse. Builds the URL, sets the bearer header, parses the body,
   * and translates non-2xx into typed errors. `path` may be either a
   * leading-slash absolute path (`/api/v1/...`) or a fully qualified URL
   * (used by tests against a mock server).
   *
   * Refresh-on-401: when a `refreshContext` is set, a 401 triggers a
   * single `/oauth/token` exchange (deduped against concurrent calls),
   * we update `this.bearer` from the rotation result, and retry the
   * original request ONCE. A second 401 after refresh is a real
   * `MissingApiKeyError`.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    isRetry = false
  ): Promise<T> {
    const url = path.startsWith("http")
      ? path
      : `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.bearer}`,
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };

    const res = await fetch(url, init);
    const requestId = res.headers.get("x-request-id");

    if (res.status === 401) {
      if (this.refreshContext && !isRetry) {
        // Try once to refresh and replay. If refresh itself errors we
        // surface a `MissingApiKeyError` so the dispatcher can render
        // its recovery hint (which tells the user to re-login).
        try {
          await this.ensureRefreshed();
        } catch {
          throw new MissingApiKeyError(
            "Refresh failed; run `autousers login` to sign in again."
          );
        }
        return this.request<T>(method, path, body, true);
      }
      throw new MissingApiKeyError(
        `Autousers API rejected the bearer token (HTTP 401).`
      );
    }

    if (!res.ok) {
      let errBody: AutousersApiErrorBody | null = null;
      try {
        errBody = (await res.json()) as AutousersApiErrorBody;
      } catch {
        // Non-JSON error body — fall through with status text below.
      }
      const message =
        errBody?.error?.message ?? `HTTP ${res.status} ${res.statusText}`;
      throw new AutousersApiError(
        message,
        res.status,
        requestId,
        errBody?.error?.type,
        errBody?.error?.param
      );
    }

    if (res.status === 204) {
      return undefined as unknown as T;
    }
    return (await res.json()) as T;
  }

  /**
   * Single-flight refresh helper. Concurrent callers all `await` the
   * same in-flight Promise; only the first one actually issues the
   * `/oauth/token` request. We clear `this.refreshing` in `finally` so
   * the next 401 (e.g. when the rotated token also expires) can kick
   * off a fresh refresh.
   */
  private ensureRefreshed(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    const ctx = this.refreshContext;
    if (!ctx) {
      throw new OAuthError("No refresh context available.");
    }

    const formBody = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: ctx.refreshToken,
      client_id: ctx.clientId,
    });

    const res = await fetch(`${this.baseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      body: formBody.toString(),
    });

    if (!res.ok) {
      throw new OAuthError(
        `Refresh-token exchange failed (HTTP ${res.status}).`
      );
    }

    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (
      !json.access_token ||
      !json.refresh_token ||
      typeof json.expires_in !== "number"
    ) {
      throw new OAuthError("Refresh response missing required fields.");
    }

    const next: TokenSet = {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString(),
      clientId: ctx.clientId,
    };

    this.bearer = next.accessToken;
    // Refresh tokens rotate on every successful exchange — we MUST
    // remember the new one or the next refresh will trigger replay
    // detection (revokedAt set + chain walk).
    (this.refreshContext as RefreshContext).refreshToken = next.refreshToken;
    await ctx.onRefresh(next);
  }
}

/**
 * Resolve a bearer token from precedence: `--key` → `AUTOUSERS_API_KEY`
 * → OAuth tokens in config (refreshing if expired) → paste-mode
 * `apiKey` in config. Throws `MissingApiKeyError` if all sources miss.
 *
 * Returns the bearer plus the refresh context (only set for OAuth
 * tokens) so the caller can construct an `AutousersClient` ready to
 * refresh on its own.
 */
async function resolveBearer(globalOpts: {
  key?: string | undefined;
  baseUrl?: string | undefined;
}): Promise<{
  bearer: string;
  refreshContext: RefreshContext | undefined;
}> {
  // 1. --key
  if (globalOpts.key && globalOpts.key.length > 0) {
    return { bearer: globalOpts.key, refreshContext: undefined };
  }
  // 2. AUTOUSERS_API_KEY
  const fromEnv = process.env.AUTOUSERS_API_KEY;
  if (fromEnv && fromEnv.length > 0) {
    return { bearer: fromEnv, refreshContext: undefined };
  }

  // 3. Config — OAuth or paste-mode.
  const cfg = await readConfig();
  if (!cfg) {
    throw new MissingApiKeyError();
  }

  if (cfg.accessToken && cfg.refreshToken && cfg.clientId) {
    // OAuth path. Build a refresh-capable client; if `expiresAt` is in
    // the past we eagerly refresh once before handing the bearer back
    // so the next request doesn't have to round-trip through a 401.
    const baseUrl = await getBaseUrl(globalOpts.baseUrl);

    let bearer = cfg.accessToken;
    let refreshToken = cfg.refreshToken;
    const onRefresh = async (next: TokenSet): Promise<void> => {
      const fresh = await readConfig();
      const updated: CliConfig = {
        ...(fresh ?? {}),
        accessToken: next.accessToken,
        refreshToken: next.refreshToken,
        expiresAt: next.expiresAt,
        clientId: next.clientId,
      };
      await writeConfig(updated);
    };

    if (
      cfg.expiresAt &&
      Date.parse(cfg.expiresAt) - Date.now() < PROACTIVE_REFRESH_SKEW_MS
    ) {
      // Eager refresh — minimal duplication with `doRefresh` because we
      // don't yet have the client instance. Keep this path tight.
      try {
        const formBody = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: cfg.clientId,
        });
        const res = await fetch(`${baseUrl}/oauth/token`, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
            "User-Agent": USER_AGENT,
          },
          body: formBody.toString(),
        });
        if (res.ok) {
          const json = (await res.json()) as {
            access_token?: string;
            refresh_token?: string;
            expires_in?: number;
          };
          if (
            json.access_token &&
            json.refresh_token &&
            typeof json.expires_in === "number"
          ) {
            bearer = json.access_token;
            refreshToken = json.refresh_token;
            await onRefresh({
              accessToken: json.access_token,
              refreshToken: json.refresh_token,
              expiresAt: new Date(
                Date.now() + json.expires_in * 1000
              ).toISOString(),
              clientId: cfg.clientId,
            });
          }
        }
        // Refresh failure here is non-fatal — fall through with the
        // (possibly expired) accessToken and let the 401 path handle
        // the recovery.
      } catch {
        // Same fall-through.
      }
    }

    return {
      bearer,
      refreshContext: {
        refreshToken,
        clientId: cfg.clientId,
        onRefresh,
      },
    };
  }

  if (cfg.apiKey && cfg.apiKey.length > 0) {
    return { bearer: cfg.apiKey, refreshContext: undefined };
  }

  throw new MissingApiKeyError();
}

/**
 * Build a ready-to-use `AutousersClient` from the current global flags
 * and persisted config. The dispatcher / individual subcommands call
 * this rather than instantiating the client by hand — keeps the bearer
 * resolution logic in one place.
 */
export async function createClientFromConfig(globalOpts: {
  key?: string | undefined;
  baseUrl?: string | undefined;
}): Promise<AutousersClient> {
  const { bearer, refreshContext } = await resolveBearer(globalOpts);
  const baseUrl = await getBaseUrl(globalOpts.baseUrl);
  return new AutousersClient({
    bearer,
    baseUrl,
    refreshContext,
  });
}

/** Re-exported so `logout` can call it without importing `clearOAuthFields` directly. */
export { clearOAuthFields };

/**
 * Resolve the active bearer string without constructing a full
 * AutousersClient. Used by SSE-streaming consumers (e.g. the Wave-8
 * autorater-creator) that need to set the `Authorization` header on a
 * raw `fetch` call rather than going through the client's
 * `request<T>()` method (which buffers the response into JSON before
 * returning).
 *
 * Same precedence as `createClientFromConfig`: explicit `--key` →
 * `AUTOUSERS_API_KEY` env → persisted config (OAuth or paste mode).
 * Returns `null` (rather than throwing) when no bearer can be
 * resolved, so the caller can degrade gracefully (e.g. surface a
 * "please log in" prompt rather than crash mid-screen).
 */
export async function getResolvedBearer(
  globalOpts: {
    key?: string | undefined;
    baseUrl?: string | undefined;
  } = {}
): Promise<string | null> {
  try {
    const { bearer } = await resolveBearer(globalOpts);
    return bearer;
  } catch {
    return null;
  }
}
