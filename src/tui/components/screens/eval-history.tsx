/**
 * Wave 7 — full-page paginated eval history browser.
 *
 * Routes from the menu's "Browse evaluations" item (item 2). Replaces
 * what was a Wave-3 placeholder. Adapted from uxrater's
 * `cli/components/screens/eval-history.tsx`, with autousers-specific
 * additions:
 *
 *   - **Filter bar** at the top — status (Draft / Running / Ended /
 *     Archived / All), type (SSE / SxS / All), date range (7d / 30d /
 *     90d / All), owner substring. Filters apply client-side over the
 *     fetched page.
 *   - **Sort cycle** via `c` — created desc / name / cost desc.
 *   - **Action keybinds** for share (`s`), invite (`i`), transfer (`t`),
 *     delete (`d`). Each opens a small modal built on the Wave-3 Modal
 *     primitive; each modal closes back into the list with a toast on
 *     success.
 *   - **Open in browser** via `o` — best-effort `process.stdout.write`
 *     of the dashboard URL, since the CLI doesn't ship a `open` helper.
 *   - **Search** via `/` — substring match against eval name.
 *
 * State for the filter bar / search / sort lives in the zustand store
 * (Wave-7 additions in `state.ts`), so it persists across re-mounts of
 * the screen and tests can inspect it directly.
 *
 * Layout
 * ------
 *   ┌─ Filter bar ─────────────────────────┐
 *   │ Status: All  Type: All  Range: All    │
 *   │ Owner: -    Sort: created desc        │
 *   └───────────────────────────────────────┘
 *   Search: <query>
 *
 *   > #1  Eval name           SSE   3 comp  12 ratings  2h ago
 *     #2  Other eval          SxS   1 comp   2 ratings  3d ago
 *
 *   ↑↓ navigate · Enter open · o browser · s share · i invite · t
 *   transfer · d delete · / search · f filter · c sort · Esc back
 */
import { useEffect, useState } from "react";
import { Box, Text, useInput } from "@jrichman/ink";

import {
  createClientFromConfig,
  type AutousersClient,
} from "../../../client.js";
import {
  useTUIStore,
  type HistoryFilters,
  type HistorySort,
} from "../../state.js";
import { Theme } from "../../theme.js";
import { InlineTextInput } from "../inline-text-input.js";
import {
  DeleteConfirmModal,
  InviteModal,
  ShareModal,
  TransferModal,
} from "../interactive/index.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Slim, filter-friendly view-model derived from the server envelope. */
export interface EvalRow {
  id: string;
  name: string;
  type: "SSE" | "SxS";
  status: string;
  ratingsCount: number;
  comparisonsCount: number;
  createdAt: string;
  updatedAt: string;
  /** Best-effort owner email or team name surfaced in the filter bar. */
  ownerLabel?: string;
  /** Best-effort cost; absent on most rows but used for cost-desc sort. */
  totalCost?: number;
}

interface EvalListEnvelope {
  data: Array<{
    id: string;
    name: string;
    type: "SSE" | "SxS";
    status: string;
    ratingsCount: number;
    comparisonsCount: number;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
    owner?: { email?: string; name?: string };
    team?: { name?: string; slug?: string };
  }>;
  has_more: boolean;
  next_cursor?: string;
}

interface EvalHistoryProps {
  /** Test seam — overrides the API client factory. */
  createClient?: () => Promise<Pick<AutousersClient, "get">>;
}

// ─── Time formatting ────────────────────────────────────────────────────────

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

// ─── Filter / sort helpers (exported for tests) ─────────────────────────────

const RANGE_DAYS: Record<HistoryFilters["range"], number | null> = {
  all: null,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export function applyHistoryFilters(
  rows: EvalRow[],
  query: string,
  filters: HistoryFilters,
  sort: HistorySort
): EvalRow[] {
  const q = query.trim().toLowerCase();
  const days = RANGE_DAYS[filters.range];
  const cutoff = days ? Date.now() - days * 86_400_000 : null;

  let out = rows.filter((r) => {
    if (q && !r.name.toLowerCase().includes(q)) return false;
    if (filters.status && r.status !== filters.status) return false;
    if (filters.type && r.type !== filters.type) return false;
    if (
      filters.owner &&
      !(r.ownerLabel ?? "").toLowerCase().includes(filters.owner.toLowerCase())
    )
      return false;
    if (cutoff !== null && new Date(r.createdAt).getTime() < cutoff) {
      return false;
    }
    return true;
  });

  if (sort === "name") {
    out = [...out].sort((a, b) => a.name.localeCompare(b.name));
  } else if (sort === "cost-desc") {
    out = [...out].sort(
      (a, b) =>
        (b.totalCost ?? b.ratingsCount) - (a.totalCost ?? a.ratingsCount)
    );
  } else {
    out = [...out].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }
  return out;
}

const SORT_LABELS: Record<HistorySort, string> = {
  "created-desc": "created desc",
  name: "name",
  "cost-desc": "cost desc",
};

const STATUS_OPTIONS: Array<HistoryFilters["status"]> = [
  null,
  "Draft",
  "Running",
  "Ended",
  "Archived",
];

const TYPE_OPTIONS: Array<HistoryFilters["type"]> = [null, "SSE", "SxS"];

const RANGE_OPTIONS: HistoryFilters["range"][] = ["all", "7d", "30d", "90d"];

const SORT_OPTIONS: HistorySort[] = ["created-desc", "name", "cost-desc"];

/** Cycle helper — returns the next entry in the array, wrapping at the end. */
function cycle<T>(arr: readonly T[], current: T): T {
  const idx = arr.indexOf(current);
  return arr[(idx + 1) % arr.length]!;
}

// ─── Filter bar ─────────────────────────────────────────────────────────────

type FocusBar = "list" | "filters" | "search";

function FilterBar({
  filters,
  sort,
  active,
}: {
  filters: HistoryFilters;
  sort: HistorySort;
  active: boolean;
}) {
  return (
    <Box
      borderStyle="single"
      borderColor={active ? Theme.brand : Theme.textDim}
      flexDirection="column"
      paddingX={1}
    >
      <Text bold color={active ? Theme.brand : undefined}>
        Filters {active ? "(Tab to leave)" : "(Tab to focus)"}
      </Text>
      <Box gap={2}>
        <Text>
          Status: <Text bold>{filters.status ?? "All"}</Text>
          {active ? <Text dimColor> (s)</Text> : null}
        </Text>
        <Text>
          Type: <Text bold>{filters.type ?? "All"}</Text>
          {active ? <Text dimColor> (t)</Text> : null}
        </Text>
        <Text>
          Range: <Text bold>{filters.range}</Text>
          {active ? <Text dimColor> (r)</Text> : null}
        </Text>
      </Box>
      <Box gap={2}>
        <Text>
          Owner: <Text bold>{filters.owner ?? "All"}</Text>
          {active ? <Text dimColor> (o)</Text> : null}
        </Text>
        <Text>
          Sort: <Text bold>{SORT_LABELS[sort]}</Text>
          {active ? <Text dimColor> (c)</Text> : null}
        </Text>
      </Box>
    </Box>
  );
}

// ─── Main screen ────────────────────────────────────────────────────────────

type ActionModal = "share" | "invite" | "transfer" | "delete" | null;

export function EvalHistory(props: EvalHistoryProps = {}) {
  const setScreen = useTUIStore((s) => s.setScreen);
  const setSelectedEvalId = useTUIStore((s) => s.setSelectedEvalId);
  const setToast = useTUIStore((s) => s.setToast);
  const query = useTUIStore((s) => s.historyQuery);
  const setQuery = useTUIStore((s) => s.setHistoryQuery);
  const filters = useTUIStore((s) => s.historyFilters);
  const setFilters = useTUIStore((s) => s.setHistoryFilters);
  const sort = useTUIStore((s) => s.historySort);
  const setSort = useTUIStore((s) => s.setHistorySort);

  const [rows, setRows] = useState<EvalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [focus, setFocus] = useState<FocusBar>("list");
  const [activeModal, setActiveModal] = useState<ActionModal>(null);
  const pageSize = 10;

  const filtered = applyHistoryFilters(rows, query, filters, sort);
  const visible = filtered.slice(scrollOffset, scrollOffset + pageSize);
  const cursor = filtered[selected];

  // Initial fetch
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const factory =
          props.createClient ?? (() => createClientFromConfig({}));
        const client = await Promise.resolve(factory());
        const env = await client.get<EvalListEnvelope>(
          "/api/v1/evaluations?limit=100"
        );
        if (cancelled) return;
        const next: EvalRow[] = env.data.map((e) => ({
          id: e.id,
          name: e.name,
          type: e.type,
          status: e.status,
          ratingsCount: e.ratingsCount,
          comparisonsCount: e.comparisonsCount,
          createdAt: e.createdAt,
          updatedAt: e.updatedAt,
          ownerLabel:
            e.owner?.email ?? e.team?.slug ?? e.team?.name ?? undefined,
          totalCost:
            e.metadata &&
            typeof (e.metadata as Record<string, unknown>).totalCost ===
              "number"
              ? ((e.metadata as Record<string, unknown>).totalCost as number)
              : undefined,
        }));
        setRows(next);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setFetchError(msg);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.createClient]);

  function openInBrowser(id: string): void {
    // CLI doesn't ship the `open` helper — we print the URL the same
    // way Wave 6's results view does for parity.
    process.stdout.write(`\nhttps://app.autousers.ai/eval/${id}\n`);
    setToast({
      kind: "info",
      message: `Open: https://app.autousers.ai/eval/${id}`,
    });
    setTimeout(() => setToast(null), 3000);
  }

  useInput(
    (input, key) => {
      if (activeModal !== null) return;
      if (focus === "search") return; // InlineTextInput owns input

      if (key.escape) {
        setScreen("menu");
        return;
      }
      if (key.tab) {
        setFocus((f) => (f === "list" ? "filters" : "list"));
        return;
      }
      if (input === "/") {
        setFocus("search");
        return;
      }
      if (input === "c") {
        setSort(cycle(SORT_OPTIONS, sort));
        return;
      }

      if (focus === "filters") {
        if (input === "s") {
          setFilters({
            ...filters,
            status: cycle(STATUS_OPTIONS, filters.status),
          });
          return;
        }
        if (input === "t") {
          setFilters({ ...filters, type: cycle(TYPE_OPTIONS, filters.type) });
          return;
        }
        if (input === "r") {
          setFilters({
            ...filters,
            range: cycle(RANGE_OPTIONS, filters.range),
          });
          return;
        }
        if (input === "o") {
          // toggle owner filter — rotates between null and "me" as a
          // crude default; full picker lives in Wave 9.
          setFilters({
            ...filters,
            owner: filters.owner ? null : "me",
          });
          return;
        }
        return;
      }

      // List focus
      if (key.upArrow) {
        setSelected((p) => {
          const next = Math.max(0, p - 1);
          if (next < scrollOffset) setScrollOffset(next);
          return next;
        });
        return;
      }
      if (key.downArrow) {
        setSelected((p) => {
          const next = Math.min(filtered.length - 1, p + 1);
          if (next >= scrollOffset + pageSize) {
            setScrollOffset(next - pageSize + 1);
          }
          return next;
        });
        return;
      }
      if (key.return && cursor) {
        setSelectedEvalId(cursor.id);
        setScreen("eval-results-by-id");
        return;
      }
      if (input === "o" && cursor) {
        openInBrowser(cursor.id);
        return;
      }
      if (input === "s" && cursor) {
        setActiveModal("share");
        return;
      }
      if (input === "i" && cursor) {
        setActiveModal("invite");
        return;
      }
      if (input === "t" && cursor) {
        setActiveModal("transfer");
        return;
      }
      if (input === "d" && cursor) {
        setActiveModal("delete");
        return;
      }
    },
    { isActive: focus !== "search" && activeModal === null }
  );

  if (loading) {
    return (
      <Box paddingX={2} marginY={1}>
        <Text color={Theme.brand}>Loading evaluations…</Text>
      </Box>
    );
  }

  if (fetchError) {
    return (
      <Box flexDirection="column" paddingX={2} marginY={1}>
        <Text color={Theme.error}>Failed to load history: {fetchError}</Text>
        <Text dimColor>Esc → main menu</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <FilterBar filters={filters} sort={sort} active={focus === "filters"} />

      <Box paddingTop={1}>
        <Text bold color={Theme.brand}>
          Browse evaluations
        </Text>
        <Text dimColor>
          {"  "}
          {filtered.length} of {rows.length}
        </Text>
      </Box>

      {focus === "search" ? (
        <Box paddingTop={1}>
          <Text dimColor>Search: </Text>
          <InlineTextInput
            placeholder="filter by name…"
            defaultValue={query}
            onChange={(val) => {
              setQuery(val);
              setSelected(0);
              setScrollOffset(0);
            }}
            onSubmit={() => setFocus("list")}
          />
        </Box>
      ) : query ? (
        <Box paddingTop={1}>
          <Text dimColor>Search: {query} (/ to edit)</Text>
        </Box>
      ) : null}

      <Box flexDirection="column" paddingTop={1}>
        {filtered.length === 0 ? (
          <Text dimColor>
            {query
              ? "No evaluations match your search."
              : "No evaluations yet. Create one with item 1."}
          </Text>
        ) : (
          visible.map((row, vi) => {
            const i = scrollOffset + vi;
            const isSelected = i === selected && focus === "list";
            return (
              <Box key={row.id} gap={1}>
                <Text
                  color={isSelected ? Theme.brand : undefined}
                  bold={isSelected}
                >
                  {isSelected ? ">" : " "}
                </Text>
                <Box width={28}>
                  <Text bold={isSelected}>
                    {row.name.slice(0, 26).padEnd(26)}
                  </Text>
                </Box>
                <Text color={Theme.brand}>{row.type.padEnd(3)}</Text>
                <Text dimColor>{row.status.padEnd(8)}</Text>
                <Text dimColor>
                  {row.comparisonsCount}c · {row.ratingsCount}r
                </Text>
                <Text dimColor>{timeAgo(row.createdAt)}</Text>
              </Box>
            );
          })
        )}
        {filtered.length > pageSize ? (
          <Text dimColor>
            {selected + 1} / {filtered.length}
          </Text>
        ) : null}
      </Box>

      <Box paddingTop={1}>
        <Text dimColor>
          {focus === "search"
            ? "Enter confirm search · Esc list"
            : focus === "filters"
              ? "s status · t type · r range · o owner · c sort · Tab list · Esc back"
              : "↑↓ nav · Enter open · o browser · s share · i invite · t transfer · d del · / search · c sort · Tab filters · Esc back"}
        </Text>
      </Box>

      {activeModal === "share" && cursor ? (
        <ShareModal
          evaluationId={cursor.id}
          evaluationName={cursor.name}
          onClose={(res) => {
            setActiveModal(null);
            if (res.kind !== "cancel") {
              setToast({
                kind: res.kind === "success" ? "success" : "error",
                message: res.message,
              });
              setTimeout(() => setToast(null), 4000);
            }
          }}
        />
      ) : null}

      {activeModal === "invite" && cursor ? (
        <InviteModal
          evaluationId={cursor.id}
          evaluationName={cursor.name}
          onClose={(res) => {
            setActiveModal(null);
            if (res.kind !== "cancel") {
              setToast({
                kind: res.kind === "success" ? "success" : "error",
                message: res.message,
              });
              setTimeout(() => setToast(null), 4000);
            }
          }}
        />
      ) : null}

      {activeModal === "transfer" && cursor ? (
        <TransferModal
          evaluationId={cursor.id}
          evaluationName={cursor.name}
          onClose={(res) => {
            setActiveModal(null);
            if (res.kind !== "cancel") {
              setToast({
                kind: res.kind === "success" ? "success" : "error",
                message: res.message,
              });
              setTimeout(() => setToast(null), 4000);
            }
          }}
        />
      ) : null}

      {activeModal === "delete" && cursor ? (
        <DeleteConfirmModal
          evaluationId={cursor.id}
          evaluationName={cursor.name}
          onClose={(res) => {
            setActiveModal(null);
            if (res.kind === "success") {
              // Remove the row locally — the server is the source of
              // truth, but optimistic removal keeps the list responsive.
              setRows((prev) => prev.filter((r) => r.id !== cursor.id));
              setSelected((s) => Math.max(0, s - 1));
              setToast({ kind: "success", message: res.message });
              setTimeout(() => setToast(null), 4000);
            } else if (res.kind === "error") {
              setToast({ kind: "error", message: res.message });
              setTimeout(() => setToast(null), 4000);
            }
          }}
        />
      ) : null}
    </Box>
  );
}
