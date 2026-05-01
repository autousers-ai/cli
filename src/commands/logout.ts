/**
 * `autousers logout` — wipe local credentials.
 *
 * If an OAuth refresh token is on disk we make a best-effort POST to
 * `/oauth/revoke` (RFC 7009) so the AS marks the token revoked server-side
 * BEFORE we delete it from disk. Order matters: if we wiped first then
 * tried to revoke, we'd have lost the refresh token and the AS would
 * keep the row alive until natural expiry.
 *
 * Revocation is intentionally best-effort — a network failure shouldn't
 * keep the user "logged in" locally when they explicitly asked to sign
 * out. We log a warning to stderr and continue.
 *
 * Wipe semantics: ALL credential fields go (paste-mode `apiKey` AND
 * OAuth `accessToken`/`refreshToken`/`expiresAt`/`clientId`). Non-credential
 * fields (`baseUrl`) are preserved so a developer pinned to a dev cluster
 * doesn't have to re-set the override every time.
 */

import {
  clearOAuthFields,
  configPath,
  getBaseUrl,
  readConfig,
  writeConfig,
  type CliConfig,
} from "../config.js";

interface LogoutFlags {
  baseUrl?: string;
}

export async function logoutCommand(flags: LogoutFlags = {}): Promise<void> {
  const cfg = await readConfig();
  if (!cfg || (!cfg.apiKey && !cfg.refreshToken && !cfg.accessToken)) {
    process.stdout.write(`Already logged out.\n`);
    return;
  }

  // Best-effort server-side revoke. Only meaningful for OAuth tokens —
  // `ak_live_*` keys are revoked from the dashboard, not by the CLI.
  if (cfg.refreshToken && cfg.clientId) {
    const baseUrl = await getBaseUrl(flags.baseUrl);
    try {
      const body = new URLSearchParams({
        token: cfg.refreshToken,
        token_type_hint: "refresh_token",
        client_id: cfg.clientId,
      });
      const res = await fetch(`${baseUrl}/oauth/revoke`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: body.toString(),
      });
      if (!res.ok) {
        // RFC 7009 §2.2 — even unknown tokens get 200, so a non-2xx is
        // a real server problem. Log + continue per "best effort" rule.
        process.stderr.write(
          `Warning: server-side revoke returned HTTP ${res.status}; continuing with local wipe.\n`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `Warning: server-side revoke failed (${message}); continuing with local wipe.\n`
      );
    }
  }

  // Wipe local creds. Preserve `baseUrl` so a dev-cluster override
  // survives logout (most CLIs follow this convention).
  const next: CliConfig = clearOAuthFields(cfg);
  delete next.apiKey;
  await writeConfig(next);

  process.stdout.write(
    `OK Logged out. Local credentials cleared from ${configPath()}.\n`
  );
}
