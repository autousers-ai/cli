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
