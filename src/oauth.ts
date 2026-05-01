/**
 * OAuth 2.1 browser-flow orchestrator for the Autousers CLI.
 *
 * Implements the public-client (PKCE) authorization-code flow against the
 * server's `/oauth/{register,authorize,token}` endpoints:
 *
 *   1. PKCE pair (S256) + CSRF state token are generated locally.
 *   2. A short-lived loopback HTTP server binds to `127.0.0.1` on a
 *      kernel-assigned port — that port is the only thing baked into the
 *      `redirect_uri` we register with the AS, so each login uses a fresh
 *      ephemeral redirect target.
 *   3. We POST `/oauth/register` (RFC 7591 DCR) to mint a `client_id` for
 *      this redirect URI. v0.2 re-registers per login; the server's
 *      90-day stale-client sweeper handles cleanup. Persisting the
 *      `client_id` for reuse is a v0.3 polish.
 *   4. We open the system browser at `/oauth/authorize?...&resource=<origin>/api/v1`
 *      so the minted access JWT's `aud` is bound to the API surface the
 *      CLI actually calls (RFC 8707 audience binding).
 *   5. The user signs in + consents on the AS, which 302s back to our
 *      loopback `/callback?code=...&state=...`.
 *   6. We validate `state`, exchange `code + code_verifier` at
 *      `/oauth/token`, and resolve a `TokenSet`.
 *
 * Security
 * --------
 * - The loopback server binds to `127.0.0.1` ONLY (never `0.0.0.0`). A
 *   public bind would let any process on the network race the user's
 *   browser to the callback.
 * - 5-minute timeout on the callback wait so we don't keep an open port
 *   forever if the user closes the tab without consenting.
 * - State is generated with `crypto.randomBytes` (CSPRNG) and compared
 *   verbatim — any mismatch closes the server and rejects the promise.
 * - The server stops listening after the first valid callback. Single-use
 *   loop prevents replay.
 *
 * Why we don't use a fixed port
 * -----------------------------
 * A fixed port (8765 etc.) is convenient but makes pre-registration of
 * the redirect URI possible: an attacker who knows the host registers
 * the same URI ahead of you and races your callback. Kernel-assigned
 * ports + per-login DCR + state validation closes that gap.
 */

import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { AddressInfo } from "node:net";

import { OAuthError } from "./errors.js";

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

/** Token bundle returned from a successful login. Persisted to config. */
export interface TokenSet {
  /** OAuth access token (HS256 JWT). 15-minute TTL on the server. */
  accessToken: string;
  /** OAuth refresh token (90-day TTL). Used to mint new access tokens. */
  refreshToken: string;
  /** ISO timestamp of access-token expiry (`now + expires_in`). */
  expiresAt: string;
  /** DCR-issued client_id; required to refresh and to revoke. */
  clientId: string;
}

/** Inputs to {@link loginWithBrowser}. */
export interface LoginOptions {
  /** Origin to talk to, e.g. `https://app.autousers.ai`. No trailing slash. */
  baseUrl: string;
  /** Scopes to request (space-joined on the wire). */
  scopes: string[];
  /**
   * Open the system browser automatically. When `false`, we print the URL
   * and let the user paste it manually — useful in remote SSH sessions
   * where there's no GUI. Default: `true`.
   */
  openBrowser?: boolean;
  /**
   * Override `console.log` for tests / quiet modes. Default: `console.log`.
   * Stays a thin sink so tests can assert on what the user would have seen.
   */
  log?: (message: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────
// PKCE helpers — RFC 7636
// ─────────────────────────────────────────────────────────────────────────

/**
 * Generate a PKCE verifier + S256 challenge.
 *
 * Verifier: 32 random bytes from `crypto.randomBytes` (Node's CSPRNG)
 * encoded as base64url. Yields a 43-char unreserved string, the lower
 * bound RFC 7636 §4.1 mandates.
 *
 * Challenge: SHA-256 of the verifier, base64url. The AS MUST accept S256
 * (per the well-known doc) and MUST reject `plain` (per MCP spec
 * 2025-11-25).
 */
export function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/**
 * Generate a CSRF state token. 16 bytes of CSPRNG output as hex (32
 * chars) — well within the AS's 1024-byte cap and impossible to
 * collision-find. Used purely for round-trip integrity, not as a secret.
 */
export function generateState(): string {
  return randomBytes(16).toString("hex");
}

// ─────────────────────────────────────────────────────────────────────────
// Browser-open helper
// ─────────────────────────────────────────────────────────────────────────

/**
 * Cross-platform "open this URL in the user's browser" helper.
 *
 * macOS  → `open <url>`
 * Linux  → `xdg-open <url>` (most desktop distros wire this to the user's
 *          default browser via `update-alternatives`)
 * Win32  → `cmd /c start "" "<url>"` — the empty-string title arg is
 *          required because `start` interprets a single quoted token as
 *          a window title rather than a URL.
 *
 * Spawn detached + unref so the parent CLI process can exit independently
 * of the browser. We pipe stdio away so we don't pollute the user's
 * terminal with `open`'s noise.
 */
export function openUrl(url: string): void {
  const platform = process.platform;
  let command: string;
  let args: string[];

  if (platform === "darwin") {
    command = "open";
    args = [url];
  } else if (platform === "win32") {
    command = "cmd";
    // The double-quoted empty title is what `start` needs to treat the
    // next argument as a URL, not a window title.
    args = ["/c", "start", "", url];
  } else {
    // Assume freedesktop-compatible (Linux, FreeBSD, etc.)
    command = "xdg-open";
    args = [url];
  }

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    // Best-effort. The caller already prints the URL alongside, so the
    // user can paste it manually if `open` fails.
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Callback HTML (success / error landing pages)
// ─────────────────────────────────────────────────────────────────────────

const SUCCESS_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Logged in | autousers</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:32rem;margin:6rem auto;padding:0 1rem;color:#111;text-align:center}
  h1{font-size:1.5rem;margin:0 0 .75rem}
  p{margin:0 0 1rem;color:#444}
  .check{display:inline-block;width:2rem;height:2rem;line-height:2rem;border-radius:9999px;background:#16a34a;color:#fff;font-size:1rem;margin-bottom:1rem}
</style>
</head>
<body>
<div class="check" aria-hidden="true">&#10003;</div>
<h1>You're logged in.</h1>
<p>You can close this tab and return to your terminal.</p>
<script>setTimeout(function(){try{window.close()}catch(e){}},250);</script>
</body>
</html>`;

function errorHtml(error: string, description: string): string {
  const safe = (s: string): string =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Login failed | autousers</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:32rem;margin:6rem auto;padding:0 1rem;color:#111}
  h1{font-size:1.25rem;margin:0 0 .5rem}
  p{margin:0 0 1rem}
  code{background:#f4f4f5;padding:.125rem .375rem;border-radius:.25rem;font-size:.875rem}
</style>
</head>
<body>
<h1>Login failed</h1>
<p><code>${safe(error)}</code> — ${safe(description)}</p>
<p>You can close this tab and try <code>autousers login</code> again.</p>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────
// Callback server — boot, listen, resolve on first valid hit
// ─────────────────────────────────────────────────────────────────────────

/**
 * Result captured from a successful `/callback` hit.
 */
interface CallbackResult {
  code: string;
}

/**
 * Boot a single-use HTTP server bound to `127.0.0.1:0`. Returns the
 * server, the kernel-assigned port, and a Promise that resolves on the
 * first valid `GET /callback?code=...&state=<expectedState>`.
 *
 * The server stops listening after the first response (success or error)
 * so a second hit can't race the first.
 */
export function startCallbackServer(
  expectedState: string,
  timeoutMs = 5 * 60 * 1000
): Promise<{ server: Server; port: number; result: Promise<CallbackResult> }> {
  return new Promise((resolveBoot, rejectBoot) => {
    let resolveResult: ((value: CallbackResult) => void) | null = null;
    let rejectResult: ((reason: unknown) => void) | null = null;
    const result = new Promise<CallbackResult>((res, rej) => {
      resolveResult = res;
      rejectResult = rej;
    });

    let timeoutHandle: NodeJS.Timeout | null = null;

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      // Defensive — the callback URL should always have a method+url, but
      // the Node typings are conservative.
      if (!req.url || !req.method) {
        res.statusCode = 400;
        res.end("bad request");
        return;
      }

      // Only the callback path is interesting; everything else is 404.
      // We parse against the request's `Host` header so the URL parser
      // has a base to resolve against.
      const host = req.headers.host ?? "127.0.0.1";
      const requestUrl = new URL(req.url, `http://${host}`);

      if (req.method !== "GET" || requestUrl.pathname !== "/callback") {
        res.statusCode = 404;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end("not found");
        return;
      }

      const params = requestUrl.searchParams;
      const code = params.get("code");
      const state = params.get("state");
      const error = params.get("error");
      const errorDescription = params.get("error_description") ?? "";

      // RFC 6749 §4.1.2.1 — the AS bounces back here with `?error=...`
      // when the user denies consent or the request was malformed.
      if (error) {
        res.statusCode = 400;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(errorHtml(error, errorDescription));
        finalize();
        rejectResult?.(
          new OAuthError(
            `OAuth error: ${error}${errorDescription ? ` — ${errorDescription}` : ""}`
          )
        );
        return;
      }

      if (!state || state !== expectedState) {
        res.statusCode = 400;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(
          errorHtml(
            "invalid_state",
            "The state parameter did not match — this could indicate a CSRF attempt."
          )
        );
        finalize();
        rejectResult?.(
          new OAuthError("State mismatch on OAuth callback (possible CSRF).")
        );
        return;
      }

      if (!code) {
        res.statusCode = 400;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(
          errorHtml(
            "invalid_request",
            "The authorization server returned no `code` parameter."
          )
        );
        finalize();
        rejectResult?.(
          new OAuthError("Authorization server returned no `code`.")
        );
        return;
      }

      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(SUCCESS_HTML);
      finalize();
      resolveResult?.({ code });
    });

    function finalize(): void {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      // Stop accepting new connections; existing one (the response we
      // just wrote) will close cleanly.
      server.close();
    }

    server.on("error", (err) => {
      if (rejectResult) rejectResult(err);
      else rejectBoot(err);
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo | null;
      if (!addr || typeof addr.port !== "number") {
        server.close();
        rejectBoot(new OAuthError("Failed to bind callback server."));
        return;
      }

      timeoutHandle = setTimeout(() => {
        timeoutHandle = null;
        server.close();
        rejectResult?.(
          new OAuthError(
            `Timed out waiting for OAuth callback after ${Math.round(timeoutMs / 1000)}s.`
          )
        );
      }, timeoutMs);
      // Don't keep the Node event loop alive solely for the timeout —
      // when the server closes we explicitly clear it anyway.
      timeoutHandle.unref?.();

      resolveBoot({ server, port: addr.port, result });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────
// /oauth/register — Dynamic Client Registration (RFC 7591)
// ─────────────────────────────────────────────────────────────────────────

interface RegisterResponse {
  client_id: string;
  client_id_issued_at?: number;
  redirect_uris?: string[];
  client_name?: string;
  scope?: string;
  // ...other RFC 7591 fields we don't read
}

async function registerClient(
  baseUrl: string,
  redirectUri: string,
  scopes: string[]
): Promise<string> {
  const res = await fetch(`${baseUrl}/oauth/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      client_name: "Autousers CLI",
      // Surfaced on the consent screen alongside the client name so users
      // see a recognisable mark instead of the "A" letter fallback. Points
      // at the autousers brand mark; can be swapped to a CLI-specific
      // asset (e.g. `/landing/logos/clients/autousers-cli.svg`) when one
      // ships without a CLI release.
      logo_uri: `${baseUrl}/logo/autousers_logo.svg`,
      // RFC 7591 metadata that the consent screen surfaces in fine print.
      client_uri: "https://autousers.ai/help/cli",
      tos_uri: "https://autousers.ai/terms",
      policy_uri: "https://autousers.ai/privacy",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: scopes.join(" "),
    }),
  });

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as {
        error?: string;
        error_description?: string;
      };
      if (body.error || body.error_description) {
        detail = `${body.error ?? "registration_failed"}${body.error_description ? `: ${body.error_description}` : ""}`;
      }
    } catch {
      // Non-JSON error body — keep the status fallback.
    }
    throw new OAuthError(`Dynamic client registration failed (${detail}).`);
  }

  const body = (await res.json()) as RegisterResponse;
  if (!body.client_id) {
    throw new OAuthError(
      "Dynamic client registration response missing client_id."
    );
  }
  return body.client_id;
}

// ─────────────────────────────────────────────────────────────────────────
// /oauth/token — authorization_code exchange
// ─────────────────────────────────────────────────────────────────────────

interface TokenExchangeResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
}

async function exchangeAuthorizationCode(
  baseUrl: string,
  params: {
    code: string;
    redirectUri: string;
    verifier: string;
    clientId: string;
  }
): Promise<TokenExchangeResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.verifier,
    client_id: params.clientId,
  });

  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const errBody = (await res.json()) as {
        error?: string;
        error_description?: string;
      };
      if (errBody.error || errBody.error_description) {
        detail = `${errBody.error ?? "token_exchange_failed"}${errBody.error_description ? `: ${errBody.error_description}` : ""}`;
      }
    } catch {
      // Non-JSON error body — fall through with status text.
    }
    throw new OAuthError(`Token exchange failed (${detail}).`);
  }

  const json = (await res.json()) as TokenExchangeResponse;
  if (
    !json.access_token ||
    !json.refresh_token ||
    typeof json.expires_in !== "number"
  ) {
    throw new OAuthError("Token response missing required fields.");
  }
  return json;
}

// ─────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────

/**
 * Run the full browser-flow login sequence and resolve to a token set.
 *
 * Caller is responsible for persisting the returned `TokenSet` to disk
 * (so we keep this module pure — it doesn't touch `~/.autousers/config.json`
 * itself).
 */
export async function loginWithBrowser(
  options: LoginOptions
): Promise<TokenSet> {
  const { baseUrl, scopes } = options;
  const openInBrowser = options.openBrowser ?? true;
  const log = options.log ?? ((m: string) => process.stdout.write(`${m}\n`));

  if (!baseUrl || !baseUrl.startsWith("http")) {
    throw new OAuthError(`Invalid baseUrl: "${baseUrl}"`);
  }
  if (!scopes || scopes.length === 0) {
    throw new OAuthError("At least one scope must be requested.");
  }

  // 1. Local crypto.
  const { verifier, challenge } = generatePkcePair();
  const state = generateState();

  // 2. Boot loopback callback server first — we need its port to build
  //    `redirectUri`, which we register and pass to /authorize.
  const { server, port, result } = await startCallbackServer(state);
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  let tokenResponse: TokenExchangeResponse;
  let clientId: string;

  try {
    // 3. Register the client (per-login DCR). v0.2 doesn't reuse client_ids;
    //    the server's stale-client sweeper handles cleanup.
    clientId = await registerClient(baseUrl, redirectUri, scopes);

    // 4. Build the authorize URL.
    const authorizeUrl = new URL(`${baseUrl}/oauth/authorize`);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("scope", scopes.join(" "));
    // RFC 8707 audience binding — pin the minted access token to the
    // `/api/v1` surface, the only one the CLI actually calls.
    authorizeUrl.searchParams.set("resource", `${baseUrl}/api/v1`);

    const authorizeUrlStr = authorizeUrl.toString();

    if (openInBrowser) {
      log(`Opening your browser to sign in...`);
      log(`If it doesn't open automatically, paste this URL:`);
      log(`  ${authorizeUrlStr}`);
      openUrl(authorizeUrlStr);
    } else {
      log(`Open this URL in your browser to sign in:`);
      log(`  ${authorizeUrlStr}`);
    }

    // 5. Wait for the callback. Times out after 5 minutes.
    const { code } = await result;

    // 6. Exchange `code` for tokens.
    tokenResponse = await exchangeAuthorizationCode(baseUrl, {
      code,
      redirectUri,
      verifier,
      clientId,
    });
  } finally {
    // Always release the loopback port even if we threw mid-flow.
    if (server.listening) {
      server.close();
    }
  }

  const expiresAt = new Date(
    Date.now() + tokenResponse.expires_in * 1000
  ).toISOString();

  return {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    expiresAt,
    clientId,
  };
}
