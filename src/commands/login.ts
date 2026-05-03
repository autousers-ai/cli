/**
 * `autousers login` — sign in to Autousers.
 *
 * Two paths, picked at runtime based on flags:
 *
 *   1. **Browser flow** (default) — boot a localhost callback server,
 *      register an OAuth client via DCR, open the user's browser to
 *      `/oauth/authorize`, capture the code, and exchange it for an
 *      `accessToken` + `refreshToken` pair. Persisted to
 *      `~/.autousers/config.json` so subsequent commands are
 *      authenticated.
 *
 *   2. **Paste mode** (`--key ak_live_*`) — the legacy single-step path:
 *      validate the key shape, drop it on disk, done.
 *
 * Flags:
 *   --key <ak_live_...>   Paste-mode (skip browser, persist as-is)
 *   --no-browser          Print the auth URL instead of opening one
 *   --base-url <url>      Override the API host (also persisted)
 *
 * Exit codes:
 *   0  success
 *   1  generic failure (network, auth refused, etc.)
 *   2  no usable input (e.g. `--key` provided but malformed)
 */

import { Command } from "commander";

import {
  clearOAuthFields,
  configPath,
  getBaseUrl,
  readConfig,
  writeConfig,
  type CliConfig,
} from "../config.js";
import { OAuthError } from "../errors.js";
import { loginWithBrowser } from "../oauth.js";

/**
 * Full first-party scope universe the CLI requests. Mirrors
 * `SUPPORTED_SCOPES` in `app/(mcp)/oauth/authorize/route.ts` and
 * `app/(mcp)/oauth/register/route.ts`.
 *
 * The CLI is a first-party client driving the same surfaces the dashboard
 * does (eval create, autouser CRUD, template duplicate, ratings submit,
 * etc.) — request the full read+write set up front so post-login the TUI
 * can perform the actions it advertises. Asking for only `*:read` and
 * then 403'ing on every write is worse UX than the consent screen
 * listing one extra line.
 *
 * Routes that don't `requireScope` (teams, api-keys, settings/byok) are
 * still callable by the OAuth principal because `requireScope` is
 * additive — those endpoints rely solely on the route's permission check
 * (`assertTeamAccess` etc.), which the user-bound OAuth principal
 * satisfies regardless of the granted scope set.
 *
 * Power users who want a narrower grant can mint an `ak_live_*` API key
 * with custom scopes via `autousers key create --scope <list>` and use
 * `autousers login --key ak_live_...` instead.
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

interface LoginFlags {
  key?: string;
  browser?: boolean; // commander negates `--no-browser` to `browser=false`
}

export async function loginCommand(
  flags: LoginFlags,
  command: Command
): Promise<void> {
  // --base-url lives on the parent program (global flag); read it via
  // optsWithGlobals so a single declaration covers every subcommand and
  // commander's option-name resolution stays unambiguous.
  const globalBaseUrl =
    (command.optsWithGlobals?.().baseUrl as string | undefined) ?? undefined;

  // Validate paste-mode shape before any side effects.
  if (flags.key !== undefined) {
    if (!flags.key.startsWith("ak_live_") || flags.key.length < 12) {
      process.stderr.write(
        `--key must be an ak_live_... API key. Mint one at https://app.autousers.ai/settings/api-keys.\n`
      );
      process.exit(2);
    }

    const existing = (await readConfig()) ?? {};
    // Paste-mode wipes any previous OAuth state — mixing the two would
    // make `whoami` non-deterministic (which bearer wins?).
    const next: CliConfig = {
      ...clearOAuthFields(existing),
      apiKey: flags.key,
    };
    if (globalBaseUrl) next.baseUrl = globalBaseUrl;
    await writeConfig(next);

    process.stdout.write(
      `OK API key saved to ${configPath()}.\n` +
        `   Run \`autousers whoami\` to verify.\n`
    );
    return;
  }

  // Browser flow. Reuse the same precedence the rest of the CLI uses:
  // explicit flag → env → config file's saved baseUrl → prod default. The
  // config-file fallback matters when a user previously logged in against
  // a non-prod host (e.g. localhost dev) and re-runs `autousers login`
  // without re-passing --base-url; without it, re-login silently falls
  // back to prod and 401s on a host the prior session never used.
  const baseUrl = await getBaseUrl(globalBaseUrl);
  const openBrowser = flags.browser !== false;

  try {
    const tokens = await loginWithBrowser({
      baseUrl,
      scopes: DEFAULT_SCOPES,
      openBrowser,
    });

    const existing = (await readConfig()) ?? {};
    // Browser-login wipes any paste-mode key for the same reason
    // paste-mode wipes OAuth fields above.
    const next: CliConfig = {
      ...existing,
      apiKey: undefined,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      clientId: tokens.clientId,
    };
    delete next.apiKey;
    if (globalBaseUrl) next.baseUrl = globalBaseUrl;
    await writeConfig(next);

    process.stdout.write(
      `OK Logged in. Tokens saved to ${configPath()}.\n` +
        `   Run \`autousers whoami\` to verify.\n`
    );
  } catch (err) {
    if (err instanceof OAuthError) {
      process.stderr.write(`Login failed: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}
