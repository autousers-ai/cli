/**
 * Wave 8 — Autouser hub screen.
 *
 * Lists every autouser visible to the caller (built-in + custom),
 * surfaces the metadata users care about (status, calibration, source),
 * and exposes the keybinds for create / edit / duplicate / delete /
 * calibrate / open-in-browser.
 *
 * Adapted from uxrater's `cli/components/screens/autoraters-hub.tsx`,
 * trimmed to autousers' tighter envelope shape (no behavior-profile
 * sliders rendered server-side; we surface what the autousers list
 * endpoint exposes plus the calibration status). The richer detail pane
 * lives in the autorater-creator preview — the hub is intentionally a
 * scannable index.
 *
 * Routing:
 *   - `n` opens the AI-assisted creator (autorater-creator screen)
 *   - `f` opens the same creator pre-toggled to manual form (Wave 8 fold-back)
 *   - `Enter` opens the creator in edit mode for the highlighted custom row
 *   - `d` duplicates (POST .../duplicate); built-ins duplicate to a custom
 *   - `D` deletes (custom only) with a y/N confirm banner
 *   - `c` opens the calibration wizard for the highlighted custom row
 *   - `o` prints the dashboard URL (best-effort — no shell `open`)
 *   - `Esc` returns to the menu
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

/** Row shape returned by `GET /api/v1/autousers`. */
export interface HubAutouserRow {
  id: string;
  name: string;
  description: string | null;
  role: string;
  isSystem: boolean;
  status: string;
  visibility: string;
  source: "built-in" | "custom";
  calibrationStatus?: string;
  updatedAt: string;
}

interface AutouserListEnvelope {
  data: HubAutouserRow[];
  has_more: boolean;
  next_cursor?: string;
}

interface AutoratersHubProps {
  /** Test seam — substitute the API client factory. */
  createClient?: () => Promise<
    Pick<AutousersClient, "get" | "post" | "delete">
  >;
  /** Test seam — control how the screen reports navigation requests. */
  baseUrl?: string;
}

type SourceFilter = "all" | "built-in" | "custom";

// ─── Helpers (exported for tests) ──────────────────────────────────────────

export function applyHubFilters(
  rows: HubAutouserRow[],
  filter: SourceFilter
): HubAutouserRow[] {
  if (filter === "all") return rows;
  return rows.filter((r) => r.source === filter);
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function AutoratersHub(props: AutoratersHubProps = {}) {
  const setScreen = useTUIStore((s) => s.setScreen);
  const setEditingAutouserId = useTUIStore((s) => s.setEditingAutouserId);
  const setCalibratingAutouserId = useTUIStore(
    (s) => s.setCalibratingAutouserId
  );
  const setToast = useTUIStore((s) => s.setToast);

  const [rows, setRows] = useState<HubAutouserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [confirmDelete, setConfirmDelete] = useState<HubAutouserRow | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);

  const baseUrl =
    props.baseUrl ??
    process.env.AUTOUSERS_BASE_URL ??
    "https://app.autousers.ai";

  async function load(): Promise<void> {
    try {
      setLoading(true);
      setError(null);
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      const env = await client.get<AutouserListEnvelope>(
        "/api/v1/autousers?limit=100"
      );
      setRows(env.data);
      setSelected(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // load is stable — props.createClient is captured by closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = applyHubFilters(rows, filter);
  const cursor = visible[selected] ?? null;

  async function duplicate(row: HubAutouserRow): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    try {
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      await client.post(
        `/api/v1/autousers/${encodeURIComponent(row.id)}/duplicate`,
        {}
      );
      setToast({ kind: "success", message: `Duplicated ${row.name}` });
      setTimeout(() => setToast(null), 3000);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: "error", message: `Duplicate failed: ${msg}` });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSubmitting(false);
    }
  }

  async function performDelete(row: HubAutouserRow): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    try {
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      await client.delete(`/api/v1/autousers/${encodeURIComponent(row.id)}`);
      setToast({ kind: "success", message: `Deleted ${row.name}` });
      setTimeout(() => setToast(null), 3000);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      setSelected((s) => Math.max(0, s - 1));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: "error", message: `Delete failed: ${msg}` });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSubmitting(false);
      setConfirmDelete(null);
    }
  }

  useInput((input, key) => {
    if (submitting) return;

    // Delete confirmation modal owns input until resolved.
    if (confirmDelete) {
      if (input === "y" || input === "Y") {
        void performDelete(confirmDelete);
      } else if (input === "n" || input === "N" || key.escape) {
        setConfirmDelete(null);
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
      setSelected((s) => Math.min(Math.max(0, visible.length - 1), s + 1));
      return;
    }
    if (input === "n") {
      setEditingAutouserId(null);
      setScreen("autorater-creator");
      return;
    }
    if (input === "f") {
      // Same screen, manual-form preference handled by the creator's
      // `?` toggle. The creator detects no editingAutouserId and the
      // user can hit `?` once to land on the form. We pre-route via
      // the same screen so future polish (preset toggle in store) is
      // a one-line change.
      setEditingAutouserId(null);
      setScreen("autorater-creator");
      return;
    }
    if (input === "/") {
      setFilter((prev) =>
        prev === "all" ? "custom" : prev === "custom" ? "built-in" : "all"
      );
      setSelected(0);
      return;
    }
    if (key.return && cursor) {
      if (cursor.source === "custom") {
        setEditingAutouserId(cursor.id);
        setScreen("autorater-creator");
      } else {
        // Built-in rows are read-only; show their detail in the
        // creator's preview pane via the duplicate flow seed.
        setToast({
          kind: "info",
          message: `${cursor.name} is built-in — press 'd' to duplicate first to edit.`,
        });
        setTimeout(() => setToast(null), 3500);
      }
      return;
    }
    if (input === "d" && cursor) {
      void duplicate(cursor);
      return;
    }
    if (input === "D" && cursor && cursor.source === "custom") {
      setConfirmDelete(cursor);
      return;
    }
    if (input === "c" && cursor && cursor.source === "custom") {
      setCalibratingAutouserId(cursor.id);
      setScreen("autorater-calibration");
      return;
    }
    if (input === "o" && cursor) {
      // Best-effort — print the URL so the user can click it in
      // terminals that linkify (and copy-paste otherwise).
      const url = `${baseUrl.replace(/\/+$/, "")}/autousers/${encodeURIComponent(cursor.id)}`;
      setToast({ kind: "info", message: `Open: ${url}` });
      setTimeout(() => setToast(null), 4000);
      return;
    }
  });

  if (loading) {
    return (
      <Box paddingX={1}>
        <Text color={Theme.brand}>Loading autousers…</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box paddingBottom={1}>
        <Text bold color={Theme.brand}>
          Manage autousers
        </Text>
        <Text dimColor>
          {"  "}({visible.length}/{rows.length} · filter: {filter})
        </Text>
      </Box>

      {error ? (
        <Box paddingBottom={1}>
          <Text color={Theme.error}>Error: {error}</Text>
        </Box>
      ) : null}

      {confirmDelete ? (
        <Box
          borderStyle="single"
          borderColor={Theme.error}
          paddingX={1}
          marginBottom={1}
        >
          <Text color={Theme.error}>
            Delete {confirmDelete.name}? This cannot be undone. (y/N)
          </Text>
        </Box>
      ) : null}

      {visible.length === 0 ? (
        <Text dimColor>
          No autousers match the current filter. Press n to create one.
        </Text>
      ) : (
        visible.map((row, i) => {
          const isCursor = i === selected;
          return (
            <Box key={row.id} gap={1}>
              <Text color={isCursor ? Theme.brand : undefined} bold={isCursor}>
                {isCursor ? ">" : " "}
              </Text>
              <Box width={6}>
                <Text dimColor>{row.source}</Text>
              </Box>
              <Box width={28}>
                <Text bold={isCursor}>{row.name}</Text>
              </Box>
              <Box width={14}>
                <Text dimColor>{row.calibrationStatus ?? "—"}</Text>
              </Box>
              <Box width={10}>
                <Text dimColor>{row.status}</Text>
              </Box>
              <Text dimColor>{timeAgo(row.updatedAt)}</Text>
            </Box>
          );
        })
      )}

      <Box paddingTop={1}>
        <Text dimColor>
          ↑↓ nav · Enter edit · n new · d duplicate · D delete · c calibrate · o
          browser · / filter · Esc back
        </Text>
      </Box>
    </Box>
  );
}
