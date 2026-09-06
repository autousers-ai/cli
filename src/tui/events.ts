/**
 * In-process pub/sub bus for TUI events.
 *
 * Wave 2 shipped a stub union with a single `noop` variant; Wave 5
 * expands it to the full event surface modeled on uxrater's
 * `cli/events.ts`. Adapted for autousers' server-side eval running:
 * uxrater drove agents locally and fed transcripts/agent-results into
 * `session:turn` and `session:nav-done`; the autousers server doesn't
 * stream that level of detail, so those variants stay in the union for
 * forward compat (plain-mode JSONL output, future local runner) but the
 * SSE adapter only synthesizes the variants the server actually emits.
 *
 * Event-type quick reference:
 *
 *   session:start    — first transition of a run from pending → running
 *   session:turn     — per-turn transcript entry (NOT emitted by adapter;
 *                      reserved for future local-runner / plain mode)
 *   session:nav-done — navigation phase complete (same caveat as turn)
 *   session:judging  — judging phase started/complete
 *   session:result   — run finished with judging results
 *   session:error    — run failed
 *   run:progress     — aggregate counts updated (completed / total / errors)
 *   run:complete     — every run terminal; aggregate cost + ratings count
 */

/**
 * Phase string the worker advertises on each AutouserRun. Matches the
 * Prisma `currentStep` field. `queued` is the synthetic value we use
 * before any update lands; `complete`/`error` are derived from terminal
 * `status` rather than `currentStep`.
 */
export type SessionPhase =
  | "queued"
  | "navigating"
  | "judging"
  | "complete"
  | "error";

/**
 * Cost / token snapshot for a single run. Server reports input/output
 * token totals + an `estimatedCostUsd` aggregate; we forward both so the
 * cost ticker can render either total spend or a tokens breakdown. Kept
 * as plain numbers — `Decimal` round-trips cleanly through JSON.
 */
export interface SessionCost {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * Lightweight result payload surfaced when a run finishes. The server
 * stream emits the AutouserRun row (with `ratingsCreated` and an
 * optional `ratingSummary`); the dashboard renders summary numbers,
 * not transcripts. Detail fetch (`/api/v1/evaluations/:id/ratings`) is
 * left to the listener that owns the screen.
 */
export interface SessionResultSummary {
  ratingsCreated: number;
  ratingSummary?: {
    totalRatings: number;
    averageScore?: number;
    sideA?: number;
    same?: number;
    sideB?: number;
  };
}

/**
 * Aggregate cost-tracking entry, accumulated as runs complete. uxrater's
 * shape splits navigation / judging tokens; the autousers server only
 * exposes a single combined `inputTokens`/`outputTokens` per run, so we
 * collapse into a single "model" bucket. Keeping the type around (rather
 * than inlining) makes it easier to widen later if the server starts
 * emitting per-phase token counts.
 */
export interface RunCostEntry {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export type TUIEvent =
  | {
      type: "session:start";
      sessionId: string;
      autouser: string;
      autouserType: "builtin" | "custom";
      timestamp: string;
    }
  | {
      type: "session:turn";
      sessionId: string;
      turn: number;
      maxTurns: number;
      action?: string;
      narration?: string;
    }
  | {
      type: "session:nav-done";
      sessionId: string;
      currentComparison: number;
      totalComparisons: number;
    }
  | {
      type: "session:judging";
      sessionId: string;
      status: "started" | "complete";
    }
  | {
      type: "session:result";
      sessionId: string;
      result: SessionResultSummary;
      cost: SessionCost;
    }
  | {
      type: "session:error";
      sessionId: string;
      error: string;
    }
  | {
      type: "run:progress";
      completed: number;
      total: number;
      errors: number;
    }
  | {
      type: "run:complete";
      totalRatings: number;
      totalCost: number;
      durationSec: number;
      reason: string;
    };

export class TUIEventBus {
  private listeners = new Map<string, Set<(event: TUIEvent) => void>>();

  on<T extends TUIEvent["type"]>(
    type: T,
    handler: (event: Extract<TUIEvent, { type: T }>) => void
  ): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler as (event: TUIEvent) => void);
    return () => {
      this.listeners.get(type)?.delete(handler as (event: TUIEvent) => void);
    };
  }

  emit(event: TUIEvent): void {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      for (const handler of handlers) handler(event);
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
