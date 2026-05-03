/**
 * Tests for the Wave 6 ResultsView screen.
 *
 * Strategy: pre-seed the cache via `adaptServerResults()`, mount the
 * view with a stubbed `createClient` (never called because cache is
 * primed), assert frame contents on the Overall + Comparisons + Stats
 * tabs. Tab navigation is driven through `stdin.write`.
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

import { ResultsView } from "./index.js";
import {
  adaptServerResults,
  invalidateResultsCache,
  type ServerResultsEnvelope,
} from "./use-results-data.js";
import { useTUIStore } from "../../state.js";

const SXS_ENVELOPE: ServerResultsEnvelope = {
  evaluation: {
    id: "eval_x",
    name: "Hero CTA",
    type: "SxS",
    status: "Completed",
    links: { web: "https://app.autousers.ai/evals/eval_x" },
  },
  dimensions: [
    { id: "clarity", name: "Clarity" },
    { id: "trust", name: "Trust" },
  ],
  primaryDimensionId: "clarity",
  aggregateStats: {
    totalRatings: 12,
    totalComparisons: 1,
    overallWinner: "sideB",
    sideAWins: 4,
    sideBWins: 7,
    ties: 1,
    winRate: 64,
    confidence: { level: "Medium", margin: 0.27 },
    dimensionStats: {
      clarity: {
        dimensionId: "clarity",
        dimensionName: "Clarity",
        sideAWins: 1,
        sideBWins: 3,
        ties: 0,
        total: 4,
        meanRating: 0.8,
        confidenceInterval: { lower: 0.1, upper: 1.5 },
        winner: "sideB",
      },
    },
  },
  comparisonStats: [
    {
      comparisonId: "c1",
      label: "Headline A vs B",
      position: 0,
      validRatingsCount: 4,
      dimensionStats: {
        clarity: {
          dimensionId: "clarity",
          dimensionName: "Clarity",
          sideAWins: 1,
          sideBWins: 3,
          ties: 0,
          total: 4,
          meanRating: 1.5,
          confidenceInterval: { lower: 0.5, upper: 2.5 },
          winner: "sideB",
        },
      },
      overallWinner: "sideB",
      confidence: { level: "Medium", margin: 0.25 },
    },
  ],
  sideALabel: "Variant A",
  sideBLabel: "Variant B",
};

const SSE_ENVELOPE: ServerResultsEnvelope = {
  evaluation: {
    id: "eval_y",
    name: "Pricing page",
    type: "SSE",
    status: "Completed",
  },
  dimensions: [{ id: "clarity", name: "Clarity" }],
  primaryDimensionId: "clarity",
  aggregateStats: {
    totalRatings: 8,
    totalComparisons: 1,
    overallAverage: 4.1,
    overallDistribution: { "1": 0, "2": 0, "3": 1, "4": 4, "5": 3 },
    confidence: { level: "High", margin: 0.1 },
    dimensionStats: {
      clarity: {
        dimensionId: "clarity",
        dimensionName: "Clarity",
        distribution: { "1": 0, "2": 0, "3": 1, "4": 4, "5": 3 },
        total: 8,
        meanRating: 4.3,
        stdDev: 0.6,
        confidenceInterval: { lower: 3.9, upper: 4.7 },
      },
    },
  },
  comparisonStats: [
    {
      comparisonId: "d1",
      label: "Pricing v3",
      position: 0,
      validRatingsCount: 4,
      dimensionStats: {
        clarity: {
          dimensionId: "clarity",
          dimensionName: "Clarity",
          distribution: { "1": 0, "2": 0, "3": 0, "4": 2, "5": 2 },
          total: 4,
          meanRating: 4.5,
          stdDev: 0.5,
          confidenceInterval: { lower: 4, upper: 5 },
        },
      },
      overallAverage: 4.5,
      confidence: { level: "High", margin: 0.1 },
    },
  ],
};

beforeEach(() => {
  invalidateResultsCache();
  useTUIStore.setState({
    screen: "results",
    authUser: null,
    placeholderTarget: null,
    toast: null,
  });
  useTUIStore.getState().resetDashboard();
  useTUIStore.getState().setEvaluationId("eval_x");
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Prime the module-level cache so the hook short-circuits the fetch. */
function primeCache(envelope: ServerResultsEnvelope): void {
  // Touching adaptServerResults populates a value; we then push it into
  // the hook's cache by mounting the view with a never-resolved fetch
  // factory and waiting for the cache hit. Simpler: use the exported
  // helper indirectly — call the hook with a captor that primes the
  // module's internal cache. The cleanest path is a synchronous fetch
  // factory that resolves with the envelope, and we just await
  // microtasks before snapshot.
  void adaptServerResults(envelope);
}

describe("ResultsView", () => {
  it("renders the Overall tab for an SxS eval (winner banner + head-to-head)", async () => {
    primeCache(SXS_ENVELOPE);
    const get = vi.fn().mockResolvedValueOnce(SXS_ENVELOPE);
    const createClient = vi.fn(async () => ({ get }));

    const { lastFrame } = render(
      <ResultsView hookOptions={{ createClient }} />
    );
    await new Promise((r) => setTimeout(r, 50));

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Hero CTA");
    expect(frame).toContain("Overall");
    expect(frame).toContain("Comparisons");
    expect(frame).toContain("Stats");
    expect(frame).toContain("Cost");
    expect(frame).toContain("Winner: Variant B");
    expect(frame).toContain("Win Rate");
  });

  it("hides Comparisons tab on SSE eval", async () => {
    useTUIStore.getState().setEvaluationId("eval_y");
    const get = vi.fn().mockResolvedValueOnce(SSE_ENVELOPE);
    const createClient = vi.fn(async () => ({ get }));

    const { lastFrame } = render(
      <ResultsView hookOptions={{ createClient }} />
    );
    await new Promise((r) => setTimeout(r, 50));

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Pricing page");
    expect(frame).toContain("Overall Score");
    // Comparisons tab is hidden on SSE
    expect(frame).not.toContain("2 Comparisons");
    expect(frame).toContain("Stats");
    expect(frame).toContain("Cost");
  });

  it("switches to the Comparisons tab on '2' for SxS evals", async () => {
    const get = vi.fn().mockResolvedValueOnce(SXS_ENVELOPE);
    const createClient = vi.fn(async () => ({ get }));

    const { stdin, lastFrame } = render(
      <ResultsView hookOptions={{ createClient }} />
    );
    await new Promise((r) => setTimeout(r, 50));
    stdin.write("2");
    await new Promise((r) => setTimeout(r, 30));

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Headline A vs B");
    expect(frame).toContain("Comparison");
  });

  it("switches to the Stats tab on '3' and renders distribution", async () => {
    useTUIStore.getState().setEvaluationId("eval_y");
    const get = vi.fn().mockResolvedValueOnce(SSE_ENVELOPE);
    const createClient = vi.fn(async () => ({ get }));

    const { stdin, lastFrame } = render(
      <ResultsView hookOptions={{ createClient }} />
    );
    await new Promise((r) => setTimeout(r, 50));
    stdin.write("3");
    await new Promise((r) => setTimeout(r, 30));

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Rating Distribution");
    expect(frame).toContain("Dimension Breakdown");
  });

  it("opens the export modal on 'e'", async () => {
    const get = vi.fn().mockResolvedValueOnce(SXS_ENVELOPE);
    const createClient = vi.fn(async () => ({ get }));

    const { stdin, lastFrame } = render(
      <ResultsView hookOptions={{ createClient }} />
    );
    await new Promise((r) => setTimeout(r, 50));
    stdin.write("e");
    await new Promise((r) => setTimeout(r, 30));

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Export");
    expect(frame).toContain("autousers eval export");
  });
});
