/**
 * Tests for `autousers eval list` and `autousers eval get`.
 *
 * We exercise the subcommand actions through commander's `parseAsync`
 * because the action callbacks need a fully wired commander tree to
 * walk back to the root for global flags. The mocked client is what
 * captures the actual HTTP shape we're asserting against.
 */

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client.js")>();
  return {
    ...actual,
    createClientFromConfig: vi.fn(),
  };
});

vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>();
  return {
    ...actual,
    getBaseUrl: vi.fn(async () => "https://app.autousers.ai"),
  };
});

import { createClientFromConfig } from "../client.js";
import { buildEvalCommand } from "./eval.js";

const createClient = createClientFromConfig as unknown as ReturnType<
  typeof vi.fn
>;

interface CapturedStdout {
  text: string;
}

function captureStdout(): CapturedStdout {
  const cap: CapturedStdout = { text: "" };
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    cap.text += String(chunk);
    return true;
  });
  return cap;
}

function buildProgramWithEval(): Command {
  const program = new Command();
  program.option("--key <key>");
  program.option("--base-url <url>");
  program.option("--json");
  program.option("--quiet");
  program.option("--no-color");
  // Disable color across the suite so assertions ignore ANSI.
  program.setOptionValue("color", false);
  program.exitOverride(); // throw on commander errors instead of process.exit
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

describe("eval list", () => {
  it("calls /api/v1/evaluations and renders a table", async () => {
    const get = vi.fn().mockResolvedValueOnce({
      data: [
        {
          id: "cmoiEval12345_abcd",
          name: "Pricing redesign",
          type: "SxS",
          status: "Running",
          shareAccess: "PRIVATE",
          updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          ratingsCount: 0,
          comparisonsCount: 2,
        },
      ],
      has_more: false,
    });
    createClient.mockResolvedValueOnce({ get });

    const cap = captureStdout();
    const program = buildProgramWithEval();
    await program.parseAsync(["node", "test", "eval", "list"]);

    expect(get).toHaveBeenCalledTimes(1);
    const url = get.mock.calls[0]![0] as string;
    expect(url).toContain("/api/v1/evaluations");
    expect(url).toContain("limit=20");

    expect(cap.text).toContain("Pricing redesign");
    expect(cap.text).toContain("Running");
    expect(cap.text).toContain("cmoiEval");
  });

  it("includes teamId and limit query params", async () => {
    const get = vi.fn().mockResolvedValueOnce({ data: [], has_more: false });
    createClient.mockResolvedValueOnce({ get });
    captureStdout();

    const program = buildProgramWithEval();
    await program.parseAsync([
      "node",
      "test",
      "eval",
      "list",
      "--limit",
      "5",
      "--team",
      "cmoiTeamX",
    ]);

    const url = get.mock.calls[0]![0] as string;
    expect(url).toContain("limit=5");
    expect(url).toContain("teamId=cmoiTeamX");
  });

  it("emits the raw envelope in --json mode", async () => {
    const envelope = {
      data: [
        {
          id: "cmoi1",
          name: "X",
          type: "SSE",
          status: "Draft",
          shareAccess: "PRIVATE",
          updatedAt: "2026-01-01T00:00:00Z",
          createdAt: "2026-01-01T00:00:00Z",
          ratingsCount: 0,
          comparisonsCount: 0,
        },
      ],
      has_more: false,
    };
    const get = vi.fn().mockResolvedValueOnce(envelope);
    createClient.mockResolvedValueOnce({ get });
    const cap = captureStdout();

    const program = buildProgramWithEval();
    program.setOptionValue("json", true);
    await program.parseAsync(["node", "test", "eval", "list"]);

    expect(JSON.parse(cap.text)).toEqual(envelope);
  });
});

describe("eval get", () => {
  it("renders kv block for a single eval", async () => {
    const get = vi.fn().mockResolvedValueOnce({
      id: "cmoiEvalABCDEFGH",
      name: "Onboarding A/B",
      type: "SxS",
      status: "Running",
      shareAccess: "PRIVATE",
      description: "Two onboarding flows",
      updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      ratingsCount: 12,
      comparisonsCount: 3,
      config: { dimensions: JSON.stringify(["overall", "clarity"]) },
      links: { web: "https://app.autousers.ai/evals/cmoiEvalABCDEFGH" },
    });
    createClient.mockResolvedValueOnce({ get });

    const cap = captureStdout();
    const program = buildProgramWithEval();
    await program.parseAsync([
      "node",
      "test",
      "eval",
      "get",
      "cmoiEvalABCDEFGH",
    ]);

    expect(get).toHaveBeenCalledWith("/api/v1/evaluations/cmoiEvalABCDEFGH");
    expect(cap.text).toContain("Onboarding A/B");
    expect(cap.text).toContain("SxS");
    // Dimensions count parsed from the stringified config JSON.
    expect(cap.text).toContain("Dimensions");
    expect(cap.text).toContain("2"); // 2 dimensions
    expect(cap.text).toContain(
      "https://app.autousers.ai/evals/cmoiEvalABCDEFGH"
    );
  });
});
