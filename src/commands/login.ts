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
  readConfig,
  writeConfig,
  type CliConfig,
} from "../config.js";
import { OAuthError } from "../errors.js";
import { loginWithBrowser } from "../oauth.js";

/**
 * Read-only scope universe v0.2 of the CLI requests. Mirrors the
 * `DEFAULT_SCOPES` constant in `app/(mcp)/oauth/authorize/route.ts`.
 *
 * We intentionally request only read scopes for now — the few CLI
 * subcommands that exist (`whoami`, `eval list`, `usage`) are read-only.
 * Once mutating commands ship (`eval create`, etc.) we'll widen this set
 * and surface a `--scopes` flag so power users can opt into less.
 */
const DEFAULT_SCOPES = [
  "evaluations:read",
  "templates:read",
  "autousers:read",
  "ratings:read",
];

interface LoginFlags {
  key?: string;
  browser?: boolean; // commander negates `--no-browser` to `browser=false`
  baseUrl?: string;
}

export async function loginCommand(
  flags: LoginFlags,
  _command: Command
): Promise<void> {
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
    if (flags.baseUrl) next.baseUrl = flags.baseUrl;
    await writeConfig(next);

    process.stdout.write(
      `OK API key saved to ${configPath()}.\n` +
        `   Run \`autousers whoami\` to verify.\n`
    );
    return;
  }

  // Browser flow.
  const baseUrl = resolveBaseUrl(flags.baseUrl);
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
    if (flags.baseUrl) next.baseUrl = flags.baseUrl;
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

/**
 * Same precedence as `getBaseUrl` but synchronous and tied to the flag —
 * the explicit flag wins, then env, then prod default. We don't read the
 * config file here because login is the moment we WRITE it — reading
 * from it for the base URL during login is circular.
 */
function resolveBaseUrl(flag: string | undefined): string {
  if (flag && flag.length > 0) return flag.replace(/\/+$/, "");
  const fromEnv = process.env.AUTOUSERS_BASE_URL;
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/+$/, "");
  return "https://app.autousers.ai";
}
