import { describe, it, expect } from "vitest";

import {
  SSEAdapter,
  deriveSessionPhase,
  mapServerEvent,
  type ServerRun,
} from "./sse-adapter.js";

function fixtureRun(overrides: Partial<ServerRun> = {}): ServerRun {
  return {
    id: "run_a",
    status: "pending",
    autouserId: "built-in:casual-browser",
    autouserType: "builtin",
    autouserName: "Casual Browser",
    autouserIcon: "smart_toy",
    currentStep: null,
    currentComparison: 0,
    totalComparisons: 1,
    ratingsCreated: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    error: null,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe("deriveSessionPhase", () => {
  it("maps every server status to a SessionPhase", () => {
    expect(deriveSessionPhase(fixtureRun({ status: "pending" }))).toBe(
      "queued"
    );
    expect(deriveSessionPhase(fixtureRun({ status: "running" }))).toBe(
      "navigating"
    );
    expect(
      deriveSessionPhase(
        fixtureRun({ status: "running", currentStep: "judging" })
      )
    ).toBe("judging");
    expect(deriveSessionPhase(fixtureRun({ status: "completed" }))).toBe(
      "complete"
    );
    expect(deriveSessionPhase(fixtureRun({ status: "failed" }))).toBe("error");
    expect(deriveSessionPhase(fixtureRun({ status: "cancelled" }))).toBe(
      "error"
    );
  });
});

describe("SSEAdapter.translate", () => {
  describe("snapshot", () => {
    it("emits a single run:progress with seeded counts", () => {
      const adapter = new SSEAdapter(() => 1700000000000);
      const events = adapter.translate({
        type: "snapshot",
        payload: {
          runs: [
            fixtureRun({ id: "r1", status: "pending" }),
            fixtureRun({ id: "r2", status: "running" }),
            fixtureRun({
              id: "r3",
              status: "completed",
              ratingsCreated: 4,
              estimatedCostUsd: 0.12,
            }),
            fixtureRun({ id: "r4", status: "failed", error: "boom" }),
          ],
        },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "run:progress",
        completed: 1,
        total: 4,
        errors: 1,
      });
    });

    it("does not double-emit session:start for runs already running on connect", () => {
      const adapter = new SSEAdapter();
      adapter.translate({
        type: "snapshot",
        payload: {
          runs: [fixtureRun({ id: "r1", status: "running" })],
        },
      });

      const events = adapter.translate({
        type: "run_update",
        payload: fixtureRun({ id: "r1", status: "running" }),
      });
      expect(events.find((e) => e.type === "session:start")).toBeUndefined();
    });
  });

  describe("run_update", () => {
    it("emits session:start the first time a run goes non-pending", () => {
      const adapter = new SSEAdapter();
      // First, snapshot with the run still pending so the adapter
      // doesn't pre-mark it as started.
      adapter.translate({
        type: "snapshot",
        payload: { runs: [fixtureRun({ id: "r1", status: "pending" })] },
      });

      const events = adapter.translate({
        type: "run_update",
        payload: fixtureRun({
          id: "r1",
          status: "running",
          startedAt: "2026-05-02T01:23:45.000Z",
        }),
      });

      const start = events.find((e) => e.type === "session:start");
      expect(start).toBeDefined();
      expect(start).toMatchObject({
        type: "session:start",
        sessionId: "r1",
        autouser: "built-in:casual-browser",
        autouserType: "builtin",
        timestamp: "2026-05-02T01:23:45.000Z",
      });
    });

    it("does not re-emit session:start on subsequent run_updates", () => {
      const adapter = new SSEAdapter();
      adapter.translate({
        type: "snapshot",
        payload: { runs: [fixtureRun({ id: "r1", status: "pending" })] },
      });
      adapter.translate({
        type: "run_update",
        payload: fixtureRun({ id: "r1", status: "running" }),
      });
      const events = adapter.translate({
        type: "run_update",
        payload: fixtureRun({
          id: "r1",
          status: "running",
          currentStep: "judging",
        }),
      });
      expect(events.find((e) => e.type === "session:start")).toBeUndefined();
    });

    it("emits session:error when status flips to failed", () => {
      const adapter = new SSEAdapter();
      adapter.translate({
        type: "snapshot",
        payload: { runs: [fixtureRun({ id: "r1", status: "pending" })] },
      });
      adapter.translate({
        type: "run_update",
        payload: fixtureRun({ id: "r1", status: "running" }),
      });
      const events = adapter.translate({
        type: "run_update",
        payload: fixtureRun({
          id: "r1",
          status: "failed",
          error: "headless crashed",
        }),
      });
      const errEvent = events.find((e) => e.type === "session:error");
      expect(errEvent).toMatchObject({
        type: "session:error",
        sessionId: "r1",
        error: "headless crashed",
      });
      const progress = events.find((e) => e.type === "run:progress");
      expect(progress).toMatchObject({ errors: 1 });
    });

    it("always emits a run:progress event", () => {
      const adapter = new SSEAdapter();
      adapter.translate({
        type: "snapshot",
        payload: { runs: [fixtureRun({ id: "r1", status: "pending" })] },
      });
      const events = adapter.translate({
        type: "run_update",
        payload: fixtureRun({ id: "r1", status: "running" }),
      });
      expect(events.find((e) => e.type === "run:progress")).toBeDefined();
    });
  });

  describe("run_complete", () => {
    it("emits session:result with accumulated cost and ratings", () => {
      const adapter = new SSEAdapter();
      adapter.translate({
        type: "snapshot",
        payload: { runs: [fixtureRun({ id: "r1", status: "running" })] },
      });

      const events = adapter.translate({
        type: "run_complete",
        payload: fixtureRun({
          id: "r1",
          status: "completed",
          ratingsCreated: 3,
          inputTokens: 1000,
          outputTokens: 200,
          estimatedCostUsd: 0.42,
          ratingSummary: { totalRatings: 3, averageScore: 4.2 },
        }),
      });

      const result = events.find((e) => e.type === "session:result");
      expect(result).toMatchObject({
        type: "session:result",
        sessionId: "r1",
        result: {
          ratingsCreated: 3,
          ratingSummary: { totalRatings: 3, averageScore: 4.2 },
        },
        cost: { inputTokens: 1000, outputTokens: 200, costUsd: 0.42 },
      });

      const progress = events.find((e) => e.type === "run:progress");
      expect(progress).toMatchObject({ completed: 1, errors: 0 });
    });

    it("dedupes when the same run completes twice", () => {
      const adapter = new SSEAdapter();
      adapter.translate({
        type: "snapshot",
        payload: { runs: [fixtureRun({ id: "r1", status: "running" })] },
      });

      adapter.translate({
        type: "run_complete",
        payload: fixtureRun({
          id: "r1",
          status: "completed",
          ratingsCreated: 3,
          estimatedCostUsd: 0.42,
        }),
      });

      const events = adapter.translate({
        type: "run_complete",
        payload: fixtureRun({
          id: "r1",
          status: "completed",
          ratingsCreated: 3,
          estimatedCostUsd: 0.42,
        }),
      });

      // No new session:result; only a fresh run:progress
      expect(events.find((e) => e.type === "session:result")).toBeUndefined();
      const progress = events.find((e) => e.type === "run:progress");
      expect(progress).toMatchObject({ completed: 1, errors: 0 });
    });

    it("emits session:error when run_complete carries failed status", () => {
      const adapter = new SSEAdapter();
      adapter.translate({
        type: "snapshot",
        payload: { runs: [fixtureRun({ id: "r1", status: "running" })] },
      });

      const events = adapter.translate({
        type: "run_complete",
        payload: fixtureRun({
          id: "r1",
          status: "failed",
          error: "timeout",
        }),
      });

      expect(events.find((e) => e.type === "session:error")).toMatchObject({
        sessionId: "r1",
        error: "timeout",
      });
    });
  });

  describe("done", () => {
    it("emits run:complete with totalRatings + totalCost + durationSec", () => {
      let now = 1700000000000;
      const adapter = new SSEAdapter(() => now);
      adapter.translate({
        type: "snapshot",
        payload: {
          runs: [
            fixtureRun({
              id: "r1",
              status: "completed",
              ratingsCreated: 2,
              estimatedCostUsd: 0.25,
            }),
            fixtureRun({
              id: "r2",
              status: "completed",
              ratingsCreated: 1,
              estimatedCostUsd: 0.15,
            }),
          ],
        },
      });
      now += 12_000;

      const events = adapter.translate({
        type: "done",
        payload: { reason: "all_terminal" },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "run:complete",
        totalRatings: 3,
        totalCost: 0.4,
        durationSec: 12,
        reason: "all_terminal",
      });
    });
  });

  describe("mapServerEvent (one-shot helper)", () => {
    it("returns the same shape as translate() on a fresh adapter", () => {
      const events = mapServerEvent({
        type: "snapshot",
        payload: { runs: [fixtureRun({ id: "r1", status: "pending" })] },
      });
      expect(events).toEqual([
        { type: "run:progress", completed: 0, total: 1, errors: 0 },
      ]);
    });
  });
});
