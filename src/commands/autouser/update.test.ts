/**
 * Tests for `autousers autouser update <id>`.
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
import { buildAutouserCommand } from "./index.js";

const createClient = createClientFromConfig as unknown as ReturnType<
  typeof vi.fn
>;

function capture() {
  const cap = { stdout: "", stderr: "" };
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
  program.addCommand(buildAutouserCommand());
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

describe("autouser update", () => {
  it("PATCHes the body when --name is provided", async () => {
    const patch = vi.fn().mockResolvedValueOnce({
      data: { id: "au_x", name: "Renamed" },
    });
    createClient.mockResolvedValueOnce({ patch });
    capture();
    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "autouser",
      "update",
      "au_x",
      "--name",
      "Renamed",
    ]);
    expect(patch).toHaveBeenCalledWith(
      "/api/v1/autousers/au_x",
      expect.objectContaining({ name: "Renamed" })
    );
  });

  it("exits 4 when no fields supplied", async () => {
    const patch = vi.fn();
    createClient.mockResolvedValueOnce({ patch });
    const cap = capture();
    const program = buildProgram();
    await expect(
      program.parseAsync(["node", "test", "autouser", "update", "au_x"])
    ).rejects.toThrow(/process\.exit\(4\)/);
    expect(cap.stderr).toContain("at least one of");
    expect(patch).not.toHaveBeenCalled();
  });
});
