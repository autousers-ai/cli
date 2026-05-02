/**
 * Tests for `autousers eval stop <id>`.
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

describe("eval stop", () => {
  it("POSTs stop-autousers when --yes is passed", async () => {
    const post = vi.fn().mockResolvedValueOnce({ data: { cancelled: 3 } });
    createClient.mockResolvedValueOnce({ post });
    const cap = capture();

    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "eval",
      "stop",
      "eval_x",
      "--yes",
    ]);

    expect(post).toHaveBeenCalledWith(
      "/api/v1/evaluations/eval_x/stop-autousers",
      {}
    );
    expect(cap.stdout).toContain("Cancelled 3 runs for eval_x");
  });

  it("refuses without --yes in a non-interactive shell", async () => {
    const post = vi.fn();
    createClient.mockResolvedValueOnce({ post });
    const cap = capture();

    const program = buildProgram();
    await expect(
      program.parseAsync(["node", "test", "eval", "stop", "eval_x"])
    ).rejects.toThrow(/process\.exit\(4\)/);
    expect(post).not.toHaveBeenCalled();
    expect(cap.stderr).toContain("refusing to stop");
  });

  it("emits the full envelope in --json mode", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ data: { cancelled: 0, runs: [] } });
    createClient.mockResolvedValueOnce({ post });
    const cap = capture();

    const program = buildProgram();
    program.setOptionValue("json", true);
    await program.parseAsync([
      "node",
      "test",
      "eval",
      "stop",
      "eval_x",
      "--yes",
    ]);

    expect(JSON.parse(cap.stdout)).toEqual({
      data: { cancelled: 0, runs: [] },
    });
  });
});
