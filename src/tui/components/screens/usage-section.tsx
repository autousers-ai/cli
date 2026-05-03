/**
 * Usage section screen — terminal mirror of the web `/settings/usage` page.
 *
 * Surfaces the same data the web client renders, in three vertical
 * sections sized for an 80-column terminal:
 *
 *   1. **Free-quota progress** — single ASCII bar (filled / total). When
 *      BYOK is active the cap is effectively lifted; we still show the
 *      counter for transparency, but with a "BYOK active" hint so the
 *      user understands the bar is informational rather than a gate.
 *   2. **Cost summary** — total USD, run count, total tokens for the
 *      currently-selected range.
 *   3. **Daily sparkline** — single-line Unicode block-char chart of
 *      cost-per-day across the range. Empty days render as the lowest
 *      block; this matches the web chart's zero-fill behaviour.
 *   4. **Top evaluations** — top 5 by cost (the API already sorts
 *      descending and returns up to 10; we slice to 5 for the terminal).
 *   5. **Range selector** — `7` / `3` / `9` switch to 7d / 30d / 90d and
 *      refetch.
 *
 * Esc returns to the parent (`settings`) — Settings is the entry point;
 * routing back to the menu would skip a level of the IA.
 *
 * Wire path matches the web client: `GET /api/v1/usage?range=…` returns
 * the response shape directly (no `{ data: … }` envelope — `apiSuccess`
 * just JSON-stringifies the object). We therefore type the call as
 * `client.get<UsageResponse>(…)` rather than the `{ data }` envelope
 * convention used by some other endpoints.
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
 * Mirrors `UsageResponse` from `app/api/v1/usage/route.ts`. Kept inline
 * rather than imported because the CLI is published as a standalone
 * package and pulling in a server-only module would drag the route's
 * Prisma deps into the bundle. When the response shape changes, update
 * here AND in the route. `freeQuota.limit` is widened to allow `null`
 * because the web client already plans for an unlimited tier — keeping
 * the CLI ahead of that change avoids a rebuild on rollout day.
 */
export type UsageRange = "7d" | "30d" | "90d";

export interface UsageDataDaily {
  date: string;
  runs: number;
  tokens: number;
  costUsd: number;
}

export interface UsageDataByEval {
  evaluationId: string;
  evaluationName: string;
  runs: number;
  tokens: number;
  costUsd: number;
}

export interface UsageResponse {
  range: UsageRange;
  byok: boolean;
  byokConfigured: boolean;
  freeQuota: { used: number; limit: number | null };
  totals: {
    runs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    evaluations: number;
    autousersUsed: number;
  };
  byEval: UsageDataByEval[];
  daily: UsageDataDaily[];
  perRun: {
    medianCost: number;
    meanCost: number;
    medianTokens: number;
  };
}

interface UsageSectionProps {
  /** Test seam — substitute the API client factory. */
  createClient?: () => Promise<Pick<AutousersClient, "get">>;
  /** Test seam — initial range so tests can assert against a known default. */
  initialRange?: UsageRange;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Render an ASCII progress bar — `[████████░░░░]` — sized to `width`
 * cells. Caps `used` to `[0, total]` so an over-quota account can't
 * overflow the bar.
 */
function progressBar(used: number, total: number, width = 24): string {
  if (total <= 0) return `[${"░".repeat(width)}]`;
  const ratio = Math.max(0, Math.min(1, used / total));
  const filled = Math.round(ratio * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

/**
 * Render a one-line Unicode block-char sparkline of `values`. The min
 * value pins the lowest tier (▁) and the max pins the highest (█); zero
 * values render as ▁ rather than a space so the row stays a stable
 * height. Idiomatic for terminal dashboards — no chart deps.
 */
function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const blocks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  const max = Math.max(...values);
  if (max === 0) return blocks[0]!.repeat(values.length);
  return values
    .map((v) => {
      const idx = Math.min(
        blocks.length - 1,
        Math.floor((v / max) * (blocks.length - 1))
      );
      return blocks[idx]!;
    })
    .join("");
}

/** Format a USD figure with up to 4 decimal places (matches the web card). */
function fmtUsd(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

/** Format a token count with thousands separators. */
function fmtTokens(n: number): string {
  return n.toLocaleString("en-US");
}

function rangeLabel(range: UsageRange): string {
  if (range === "7d") return "Last 7d";
  if (range === "90d") return "Last 90d";
  return "Last 30d";
}

// ─── Component ─────────────────────────────────────────────────────────────

export function UsageSection(props: UsageSectionProps = {}) {
  const setScreen = useTUIStore((s) => s.setScreen);
  const setToast = useTUIStore((s) => s.setToast);
  const activeTeamSlug = useTUIStore((s) => s.activeTeamSlug);

  const [range, setRange] = useState<UsageRange>(props.initialRange ?? "30d");
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(target: UsageRange): Promise<void> {
    try {
      setLoading(true);
      setError(null);
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      const payload = await client.get<UsageResponse>(
        `/api/v1/usage?range=${target}`
      );
      setData(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setToast({ kind: "error", message: `Usage load failed: ${msg}` });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  useInput((input, key) => {
    if (key.escape) {
      setScreen("settings");
      return;
    }
    if (input === "7") {
      if (range !== "7d") setRange("7d");
      return;
    }
    if (input === "3") {
      if (range !== "30d") setRange("30d");
      return;
    }
    if (input === "9") {
      if (range !== "90d") setRange("90d");
      return;
    }
    if (input === "r") {
      void load(range);
      return;
    }
  });

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box paddingBottom={1}>
        <Text bold color={Theme.brand}>
          Usage
        </Text>
        <Text dimColor>
          {"  "}
          {activeTeamSlug ? `(active team: ${activeTeamSlug})  ·  ` : ""}
          {rangeLabel(range)}
        </Text>
      </Box>

      {error ? (
        <Box paddingBottom={1}>
          <Text color={Theme.error}>Error: {error}</Text>
        </Box>
      ) : null}

      {loading && !data ? (
        <Text color={Theme.brand}>Loading…</Text>
      ) : data ? (
        <Box flexDirection="column" gap={1}>
          <FreeQuotaBlock data={data} />
          <CostSummaryBlock data={data} range={range} />
          <SparklineBlock data={data} range={range} />
          <TopEvalsBlock data={data} />
        </Box>
      ) : (
        <Text dimColor>No usage data available.</Text>
      )}

      <Box paddingTop={1}>
        <Text dimColor>
          {"7 = 7d  ·  3 = 30d  ·  9 = 90d  ·  r refresh  ·  Esc back"}
        </Text>
      </Box>
    </Box>
  );
}

// ─── Sub-blocks ────────────────────────────────────────────────────────────

function FreeQuotaBlock({ data }: { data: UsageResponse }) {
  const { used, limit } = data.freeQuota;
  // `limit === null` = unlimited (early-access / paid tier). Render a
  // distinct line rather than a 0/0 bar that would look like a bug.
  if (limit === null) {
    return (
      <Box flexDirection="column">
        <Text bold>Free quota</Text>
        <Text>Unlimited · {used} runs used overall</Text>
      </Box>
    );
  }
  const bar = progressBar(used, limit);
  const colour =
    used >= limit
      ? Theme.error
      : used / Math.max(limit, 1) >= 0.8
        ? Theme.warning
        : Theme.success;
  return (
    <Box flexDirection="column">
      <Text bold>Free quota</Text>
      <Text>
        <Text color={colour}>{bar}</Text>
        {"  "}
        {used} / {limit} free runs used
        {data.byok ? "  ·  BYOK active (cap effectively lifted)" : ""}
      </Text>
    </Box>
  );
}

function CostSummaryBlock({
  data,
  range,
}: {
  data: UsageResponse;
  range: UsageRange;
}) {
  const tokens = data.totals.inputTokens + data.totals.outputTokens;
  return (
    <Box flexDirection="column">
      <Text bold>{rangeLabel(range)} · cost</Text>
      <Text>
        Total: <Text color={Theme.brand}>{fmtUsd(data.totals.costUsd)}</Text>
        {"  ·  "}
        Runs: {data.totals.runs}
        {"  ·  "}
        Tokens: {fmtTokens(tokens)}
      </Text>
      {data.totals.runs > 0 ? (
        <Text dimColor>
          per run · median {fmtUsd(data.perRun.medianCost)} · mean{" "}
          {fmtUsd(data.perRun.meanCost)} · median tokens{" "}
          {fmtTokens(data.perRun.medianTokens)}
        </Text>
      ) : null}
    </Box>
  );
}

function SparklineBlock({
  data,
  range,
}: {
  data: UsageResponse;
  range: UsageRange;
}) {
  const series = data.daily.map((d) => d.costUsd);
  const peak = series.length ? Math.max(...series) : 0;
  return (
    <Box flexDirection="column">
      <Text bold>{rangeLabel(range)} cost</Text>
      <Text>
        <Text color={Theme.brand}>{sparkline(series)}</Text>
      </Text>
      <Text dimColor>
        peak {fmtUsd(peak)} / day · {data.daily.length} days
      </Text>
    </Box>
  );
}

function TopEvalsBlock({ data }: { data: UsageResponse }) {
  const top = data.byEval.slice(0, 5);
  return (
    <Box flexDirection="column">
      <Text bold>Top evaluations by cost</Text>
      {top.length === 0 ? (
        <Text dimColor>No evaluations in range.</Text>
      ) : (
        top.map((row, i) => (
          <Box key={row.evaluationId} gap={1}>
            <Box width={2}>
              <Text dimColor>{i + 1}.</Text>
            </Box>
            <Box width={36}>
              <Text>
                {row.evaluationName.length > 34
                  ? `${row.evaluationName.slice(0, 33)}…`
                  : row.evaluationName}
              </Text>
            </Box>
            <Box width={12}>
              <Text color={Theme.brand}>{fmtUsd(row.costUsd)}</Text>
            </Box>
            <Text dimColor>{row.runs} runs</Text>
          </Box>
        ))
      )}
    </Box>
  );
}
