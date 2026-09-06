/**
 * Connected apps section screen — CLI mirror of the web
 * `/settings/connected-apps` page.
 *
 * Lists every active OAuth grant the signed-in user has issued (Claude.ai
 * MCP host, future first-party clients, CIMD URL-clients, …) and lets the
 * user revoke any of them. Plain-mode equivalent: none yet — this is a
 * TUI-only surface. The web page remains the canonical source of truth.
 *
 * API surface
 * -----------
 *   GET    /api/v1/oauth/connected-apps
 *     → list grants (envelope: `{ data: ConnectedApp[] }`).
 *   DELETE /api/v1/oauth/connected-apps?client_id={clientId}
 *     → revoke every active refresh token + consent row for the given
 *       clientId. The route is **session-only** — bearer-authed CLI
 *       callers will get a 403 with a "sign in via the web" message,
 *       which is rendered inline so the user knows where to go.
 *
 * UX
 * --
 *   - Header: "Connected apps"
 *   - One row per grant: `<name> · scopes: a, b · granted <Nm/Nh/Nd ago>`
 *   - j/k or ↑/↓ to highlight a row
 *   - `R` (capital, matching the api-keys revoke convention) prompts a
 *     y/n confirmation, then issues the DELETE call.
 *   - Empty state directs the user to the web `/help/mcp` flow which is
 *     where MCP hosts authorise.
 *   - Esc → returns to `"settings"` (parent).
 *
 * Why session-only doesn't break this screen
 * ------------------------------------------
 * The route rejects bearer auth entirely, but if a user is running the
 * TUI with a CLI bearer they still want to *see* what they have
 * authorised. The list call surfaces a friendly inline error rather
 * than a stack trace, with a hint that revocation must happen via the
 * web. This matches the web page's degradation behaviour for users
 * whose session has expired.
 */
import { useEffect, useState } from "react";
import { Box, Text, useInput } from "@jrichman/ink";

import {
  createClientFromConfig,
  type AutousersClient,
} from "../../../client.js";
import { useTUIStore } from "../../state.js";
import { Theme } from "../../theme.js";

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * Subset of `ConnectedApp` from `app/api/v1/oauth/connected-apps/_lib.ts`
 * that the CLI needs. Web-only fields (clientLogoSrc) are omitted so the
 * test stub stays small. Anything we don't read here is harmless extra
 * over the wire.
 */
interface ConnectedApp {
  clientId: string;
  clientName: string;
  isCimd: boolean;
  scopes: string[];
  grantedAt: string;
  lastUsedAt: string | null;
  refreshTokenCount: number;
  hasNoActiveSessions: boolean;
}

interface ConnectedAppsSectionProps {
  /** Test seam — substitute the API client factory. */
  createClient?: () => Promise<
    Pick<AutousersClient, "get" | "post" | "delete">
  >;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Friendly relative-time formatter — matches the conventions used by the
 * web `ConnectedAppsList` ("just now" / "5m ago" / "2d ago") so the two
 * surfaces vocab-align.
 */
function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "never";
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 30 * 86400) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ─── Component ─────────────────────────────────────────────────────────────

export function ConnectedAppsSection(props: ConnectedAppsSectionProps = {}) {
  const setScreen = useTUIStore((s) => s.setScreen);
  const setToast = useTUIStore((s) => s.setToast);

  const [rows, setRows] = useState<ConnectedApp[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** Confirm-prompt state — null when no revoke is pending. */
  const [confirm, setConfirm] = useState<ConnectedApp | null>(null);

  async function load(): Promise<void> {
    try {
      setLoading(true);
      setError(null);
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      const env = await client.get<{ data: ConnectedApp[] }>(
        "/api/v1/oauth/connected-apps"
      );
      setRows(Array.isArray(env.data) ? env.data : []);
      setSelected(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function revoke(app: ConnectedApp): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    try {
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      // Route accepts DELETE with `?client_id=...`. The clientId for CIMD
      // is an https URL — encodeURIComponent keeps the `:` and `/` from
      // tripping up the URL parser.
      await client.delete(
        `/api/v1/oauth/connected-apps?client_id=${encodeURIComponent(app.clientId)}`
      );
      setToast({
        kind: "success",
        message: `Revoked ${app.clientName}`,
      });
      setTimeout(() => setToast(null), 3000);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: "error", message: `Revoke failed: ${msg}` });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Input handling ─────────────────────────────────────────────────────

  useInput((input, key) => {
    if (submitting) return;

    // Confirm prompt owns input until the user picks y/n or aborts.
    if (confirm) {
      if (key.escape || input === "n" || input === "N") {
        setConfirm(null);
        return;
      }
      if (input === "y" || input === "Y" || key.return) {
        const target = confirm;
        setConfirm(null);
        void revoke(target);
        return;
      }
      return;
    }

    if (key.escape) {
      setScreen("settings");
      return;
    }
    if (key.upArrow || input === "k") {
      setSelected((s) => Math.max(0, s - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setSelected((s) => Math.min(Math.max(0, rows.length - 1), s + 1));
      return;
    }
    const cursor = rows[selected];
    if (input === "R" && cursor) {
      setConfirm(cursor);
      return;
    }
  });

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box paddingBottom={1}>
        <Text bold color={Theme.brand}>
          Connected apps
        </Text>
      </Box>

      {error ? (
        <Box paddingBottom={1}>
          <Text color={Theme.error}>Error: {error}</Text>
        </Box>
      ) : null}

      {loading ? (
        <Text color={Theme.brand}>Loading…</Text>
      ) : rows.length === 0 ? (
        <Text dimColor>
          No connected apps. Authorise via /help/mcp on the web.
        </Text>
      ) : (
        rows.map((row, i) => {
          const isCursor = i === selected;
          const scopeStr = row.scopes.length
            ? row.scopes.join(", ")
            : "(no scopes)";
          return (
            <Box key={row.clientId} flexDirection="column">
              <Box gap={1}>
                <Text
                  color={isCursor ? Theme.brand : undefined}
                  bold={isCursor}
                >
                  {isCursor ? ">" : " "}
                </Text>
                <Text bold={isCursor}>
                  {row.clientName}
                  {row.isCimd ? " (CIMD)" : ""}
                </Text>
                <Text dimColor>·</Text>
                <Text dimColor>scopes: {scopeStr}</Text>
                <Text dimColor>·</Text>
                <Text dimColor>granted {relativeTime(row.grantedAt)}</Text>
              </Box>
              {isCursor && row.hasNoActiveSessions ? (
                <Box paddingLeft={2}>
                  <Text dimColor>
                    Authorised — no active session ({row.refreshTokenCount}{" "}
                    active tokens)
                  </Text>
                </Box>
              ) : null}
            </Box>
          );
        })
      )}

      {confirm ? (
        <Box
          marginTop={1}
          borderStyle="round"
          borderColor={Theme.warning}
          paddingX={1}
          flexDirection="column"
        >
          <Text color={Theme.warning} bold>
            Revoke {confirm.clientName}?
          </Text>
          <Text dimColor>
            Every active session for this app will be invalidated. (y / n)
          </Text>
        </Box>
      ) : null}

      <Box paddingTop={1}>
        <Text dimColor>R revoke · ↑↓ select · ESC back</Text>
      </Box>
    </Box>
  );
}
