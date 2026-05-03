/**
 * Tests for the Wave 5 Dashboard screen.
 *
 * Strategy: stub `startRunner` so the runner doesn't actually open a
 * fetch; pre-seed `useTUIStore` with sessions + cost; assert the
 * rendered frame contains the expected header / progress / row text.
 *
 * The wide-terminal stub keeps the layout deterministic — without it
 * Ink collapses the cost ticker on narrow widths.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";

vi.mock("../../tty.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../tty.js")>();
  return {
    ...actual,
    isWideTerminal: () => true,
  };
});

import { Dashboard } from "./index.js";
import { TUIEventBus } from "../../events.js";
import { useTUIStore, type SessionState } from "../../state.js";

beforeEach(() => {
  useTUIStore.setState({
    screen: "dashboard",
    authUser: null,
    placeholderTarget: null,
    toast: null,
  });
  useTUIStore.getState().resetDashboard();
  useTUIStore.getState().setEvaluationId("eval_test");
});

afterEach(() => {
  vi.restoreAllMocks();
});

function seedSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: "r1",
    phase: "navigating",
    autouserId: "built-in:casual-browser",
    autouserName: "Casual Browser",
    autouserIcon: "smart_toy",
    currentComparison: 1,
    totalComparisons: 2,
    ratingsCreated: 0,
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.05,
    ...overrides,
  };
}

describe("Dashboard", () => {
  it("renders the live-run header with progress + cost summary", () => {
    useTUIStore.getState().upsertSession(seedSession());
    useTUIStore.getState().setProgress({ completed: 0, total: 1, errors: 0 });
    useTUIStore.getState().setCost({
      inputTokens: 100,
      outputTokens: 50,
      totalCost: 0.05,
    });

    const noopRunner = vi.fn(() => null);
    const { lastFrame } = render(
      <Dashboard startRunner={noopRunner} bus={new TUIEventBus()} />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Live run");
    expect(frame).toContain("0 / 1 complete");
    expect(frame).toContain("$0.05");
  });

  it("renders one row per session with the correct phase badge", () => {
    useTUIStore.getState().upsertSession(seedSession({ id: "r1" }));
    useTUIStore
      .getState()
      .upsertSession(seedSession({ id: "r2", phase: "complete" }));
    useTUIStore
      .getState()
      .upsertSession(seedSession({ id: "r3", phase: "error", error: "boom" }));
    useTUIStore.getState().setProgress({ completed: 1, total: 3, errors: 1 });

    const noopRunner = vi.fn(() => null);
    const { lastFrame } = render(
      <Dashboard startRunner={noopRunner} bus={new TUIEventBus()} />
    );
    const frame = lastFrame() ?? "";

    // Active section
    expect(frame).toContain("Active");
    expect(frame).toContain("[NAV]");
    // Completed section
    expect(frame).toContain("Completed");
    expect(frame).toContain("[DONE]");
    // Errors section
    expect(frame).toContain("Errors");
    expect(frame).toContain("[ERR]");
  });

  it("calls startRunner with the active evaluationId on mount", () => {
    const startRunner = vi.fn(() => null);
    render(<Dashboard startRunner={startRunner} bus={new TUIEventBus()} />);
    expect(startRunner).toHaveBeenCalledWith("eval_test", expect.anything());
  });

  it("shows a confirm prompt when `s` is pressed", async () => {
    useTUIStore.getState().upsertSession(seedSession());
    const noopRunner = vi.fn(() => null);
    const { stdin, lastFrame } = render(
      <Dashboard startRunner={noopRunner} bus={new TUIEventBus()} />
    );
    stdin.write("s");
    // ink-testing-library's stdin.write is sync but Ink's useInput
    // runs the React update inside a microtask — let it flush before
    // we sample the frame.
    await new Promise((r) => setTimeout(r, 30));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Stop the run?");
  });

  it("renders done indicator once runComplete is set", () => {
    useTUIStore
      .getState()
      .upsertSession(seedSession({ id: "r1", phase: "complete" }));
    useTUIStore.getState().setProgress({ completed: 1, total: 1, errors: 0 });
    useTUIStore.getState().setRunComplete(true);

    const noopRunner = vi.fn(() => null);
    const { lastFrame } = render(
      <Dashboard startRunner={noopRunner} bus={new TUIEventBus()} />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("done");
  });
});
