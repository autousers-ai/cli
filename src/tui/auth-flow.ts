/**
 * TUI-side wrapper around the OAuth browser flow.
 *
 * The plain-mode `autousers login` command (`src/commands/login.ts`) is the
 * canonical implementation: it boots a localhost callback server, runs the
 * PKCE/DCR/authorize/exchange dance, and persists the resulting `TokenSet`
 * to `~/.autousers/config.json`. This module exposes the SAME flow, but
 * shaped for the TUI:
 *
 *   - No `process.exit()` calls — the TUI process must keep running.
 *   - All console output is suppressed (the TUI renders its own status).
 *   - On success, the resolved identity (email + team + plan + quota) is
 *     fetched from `/api/v1/auth/whoami` and pushed into the zustand store
 *     so the header banner updates without a screen refresh.
 *   - On logout, the same `/oauth/revoke` POST + local-wipe semantics as
 *     plain mode, plus a store reset.
 *
 * Keeping these wrappers in `tui/` (rather than collapsing them into the
 * commands) prevents a chicken-and-egg import: `commands/login.ts` writes
 * to `process.stdout` and exits the process, neither of which the TUI can
 * tolerate. The OAuth orchestrator (`oauth.ts`) is intentionally
 * side-effect-free, so we reuse it here directly.
 */

import {
  clearOAuthFields,
  getBaseUrl,
  readConfig,
  writeConfig,
  type CliConfig,
} from "../config.js";
import { createClientFromConfig } from "../client.js";
import { OAuthError } from "../errors.js";
import { loginWithBrowser } from "../oauth.js";
import type { AuthUser } from "./state.js";
import { useTUIStore } from "./state.js";

/**
 * Full read+write scope set the TUI requests on first login. Mirrors the
 * `DEFAULT_SCOPES` constant in `commands/login.ts` — the TUI drives the
 * same workflows (eval create, autouser CRUD, template duplicate,
 * ratings submit) so it MUST request write scopes up front. A read-only
 * grant would let the user log in but every actionable menu item would
 * 403 with "Missing required scope: …:write".
 *
 * See `commands/login.ts` for the rationale on why a single broad grant
 * beats per-action incremental scope requests for a first-party client.
 */
const DEFAULT_SCOPES = [
  "evaluations:read",
  "evaluations:write",
  "templates:read",
  "templates:write",
  "autousers:read",
  "autousers:write",
  "ratings:read",
  "ratings:write",
];

/** Subset of CLI globals the TUI threads through to auth. */
export interface GlobalOptions {
  /** Override the API host. Defaults to env / `https://app.autousers.ai`. */
  baseUrl?: string;
  /**
   * Open the system browser. Defaults to `true`. The TUI launches via
   * `autousers` (no args) so a desktop browser should always be available;
   * keeping the option for SSH-tunneled `--no-browser` scenarios that may
   * surface from a future entry point.
   */
  openBrowser?: boolean;
}

/**
 * Shape of the `/api/v1/auth/whoami` envelope we read post-login. We only
 * pluck the bits the header actually displays — the rest of the payload is
 * ignored. Defining a private interface (rather than reusing the plain-mode
 * command's TeamRow / UsageEnvelope) keeps the failure surface narrow: a
 * server response that drops or renames fields downgrades to "no quota
 * line" instead of crashing the TUI.
 */
interface WhoamiTeam {
  id: string;
  name: string;
  isPersonal: boolean;
}
interface WhoamiUsage {
  freeQuota?: { used: number; limit: number | null };
  byok?: boolean;
}
interface WhoamiEnvelope {
  email?: string;
  user?: { email?: string };
  teams?: WhoamiTeam[];
  activeTeamId?: string | null;
  usage?: WhoamiUsage;
  plan?: string;
}

/**
 * Resolve the active identity for whatever bearer is currently on disk and
 * return an {@link AuthUser} suitable for the store.
 *
 * Returns `null` if the bearer is missing or the call fails — the caller
 * should treat that as "signed out". Errors are swallowed because this is
 * called from inside a render reaction and we don't want a flaky network
 * request to crash the TUI.
 */
export async function fetchAuthUser(
  globalOpts: GlobalOptions = {}
): Promise<AuthUser | null> {
  try {
    const client = await createClientFromConfig({
      baseUrl: globalOpts.baseUrl,
    });
    // The `/api/v1/auth/whoami` endpoint is the synthetic identity probe
    // (see CLAUDE.md § Auth). It returns the active user + team + quota in
    // a single round-trip; `whoami` in plain mode synthesises the same
    // shape from `/teams` + `/usage` because that command predates whoami.
    const env = await client.get<WhoamiEnvelope>("/api/v1/auth/whoami");

    const email = env.email ?? env.user?.email;
    if (!email) return null;

    // Prefer the active team from the explicit pointer; fall back to the
    // user's personal team for older server responses.
    const activeTeam =
      env.teams?.find((t) => t.id === env.activeTeamId) ??
      env.teams?.find((t) => t.isPersonal) ??
      env.teams?.[0];

    const used = env.usage?.freeQuota?.used;
    const limit = env.usage?.freeQuota?.limit;
    const left =
      typeof used === "number" && typeof limit === "number"
        ? Math.max(0, limit - used)
        : undefined;

    return {
      email,
      teamName: activeTeam?.name,
      plan: env.plan,
      freeRunsLeft: left,
      freeRunsTotal: typeof limit === "number" ? limit : undefined,
    };
  } catch {
    // Don't let the TUI crash if whoami is unreachable / the bearer is
    // invalid — treat as signed-out and let the user retry login.
    return null;
  }
}

/**
 * Run the OAuth browser flow and update the store on success.
 *
 * Returns when the persisted tokens are on disk and the store reflects
 * the new identity. Throws {@link OAuthError} on user-visible failures
 * (state mismatch, callback timeout, token-exchange refusal). The caller
 * (mode-selector) catches these to render the inline error banner.
 */
export async function startTuiLogin(
  globalOpts: GlobalOptions = {}
): Promise<void> {
  const baseUrl = await getBaseUrl(globalOpts.baseUrl);
  const openBrowser = globalOpts.openBrowser ?? true;

  // Drive the same orchestrator the plain-mode command uses. Suppress its
  // log output by handing it a no-op sink — the TUI surfaces login status
  // through its own banner state, not stdout writes (which would garble
  // the Ink render).
  const tokens = await loginWithBrowser({
    baseUrl,
    scopes: DEFAULT_SCOPES,
    openBrowser,
    log: () => {},
  });

  // Persist tokens. Same wipe semantics as plain-mode `login`: any prior
  // paste-mode `apiKey` is cleared so the next request unambiguously uses
  // the OAuth bearer.
  const existing = (await readConfig()) ?? {};
  const next: CliConfig = {
    ...existing,
    apiKey: undefined,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    clientId: tokens.clientId,
  };
  delete next.apiKey;
  if (globalOpts.baseUrl) next.baseUrl = globalOpts.baseUrl;
  await writeConfig(next);

  // Fetch + push identity into the store so the header updates.
  const authUser = await fetchAuthUser(globalOpts);
  useTUIStore.getState().setAuthUser(authUser);
}

/**
 * Revoke OAuth tokens server-side, wipe local credentials, clear the store.
 *
 * Order matters: revoke first (so the AS marks the token revoked while we
 * still have it), then wipe disk, then reset the store. A network failure
 * on revoke is non-fatal — we continue to local wipe so the user isn't
 * stuck "signed in" locally when they explicitly asked to sign out.
 */
export async function tuiLogout(globalOpts: GlobalOptions = {}): Promise<void> {
  const cfg = await readConfig();

  if (cfg?.refreshToken && cfg.clientId) {
    const baseUrl = await getBaseUrl(globalOpts.baseUrl);
    try {
      const body = new URLSearchParams({
        token: cfg.refreshToken,
        token_type_hint: "refresh_token",
        client_id: cfg.clientId,
      });
      await fetch(`${baseUrl}/oauth/revoke`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: body.toString(),
      });
    } catch {
      // Best-effort; continue with local wipe.
    }
  }

  // Wipe local creds. Preserve `baseUrl` so a dev-cluster pin survives.
  if (cfg) {
    const next: CliConfig = clearOAuthFields(cfg);
    delete next.apiKey;
    await writeConfig(next);
  }

  useTUIStore.getState().setAuthUser(null);
}

// Re-export so callers (mode-selector) can `instanceof OAuthError` without
// reaching into `../errors.js` directly.
export { OAuthError };
