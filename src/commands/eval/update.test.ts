/**
 * Tests for `autousers eval update <id>`.
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

describe("eval update", () => {
  it("PATCHes /api/v1/evaluations/:id with --name and --status", async () => {
    const patch = vi.fn().mockResolvedValueOnce({
      data: { id: "cmoi123", name: "Renamed", status: "Ended" },
    });
    createClient.mockResolvedValueOnce({ patch });
    const cap = capture();

    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "eval",
      "update",
      "cmoi123",
      "--name",
      "Renamed",
      "--status",
      "Ended",
    ]);

    expect(patch).toHaveBeenCalledTimes(1);
    const [path, body] = patch.mock.calls[0];
    expect(path).toBe("/api/v1/evaluations/cmoi123");
    expect(body).toEqual({ name: "Renamed", status: "Ended" });
    expect(cap.stdout).toContain("Updated evaluation");
    expect(cap.stdout).toContain("Renamed");
  });

  it("exits 4 when no fields are passed", async () => {
    const patch = vi.fn();
    createClient.mockResolvedValueOnce({ patch });
    const cap = capture();

    const program = buildProgram();
    await expect(
      program.parseAsync(["node", "test", "eval", "update", "cmoi123"])
    ).rejects.toThrow(/process\.exit\(4\)/);
    expect(patch).not.toHaveBeenCalled();
    expect(cap.stderr).toContain("no fields to update");
  });
});
