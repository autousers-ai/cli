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

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse as parsePath, resolve } from "node:path";

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
  /**
   * Active team slug — Wave 9 added so subsequent commands implicitly
   * scope to the chosen team. Set via `autousers team use <slug>` (or
   * the TUI's Settings → Teams sub-screen). Read by `resolveContext`
   * for downstream commands that surface a team-scoped envelope.
   */
  activeTeamSlug?: string;
  /**
   * Default output mode — Wave 10. `"json"` flips every command into the
   * machine-readable shape without needing `--json` on each invocation.
   * `"text"` is the historical default. Project-level `.autousers.json`
   * overrides global. Per-invocation `--json` always wins.
   */
  output?: "json" | "text";
}

/**
 * Filename for the project-local config — Wave 10 introduced via
 * `autousers init`. Walks up from the CWD like `.git`, `package.json`,
 * etc., so a developer can `cd` anywhere inside a repo and have the same
 * defaults apply. Project config OVERRIDES global config for the fields
 * it specifies; auth (api key / OAuth tokens) is always read from global
 * since `.autousers.json` is intended to be checked in to source control.
 */
export const PROJECT_CONFIG_FILENAME = ".autousers.json";

/**
 * Subset of {@link CliConfig} that is allowed in `.autousers.json`. Auth
 * fields are intentionally absent — committing a refresh token to git is
 * a leak waiting to happen, so the schema simply doesn't allow it. The
 * `init` command writes this shape; the merge logic in {@link getBaseUrl}
 * et al. only reads these fields from project config.
 */
export interface ProjectConfig {
  baseUrl?: string;
  activeTeamSlug?: string;
  output?: "json" | "text";
}

/**
 * Walk up from `startDir` (default: CWD) looking for a `.autousers.json`.
 * Returns the absolute path of the first match, or `null` if the walk
 * reaches the filesystem root without finding one. Same algorithm as
 * `git`, `npm`, and `prettier` use — the user's mental model of "what's
 * my project config" should match every other tool's.
 */
export function findProjectConfigPath(startDir?: string): string | null {
  let dir = resolve(startDir ?? process.cwd());
  const { root } = parsePath(dir);
  while (true) {
    const candidate = join(dir, PROJECT_CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    if (dir === root) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Read the nearest `.autousers.json` walking up from `startDir`. Returns
 * `null` if none is found. Malformed JSON is rethrown so the user gets a
 * clear error rather than silently falling back to global defaults.
 */
export async function readProjectConfig(
  startDir?: string
): Promise<{ path: string; config: ProjectConfig } | null> {
  const path = findProjectConfigPath(startDir);
  if (!path) return null;
  const raw = await readFile(path, "utf8");
  return { path, config: JSON.parse(raw) as ProjectConfig };
}

/**
 * Write a project config to disk. Unlike the global config, project
 * config is NOT chmod'd to `0600` — it's intended to be checked in to
 * source control. Auth is never written here (the {@link ProjectConfig}
 * type doesn't allow it).
 */
export async function writeProjectConfig(
  path: string,
  config: ProjectConfig
): Promise<void> {
  const absPath = resolve(path);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, JSON.stringify(config, null, 2) + "\n", {
    encoding: "utf8",
  });
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
 * dev cluster: explicit > env > project config > global config > prod
 * default. Project config (`.autousers.json` walked up from CWD) overrides
 * global so a per-repo dev cluster Just Works.
 */
export async function getBaseUrl(
  explicitBaseUrl?: string | undefined
): Promise<string> {
  if (explicitBaseUrl && explicitBaseUrl.length > 0) return explicitBaseUrl;
  const fromEnv = process.env.AUTOUSERS_BASE_URL;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  try {
    const project = await readProjectConfig();
    if (project?.config.baseUrl && project.config.baseUrl.length > 0) {
      return project.config.baseUrl;
    }
  } catch {
    // Malformed project config is non-fatal here — getBaseUrl is on the
    // hot path of every command. The next read via readProjectConfig will
    // surface the parse error to the user explicitly.
  }
  const cfg = await readConfig();
  return cfg?.baseUrl ?? "https://app.autousers.ai";
}

/**
 * Resolve the active team slug — Wave 9 plumbed this for `team use`,
 * Wave 10 extends it to also consult project config so a checked-in
 * `.autousers.json` can pin every command to the right team without
 * needing each developer to run `team use`.
 *
 * Priority: explicit (caller-supplied) > project config > global config.
 * Returns `null` if all sources miss.
 */
export async function getActiveTeamSlug(
  explicit?: string | undefined
): Promise<string | null> {
  if (explicit && explicit.length > 0) return explicit;
  try {
    const project = await readProjectConfig();
    if (project?.config.activeTeamSlug) return project.config.activeTeamSlug;
  } catch {
    // Same rationale as getBaseUrl — non-fatal here.
  }
  const cfg = await readConfig();
  return cfg?.activeTeamSlug ?? null;
}

/**
 * Resolve the default output mode. Per-invocation `--json` always wins
 * (handled at the call site); this helper is for the "no flag was
 * passed" case. Project > global > "text".
 */
export async function getDefaultOutput(): Promise<"json" | "text"> {
  try {
    const project = await readProjectConfig();
    if (project?.config.output) return project.config.output;
  } catch {
    // non-fatal
  }
  const cfg = await readConfig();
  return cfg?.output ?? "text";
}
