/**
 * Server-event → TUIEvent adapter.
 *
 * The autousers server's SSE endpoint at
 * `/api/v1/evaluations/:id/autouser-stream` emits four event names:
 *
 *   - `snapshot`     initial enriched run list, sent once on connect
 *   - `run_update`   any UPDATE on an AutouserRun row (postgres_changes)
 *   - `run_complete` a run transitioned to a terminal status — payload
 *                    includes a `ratingSummary` aggregate
 *   - `done`         every run is terminal; server then closes the stream
 *
 * The TUI's component tree is shaped against uxrater's `TUIEvent` union
 * (8 variants) — so this adapter maps the four server shapes onto the
 * subset the dashboard cares about. uxrater's `session:turn` and
 * `session:nav-done` aren't synthesized here because the server doesn't
 * stream per-turn detail.
 *
 * The adapter is **stateful** — it remembers which sessions it has seen
 * transition from pending → running so it can emit `session:start`
 * exactly once per run, and tallies progress counts so each
 * `run_update` triggers a fresh `run:progress` event. Pure functions
 * with this kind of cross-event memory get clunky; the explicit class
 * makes the test surface obvious.
 */

import type { SessionPhase, SessionResultSummary, TUIEvent } from "./events.js";

/**
 * Shape of an enriched AutouserRun the server sends. We type only the
 * fields the adapter consumes — extra fields on the wire are ignored.
 *
 * Matches `EnrichedRun` in
 * `app/api/v1/evaluations/[id]/autouser-stream/route.ts`.
 */
export interface ServerRun {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  autouserId: string;
  autouserType: "builtin" | "custom";
  autouserName: string;
  autouserIcon: string;
  currentStep: string | null;
  currentComparison: number;
  totalComparisons: number;
  ratingsCreated: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  currentAction?: string | null;
  currentNarration?: string | null;
  ratingSummary?: {
    totalRatings: number;
    averageScore?: number;
    sideA?: number;
    same?: number;
    sideB?: number;
  };
}

export interface ServerSnapshotEvent {
  type: "snapshot";
  payload: { runs: ServerRun[] };
}
export interface ServerRunUpdateEvent {
  type: "run_update";
  payload: ServerRun;
}
export interface ServerRunCompleteEvent {
  type: "run_complete";
  payload: ServerRun;
}
export interface ServerDoneEvent {
  type: "done";
  payload: { reason: string };
}

export type ServerEvent =
  | ServerSnapshotEvent
  | ServerRunUpdateEvent
  | ServerRunCompleteEvent
  | ServerDoneEvent;

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

/**
 * Translate a server `status` field into the dashboard's `SessionPhase`.
 * `currentStep` (when the row is `running`) gives us a more precise
 * phase — we surface `judging` whenever the worker reports it so the
 * dashboard's row label changes mid-run; otherwise we fall back to
 * `navigating`.
 */
export function deriveSessionPhase(run: ServerRun): SessionPhase {
  if (run.status === "completed") return "complete";
  if (run.status === "failed" || run.status === "cancelled") return "error";
  if (run.status === "pending") return "queued";
  // status === "running"
  if (run.currentStep === "judging") return "judging";
  return "navigating";
}

/**
 * Build a SessionResultSummary from a completed ServerRun. Returns
 * `undefined` when the run isn't completed or hasn't produced ratings.
 */
function toResultSummary(run: ServerRun): SessionResultSummary | undefined {
  if (run.status !== "completed") return undefined;
  return {
    ratingsCreated: run.ratingsCreated,
    ...(run.ratingSummary ? { ratingSummary: run.ratingSummary } : {}),
  };
}

/**
 * Adapter — feed server events in, get TUIEvents out. The caller
 * dispatches each returned event onto the `TUIEventBus`. Returning an
 * array (rather than emitting via callback) keeps the function pure on
 * a per-call basis, which makes test assertions tidy.
 */
export class SSEAdapter {
  /**
   * Tracks which sessions have already emitted `session:start`, so a
   * row that update-bounces between `pending` and `running` doesn't
   * emit duplicate starts. `session:start` fires the first time we see
   * a non-`pending` status.
   */
  private startedSessions = new Set<string>();
  /**
   * Tracks which sessions have emitted `session:result` or
   * `session:error` so a duplicate `run_update` (e.g. from a
   * postgres_changes burst) doesn't double-count.
   */
  private completedSessions = new Set<string>();
  /** Most recent total — server sends this in `snapshot.runs.length`. */
  private total = 0;
  /** Cumulative completed (excluding errors). */
  private completed = 0;
  /** Cumulative errors. */
  private errors = 0;
  /** Aggregate cost, accumulated as runs complete. */
  private aggregateCost = 0;
  /** Aggregate ratings, accumulated as runs complete. */
  private aggregateRatings = 0;
  /** First-seen timestamp — anchors the `run:complete` durationSec. */
  private startedAt: number | null = null;

  /**
   * Optional override for `Date.now()` — tests pass a deterministic
   * counter so the `run:complete.durationSec` is reproducible.
   */
  constructor(private now: () => number = () => Date.now()) {}

  /** Map a single server event → TUIEvent[]. */
  public translate(event: ServerEvent): TUIEvent[] {
    switch (event.type) {
      case "snapshot":
        return this.translateSnapshot(event.payload.runs);
      case "run_update":
        return this.translateRunUpdate(event.payload);
      case "run_complete":
        return this.translateRunComplete(event.payload);
      case "done":
        return this.translateDone(event.payload.reason);
    }
  }

  private translateSnapshot(runs: ServerRun[]): TUIEvent[] {
    if (this.startedAt === null) this.startedAt = this.now();
    this.total = runs.length;
    let completed = 0;
    let errors = 0;
    const out: TUIEvent[] = [];

    for (const run of runs) {
      // Record sessions that arrive already-started so a later
      // run_update doesn't re-emit `session:start` for them.
      if (run.status !== "pending") {
        this.startedSessions.add(run.id);
      }
      if (run.status === "completed") {
        completed++;
        this.completedSessions.add(run.id);
        this.aggregateCost += run.estimatedCostUsd ?? 0;
        this.aggregateRatings += run.ratingsCreated ?? 0;
      } else if (run.status === "failed" || run.status === "cancelled") {
        errors++;
        this.completedSessions.add(run.id);
      }
    }
    this.completed = completed;
    this.errors = errors;

    out.push({
      type: "run:progress",
      completed: this.completed,
      total: this.total,
      errors: this.errors,
    });

    return out;
  }

  private translateRunUpdate(run: ServerRun): TUIEvent[] {
    // First time we see this run as non-pending → emit session:start.
    const out: TUIEvent[] = [];
    if (!this.startedSessions.has(run.id) && run.status !== "pending") {
      this.startedSessions.add(run.id);
      out.push({
        type: "session:start",
        sessionId: run.id,
        autouser: run.autouserId,
        autouserType: run.autouserType,
        timestamp: run.startedAt ?? new Date(this.now()).toISOString(),
      });
    }

    // Failure surfaces as `run_update` with status=failed (not as
    // run_complete). We emit `session:error` here, deduped via
    // `completedSessions`.
    if (
      (run.status === "failed" || run.status === "cancelled") &&
      !this.completedSessions.has(run.id)
    ) {
      this.completedSessions.add(run.id);
      this.errors++;
      out.push({
        type: "session:error",
        sessionId: run.id,
        error: run.error ?? "Run failed",
      });
    }

    // Always sync progress on every update so the header counter ticks
    // even when a run is mid-navigation.
    out.push({
      type: "run:progress",
      completed: this.completed,
      total: this.total,
      errors: this.errors,
    });

    return out;
  }

  private translateRunComplete(run: ServerRun): TUIEvent[] {
    const out: TUIEvent[] = [];

    // Defensive: emit session:start if we somehow missed the running
    // transition (server may compact updates under load).
    if (!this.startedSessions.has(run.id)) {
      this.startedSessions.add(run.id);
      out.push({
        type: "session:start",
        sessionId: run.id,
        autouser: run.autouserId,
        autouserType: run.autouserType,
        timestamp: run.startedAt ?? new Date(this.now()).toISOString(),
      });
    }

    if (this.completedSessions.has(run.id)) {
      // Already accounted for (e.g. a duplicate postgres_changes burst).
      // Still emit a fresh progress to keep the UI in sync.
      out.push({
        type: "run:progress",
        completed: this.completed,
        total: this.total,
        errors: this.errors,
      });
      return out;
    }

    this.completedSessions.add(run.id);
    if (run.status === "completed") {
      this.completed++;
      this.aggregateCost += run.estimatedCostUsd ?? 0;
      this.aggregateRatings += run.ratingsCreated ?? 0;

      const result =
        toResultSummary(run) ?? ({ ratingsCreated: 0 } as SessionResultSummary);
      out.push({
        type: "session:result",
        sessionId: run.id,
        result,
        cost: {
          inputTokens: run.inputTokens ?? 0,
          outputTokens: run.outputTokens ?? 0,
          costUsd: run.estimatedCostUsd ?? 0,
        },
      });
    } else if (run.status === "failed" || run.status === "cancelled") {
      this.errors++;
      out.push({
        type: "session:error",
        sessionId: run.id,
        error: run.error ?? "Run failed",
      });
    }

    out.push({
      type: "run:progress",
      completed: this.completed,
      total: this.total,
      errors: this.errors,
    });

    return out;
  }

  private translateDone(reason: string): TUIEvent[] {
    const startedAt = this.startedAt ?? this.now();
    const durationSec = Math.max(
      0,
      Math.round((this.now() - startedAt) / 1000)
    );
    return [
      {
        type: "run:complete",
        totalRatings: this.aggregateRatings,
        totalCost: this.aggregateCost,
        durationSec,
        reason,
      },
    ];
  }
}

/**
 * Convenience function for callers that want one-shot translation
 * without instantiating an adapter (e.g. tests verifying a single
 * event's mapping). The returned array semantics match `translate`.
 */
export function mapServerEvent(event: ServerEvent): TUIEvent[] {
  return new SSEAdapter().translate(event);
}
