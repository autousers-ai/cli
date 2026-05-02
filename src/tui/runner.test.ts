import { describe, it, expect, vi } from "vitest";

import { TUIEventBus, type TUIEvent } from "./events.js";
import { parseSSEStream, readableFromString, runEval } from "./runner.js";

const SNAPSHOT_PAYLOAD = JSON.stringify({
  runs: [
    {
      id: "r1",
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
    },
  ],
});

const RUN_UPDATE_RUNNING = JSON.stringify({
  id: "r1",
  status: "running",
  autouserId: "built-in:casual-browser",
  autouserType: "builtin",
  autouserName: "Casual Browser",
  autouserIcon: "smart_toy",
  currentStep: "navigating",
  currentComparison: 0,
  totalComparisons: 1,
  ratingsCreated: 0,
  inputTokens: 0,
  outputTokens: 0,
  estimatedCostUsd: 0,
  error: null,
  startedAt: "2026-05-02T01:23:45Z",
  completedAt: null,
});

const RUN_COMPLETE = JSON.stringify({
  id: "r1",
  status: "completed",
  autouserId: "built-in:casual-browser",
  autouserType: "builtin",
  autouserName: "Casual Browser",
  autouserIcon: "smart_toy",
  currentStep: null,
  currentComparison: 1,
  totalComparisons: 1,
  ratingsCreated: 3,
  inputTokens: 1200,
  outputTokens: 300,
  estimatedCostUsd: 0.42,
  error: null,
  startedAt: "2026-05-02T01:23:45Z",
  completedAt: "2026-05-02T01:24:30Z",
  ratingSummary: { totalRatings: 3, averageScore: 4.2 },
});

const FULL_STREAM = [
  ": heartbeat",
  "",
  `event: snapshot\ndata: ${SNAPSHOT_PAYLOAD}`,
  "",
  `event: run_update\ndata: ${RUN_UPDATE_RUNNING}`,
  "",
  ": heartbeat",
  "",
  `event: run_complete\ndata: ${RUN_COMPLETE}`,
  "",
  `event: done\ndata: {"reason":"all_terminal"}`,
  "",
  "",
].join("\n");

describe("parseSSEStream", () => {
  it("skips heartbeats and yields server events in order", async () => {
    const stream = readableFromString(FULL_STREAM);
    const out: string[] = [];
    for await (const ev of parseSSEStream(stream)) {
      out.push(ev.type);
    }
    expect(out).toEqual(["snapshot", "run_update", "run_complete", "done"]);
  });

  it("ignores unknown event names without throwing", async () => {
    const stream = readableFromString(
      [
        `event: future_thing\ndata: {"x":1}`,
        "",
        `event: done\ndata: {"reason":"x"}`,
        "",
        "",
      ].join("\n")
    );
    const out: string[] = [];
    for await (const ev of parseSSEStream(stream)) {
      out.push(ev.type);
    }
    expect(out).toEqual(["done"]);
  });
});

describe("runEval", () => {
  function buildFetchMock(body: ReadableStream<Uint8Array>): typeof fetch {
    return vi.fn(async () => ({
      ok: true,
      status: 200,
      body,
    })) as unknown as typeof fetch;
  }

  it("subscribes to the SSE endpoint and emits TUIEvents for each frame", async () => {
    const bus = new TUIEventBus();
    const captured: TUIEvent[] = [];
    bus.on("session:start", (e) => captured.push(e));
    bus.on("session:result", (e) => captured.push(e));
    bus.on("run:progress", (e) => captured.push(e));
    bus.on("run:complete", (e) => captured.push(e));

    const handle = runEval("eval_abc", {
      bearer: "ak_live_test",
      bus,
      fetchImpl: buildFetchMock(readableFromString(FULL_STREAM)),
      now: () => 1700000000000,
    });
    await handle.done;

    const types = captured.map((e) => e.type);
    expect(types).toContain("session:start");
    expect(types).toContain("session:result");
    expect(types).toContain("run:complete");
    // Progress events fire on snapshot + run_update + run_complete
    const progressCount = types.filter((t) => t === "run:progress").length;
    expect(progressCount).toBeGreaterThanOrEqual(2);
  });

  it("includes the bearer in the Authorization header", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: readableFromString(
        [`event: done\ndata: {"reason":"x"}`, "", ""].join("\n")
      ),
    })) as unknown as typeof fetch;
    const bus = new TUIEventBus();
    const handle = runEval("eval_abc", {
      bearer: "ak_live_test",
      bus,
      fetchImpl: fetchSpy,
    });
    await handle.done;
    const args = (
      fetchSpy as unknown as { mock: { calls: [string, RequestInit][] } }
    ).mock.calls[0]!;
    const init = args[1];
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer ak_live_test"
    );
  });

  it("emits a synthetic session:error when fetch fails", async () => {
    const bus = new TUIEventBus();
    const errors: TUIEvent[] = [];
    bus.on("session:error", (e) => errors.push(e));
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const handle = runEval("eval_abc", {
      bearer: "ak_live_test",
      bus,
      fetchImpl,
    });
    await handle.done;
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      type: "session:error",
      sessionId: "__stream__",
    });
  });

  it("aborts when caller calls controller.abort()", async () => {
    const bus = new TUIEventBus();
    // Build a body that closes when the abort signal fires. Mimics
    // what real `fetch()` does — its body is hooked up to the same
    // signal we passed in the init.
    const encoder = new TextEncoder();
    const fetchImpl = vi.fn(
      async (_url: string, init?: { signal?: AbortSignal }) =>
        ({
          ok: true,
          status: 200,
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode(": heartbeat\n\n"));
              init?.signal?.addEventListener("abort", () => {
                controller.close();
              });
            },
          }),
        }) as Response
    ) as unknown as typeof fetch;
    const handle = runEval("eval_abc", {
      bearer: "ak_live_test",
      bus,
      fetchImpl,
    });
    handle.controller.abort();
    await expect(handle.done).resolves.toBeUndefined();
  });
});
