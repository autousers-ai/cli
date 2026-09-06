/**
 * Wave 9 — Settings screen.
 *
 * Three sub-sections, navigated by ↑↓:
 *
 *   1. **Profile** — read-only display of the signed-in user (email,
 *      team name, plan, free-runs left). Sourced from the existing
 *      `authUser` slice in the store; same data the header banner uses.
 *
 *   2. **BYOK** — Bring-Your-Own-Key for Gemini. Per the Wave 9 audit
 *      the schema is hard-coded to a single `geminiApiKey` column on
 *      User; multi-provider is a Wave 11+ refactor. We expose:
 *        - `t` test the saved key (`POST /api/v1/settings/byok/test`)
 *        - `s` set / replace the saved key (inline input → `POST .../byok`)
 *        - `u` unset the saved key (`DELETE .../byok`)
 *        - `p` probe a TYPED key without saving (`POST .../byok/probe`)
 *      No `--provider` switch — the audit established Gemini-only.
 *
 *   3. **API keys** — list / mint / rename / scope / revoke programmatic keys.
 *        - `n` mint a new key (prompts for name; surfaces the plain key
 *          ONCE with a "won't be shown again" warning)
 *        - `r` rename the highlighted key (`PATCH /api/v1/api-keys/:id`
 *          with `{ name }`)
 *        - `s` edit the highlighted key's scopes (comma-separated list
 *          validated against `VALID_SCOPES`, then `PATCH .../:id` with
 *          `{ scopes }`)
 *        - `R` revoke the highlighted key (`DELETE /api/v1/api-keys/:id`)
 *      Rename + scope edit are disabled on revoked keys (a one-line
 *      red inline error nudges the user; the PATCH call is suppressed).
 *
 *   4. **Switch active team** — delegates to the teams-section screen.
 *
 * Esc returns to the menu. The screen is intentionally compact; the
 * uxrater port is ~800 LOC of detail panels we don't need at v1.0 —
 * a single scrollable section per resource is the minimum viable
 * surface and matches what a power user reaches for in the CLI.
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
 * Mirror of `VALID_SCOPES` in `lib/api/scope.ts` — we don't share
 * code with the Next.js app (CLI is a standalone npm package) so we
 * keep a tiny copy here and validate input client-side. Stays in
 * lock-step with the server allowlist; if the server rejects the
 * PATCH, the toast surfaces the error verbatim.
 */
const VALID_SCOPES = [
  "*",
  "templates:read",
  "templates:write",
  "templates:*",
  "evaluations:read",
  "evaluations:write",
  "evaluations:*",
  "autousers:read",
  "autousers:write",
  "autousers:*",
  "ratings:read",
  "ratings:write",
  "ratings:*",
] as const;

/**
 * Parse a user-typed comma-separated scope list into a normalized,
 * validated array. Returns either `{ scopes }` (success) or
 * `{ invalid }` listing the rejected tokens for an inline error.
 *
 * UX choice: comma-list rather than an interactive multi-select picker.
 * Power-users who reach the API-keys section already know the scope
 * names; an inline picker would be ~150 LOC of Ink for a screen that
 * is consciously kept lightweight (see header docs).
 */
function parseScopeList(raw: string): {
  scopes: string[];
  invalid: string[];
} {
  const tokens = raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const t of tokens) {
    if ((VALID_SCOPES as readonly string[]).includes(t)) {
      valid.push(t);
    } else {
      invalid.push(t);
    }
  }
  return { scopes: valid, invalid };
}

type Section =
  | "profile"
  | "byok"
  | "api-keys"
  | "usage"
  | "connected-apps"
  | "teams";

interface ByokState {
  configured: boolean;
  active: boolean;
  hint: string | null;
  addedAt: string | null;
}

interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

interface SettingsProps {
  /** Test seam — substitute the API client factory. */
  createClient?: () => Promise<
    Pick<AutousersClient, "get" | "post" | "patch" | "delete">
  >;
}

// ─── Component ─────────────────────────────────────────────────────────────

const SECTIONS: Array<{ id: Section; label: string; description: string }> = [
  {
    id: "profile",
    label: "Profile",
    description: "Signed-in user, team, plan, free-runs left",
  },
  {
    id: "byok",
    label: "BYOK · Gemini API key",
    description: "Use your own Google AI Studio key for runs",
  },
  {
    id: "api-keys",
    label: "API keys",
    description: "Mint / revoke ak_live_* keys for programmatic access",
  },
  {
    id: "usage",
    label: "Usage",
    description: "Runs, tokens, cost, and free-quota progress",
  },
  {
    id: "connected-apps",
    label: "Connected apps",
    description: "Review / revoke OAuth grants (e.g. Claude.ai MCP)",
  },
  {
    id: "teams",
    label: "Switch active team",
    description: "Pick which team subsequent commands scope to",
  },
];

export function Settings(props: SettingsProps = {}) {
  const setScreen = useTUIStore((s) => s.setScreen);
  const setToast = useTUIStore((s) => s.setToast);
  const activeTeamSlug = useTUIStore((s) => s.activeTeamSlug);

  const [selected, setSelected] = useState(0);
  const [byokState, setByokState] = useState<ByokState | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [apiKeyCursor, setApiKeyCursor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /** Inline-input state — null when no input pending. */
  const [inputPrompt, setInputPrompt] = useState<{
    label: string;
    value: string;
    onSubmit: (value: string) => Promise<void> | void;
  } | null>(null);

  /** Plain key surfaced once after mint — null when nothing to show. */
  const [mintedKey, setMintedKey] = useState<{
    name: string;
    plainKey: string;
  } | null>(null);

  /**
   * Single-line inline error for the API-keys section (e.g. "can't
   * rename a revoked key" or "unknown scope: foo"). Cleared the next
   * time the user takes any action on the section.
   */
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      setLoading(true);
      setError(null);
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      const [byok, keys] = await Promise.all([
        client
          .get<{ data: ByokState }>("/api/v1/settings/byok")
          .then((env) => env.data)
          .catch(() => null),
        client
          .get<{ data: ApiKeyRow[] }>("/api/v1/api-keys")
          .then((env) => env.data)
          .catch(() => [] as ApiKeyRow[]),
      ]);
      setByokState(byok);
      setApiKeys(keys);
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

  // ─── BYOK actions ───────────────────────────────────────────────────────

  async function byokTest(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    try {
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      const env = await client.post<{
        data: { status: string; statusCode?: number };
      }>("/api/v1/settings/byok/test", {});
      const status = env.data.status ?? "unknown";
      setToast({
        kind: status === "ok" ? "success" : "info",
        message: `BYOK test: ${status}`,
      });
      setTimeout(() => setToast(null), 4000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: "error", message: `Test failed: ${msg}` });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSubmitting(false);
    }
  }

  async function byokSet(apiKey: string): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    try {
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      await client.post("/api/v1/settings/byok", { apiKey });
      setToast({ kind: "success", message: "Gemini key saved." });
      setTimeout(() => setToast(null), 3000);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: "error", message: `Save failed: ${msg}` });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSubmitting(false);
    }
  }

  async function byokProbe(apiKey: string): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    try {
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      const env = await client.post<{
        data: { status: string };
      }>("/api/v1/settings/byok/probe", { apiKey });
      setToast({
        kind: env.data.status === "ok" ? "success" : "info",
        message: `Probe: ${env.data.status}`,
      });
      setTimeout(() => setToast(null), 4000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: "error", message: `Probe failed: ${msg}` });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSubmitting(false);
    }
  }

  async function byokUnset(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    try {
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      await client.delete("/api/v1/settings/byok");
      setToast({ kind: "success", message: "Gemini key cleared." });
      setTimeout(() => setToast(null), 3000);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: "error", message: `Unset failed: ${msg}` });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSubmitting(false);
    }
  }

  // ─── API keys actions ────────────────────────────────────────────────────

  async function mintApiKey(name: string): Promise<void> {
    if (submitting || !name.trim()) return;
    setSubmitting(true);
    try {
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      const env = await client.post<{
        data: { name: string; plainKey: string };
      }>("/api/v1/api-keys", { name: name.trim(), scopes: [] });
      setMintedKey({ name: env.data.name, plainKey: env.data.plainKey });
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: "error", message: `Mint failed: ${msg}` });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSubmitting(false);
    }
  }

  async function revokeApiKey(id: string): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    try {
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      await client.delete(`/api/v1/api-keys/${encodeURIComponent(id)}`);
      setToast({ kind: "success", message: "Key revoked." });
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

  async function renameApiKey(id: string, name: string): Promise<void> {
    if (submitting || !name.trim()) return;
    setSubmitting(true);
    try {
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      await client.patch(`/api/v1/api-keys/${encodeURIComponent(id)}`, {
        name: name.trim(),
      });
      setToast({ kind: "success", message: "Key renamed." });
      setTimeout(() => setToast(null), 3000);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: "error", message: `Rename failed: ${msg}` });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSubmitting(false);
    }
  }

  async function editScopes(id: string, raw: string): Promise<void> {
    if (submitting) return;
    const { scopes, invalid } = parseScopeList(raw);
    if (invalid.length > 0) {
      setApiKeyError(`Unknown scope: ${invalid.join(", ")}`);
      return;
    }
    setSubmitting(true);
    try {
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      await client.patch(`/api/v1/api-keys/${encodeURIComponent(id)}`, {
        scopes,
      });
      setToast({ kind: "success", message: "Scopes updated." });
      setTimeout(() => setToast(null), 3000);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: "error", message: `Scope edit failed: ${msg}` });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Input handling ─────────────────────────────────────────────────────

  useInput((input, key) => {
    if (submitting) return;

    // The minted-key reveal banner owns input until acknowledged.
    if (mintedKey) {
      if (key.return || key.escape || input === "y") {
        setMintedKey(null);
      }
      return;
    }

    // Inline input owns input when active.
    if (inputPrompt) {
      if (key.escape) {
        setInputPrompt(null);
        return;
      }
      if (key.return) {
        const trimmed = inputPrompt.value.trim();
        const handler = inputPrompt.onSubmit;
        setInputPrompt(null);
        if (trimmed) void handler(trimmed);
        return;
      }
      if (key.backspace || key.delete) {
        setInputPrompt({
          ...inputPrompt,
          value: inputPrompt.value.slice(0, -1),
        });
        return;
      }
      if (
        input &&
        !key.upArrow &&
        !key.downArrow &&
        !key.leftArrow &&
        !key.rightArrow &&
        !key.tab
      ) {
        setInputPrompt({ ...inputPrompt, value: inputPrompt.value + input });
      }
      return;
    }

    if (key.escape) {
      setScreen("menu");
      return;
    }
    if (key.upArrow) {
      setSelected((s) => Math.max(0, s - 1));
      return;
    }
    if (key.downArrow) {
      setSelected((s) => Math.min(SECTIONS.length - 1, s + 1));
      return;
    }
    if (key.return) {
      const cur = SECTIONS[selected];
      if (cur?.id === "teams") {
        setScreen("teams-section");
      } else if (cur?.id === "usage") {
        setScreen("usage-section");
      } else if (cur?.id === "connected-apps") {
        setScreen("connected-apps-section");
      }
      return;
    }

    const cur = SECTIONS[selected];

    if (cur?.id === "byok") {
      if (input === "t") {
        void byokTest();
        return;
      }
      if (input === "s") {
        setInputPrompt({
          label: "Enter Gemini API key (starts with AIza)",
          value: "",
          onSubmit: byokSet,
        });
        return;
      }
      if (input === "p") {
        setInputPrompt({
          label: "Probe an API key (typed key, not saved)",
          value: "",
          onSubmit: byokProbe,
        });
        return;
      }
      if (input === "u") {
        void byokUnset();
        return;
      }
    }

    if (cur?.id === "api-keys") {
      if (input === "n") {
        setApiKeyError(null);
        setInputPrompt({
          label: "Name for the new API key",
          value: "",
          onSubmit: mintApiKey,
        });
        return;
      }
      if (key.downArrow || key.upArrow) {
        // already handled by section nav above
      }
      if (input === "j") {
        setApiKeyError(null);
        setApiKeyCursor((s) => Math.min(apiKeys.length - 1, s + 1));
        return;
      }
      if (input === "k") {
        setApiKeyError(null);
        setApiKeyCursor((s) => Math.max(0, s - 1));
        return;
      }
      if (input === "r" && apiKeys[apiKeyCursor]) {
        const row = apiKeys[apiKeyCursor]!;
        if (row.revokedAt) {
          setApiKeyError("Cannot rename a revoked key.");
          return;
        }
        setApiKeyError(null);
        const id = row.id;
        setInputPrompt({
          label: `Rename "${row.name}" — type the new name`,
          value: row.name,
          onSubmit: (v) => renameApiKey(id, v),
        });
        return;
      }
      if (input === "s" && apiKeys[apiKeyCursor]) {
        const row = apiKeys[apiKeyCursor]!;
        if (row.revokedAt) {
          setApiKeyError("Cannot edit scopes on a revoked key.");
          return;
        }
        setApiKeyError(null);
        const id = row.id;
        setInputPrompt({
          label:
            "Scopes (comma-separated, e.g. evaluations:read,evaluations:write)",
          value: row.scopes.join(","),
          onSubmit: (v) => editScopes(id, v),
        });
        return;
      }
      if (input === "R" && apiKeys[apiKeyCursor]) {
        setApiKeyError(null);
        void revokeApiKey(apiKeys[apiKeyCursor]!.id);
        return;
      }
    }
  });

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box paddingBottom={1}>
        <Text bold color={Theme.brand}>
          Settings
        </Text>
        <Text dimColor>
          {"  "}
          {activeTeamSlug ? `(active team: ${activeTeamSlug})` : ""}
        </Text>
      </Box>

      {error ? (
        <Box paddingBottom={1}>
          <Text color={Theme.error}>Error: {error}</Text>
        </Box>
      ) : null}

      {loading ? (
        <Text color={Theme.brand}>Loading…</Text>
      ) : (
        <Box flexDirection="column" gap={0}>
          {SECTIONS.map((s, i) => {
            const isCursor = i === selected;
            return (
              <Box
                key={s.id}
                flexDirection="column"
                marginTop={i > 0 ? 1 : 0}
                borderStyle={isCursor ? "single" : undefined}
                borderColor={isCursor ? Theme.brand : undefined}
                paddingX={isCursor ? 1 : 0}
              >
                <Text
                  bold={isCursor}
                  color={isCursor ? Theme.brand : undefined}
                >
                  {isCursor ? "❯ " : "  "}
                  {s.label}
                </Text>
                <Text dimColor>{s.description}</Text>
                {isCursor && s.id === "profile" ? <ProfileBody /> : null}
                {isCursor && s.id === "byok" ? (
                  <ByokBody state={byokState} />
                ) : null}
                {isCursor && s.id === "api-keys" ? (
                  <ApiKeysBody
                    rows={apiKeys}
                    cursor={apiKeyCursor}
                    minted={mintedKey}
                    inlineError={apiKeyError}
                  />
                ) : null}
              </Box>
            );
          })}
        </Box>
      )}

      {inputPrompt ? (
        <Box
          marginTop={1}
          borderStyle="round"
          borderColor={Theme.brand}
          paddingX={1}
          flexDirection="column"
        >
          <Text dimColor>{inputPrompt.label}</Text>
          <Text>
            <Text color={Theme.brand}>{"❯ "}</Text>
            {inputPrompt.value}
            <Text color={Theme.brand}>{"█"}</Text>
          </Text>
          <Text dimColor>Enter submit · Esc cancel</Text>
        </Box>
      ) : null}

      {/* Footer */}
      <Box paddingTop={1}>
        <Text dimColor>
          {hintForSection(SECTIONS[selected]?.id ?? "profile")}
        </Text>
      </Box>
    </Box>
  );
}

function ProfileBody() {
  const authUser = useTUIStore((s) => s.authUser);
  if (!authUser) {
    return (
      <Text dimColor>Not signed in. Press l on the main menu to sign in.</Text>
    );
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>Email: {authUser.email}</Text>
      {authUser.teamName ? (
        <Text dimColor>Team: {authUser.teamName}</Text>
      ) : null}
      {authUser.plan ? <Text dimColor>Plan: {authUser.plan}</Text> : null}
      {authUser.freeRunsLeft != null && authUser.freeRunsTotal != null ? (
        <Text dimColor>
          Free runs: {authUser.freeRunsLeft} / {authUser.freeRunsTotal}
        </Text>
      ) : null}
    </Box>
  );
}

function ByokBody({ state }: { state: ByokState | null }) {
  if (!state) {
    return <Text dimColor>BYOK status unavailable. (Sign in or retry.)</Text>;
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>
        Configured: {state.configured ? "yes" : "no"}
        {state.hint ? `  ·  …${state.hint}` : ""}
      </Text>
      <Text dimColor>Active: {state.active ? "yes" : "no"}</Text>
      {state.addedAt ? (
        <Text dimColor>Added: {new Date(state.addedAt).toLocaleString()}</Text>
      ) : null}
      <Text dimColor>Keys: t test · s set · p probe · u unset</Text>
    </Box>
  );
}

function ApiKeysBody({
  rows,
  cursor,
  minted,
  inlineError,
}: {
  rows: ApiKeyRow[];
  cursor: number;
  minted: { name: string; plainKey: string } | null;
  inlineError: string | null;
}) {
  return (
    <Box flexDirection="column" marginTop={1}>
      {minted ? (
        <Box
          borderStyle="single"
          borderColor={Theme.warning}
          paddingX={1}
          flexDirection="column"
          marginBottom={1}
        >
          <Text color={Theme.warning} bold>
            ⚠ Save this key now — it will NEVER be shown again.
          </Text>
          <Text>{minted.plainKey}</Text>
          <Text dimColor>name: {minted.name}</Text>
          <Text dimColor>(press Enter to dismiss)</Text>
        </Box>
      ) : null}
      {rows.length === 0 ? (
        <Text dimColor>No keys yet. Press n to mint one.</Text>
      ) : (
        rows.map((row, i) => {
          const isCursor = i === cursor;
          return (
            <Box key={row.id} gap={1}>
              <Text color={isCursor ? Theme.brand : undefined}>
                {isCursor ? "›" : " "}
              </Text>
              <Box width={20}>
                <Text bold={isCursor}>{row.name}</Text>
              </Box>
              <Box width={14}>
                <Text dimColor>{row.keyPrefix}…</Text>
              </Box>
              <Text dimColor>{row.revokedAt ? "revoked" : "active"}</Text>
            </Box>
          );
        })
      )}
      {inlineError ? <Text color={Theme.error}>{inlineError}</Text> : null}
      <Text dimColor>n new · r rename · s scopes · R revoke · ↑↓ select</Text>
      <Text dimColor>(j/k to move row cursor within the list)</Text>
    </Box>
  );
}

function hintForSection(id: Section): string {
  if (id === "byok") {
    return "↑↓ section · t test · s set · p probe · u unset · Esc back";
  }
  if (id === "api-keys") {
    return "↑↓ section · n new · r rename · s scopes · R revoke · j/k row · Esc back";
  }
  if (id === "teams") {
    return "↑↓ section · Enter switch teams · Esc back";
  }
  if (id === "usage") {
    return "↑↓ section · Enter open usage · Esc back";
  }
  if (id === "connected-apps") {
    return "↑↓ section · Enter manage connected apps · Esc back";
  }
  return "↑↓ section · Esc back";
}
