/**
 * Full-page eval-creation wizard host.
 *
 * Wave 4 — the first wave-4-9 screen to land. Routes from the menu's
 * "Create new evaluation" item; replaces what was a placeholder during
 * Wave 3. Lifts the wizard chrome out of {@link Wizard}, the autorater
 * picker out of {@link AutoraterPicker}, and a small handful of
 * lightweight step components defined inline below.
 *
 * 7 steps, in order:
 *   1. type            — SSE | SxS
 *   2. urls            — one URL (SSE) or A+B (SxS)
 *   3. autorater       — pick a built-in or custom persona
 *   4. dimensions      — pick from a small ad-hoc set (templates picker
 *                        ports in Wave 9)
 *   5. config          — count / concurrency / max-turns
 *   6. review          — server-side dryRun preview (cost, warnings)
 *   7. confirm         — POST /api/v1/evaluations { dryRun: false }
 *
 * The review step's preview comes from `POST /api/v1/evaluations` with
 * `dryRun: true` — server-side support landed in commit ff2385f. Confirm
 * sends the same payload with `dryRun: false`. We never persist client-
 * side cost guesses; the server is the source of truth.
 *
 * Esc inside any step rolls back to the previous step (or the menu from
 * step 1). On confirm success, surfaces a toast via the global store and
 * routes back to the menu so the user can immediately start another.
 */
import { useCallback, useEffect, useState } from "react";
import { Box, Text, useInput } from "@jrichman/ink";

import { createClientFromConfig } from "../../../client.js";
import { useTUIStore } from "../../state.js";
import { Theme } from "../../theme.js";
import { InlineTextInput } from "../inline-text-input.js";
import { AutoraterPicker } from "../interactive/autorater-picker.js";
import type { PickedAutouser } from "../interactive/autorater-picker.js";
import { Wizard } from "../interactive/wizard.js";
import type { WizardStep } from "../interactive/wizard.js";

// ─── Types ──────────────────────────────────────────────────────────────────

type CreatorStep =
  | "type"
  | "urls"
  | "autorater"
  | "dimensions"
  | "config"
  | "review"
  | "confirm";

const STEPS: WizardStep[] = [
  { key: "type", label: "Type" },
  { key: "urls", label: "URLs" },
  { key: "autorater", label: "Autorater" },
  { key: "dimensions", label: "Dimensions" },
  { key: "config", label: "Config" },
  { key: "review", label: "Review" },
  { key: "confirm", label: "Confirm" },
];

interface UrlEntry {
  id: string;
  url: string;
}
interface PairEntry {
  id: string;
  urlA: string;
  urlB: string;
}

interface CreatorState {
  name: string;
  evalType: "SSE" | "SxS";
  urls: UrlEntry[];
  pairs: PairEntry[];
  autorater: PickedAutouser | null;
  dimensions: string[];
  count: number;
  concurrency: number;
  maxTurns: number;
}

/**
 * Shape of a single template/dimension row as the picker uses it. The
 * server's `/api/v1/templates` endpoint (an alias for `/dimensions`)
 * returns the full Dimension row; we narrow to just the fields the
 * picker renders. The selected ids flow through to
 * `selectedDimensionIds` on the eval payload.
 */
export interface PickerTemplate {
  id: string;
  name: string;
  description?: string | null;
  isSystem: boolean;
}

interface TemplatesListEnvelope {
  data: Array<{
    id: string;
    name: string;
    description?: string | null;
    isSystem: boolean;
  }>;
  has_more: boolean;
  next_cursor?: string;
}

/**
 * Fallback id used when the server returns no templates the user can
 * see and the user advances without selecting any. `"overall"` is a
 * well-known system dimension id; sending it satisfies the API contract
 * (the server requires ≥1 entry in `selectedDimensionIds`) without
 * surfacing fake dimensions to the user.
 */
const FALLBACK_DIMENSION_ID = "overall";

// ─── Server-side dryRun envelope (matches POST /api/v1/evaluations) ────────

export interface DryRunEnvelope {
  data: {
    dryRun: true;
    persisted: false;
    autousersQueued: false;
    wouldCreate: Record<string, unknown> & { name: string; type: string };
    wouldRun: {
      autouserCount: number;
      comparisonCount: number;
      totalRuns: number;
    } | null;
    costEstimate: {
      total: { usd: number };
      basis?: string;
      perAutouserPerComparison?: { usd: number };
    } | null;
    warnings: { code: string; message: string }[];
    note: string;
  };
}

/** Live envelope (after dryRun: false) — we only need id/name. */
export interface CreateEvalEnvelope {
  data: {
    id: string;
    name: string;
    type: string;
    status: string;
  };
}

// ─── Public seam — payload builder, exported for tests + plain-mode reuse ──

/**
 * Build the `POST /api/v1/evaluations` request body from CreatorState.
 * Pure — no side effects, no defaults injected by the server. Exported
 * so the plain-mode `eval create` command can reuse the exact same
 * shape, and so tests can assert against the wire payload without
 * spinning up the TUI.
 */
export function buildEvalPayload(
  state: CreatorState,
  opts: { dryRun: boolean; status?: "Draft" | "Running" }
): Record<string, unknown> {
  const status = opts.status ?? (opts.dryRun ? "Draft" : "Running");
  return {
    name: state.name || "Untitled evaluation",
    type: state.evalType,
    status,
    designUrls:
      state.evalType === "SSE"
        ? state.urls
            .filter((u) => u.url.trim().length > 0)
            .map((u) => ({
              id: u.id,
              url: u.url,
              stimulusType: "URL" as const,
            }))
        : [],
    comparisonPairs:
      state.evalType === "SxS"
        ? state.pairs
            .filter((p) => p.urlA.trim() && p.urlB.trim())
            .map((p) => ({
              id: p.id,
              currentUrl: p.urlA,
              variantUrl: p.urlB,
              sideAType: "URL" as const,
              sideBType: "URL" as const,
            }))
        : [],
    selectedDimensionIds:
      state.dimensions.length > 0 ? state.dimensions : [FALLBACK_DIMENSION_ID],
    selectedAutousers: state.autorater
      ? [{ autouserId: state.autorater.id, agentCount: state.count }]
      : [],
    evaluationMethod: "ai" as const,
    dryRun: opts.dryRun,
  };
}

// ─── Step 1: Type picker (SSE | SxS) ───────────────────────────────────────

function StepType({
  evalType,
  onChange,
  onNext,
  onBack,
}: {
  evalType: "SSE" | "SxS";
  onChange: (t: "SSE" | "SxS") => void;
  onNext: () => void;
  onBack: () => void;
}) {
  useInput((input, key) => {
    if (key.escape) return onBack();
    if (key.leftArrow || input === "h") return onChange("SSE");
    if (key.rightArrow || input === "l") return onChange("SxS");
    if (input === " ") return onChange(evalType === "SSE" ? "SxS" : "SSE");
    if (key.return || key.tab) return onNext();
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box paddingBottom={1}>
        <Text bold color={Theme.brand}>
          Evaluation type
        </Text>
      </Box>
      <Box gap={2}>
        <Box
          borderStyle={evalType === "SSE" ? "bold" : "single"}
          borderColor={evalType === "SSE" ? Theme.brand : Theme.textDim}
          paddingX={2}
        >
          <Text bold={evalType === "SSE"}>SSE</Text>
        </Box>
        <Box
          borderStyle={evalType === "SxS" ? "bold" : "single"}
          borderColor={evalType === "SxS" ? Theme.brand : Theme.textDim}
          paddingX={2}
        >
          <Text bold={evalType === "SxS"}>SxS</Text>
        </Box>
      </Box>
      <Box paddingTop={1} flexDirection="column">
        <Text dimColor>SSE — single-site evaluation against criteria</Text>
        <Text dimColor>SxS — side-by-side comparison of two URLs</Text>
      </Box>
      <Box paddingTop={1}>
        <Text dimColor>← → toggle · Space toggle · Enter next · Esc back</Text>
      </Box>
    </Box>
  );
}

// ─── Step 2: URLs ──────────────────────────────────────────────────────────

function StepUrls({
  state,
  onUpdate,
  onNext,
  onBack,
}: {
  state: CreatorState;
  onUpdate: (next: Partial<CreatorState>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  // For SSE we edit a single URL; for SxS we edit one A and one B URL.
  // Keeping this minimal vs. uxrater's variable-length list — Wave 4 brief
  // says "one URL" for SSE / "URL A + URL B" for SxS, no list management.
  const [editingField, setEditingField] = useState<
    "sse" | "a" | "b" | "name" | null
  >(null);
  const [cursor, setCursor] = useState<"name" | "sse" | "a" | "b">("name");

  useInput(
    (_input, key) => {
      if (key.escape) return onBack();
      if (key.tab) {
        const valid =
          state.evalType === "SSE"
            ? state.urls[0]?.url.trim().length
            : state.pairs[0]?.urlA.trim() && state.pairs[0]?.urlB.trim();
        if (valid) onNext();
        return;
      }
      if (key.upArrow) {
        if (state.evalType === "SSE") {
          setCursor((p) => (p === "sse" ? "name" : p));
        } else {
          setCursor((p) =>
            p === "a" ? "name" : p === "b" ? "a" : p === "name" ? "name" : p
          );
        }
        return;
      }
      if (key.downArrow) {
        if (state.evalType === "SSE") {
          setCursor((p) => (p === "name" ? "sse" : p));
        } else {
          setCursor((p) =>
            p === "name" ? "a" : p === "a" ? "b" : p === "b" ? "b" : p
          );
        }
        return;
      }
      if (key.return) {
        if (cursor === "name") return setEditingField("name");
        if (cursor === "sse") return setEditingField("sse");
        if (cursor === "a") return setEditingField("a");
        if (cursor === "b") return setEditingField("b");
      }
    },
    { isActive: editingField === null }
  );

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box paddingBottom={1}>
        <Text bold color={Theme.brand}>
          Stimulus URLs
        </Text>
      </Box>

      <Box gap={1}>
        <Text color={cursor === "name" ? Theme.brand : undefined}>
          {cursor === "name" ? ">" : " "}
        </Text>
        <Text bold={cursor === "name"}>Name:</Text>
        {editingField === "name" ? (
          <InlineTextInput
            placeholder="My evaluation"
            defaultValue={state.name}
            onSubmit={(val) => {
              onUpdate({ name: val });
              setEditingField(null);
            }}
          />
        ) : (
          <Text color={state.name ? undefined : Theme.textDim}>
            {state.name || "(Enter to edit)"}
          </Text>
        )}
      </Box>

      {state.evalType === "SSE" ? (
        <Box gap={1}>
          <Text color={cursor === "sse" ? Theme.brand : undefined}>
            {cursor === "sse" ? ">" : " "}
          </Text>
          <Text bold={cursor === "sse"}>URL:</Text>
          {editingField === "sse" ? (
            <InlineTextInput
              placeholder="https://example.com"
              defaultValue={state.urls[0]?.url ?? ""}
              onSubmit={(val) => {
                onUpdate({ urls: [{ id: "u-0", url: val }] });
                setEditingField(null);
              }}
            />
          ) : (
            <Text color={state.urls[0]?.url ? undefined : Theme.textDim}>
              {state.urls[0]?.url || "(Enter to edit)"}
            </Text>
          )}
        </Box>
      ) : (
        <>
          <Box gap={1}>
            <Text color={cursor === "a" ? Theme.brand : undefined}>
              {cursor === "a" ? ">" : " "}
            </Text>
            <Text bold={cursor === "a"}>URL A:</Text>
            {editingField === "a" ? (
              <InlineTextInput
                placeholder="https://example.com/a"
                defaultValue={state.pairs[0]?.urlA ?? ""}
                onSubmit={(val) => {
                  const existing = state.pairs[0] ?? {
                    id: "p-0",
                    urlA: "",
                    urlB: "",
                  };
                  onUpdate({ pairs: [{ ...existing, urlA: val }] });
                  setEditingField(null);
                }}
              />
            ) : (
              <Text color={state.pairs[0]?.urlA ? undefined : Theme.textDim}>
                {state.pairs[0]?.urlA || "(Enter to edit)"}
              </Text>
            )}
          </Box>
          <Box gap={1}>
            <Text color={cursor === "b" ? Theme.brand : undefined}>
              {cursor === "b" ? ">" : " "}
            </Text>
            <Text bold={cursor === "b"}>URL B:</Text>
            {editingField === "b" ? (
              <InlineTextInput
                placeholder="https://example.com/b"
                defaultValue={state.pairs[0]?.urlB ?? ""}
                onSubmit={(val) => {
                  const existing = state.pairs[0] ?? {
                    id: "p-0",
                    urlA: "",
                    urlB: "",
                  };
                  onUpdate({ pairs: [{ ...existing, urlB: val }] });
                  setEditingField(null);
                }}
              />
            ) : (
              <Text color={state.pairs[0]?.urlB ? undefined : Theme.textDim}>
                {state.pairs[0]?.urlB || "(Enter to edit)"}
              </Text>
            )}
          </Box>
        </>
      )}

      <Box paddingTop={1}>
        <Text dimColor>↑↓ field · Enter edit · Tab next · Esc back</Text>
      </Box>
    </Box>
  );
}

// ─── Step 4: Dimensions (multi-select against /api/v1/templates) ───────────

/**
 * Loads every template/dimension visible to the caller (built-in +
 * team-owned) from `/api/v1/templates?includeSystem=true`. Built-in
 * templates double as the default scoring dimensions; the user
 * multi-selects whichever subset they want scored on this evaluation.
 * Reused by tests via the optional `loadTemplates` prop on
 * {@link StepDimensions}.
 *
 * The previous version of this step rendered a hardcoded list (Trust,
 * Clarity, Usability, …) which produced bogus custom-dimension ids on
 * the server. Pulling from the API ensures the ids the wizard sends
 * match real dimensions the user can see in the dashboard.
 */
async function defaultLoadTemplates(): Promise<PickerTemplate[]> {
  const client = await createClientFromConfig({});
  const env = await client.get<TemplatesListEnvelope>(
    "/api/v1/templates?limit=100&includeSystem=true"
  );
  return env.data.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    isSystem: row.isSystem,
  }));
}

function StepDimensions({
  selected,
  onChange,
  onNext,
  onBack,
  loadTemplates,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  onNext: () => void;
  onBack: () => void;
  /**
   * Test seam — replaces the API fetch entirely. Production omits this
   * and lets the step pull from `/api/v1/templates` via the configured
   * client.
   */
  loadTemplates?: () => Promise<PickerTemplate[]>;
}) {
  const [cursor, setCursor] = useState(0);
  const [templates, setTemplates] = useState<PickerTemplate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fn = loadTemplates ?? defaultLoadTemplates;
    fn()
      .then((rows) => {
        if (cancelled) return;
        setTemplates(rows);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loadTemplates]);

  useInput((_input, key) => {
    if (key.escape) return onBack();
    if (key.upArrow) return setCursor((p) => Math.max(0, p - 1));
    if (key.downArrow)
      return setCursor((p) =>
        Math.min(Math.max(0, templates.length - 1), p + 1)
      );
    if (_input === " ") {
      const row = templates[cursor];
      if (!row) return;
      const next = selected.includes(row.id)
        ? selected.filter((x) => x !== row.id)
        : [...selected, row.id];
      onChange(next);
      return;
    }
    if (key.return || key.tab) {
      // Allow advancing even when nothing is explicitly selected — the
      // wizard host injects FALLBACK_DIMENSION_ID when building the
      // payload, so the eval still has at least one dimension.
      if (selected.length > 0 || templates.length === 0) onNext();
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box paddingBottom={1}>
        <Text bold color={Theme.brand}>
          Dimensions ({selected.length} selected)
        </Text>
      </Box>

      {!loaded ? (
        <Box paddingBottom={1}>
          <Text dimColor>Loading templates…</Text>
        </Box>
      ) : null}

      {loaded && loadError ? (
        <Box paddingBottom={1} flexDirection="column">
          <Text color={Theme.error}>Failed to load templates: {loadError}</Text>
          <Text dimColor>
            Press Esc to go back, or fix your auth and reopen this screen.
          </Text>
        </Box>
      ) : null}

      {loaded && !loadError && templates.length === 0 ? (
        <Box paddingBottom={1}>
          <Text dimColor>
            No templates visible. Press Enter to continue with the default
            &quot;overall&quot; dimension.
          </Text>
        </Box>
      ) : null}

      <Box flexDirection="column">
        {templates.map((d, i) => {
          const isCursor = i === cursor;
          const checked = selected.includes(d.id);
          return (
            <Box key={d.id} gap={1}>
              <Text color={isCursor ? Theme.brand : undefined} bold={isCursor}>
                {isCursor ? ">" : " "}
              </Text>
              <Text color={checked ? Theme.success : Theme.textDim}>
                {checked ? "[x]" : "[ ]"}
              </Text>
              <Text bold={isCursor}>{d.name}</Text>
              {d.isSystem ? <Text dimColor>(built-in)</Text> : null}
            </Box>
          );
        })}
      </Box>
      <Box paddingTop={1}>
        <Text dimColor>↑↓ navigate · Space toggle · Enter next · Esc back</Text>
      </Box>
    </Box>
  );
}

// ─── Step 5: Run config ────────────────────────────────────────────────────

function StepConfig({
  state,
  onUpdate,
  onNext,
  onBack,
}: {
  state: CreatorState;
  onUpdate: (next: Partial<CreatorState>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [field, setField] = useState<"count" | "concurrency" | "maxTurns">(
    "count"
  );

  useInput((input, key) => {
    if (key.escape) return onBack();
    if (key.tab || key.return) return onNext();
    if (key.upArrow) {
      if (field === "concurrency") return setField("count");
      if (field === "maxTurns") return setField("concurrency");
    }
    if (key.downArrow) {
      if (field === "count") return setField("concurrency");
      if (field === "concurrency") return setField("maxTurns");
    }
    // +/-, j/k, h/l adjust active field by 1
    const delta =
      input === "+" || input === "k" || input === "l"
        ? 1
        : input === "-" || input === "j" || input === "h"
          ? -1
          : 0;
    if (delta !== 0) {
      if (field === "count") {
        onUpdate({ count: Math.max(1, state.count + delta) });
      } else if (field === "concurrency") {
        onUpdate({
          concurrency: Math.max(1, state.concurrency + delta),
        });
      } else if (field === "maxTurns") {
        onUpdate({ maxTurns: Math.max(1, state.maxTurns + delta) });
      }
    }
  });

  function row(
    fieldName: "count" | "concurrency" | "maxTurns",
    label: string,
    value: number,
    hint: string
  ) {
    const isActive = field === fieldName;
    return (
      <Box gap={1}>
        <Text color={isActive ? Theme.brand : undefined}>
          {isActive ? ">" : " "}
        </Text>
        <Text bold={isActive}>{label}:</Text>
        <Text color={isActive ? Theme.brand : undefined}>{String(value)}</Text>
        <Text dimColor>{hint}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box paddingBottom={1}>
        <Text bold color={Theme.brand}>
          Run configuration
        </Text>
      </Box>
      {row("count", "Count", state.count, "(autouser × per-comparison)")}
      {row("concurrency", "Concurrency", state.concurrency, "(parallel runs)")}
      {row("maxTurns", "Max turns", state.maxTurns, "(per session)")}
      <Box paddingTop={1}>
        <Text dimColor>↑↓ field · +/- adjust · Enter next · Esc back</Text>
      </Box>
    </Box>
  );
}

// ─── Step 6: Review (with server-side dryRun cost preview) ─────────────────

interface ReviewProps {
  state: CreatorState;
  preview: DryRunEnvelope["data"] | null;
  loading: boolean;
  error: string | null;
  onConfirm: () => void;
  onEdit: () => void;
  onCancel: () => void;
}

function StepReview({
  state,
  preview,
  loading,
  error,
  onConfirm,
  onEdit,
  onCancel,
}: ReviewProps) {
  type Action = "confirm" | "edit" | "cancel";
  const [action, setAction] = useState<Action>("confirm");
  const actions: Action[] = ["confirm", "edit", "cancel"];

  useInput((_input, key) => {
    if (key.escape) return onCancel();
    if (key.leftArrow) {
      const i = actions.indexOf(action);
      if (i > 0) setAction(actions[i - 1]!);
      return;
    }
    if (key.rightArrow) {
      const i = actions.indexOf(action);
      if (i < actions.length - 1) setAction(actions[i + 1]!);
      return;
    }
    if (key.return) {
      if (action === "confirm") return onConfirm();
      if (action === "edit") return onEdit();
      if (action === "cancel") return onCancel();
    }
  });

  const stimuli =
    state.evalType === "SSE"
      ? state.urls.filter((u) => u.url.trim().length > 0).length
      : state.pairs.filter((p) => p.urlA.trim() && p.urlB.trim()).length;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box paddingBottom={1}>
        <Text bold color={Theme.brand}>
          Review
        </Text>
      </Box>

      <Box
        borderStyle="single"
        borderColor={Theme.brand}
        flexDirection="column"
        paddingX={1}
      >
        <Box gap={2}>
          <Text dimColor>Would create:</Text>
          <Text bold>
            {state.name || "Untitled evaluation"} ({state.evalType})
          </Text>
        </Box>
        <Box gap={2}>
          <Text dimColor>Stimuli:</Text>
          <Text>
            {stimuli} {state.evalType === "SSE" ? "URL" : "pair"}
            {stimuli !== 1 ? "s" : ""}
          </Text>
        </Box>
        <Box gap={2}>
          <Text dimColor>Autorater:</Text>
          <Text>{state.autorater?.name ?? "(none)"}</Text>
        </Box>
        <Box gap={2}>
          <Text dimColor>Dimensions:</Text>
          <Text>{state.dimensions.length}</Text>
        </Box>
        <Box gap={2}>
          <Text dimColor>Run config:</Text>
          <Text>
            {state.count}× · c:{state.concurrency} · t:{state.maxTurns}
          </Text>
        </Box>
      </Box>

      {loading ? (
        <Box paddingTop={1}>
          <Text color={Theme.brand}>Computing cost preview...</Text>
        </Box>
      ) : null}

      {error ? (
        <Box paddingTop={1}>
          <Text color={Theme.error}>Preview failed: {error}</Text>
        </Box>
      ) : null}

      {preview && preview.wouldRun ? (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={Theme.warning}
          paddingX={1}
          marginTop={1}
        >
          <Text bold color={Theme.warning}>
            Would run
          </Text>
          <Text>
            {preview.wouldRun.autouserCount} autouser
            {preview.wouldRun.autouserCount !== 1 ? "s" : ""} ×{" "}
            {preview.wouldRun.comparisonCount} comparison
            {preview.wouldRun.comparisonCount !== 1 ? "s" : ""} ={" "}
            <Text bold>{preview.wouldRun.totalRuns} ratings</Text>
          </Text>
          {preview.costEstimate ? (
            <Text>
              Estimated cost:{" "}
              <Text color={Theme.brand} bold>
                ${preview.costEstimate.total.usd.toFixed(2)}
              </Text>
              {preview.costEstimate.basis ? (
                <Text dimColor> (basis: {preview.costEstimate.basis})</Text>
              ) : null}
            </Text>
          ) : (
            <Text dimColor>
              Cost estimate unavailable — server returned no figure.
            </Text>
          )}
        </Box>
      ) : null}

      {preview && preview.warnings.length > 0 ? (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={Theme.warning}
          paddingX={1}
          marginTop={1}
        >
          <Text bold color={Theme.warning}>
            Warnings
          </Text>
          {preview.warnings.map((w) => (
            <Text key={w.code} color={Theme.warning}>
              · {w.message}
            </Text>
          ))}
        </Box>
      ) : null}

      <Box paddingTop={1} gap={2}>
        {actions.map((a) => {
          const color =
            a === "cancel"
              ? Theme.error
              : a === "edit"
                ? Theme.textDim
                : Theme.success;
          const label =
            a === "confirm"
              ? "Confirm & create"
              : a === "edit"
                ? "Edit"
                : "Cancel";
          return (
            <Box
              key={a}
              borderStyle={action === a ? "bold" : "single"}
              borderColor={action === a ? color : Theme.textDim}
              paddingX={2}
            >
              <Text
                color={action === a ? color : Theme.textDim}
                bold={action === a}
              >
                {label}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box paddingTop={1}>
        <Text dimColor>← → choose · Enter confirm · Esc cancel</Text>
      </Box>
    </Box>
  );
}

// ─── Confirm step (post-creation success) ──────────────────────────────────

function StepConfirmDone({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  useInput((_input, key) => {
    if (key.return || key.escape) onClose();
  });
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box paddingBottom={1}>
        <Text bold color={Theme.success}>
          Evaluation queued
        </Text>
      </Box>
      <Text>{message}</Text>
      <Box paddingTop={1}>
        <Text dimColor>Enter / Esc — back to menu</Text>
      </Box>
    </Box>
  );
}

// ─── Main screen ───────────────────────────────────────────────────────────

/**
 * Minimal client surface the screen consumes — only `post`. Defining a
 * narrow interface (rather than the concrete AutousersClient class)
 * lets test harnesses pass an inline `{ post: vi.fn() }` without
 * stubbing the entire fetch stack.
 */
export interface EvalCreatorClient {
  post: <T = unknown>(path: string, body?: unknown) => Promise<T>;
}

interface EvalCreatorProps {
  /**
   * Optional override of the API client factory. Tests inject a mock that
   * returns canned dryRun + create envelopes without exercising the real
   * fetch stack. Production callers omit this and let the screen build
   * its own client from persisted config.
   */
  createClient?: () => Promise<EvalCreatorClient>;
  /**
   * Test seam — replaces the autouser-picker's API fetch. Production
   * omits this and the picker pulls its own list from
   * `/api/v1/autousers?includeSystem=true`.
   */
  loadAutousers?: () => Promise<
    Array<{
      id: string;
      name: string;
      description: string;
      source: "built-in" | "custom";
    }>
  >;
  /**
   * Test seam — replaces the dimensions-step API fetch. Production omits
   * this and the step pulls its own list from `/api/v1/templates`.
   */
  loadTemplates?: () => Promise<PickerTemplate[]>;
}

export function EvalCreator(_props: EvalCreatorProps = {}) {
  const setScreen = useTUIStore((s) => s.setScreen);
  const setToast = useTUIStore((s) => s.setToast);

  const [step, setStep] = useState<CreatorStep>("type");
  const [state, setState] = useState<CreatorState>({
    name: "",
    evalType: "SSE",
    urls: [{ id: "u-0", url: "" }],
    pairs: [{ id: "p-0", urlA: "", urlB: "" }],
    autorater: null,
    dimensions: ["overall"],
    count: 1,
    concurrency: 2,
    maxTurns: 10,
  });

  const [preview, setPreview] = useState<DryRunEnvelope["data"] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  // Fetch dryRun preview when entering the review step. Re-runs if the
  // user goes back and forwards, picking up edits made in between.
  useEffect(() => {
    if (step !== "review") return;
    let cancelled = false;
    setPreview(null);
    setPreviewLoading(true);
    setPreviewError(null);
    const factory = _props.createClient ?? (() => createClientFromConfig({}));
    Promise.resolve(factory())
      .then((client) =>
        client.post<DryRunEnvelope>(
          "/api/v1/evaluations",
          buildEvalPayload(state, { dryRun: true, status: "Draft" })
        )
      )
      .then((env) => {
        if (cancelled) return;
        setPreview(env.data);
        setPreviewLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPreviewError(err instanceof Error ? err.message : String(err));
        setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, state, _props.createClient]);

  const goNext = useCallback(() => {
    setStep((cur) => {
      const idx = STEPS.findIndex((s) => s.key === cur);
      const next = STEPS[idx + 1];
      return (next?.key ?? cur) as CreatorStep;
    });
  }, []);

  const goBack = useCallback(() => {
    setStep((cur) => {
      const idx = STEPS.findIndex((s) => s.key === cur);
      if (idx <= 0) {
        setScreen("menu");
        return cur;
      }
      return STEPS[idx - 1]!.key as CreatorStep;
    });
  }, [setScreen]);

  const setEvaluationId = useTUIStore((s) => s.setEvaluationId);
  const resetDashboard = useTUIStore((s) => s.resetDashboard);

  const onConfirm = useCallback(async () => {
    setStep("confirm");
    try {
      const factory = _props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      const env = await client.post<CreateEvalEnvelope>(
        "/api/v1/evaluations",
        buildEvalPayload(state, { dryRun: false, status: "Running" })
      );
      const id = env.data.id;
      setDoneMessage(
        `Created ${env.data.name} (${id.slice(0, 8)}…) — switching to live dashboard…`
      );
      setToast({
        kind: "success",
        message: `Evaluation queued — ${env.data.name}`,
      });
      // Auto-clear toast after 5s.
      setTimeout(() => setToast(null), 5000);

      // Wave 5: transition to the dashboard. Reset prior dashboard
      // state first so a previous run's session map doesn't leak in.
      resetDashboard();
      setEvaluationId(id);
      setScreen("dashboard");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDoneMessage(`Failed: ${msg}`);
      setToast({ kind: "error", message: `Create failed: ${msg}` });
      setTimeout(() => setToast(null), 5000);
    }
  }, [
    _props.createClient,
    setToast,
    state,
    resetDashboard,
    setEvaluationId,
    setScreen,
  ]);

  // Build the preview list for the wizard sidebar.
  const stepsWithPreview: WizardStep[] = STEPS.map((s) => {
    let preview: string | undefined;
    if (s.key === "type") preview = state.evalType;
    else if (s.key === "urls") {
      const n =
        state.evalType === "SSE"
          ? state.urls.filter((u) => u.url.trim()).length
          : state.pairs.filter((p) => p.urlA.trim() && p.urlB.trim()).length;
      preview = `${n} ${state.evalType === "SSE" ? "URL" : "pair"}${n !== 1 ? "s" : ""}`;
    } else if (s.key === "autorater") {
      preview = state.autorater?.name ?? "—";
    } else if (s.key === "dimensions") {
      preview = `${state.dimensions.length} dim${state.dimensions.length !== 1 ? "s" : ""}`;
    } else if (s.key === "config") {
      preview = `${state.count}× c:${state.concurrency}`;
    }
    return preview ? { ...s, preview } : s;
  });

  return (
    <Wizard title="Create Evaluation" steps={stepsWithPreview} activeKey={step}>
      {step === "type" ? (
        <StepType
          evalType={state.evalType}
          onChange={(t) => setState((p) => ({ ...p, evalType: t }))}
          onNext={goNext}
          onBack={goBack}
        />
      ) : null}

      {step === "urls" ? (
        <StepUrls
          state={state}
          onUpdate={(next) => setState((p) => ({ ...p, ...next }))}
          onNext={goNext}
          onBack={goBack}
        />
      ) : null}

      {step === "autorater" ? (
        <AutoraterPicker
          onSelect={(autorater) => {
            setState((p) => ({ ...p, autorater }));
            goNext();
          }}
          onBack={goBack}
          loadAutousers={_props.loadAutousers}
        />
      ) : null}

      {step === "dimensions" ? (
        <StepDimensions
          selected={state.dimensions}
          onChange={(next) => setState((p) => ({ ...p, dimensions: next }))}
          onNext={goNext}
          onBack={goBack}
          loadTemplates={_props.loadTemplates}
        />
      ) : null}

      {step === "config" ? (
        <StepConfig
          state={state}
          onUpdate={(next) => setState((p) => ({ ...p, ...next }))}
          onNext={goNext}
          onBack={goBack}
        />
      ) : null}

      {step === "review" ? (
        <StepReview
          state={state}
          preview={preview}
          loading={previewLoading}
          error={previewError}
          onConfirm={onConfirm}
          onEdit={() => setStep("type")}
          onCancel={() => setScreen("menu")}
        />
      ) : null}

      {step === "confirm" ? (
        <StepConfirmDone
          message={doneMessage ?? "Submitting..."}
          onClose={() => {
            setScreen("menu");
            setStep("type");
          }}
        />
      ) : null}
    </Wizard>
  );
}
