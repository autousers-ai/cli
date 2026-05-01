/**
 * Persistent CLI config.
 *
 * Stored at `~/.autousers/config.json` with file mode `0600` (owner read/
 * write only) so a shared-home machine doesn't leak the bearer token to
 * other users.
 *
 * The shape grew with the v0.2 OAuth browser flow:
 *
 *   - Paste-mode (v0.1): `{ apiKey: "ak_live_..." }`
 *   - OAuth (v0.2):     `{ accessToken, refreshToken, expiresAt, clientId }`
 *
 * Both shapes coexist for back-compat: a config written by `autousers
 * login --key ak_live_...` is still readable, and `getApiKey` still
 * resolves it. The API client knows how to drive either path.
 *
 * The resolution order in {@link getApiKey} mirrors common CLI conventions:
 *
 *   1. Explicit `--key` flag (passed in by the dispatcher)
 *   2. `AUTOUSERS_API_KEY` env var (CI, scripts, ad-hoc shells)
 *   3. `~/.autousers/config.json` (interactive sessions after `login`)
 *
 * No fallback to "anonymous" — if all three miss, the API client throws a
 * `MissingApiKeyError` on the next call and the dispatcher prints the
 * recovery hint.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * On-disk shape of `~/.autousers/config.json`. Optional fields stay
 * truly optional — the file is allowed to be `{}` if a user e.g. only
 * wants to pin a `baseUrl` and supplies the key via env.
 */
export interface CliConfig {
  /** Paste-mode API key (`ak_live_*`). Set by `login --key`. */
  apiKey?: string;
  /** OAuth access token (HS256 JWT). Set by the browser-flow `login`. */
  accessToken?: string;
  /** OAuth refresh token (90d TTL). Used to refresh `accessToken` on 401. */
  refreshToken?: string;
  /** ISO timestamp of `accessToken` expiry. */
  expiresAt?: string;
  /** DCR-issued OAuth `client_id`. Required to refresh and to revoke. */
  clientId?: string;
  /** Override the API host. */
  baseUrl?: string;
}

/**
 * Absolute path to the config file. Computed from `$HOME` so we don't
 * surprise anyone running with an overridden home (e.g. `HOME=/tmp` in
 * tests). Exported so the `login` / `logout` commands can mention it
 * verbatim in their output.
 */
export function configPath(): string {
  return join(homedir(), ".autousers", "config.json");
}

/**
 * Read the persisted config. Returns `null` if the file is missing — the
 * caller distinguishes "no config yet" from "malformed config" by inspecting
 * whether the result is `null` vs. an object with missing fields.
 *
 * Malformed JSON is rethrown so the user gets a clear error rather than
 * silent fallback to defaults — silent fallback after a botched edit is the
 * kind of surprise that wastes hours.
 */
export async function readConfig(): Promise<CliConfig | null> {
  try {
    const raw = await readFile(configPath(), "utf8");
    return JSON.parse(raw) as CliConfig;
  } catch (err) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw err;
  }
}

/**
 * Persist the config to disk. Creates `~/.autousers/` if it doesn't exist,
 * sets the directory mode to `0700` and the file mode to `0600` so the
 * bearer token isn't world-readable on shared machines.
 */
export async function writeConfig(config: CliConfig): Promise<void> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
    encoding: "utf8",
  });
}

/**
 * Strip every OAuth-related field from a config object. Returns a NEW
 * object — does not mutate the input. Used by `logout` to wipe access /
 * refresh tokens while leaving e.g. `baseUrl` overrides intact (callers
 * decide whether to also drop `apiKey` separately).
 */
export function clearOAuthFields(config: CliConfig): CliConfig {
  const next: CliConfig = { ...config };
  delete next.accessToken;
  delete next.refreshToken;
  delete next.expiresAt;
  delete next.clientId;
  return next;
}

/**
 * Resolve the API key in CLI-conventional priority order. `null` means
 * "all three sources missed" — the API client converts that into a
 * {@link MissingApiKeyError} with a friendly recovery hint.
 *
 * `explicitKey` is the value of `--key` passed by the user, threaded
 * through from the commander option parser. Pass `undefined` if the
 * caller isn't a command that accepts the flag.
 *
 * Note: this only resolves `ak_live_*` paste-mode keys. OAuth tokens
 * are resolved via the API client's bearer-resolution path (which knows
 * how to refresh on 401). Paste-mode and OAuth are deliberately
 * disjoint resolution paths — see `client.ts:createClientFromConfig`.
 */
export async function getApiKey(
  explicitKey?: string | undefined
): Promise<string | null> {
  if (explicitKey && explicitKey.length > 0) return explicitKey;
  const fromEnv = process.env.AUTOUSERS_API_KEY;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const cfg = await readConfig();
  return cfg?.apiKey ?? null;
}

/**
 * Resolve the base URL with the same priority order the MCP client uses,
 * so the two packages behave identically when a developer points one at a
 * dev cluster: explicit > env > config file > prod default.
 */
export async function getBaseUrl(
  explicitBaseUrl?: string | undefined
): Promise<string> {
  if (explicitBaseUrl && explicitBaseUrl.length > 0) return explicitBaseUrl;
  const fromEnv = process.env.AUTOUSERS_BASE_URL;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const cfg = await readConfig();
  return cfg?.baseUrl ?? "https://app.autousers.ai";
}
