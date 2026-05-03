/**
 * Tests for `autousers eval delete <id>`.
 *
 * The TTY-confirm path is exercised separately from the `--yes` path —
 * vitest's `process.stdin.isTTY` is undefined by default, so the
 * non-TTY branch is what runs unless we explicitly poke it.
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

describe("eval delete", () => {
  it("DELETEs /api/v1/evaluations/:id when --yes is passed", async () => {
    const del = vi.fn().mockResolvedValueOnce(undefined);
    createClient.mockResolvedValueOnce({ delete: del });
    const cap = capture();

    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "eval",
      "delete",
      "cmoiABC",
      "--yes",
    ]);

    expect(del).toHaveBeenCalledTimes(1);
    expect(del.mock.calls[0]![0]).toBe("/api/v1/evaluations/cmoiABC");
    expect(cap.stdout).toContain("Deleted evaluation cmoiABC");
  });

  it("refuses to delete in a non-interactive shell without --yes", async () => {
    const del = vi.fn();
    createClient.mockResolvedValueOnce({ delete: del });
    const cap = capture();

    const program = buildProgram();
    await expect(
      program.parseAsync(["node", "test", "eval", "delete", "cmoiABC"])
    ).rejects.toThrow(/process\.exit\(4\)/);
    expect(del).not.toHaveBeenCalled();
    expect(cap.stderr).toContain("refusing to delete");
  });

  it("emits JSON envelope in --json mode", async () => {
    const del = vi.fn().mockResolvedValueOnce(undefined);
    createClient.mockResolvedValueOnce({ delete: del });
    const cap = capture();

    const program = buildProgram();
    program.setOptionValue("json", true);
    await program.parseAsync([
      "node",
      "test",
      "eval",
      "delete",
      "cmoiABC",
      "--yes",
    ]);

    expect(JSON.parse(cap.stdout)).toEqual({ deleted: true, id: "cmoiABC" });
  });
});
