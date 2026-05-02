/**
 * Tests for `autousers eval run <id>`.
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
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("eval run", () => {
  it("POSTs run-autousers with the evaluation's pre-selected ids", async () => {
    const get = vi.fn().mockResolvedValueOnce({
      id: "eval_x",
      name: "My Eval",
      type: "SSE",
      status: "Running",
      comparisonsCount: 2,
      config: {
        selectedAutousers: [
          { autouserId: "built-in:casual-browser", agentCount: 2 },
          { autouserId: "built-in:power-user", agentCount: 1 },
        ],
      },
    });
    const post = vi.fn().mockResolvedValueOnce({
      data: {
        runs: [
          {
            id: "r1",
            autouserId: "built-in:casual-browser",
            status: "pending",
          },
          {
            id: "r2",
            autouserId: "built-in:casual-browser",
            status: "pending",
          },
          { id: "r3", autouserId: "built-in:power-user", status: "pending" },
        ],
      },
    });
    createClient.mockResolvedValueOnce({ get, post });
    const cap = capture();

    const program = buildProgram();
    await program.parseAsync(["node", "test", "eval", "run", "eval_x"]);

    expect(get).toHaveBeenCalledWith("/api/v1/evaluations/eval_x");
    expect(post).toHaveBeenCalledWith(
      "/api/v1/evaluations/eval_x/run-autousers",
      {
        autouserIds: [
          "built-in:casual-browser",
          "built-in:casual-browser",
          "built-in:power-user",
        ],
      }
    );
    expect(cap.stdout).toContain("Started 3 runs");
  });

  it("--dryRun prints would-queue preview without POSTing", async () => {
    const get = vi.fn().mockResolvedValueOnce({
      id: "eval_x",
      name: "My Eval",
      type: "SSE",
      status: "Draft",
      comparisonsCount: 2,
      config: {
        selectedAutousers: [
          { autouserId: "built-in:casual-browser", agentCount: 2 },
        ],
      },
    });
    const post = vi.fn();
    createClient.mockResolvedValueOnce({ get, post });
    const cap = capture();

    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "eval",
      "run",
      "eval_x",
      "--dryRun",
    ]);

    expect(post).not.toHaveBeenCalled();
    expect(cap.stdout).toContain("Dry-run preview");
    expect(cap.stdout).toContain("Would queue");
    expect(cap.stdout).toContain("4 run"); // 2 autousers × 2 comparisons
  });

  it("emits validation error when no autousers resolved", async () => {
    const get = vi.fn().mockResolvedValueOnce({
      id: "eval_x",
      name: "My Eval",
      type: "SSE",
      status: "Draft",
      comparisonsCount: 1,
      config: { selectedAutousers: [] },
    });
    const post = vi.fn();
    createClient.mockResolvedValueOnce({ get, post });
    const cap = capture();

    const program = buildProgram();
    await expect(
      program.parseAsync(["node", "test", "eval", "run", "eval_x"])
    ).rejects.toThrow(/process\.exit\(4\)/);
    expect(post).not.toHaveBeenCalled();
    expect(cap.stderr).toContain("no selected autousers");
  });

  it("--autousers <ids> overrides the evaluation's selection", async () => {
    const get = vi.fn().mockResolvedValueOnce({
      id: "eval_x",
      name: "My Eval",
      type: "SSE",
      status: "Draft",
      comparisonsCount: 1,
      config: { selectedAutousers: [] },
    });
    const post = vi.fn().mockResolvedValueOnce({
      data: { runs: [{ id: "r1", autouserId: "a", status: "pending" }] },
    });
    createClient.mockResolvedValueOnce({ get, post });
    capture();

    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "eval",
      "run",
      "eval_x",
      "--autousers",
      "built-in:power-user",
    ]);
    expect(post).toHaveBeenCalledWith(
      "/api/v1/evaluations/eval_x/run-autousers",
      { autouserIds: ["built-in:power-user"] }
    );
  });
});
