/**
 * Wave 9 — Teams section screen.
 *
 * Lists every team the caller belongs to and lets them pick the
 * "active team" — a config-only concept persisted to
 * `~/.autousers/config.json` so subsequent commands implicitly scope
 * to it. Plain-mode equivalent: `autousers team use <slug>`.
 *
 * Also exposes destructive flows on the highlighted team:
 *   - `l` leave team (`POST /api/v1/teams/:id/leave`)
 *   - `t` transfer admin (asks for the recipient's user id, then
 *     `POST /api/v1/teams/:id/transfer-admin`)
 *
 * Scope is intentionally tight at v1.0. Team creation and full member
 * management belong on the web app — the CLI just needs "switch which
 * team I'm working with" and "leave / transfer".
 *
 * Esc returns to the parent — settings or menu, depending on entry
 * path.
 */
import { useEffect, useState } from "react";
import { Box, Text, useInput } from "@jrichman/ink";

import {
  createClientFromConfig,
  type AutousersClient,
} from "../../../client.js";
import { readConfig, writeConfig } from "../../../config.js";
import { useTUIStore } from "../../state.js";
import { Theme } from "../../theme.js";

// ─── Types ─────────────────────────────────────────────────────────────────

interface TeamRow {
  id: string;
  name: string;
  description: string | null;
  isPersonal: boolean;
  memberCount: number;
  userRole: string | null;
  /**
   * Most teams expose a slug; falling back to the id keeps `team use`
   * from breaking when the server response is missing the field.
   */
  slug?: string;
}

interface TeamsSectionProps {
  /** Test seam — substitute the API client factory. */
  createClient?: () => Promise<
    Pick<AutousersClient, "get" | "post" | "delete">
  >;
  /**
   * Test seam — replace the persistence step so tests don't write to
   * the user's actual `~/.autousers/config.json`. Defaults to the real
   * config writer.
   */
  persistActiveTeam?: (slug: string) => Promise<void>;
}

// ─── Component ─────────────────────────────────────────────────────────────

async function defaultPersist(slug: string): Promise<void> {
  const cfg = (await readConfig()) ?? {};
  await writeConfig({ ...cfg, activeTeamSlug: slug });
}

export function TeamsSection(props: TeamsSectionProps = {}) {
  const setScreen = useTUIStore((s) => s.setScreen);
  const setToast = useTUIStore((s) => s.setToast);
  const setActiveTeamSlug = useTUIStore((s) => s.setActiveTeamSlug);
  const activeTeamSlug = useTUIStore((s) => s.activeTeamSlug);

  const [rows, setRows] = useState<TeamRow[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [inputPrompt, setInputPrompt] = useState<{
    label: string;
    value: string;
    onSubmit: (value: string) => void | Promise<void>;
  } | null>(null);

  async function load(): Promise<void> {
    try {
      setLoading(true);
      setError(null);
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      const env = await client.get<{ data: TeamRow[] }>("/api/v1/teams");
      setRows(env.data);
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

  async function switchActive(row: TeamRow): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    try {
      const slug = row.slug ?? row.id;
      const persist = props.persistActiveTeam ?? defaultPersist;
      await persist(slug);
      setActiveTeamSlug(slug);
      setToast({
        kind: "success",
        message: `Active team: ${row.name}`,
      });
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: "error", message: `Switch failed: ${msg}` });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSubmitting(false);
    }
  }

  async function leaveTeam(row: TeamRow): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    try {
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      await client.post(
        `/api/v1/teams/${encodeURIComponent(row.id)}/leave`,
        {}
      );
      setToast({ kind: "success", message: `Left ${row.name}` });
      setTimeout(() => setToast(null), 3000);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: "error", message: `Leave failed: ${msg}` });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSubmitting(false);
    }
  }

  async function transferAdmin(row: TeamRow, toUserId: string): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    try {
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      await client.post(
        `/api/v1/teams/${encodeURIComponent(row.id)}/transfer-admin`,
        { newOwnerId: toUserId }
      );
      setToast({
        kind: "success",
        message: `Admin transferred for ${row.name}`,
      });
      setTimeout(() => setToast(null), 3000);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: "error", message: `Transfer failed: ${msg}` });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSubmitting(false);
    }
  }

  useInput((input, key) => {
    if (submitting) return;

    if (inputPrompt) {
      if (key.escape) {
        setInputPrompt(null);
        return;
      }
      if (key.return) {
        const value = inputPrompt.value.trim();
        const handler = inputPrompt.onSubmit;
        setInputPrompt(null);
        if (value) void handler(value);
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
      setScreen("settings");
      return;
    }
    if (key.upArrow) {
      setSelected((s) => Math.max(0, s - 1));
      return;
    }
    if (key.downArrow) {
      setSelected((s) => Math.min(Math.max(0, rows.length - 1), s + 1));
      return;
    }
    const cursor = rows[selected];
    if (key.return && cursor) {
      void switchActive(cursor);
      return;
    }
    if (input === "l" && cursor) {
      void leaveTeam(cursor);
      return;
    }
    if (input === "t" && cursor) {
      setInputPrompt({
        label: `Transfer admin for ${cursor.name}: enter new owner's user id`,
        value: "",
        onSubmit: (value) => transferAdmin(cursor, value),
      });
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box paddingBottom={1}>
        <Text bold color={Theme.brand}>
          Teams
        </Text>
        {activeTeamSlug ? (
          <Text dimColor>
            {"  "}(active: {activeTeamSlug})
          </Text>
        ) : null}
      </Box>

      {error ? (
        <Box paddingBottom={1}>
          <Text color={Theme.error}>Error: {error}</Text>
        </Box>
      ) : null}

      {loading ? (
        <Text color={Theme.brand}>Loading…</Text>
      ) : rows.length === 0 ? (
        <Text dimColor>No teams found.</Text>
      ) : (
        rows.map((row, i) => {
          const isCursor = i === selected;
          const slug = row.slug ?? row.id;
          const isActive = activeTeamSlug === slug;
          return (
            <Box key={row.id} gap={1}>
              <Text color={isCursor ? Theme.brand : undefined} bold={isCursor}>
                {isCursor ? ">" : " "}
              </Text>
              <Box width={28}>
                <Text bold={isCursor}>
                  {row.name}
                  {isActive ? " ★" : ""}
                </Text>
              </Box>
              <Box width={10}>
                <Text dimColor>{row.userRole ?? "—"}</Text>
              </Box>
              <Box width={12}>
                <Text dimColor>{row.memberCount} members</Text>
              </Box>
              <Text dimColor>{row.isPersonal ? "personal" : "shared"}</Text>
            </Box>
          );
        })
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

      <Box paddingTop={1}>
        <Text dimColor>
          ↑↓ nav · Enter set active · l leave · t transfer admin · Esc back
        </Text>
      </Box>
    </Box>
  );
}
