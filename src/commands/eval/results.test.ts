/**
 * Tests for `autousers eval results <id>`.
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client.js")>();
  return {
    ...actual,
    createClientFromConfig: vi.fn(),
  };
});

vi.mock("../../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config.js")>();
  return {
    ...actual,
    getBaseUrl: vi.fn(async () => "https://app.autousers.ai"),
  };
});

import { createClientFromConfig } from "../../client.js";
import { buildEvalCommand } from "./index.js";

const createClient = createClientFromConfig as unknown as ReturnType<
  typeof vi.fn
>;

interface Cap {
  stdout: string;
  stderr: string;
}

function capture(): Cap {
  const cap: Cap = { stdout: "", stderr: "" };
  vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
    cap.stdout += String(c);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => {
    cap.stderr += String(c);
    return true;
  });
  return cap;
}

function buildProgram(): Command {
  const program = new Command();
  program.option("--key <key>");
  program.option("--base-url <url>");
  program.option("--json");
  program.option("--quiet");
  program.option("--no-color");
  program.setOptionValue("color", false);
  program.exitOverride();
  program.addCommand(buildEvalCommand());
  return program;
}

beforeEach(() => {
  createClient.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const SXS_FIXTURE = {
  evaluation: {
    id: "eval_x",
    name: "Hero CTA shootout",
    type: "SxS",
    status: "Completed",
    links: { web: "https://app.autousers.ai/evals/eval_x" },
  },
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
        meanRating: 0.8,
        sideAWins: 1,
        sideBWins: 3,
        ties: 0,
      },
      trust: {
        dimensionId: "trust",
        dimensionName: "Trust",
        meanRating: -0.3,
        sideAWins: 3,
        sideBWins: 4,
        ties: 1,
      },
    },
  },
  comparisonStats: [
    {
      comparisonId: "c1",
      label: "Headline A vs B",
      position: 0,
      validRatingsCount: 4,
      overallWinner: "sideB",
      confidence: { level: "Medium", margin: 0.25 },
    },
  ],
  sideALabel: "Variant A",
  sideBLabel: "Variant B",
  agreement: { percentAgreement: 75, kappa: 0.42 },
};

describe("eval results", () => {
  it("prints a human-readable summary in plain mode", async () => {
    const get = vi.fn().mockResolvedValueOnce(SXS_FIXTURE);
    createClient.mockResolvedValueOnce({ get });
    const cap = capture();

    const program = buildProgram();
    await program.parseAsync(["node", "test", "eval", "results", "eval_x"]);

    expect(get).toHaveBeenCalledWith("/api/v1/evaluations/eval_x/results");
    expect(cap.stdout).toContain("Hero CTA shootout");
    expect(cap.stdout).toContain("Overall");
    expect(cap.stdout).toContain("Winner: sideB");
    expect(cap.stdout).toContain("Win rate: 64%");
    expect(cap.stdout).toContain("Clarity");
    expect(cap.stdout).toContain("Headline A vs B");
    expect(cap.stdout).toContain("75.0%");
  });

  it("--json emits the full envelope verbatim", async () => {
    const get = vi.fn().mockResolvedValueOnce(SXS_FIXTURE);
    createClient.mockResolvedValueOnce({ get });
    const cap = capture();

    const program = buildProgram();
    program.setOptionValue("json", true);
    await program.parseAsync(["node", "test", "eval", "results", "eval_x"]);

    const parsed = JSON.parse(cap.stdout);
    expect(parsed.evaluation.id).toBe("eval_x");
    expect(parsed.aggregateStats.totalRatings).toBe(12);
  });

  it("renders SSE-shaped output with avg score", async () => {
    const get = vi.fn().mockResolvedValueOnce({
      evaluation: {
        id: "eval_y",
        name: "Pricing page",
        type: "SSE",
        status: "Completed",
      },
      aggregateStats: {
        totalRatings: 8,
        totalComparisons: 2,
        overallAverage: 4.1,
        confidence: { level: "High", margin: 0.1 },
        dimensionStats: {
          clarity: {
            dimensionId: "clarity",
            dimensionName: "Clarity",
            meanRating: 4.3,
          },
        },
      },
      comparisonStats: [
        {
          comparisonId: "d1",
          label: "Pricing v3",
          position: 0,
          validRatingsCount: 4,
          overallAverage: 4.0,
          confidence: { level: "High" },
        },
      ],
    });
    createClient.mockResolvedValueOnce({ get });
    const cap = capture();

    const program = buildProgram();
    await program.parseAsync(["node", "test", "eval", "results", "eval_y"]);

    expect(cap.stdout).toContain("4.10/5"); // overall average
    expect(cap.stdout).toContain("Pricing v3");
    expect(cap.stdout).toContain("4.0/5");
  });
});
