/**
 * Thin fetch wrapper for the Autousers v1 REST API.
 *
 * Auth is `Authorization: Bearer ak_live_*` — the same key minted at
 * `https://app.autousers.ai/settings/api-keys` that the MCP package uses.
 * No bespoke `/api/cli/*` endpoints, no OAuth, no browser flow. The CLI is
 * deliberately a paper-thin wrapper around `/api/v1/*`.
 *
 * Mirror of `mcp/src/client.ts` — same error shape (MissingApiKeyError /
 * AutousersApiError), same env-var precedence (explicit → env → fallback),
 * same User-Agent convention. Two packages, one resolution model.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AutousersApiError, MissingApiKeyError } from "./errors.js";

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

/**
 * Resolve the upstream `/api/v1` base URL.
 *
 * Resolution order matches `mcp/src/client.ts`:
 *
 *   1. Explicit constructor arg (commander `--base-url` flag, future use)
 *   2. `AUTOUSERS_BASE_URL` env var
 *   3. `https://app.autousers.ai` — production default
 *
 * No fallback to `localhost` — the 99% case for a globally-installed
 * `autousers` is targeting prod. Local development sets the env var
 * explicitly.
 */
function resolveBaseUrl(explicit?: string): string {
  if (explicit && explicit.length > 0) return explicit.replace(/\/+$/, "");
  const fromEnv = process.env.AUTOUSERS_BASE_URL;
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/+$/, "");
  return "https://app.autousers.ai";
}

/** Shape of an API error body — `{ error: { message, type?, param? } }`. */
export interface AutousersApiErrorBody {
  error?: {
    message?: string;
    type?: string;
    param?: string;
  };
}

/** Options accepted by the {@link AutousersClient} constructor. */
export interface AutousersClientOptions {
  /**
   * Bearer token (`ak_live_...`). If omitted, the client throws a
   * {@link MissingApiKeyError} on the next call so the dispatcher can
   * render the recovery hint instead of crashing the process.
   */
  apiKey?: string | undefined;
  /** Override the API host. Defaults to env / `https://app.autousers.ai`. */
  baseUrl?: string | undefined;
}

/**
 * Thin HTTP client over `/api/v1/*`. Subcommands construct one per
 * invocation rather than sharing a global singleton; that way the
 * `--key` / `--base-url` flags can override per-call without thread-local
 * gymnastics.
 */
export class AutousersClient {
  private readonly apiKey: string | undefined;
  public readonly baseUrl: string;

  constructor(options: AutousersClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = resolveBaseUrl(options.baseUrl);
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
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    if (!this.apiKey || this.apiKey.length === 0) {
      throw new MissingApiKeyError();
    }

    const url = path.startsWith("http")
      ? path
      : `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };

    const res = await fetch(url, init);
    const requestId = res.headers.get("x-request-id");

    if (res.status === 401) {
      // 401 always means "no/bad key" — surface the same friendly hint as
      // the env-var-missing path so the user gets one consistent message.
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
}
