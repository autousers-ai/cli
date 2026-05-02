/**
 * Tests for `autousers template update`.
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client.js")>();
  return { ...actual, createClientFromConfig: vi.fn() };
});

vi.mock("../../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config.js")>();
  return {
    ...actual,
    getBaseUrl: vi.fn(async () => "https://app.autousers.ai"),
  };
});

import { createClientFromConfig } from "../../client.js";
import { buildTemplateCommand } from "./index.js";

const createClient = createClientFromConfig as unknown as ReturnType<
  typeof vi.fn
>;

function buildProgram(): Command {
  const program = new Command();
  program.option("--key <key>");
  program.option("--base-url <url>");
  program.option("--json");
  program.option("--quiet");
  program.option("--no-color");
  program.setOptionValue("color", false);
  program.exitOverride();
  program.addCommand(buildTemplateCommand());
  return program;
}

beforeEach(() => {
  createClient.mockReset();
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`);
  }) as never);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("template update", () => {
  it("PATCHes the supplied fields", async () => {
    const patch = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: "tpl_1", name: "New" } });
    createClient.mockResolvedValueOnce({ patch });
    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "template",
      "update",
      "tpl_1",
      "--name",
      "New",
    ]);
    expect(patch).toHaveBeenCalledWith("/api/v1/templates/tpl_1", {
      name: "New",
    });
  });

  it("exits 4 when no flags supplied", async () => {
    const stderr: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => {
      stderr.push(String(c));
      return true;
    });
    const program = buildProgram();
    await expect(
      program.parseAsync(["node", "test", "template", "update", "tpl_1"])
    ).rejects.toThrow(/process\.exit\(4\)/);
    expect(stderr.join("")).toContain("at least one of");
  });
});
