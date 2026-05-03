/**
 * Runtime helpers for the TUI dashboard.
 *
 * The dashboard's SSE runner needs the raw bearer token (so it can set
 * `Authorization: Bearer ...` on the fetch). The plain-mode CLI exposes
 * a constructed `AutousersClient` via {@link createClientFromConfig}
 * which intentionally hides its bearer behind a `request()` method.
 *
 * Exposing a separate, narrowly-scoped resolver here keeps the public
 * client API hidden — `resolveBearerForRunner` lives outside `client.ts`
 * so the dashboard is the only thing reaching for the raw bearer.
 */

import { readConfig } from "../config.js";
import { MissingApiKeyError } from "../errors.js";

/**
 * Resolve the bearer token using the same precedence the rest of the
 * CLI uses: `--key` flag (impossible to read in TUI context, so we
 * skip it) → `AUTOUSERS_API_KEY` env → OAuth `accessToken` from
 * config → `apiKey` from config.
 *
 * Throws `MissingApiKeyError` when nothing resolves.
 */
export async function resolveBearerForRunner(): Promise<string> {
  const fromEnv = process.env.AUTOUSERS_API_KEY;
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  const cfg = await readConfig();
  if (cfg?.accessToken && cfg.accessToken.length > 0) return cfg.accessToken;
  if (cfg?.apiKey && cfg.apiKey.length > 0) return cfg.apiKey;

  throw new MissingApiKeyError();
}
