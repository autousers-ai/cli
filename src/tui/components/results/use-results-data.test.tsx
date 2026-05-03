/**
 * Tests for `useResultsData` (the adapter + cache + fetch hook).
 *
 * The pure adapter `adaptServerResults` is exercised by direct call —
 * no React tree needed. The hook itself is exercised through a tiny
 * harness component that yields its `data` to a captor function.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "@jrichman/ink";

import {
  adaptServerResults,
  invalidateResultsCache,
  useResultsData,
  type ResultsData,
  type ServerResultsEnvelope,
} from "./use-results-data.js";

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
    totalComparisons: 3,
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
      trust: {
        dimensionId: "trust",
        dimensionName: "Trust",
        sideAWins: 3,
        sideBWins: 4,
        ties: 1,
        total: 8,
        meanRating: -0.3,
        confidenceInterval: { lower: -1, upper: 0.4 },
        winner: "inconclusive",
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
  agreement: { percentAgreement: 75, kappa: 0.42, pairs: 6 },
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
    totalComparisons: 2,
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("adaptServerResults", () => {
  it("normalises an SxS envelope into ResultsData", () => {
    const data = adaptServerResults(SXS_ENVELOPE);
    expect(data.isSSE).toBe(false);
    expect(data.evaluationName).toBe("Hero CTA");
    expect(data.overall.totalRatings).toBe(12);
    expect(data.overall.overallWinner).toBe("sideB");
    expect(data.overall.winRate).toBe(64);
    expect(data.summaries).toHaveLength(1);
    expect(data.summaries[0].winner).toBe("sideB");
    expect(data.allDimIds).toEqual(["clarity", "trust"]);
    expect(data.dimensionSummaries.get("clarity")?.sideAWins).toBe(1);
    expect(data.dimensionSummaries.get("clarity")?.winner).toBe("sideB");
    expect(data.agreement?.percentAgreement).toBe(75);
    expect(data.agreement?.kappa).toBe(0.42);
    expect(data.agreement?.pairCount).toBe(6);
    expect(data.webLink).toContain("eval_x");
  });

  it("normalises an SSE envelope into ResultsData", () => {
    const data = adaptServerResults(SSE_ENVELOPE);
    expect(data.isSSE).toBe(true);
    expect(data.overall.overallAvg).toBe(4.1);
    expect(data.overall.confidence).toBe("High");
    expect(data.summaries[0].overallAvg).toBe(4.5);
    expect(data.dimensionSummaries.get("clarity")?.qualityLabel).toBe(
      "Very Good"
    );
    // Distribution comes through as the SSE 1-5 buckets
    expect(data.distribution).toHaveLength(5);
    expect(data.distribution[3].count).toBe(4); // value=4 → 4 ratings
  });

  it("falls back gracefully with no agreement payload", () => {
    const env: ServerResultsEnvelope = { ...SXS_ENVELOPE, agreement: null };
    const data = adaptServerResults(env);
    expect(data.agreement).toBeUndefined();
  });
});

describe("useResultsData", () => {
  function Harness({
    evaluationId,
    onData,
    createClient,
  }: {
    evaluationId: string | null;
    onData: (d: ResultsData) => void;
    createClient: () => Promise<{ get: (path: string) => Promise<unknown> }>;
  }) {
    const data = useResultsData(evaluationId, { createClient });
    onData(data);
    return <Text>{data.loading ? "loading" : "ready"}</Text>;
  }

  it("fetches the server envelope and adapts it on mount", async () => {
    const get = vi.fn().mockResolvedValueOnce(SXS_ENVELOPE);
    const createClient = vi.fn(async () => ({ get }));
    const seen: ResultsData[] = [];

    render(
      <Harness
        evaluationId="eval_x"
        onData={(d) => seen.push(d)}
        createClient={createClient}
      />
    );
    // Allow the useEffect's microtask to flush.
    await new Promise((r) => setTimeout(r, 30));

    expect(get).toHaveBeenCalledWith("/api/v1/evaluations/eval_x/results");
    const final = seen[seen.length - 1];
    expect(final.loading).toBe(false);
    expect(final.evaluationName).toBe("Hero CTA");
  });

  it("re-uses a cached entry on subsequent calls", async () => {
    const get = vi.fn().mockResolvedValueOnce(SXS_ENVELOPE);
    const createClient = vi.fn(async () => ({ get }));

    // First mount populates cache
    render(
      <Harness
        evaluationId="eval_x"
        onData={() => undefined}
        createClient={createClient}
      />
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(get).toHaveBeenCalledTimes(1);

    // Second mount with same id should NOT re-fetch
    render(
      <Harness
        evaluationId="eval_x"
        onData={() => undefined}
        createClient={createClient}
      />
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("surfaces fetch errors via the data.error field", async () => {
    const get = vi.fn().mockRejectedValueOnce(new Error("network down"));
    const createClient = vi.fn(async () => ({ get }));
    const seen: ResultsData[] = [];

    render(
      <Harness
        evaluationId="eval_x"
        onData={(d) => seen.push(d)}
        createClient={createClient}
      />
    );
    await new Promise((r) => setTimeout(r, 30));

    const final = seen[seen.length - 1];
    expect(final.error).toBe("network down");
  });
});
