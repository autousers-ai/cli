/**
 * Wave 9 — Templates hub screen.
 *
 * Lists every template visible to the caller (built-in + custom from the
 * caller's team) and surfaces the keybinds for create / edit / duplicate /
 * delete / open-in-browser. Mirrors the autorater hub's shape (Wave 8) so
 * users get one mental model for "manage a resource" across the TUI.
 *
 * Adapted from uxrater's `cli/components/screens/templates-hub.tsx`,
 * trimmed to autousers' tighter envelope shape — uxrater's hub renders
 * a giant per-row detail pane that pulls 15+ JSON-array fields off each
 * row; we surface the scannable index plus a small detail strip and let
 * the (future) detail screen own the rich view. Templates are dimensions
 * under the hood (`/api/v1/templates` aliases `/api/v1/dimensions`).
 *
 * Routing:
 *   - `Enter` opens the creator in edit mode for the highlighted custom row
 *   - `n` opens the AI-assisted creator (template-creator screen)
 *   - `f` opens the same creator pre-toggled to manual form
 *   - `d` duplicates (POST .../duplicate)
 *   - `D` deletes (custom only) with a y/N confirm banner
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

/**
 * Row shape returned by `GET /api/v1/templates`. Liberal — server returns
 * the full Dimension row but the hub only uses a handful of fields.
 */
export interface HubTemplateRow {
  id: string;
  name: string;
  description: string | null;
  type: string;
  scaleType: string;
  isSystem: boolean;
  updatedAt: string;
}

interface TemplateListEnvelope {
  data: HubTemplateRow[];
  has_more: boolean;
  next_cursor?: string;
}

interface TemplatesHubProps {
  /** Test seam — substitute the API client factory. */
  createClient?: () => Promise<
    Pick<AutousersClient, "get" | "post" | "delete">
  >;
  /** Test seam — control how the screen reports navigation requests. */
  baseUrl?: string;
}

type SourceFilter = "all" | "built-in" | "custom";

// ─── Helpers (exported for tests) ──────────────────────────────────────────

export function applyTemplateFilters(
  rows: HubTemplateRow[],
  filter: SourceFilter
): HubTemplateRow[] {
  if (filter === "all") return rows;
  if (filter === "built-in") return rows.filter((r) => r.isSystem);
  return rows.filter((r) => !r.isSystem);
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

export function TemplatesHub(props: TemplatesHubProps = {}) {
  const setScreen = useTUIStore((s) => s.setScreen);
  const setEditingTemplateId = useTUIStore((s) => s.setEditingTemplateId);
  const setToast = useTUIStore((s) => s.setToast);

  const [rows, setRows] = useState<HubTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [confirmDelete, setConfirmDelete] = useState<HubTemplateRow | null>(
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
      const env = await client.get<TemplateListEnvelope>(
        "/api/v1/templates?limit=100&includeSystem=true"
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = applyTemplateFilters(rows, filter);
  const cursor = visible[selected] ?? null;

  async function duplicate(row: HubTemplateRow): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    try {
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      await client.post(
        `/api/v1/templates/${encodeURIComponent(row.id)}/duplicate`,
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

  async function performDelete(row: HubTemplateRow): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    try {
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      await client.delete(`/api/v1/templates/${encodeURIComponent(row.id)}`);
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
    if (input === "n" || input === "f") {
      // Both 'n' (AI) and 'f' (form) route to the same creator screen.
      // The creator's `?` toggle picks the mode at runtime; defaulting
      // to describe-mode (n) and form-mode (f) is a UX hint we can wire
      // through the store in a follow-up if it proves useful.
      setEditingTemplateId(null);
      setScreen("template-creator");
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
      if (!cursor.isSystem) {
        setEditingTemplateId(cursor.id);
        setScreen("template-creator");
      } else {
        // Built-in rows are read-only; nudge the user toward duplicate.
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
    if (input === "D" && cursor && !cursor.isSystem) {
      setConfirmDelete(cursor);
      return;
    }
    if (input === "o" && cursor) {
      const url = `${baseUrl.replace(/\/+$/, "")}/templates/${encodeURIComponent(cursor.id)}`;
      setToast({ kind: "info", message: `Open: ${url}` });
      setTimeout(() => setToast(null), 4000);
      return;
    }
  });

  if (loading) {
    return (
      <Box paddingX={1}>
        <Text color={Theme.brand}>Loading templates…</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box paddingBottom={1}>
        <Text bold color={Theme.brand}>
          Manage templates
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
          No templates match the current filter. Press n to create one.
        </Text>
      ) : (
        visible.map((row, i) => {
          const isCursor = i === selected;
          const source = row.isSystem ? "built-in" : "custom";
          return (
            <Box key={row.id} gap={1}>
              <Text color={isCursor ? Theme.brand : undefined} bold={isCursor}>
                {isCursor ? ">" : " "}
              </Text>
              <Box width={9}>
                <Text dimColor>{source}</Text>
              </Box>
              <Box width={32}>
                <Text bold={isCursor}>{row.name}</Text>
              </Box>
              <Box width={10}>
                <Text dimColor>{row.scaleType}</Text>
              </Box>
              <Text dimColor>{timeAgo(row.updatedAt)}</Text>
            </Box>
          );
        })
      )}

      <Box paddingTop={1}>
        <Text dimColor>
          ↑↓ nav · Enter edit · n new · f form · d duplicate · D delete · o
          browser · / filter · Esc back
        </Text>
      </Box>
    </Box>
  );
}
