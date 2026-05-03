/**
 * Tests for `autousers eval ratings <id>`.
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

const RATINGS_FIXTURE = {
  data: [
    {
      id: "rt_1",
      raterType: "ai",
      autouserId: "built-in:casual-browser",
      autouser: { name: "Casual Browser" },
      comparisonId: "c1",
      comparison: { label: "Hero v1" },
      dimensionRatings: { clarity: { rating: 4 }, trust: { rating: 5 } },
      justification: "Looks good",
      createdAt: "2026-05-01T12:00:00Z",
    },
    {
      id: "rt_2",
      raterType: "human",
      userId: "user_1",
      user: { name: "Dana", email: "d@example.com" },
      comparisonId: "c2",
      comparison: { label: "Hero v2" },
      dimensionRatings: { clarity: { rating: 3 } },
      justification: null,
      createdAt: "2026-05-01T13:00:00Z",
    },
  ],
  has_more: false,
  total_count: 2,
};

describe("eval ratings", () => {
  it("prints a one-row-per-rating summary in plain mode", async () => {
    const get = vi.fn().mockResolvedValueOnce(RATINGS_FIXTURE);
    createClient.mockResolvedValueOnce({ get });
    const cap = capture();

    const program = buildProgram();
    await program.parseAsync(["node", "test", "eval", "ratings", "eval_x"]);

    expect(get).toHaveBeenCalledWith("/api/v1/evaluations/eval_x/ratings");
    expect(cap.stdout).toContain("Ratings");
    expect(cap.stdout).toContain("ai:Casual Browser");
    expect(cap.stdout).toContain("human:Dana");
    expect(cap.stdout).toContain("4.50"); // (4+5)/2
    expect(cap.stdout).toContain("3.00");
  });

  it("--json emits the full envelope verbatim", async () => {
    const get = vi.fn().mockResolvedValueOnce(RATINGS_FIXTURE);
    createClient.mockResolvedValueOnce({ get });
    const cap = capture();

    const program = buildProgram();
    program.setOptionValue("json", true);
    await program.parseAsync(["node", "test", "eval", "ratings", "eval_x"]);

    const parsed = JSON.parse(cap.stdout);
    expect(parsed.data).toHaveLength(2);
    expect(parsed.data[0].id).toBe("rt_1");
  });

  it("handles empty ratings gracefully", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ data: [], has_more: false, total_count: 0 });
    createClient.mockResolvedValueOnce({ get });
    const cap = capture();

    const program = buildProgram();
    await program.parseAsync(["node", "test", "eval", "ratings", "eval_y"]);

    expect(cap.stdout).toContain("No ratings submitted yet");
  });
});
