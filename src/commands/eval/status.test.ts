/**
 * Tests for `autousers eval status <id>`.
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

const STATUS_FIXTURE = {
  data: {
    runs: [
      {
        id: "run_1abcdef",
        status: "running",
        autouserId: "built-in:casual-browser",
        autouserName: "Casual Browser",
        currentStep: "navigating",
        currentComparison: 1,
        totalComparisons: 2,
        ratingsCreated: 0,
        error: null,
      },
      {
        id: "run_2abcdef",
        status: "completed",
        autouserId: "built-in:power-user",
        autouserName: "Power User",
        currentStep: null,
        currentComparison: 2,
        totalComparisons: 2,
        ratingsCreated: 4,
        error: null,
      },
    ],
    summary: {
      total: 2,
      pending: 0,
      running: 1,
      completed: 1,
      failed: 0,
    },
    evaluationType: "SSE",
  },
};

describe("eval status", () => {
  it("renders a summary line + per-run rows in plain mode", async () => {
    const get = vi.fn().mockResolvedValueOnce(STATUS_FIXTURE);
    createClient.mockResolvedValueOnce({ get });
    const cap = capture();

    const program = buildProgram();
    await program.parseAsync(["node", "test", "eval", "status", "eval_x"]);

    expect(get).toHaveBeenCalledWith(
      "/api/v1/evaluations/eval_x/autouser-status"
    );
    expect(cap.stdout).toContain("Evaluation eval_x");
    expect(cap.stdout).toContain("2 total");
    expect(cap.stdout).toContain("Casual Browser");
    expect(cap.stdout).toContain("Power User");
    expect(cap.stdout).toContain("[navigating]");
  });

  it("emits the full envelope in --json mode", async () => {
    const get = vi.fn().mockResolvedValueOnce(STATUS_FIXTURE);
    createClient.mockResolvedValueOnce({ get });
    const cap = capture();

    const program = buildProgram();
    program.setOptionValue("json", true);
    await program.parseAsync(["node", "test", "eval", "status", "eval_x"]);

    const parsed = JSON.parse(cap.stdout);
    expect(parsed).toEqual(STATUS_FIXTURE);
  });

  it("falls through gracefully when there are no runs", async () => {
    const get = vi.fn().mockResolvedValueOnce({
      data: {
        runs: [],
        summary: { total: 0, pending: 0, running: 0, completed: 0, failed: 0 },
      },
    });
    createClient.mockResolvedValueOnce({ get });
    const cap = capture();

    const program = buildProgram();
    await program.parseAsync(["node", "test", "eval", "status", "eval_y"]);

    expect(cap.stdout).toContain("No runs queued.");
  });
});

/**
 * A rater is several runs, and the two registers must not be confused.
 *
 * The route's `summary` counts RATERS and `chunks` counts run rows. This
 * command printed `summary` under the label "Runs:", so a 30-design evaluation
 * fanned out across nine pods reported "3 total" as a pod count — the same
 * class of mistake as three chunks each claiming 4/4 when the rater is at
 * 12/30.
 */
const CHUNKED_FIXTURE = {
  data: {
    runs: [
      {
        id: "run_1abcdef",
        status: "completed",
        autouserId: "built-in:novice",
        autouserName: "Novice User",
        currentStep: null,
        currentComparison: 10,
        totalComparisons: 10,
        ratingsCreated: 10,
        error: null,
        chunkLabel: "Part 1 of 3",
      },
      {
        id: "run_2abcdef",
        status: "completed",
        autouserId: "built-in:novice",
        autouserName: "Novice User",
        currentStep: null,
        currentComparison: 10,
        totalComparisons: 10,
        ratingsCreated: 10,
        error: null,
        chunkLabel: "Part 2 of 3",
      },
      {
        id: "run_3abcdef",
        status: "failed",
        autouserId: "built-in:novice",
        autouserName: "Novice User",
        currentStep: null,
        currentComparison: 2,
        totalComparisons: 10,
        ratingsCreated: 2,
        error: "pod deadline",
        chunkLabel: "Part 3 of 3",
      },
    ],
    raters: [
      {
        key: "grp-novice",
        autouserId: "built-in:novice",
        autouserName: "Novice User",
        status: "partial",
        runIds: ["run_1abcdef", "run_2abcdef", "run_3abcdef"],
        chunkCount: 3,
        missingChunks: 0,
        failedChunks: 1,
        currentComparison: 22,
        totalComparisons: 30,
        ratingsCreated: 22,
        missingDesigns: 8,
      },
    ],
    summary: {
      total: 1,
      pending: 0,
      running: 0,
      completed: 0,
      partial: 1,
      failed: 0,
      cancelled: 0,
    },
    chunks: {
      total: 3,
      pending: 0,
      running: 0,
      completed: 2,
      failed: 1,
      cancelled: 0,
    },
    evaluationType: "SSE",
  },
};

describe("eval status — a rater that is several runs", () => {
  it("labels the rater count as autousers and the row count as pods", async () => {
    const get = vi.fn().mockResolvedValueOnce(CHUNKED_FIXTURE);
    createClient.mockResolvedValueOnce({ get });
    const cap = capture();

    const program = buildProgram();
    await program.parseAsync(["node", "test", "eval", "status", "eval_x"]);

    // One autouser, three pods. Printing "Runs: 1 total" — what this command
    // used to do — is the sentence that makes "12/30" read as three 4/4s.
    expect(cap.stdout).toContain("Autousers: 1 total");
    expect(cap.stdout).toContain("Runs (pods): 3 total");
    expect(cap.stdout).not.toContain("Runs: 1 total");
  });

  it("prints the partial state, which no run row can hold", async () => {
    const get = vi.fn().mockResolvedValueOnce(CHUNKED_FIXTURE);
    createClient.mockResolvedValueOnce({ get });
    const cap = capture();

    const program = buildProgram();
    await program.parseAsync(["node", "test", "eval", "status", "eval_x"]);

    // Without it the states do not add up to `total` and the gap is invisible.
    expect(cap.stdout).toContain("1 partial");
    expect(cap.stdout).toContain("22/30");
    expect(cap.stdout).toContain("8 designs not rated");
  });

  it("labels each row with the part of the rater it is", async () => {
    const get = vi.fn().mockResolvedValueOnce(CHUNKED_FIXTURE);
    createClient.mockResolvedValueOnce({ get });
    const cap = capture();

    const program = buildProgram();
    await program.parseAsync(["node", "test", "eval", "status", "eval_x"]);

    // Three rows of one persona, each with its own fraction, read as three
    // autousers disagreeing about their progress unless they say otherwise.
    expect(cap.stdout).toContain("Part 1 of 3");
    expect(cap.stdout).toContain("Part 3 of 3");
  });

  it("does not add a pod line when a rater is exactly one run", async () => {
    // The ordinary evaluation. `chunks` and `summary` agree, and a second
    // identical row would be noise.
    const get = vi.fn().mockResolvedValueOnce({
      data: {
        ...STATUS_FIXTURE.data,
        summary: { ...STATUS_FIXTURE.data.summary, partial: 0, cancelled: 0 },
        chunks: {
          total: 2,
          pending: 0,
          running: 1,
          completed: 1,
          failed: 0,
          cancelled: 0,
        },
      },
    });
    createClient.mockResolvedValueOnce({ get });
    const cap = capture();

    const program = buildProgram();
    await program.parseAsync(["node", "test", "eval", "status", "eval_x"]);

    expect(cap.stdout).toContain("Autousers: 2 total");
    expect(cap.stdout).not.toContain("Runs (pods):");
  });

  it("still says Runs on a server that has not changed the meaning", async () => {
    // The CLI ships separately from the server. On an envelope with no
    // `chunks`, `summary` still counts ROWS, and relabelling it "Autousers"
    // would be the same mislabelling in the other direction.
    const get = vi.fn().mockResolvedValueOnce(STATUS_FIXTURE);
    createClient.mockResolvedValueOnce({ get });
    const cap = capture();

    const program = buildProgram();
    await program.parseAsync(["node", "test", "eval", "status", "eval_x"]);

    expect(cap.stdout).toContain("Runs: 2 total");
    expect(cap.stdout).not.toContain("Autousers:");
    // And no invented `partial` for a server that does not report one.
    expect(cap.stdout).not.toContain("partial");
  });
});
