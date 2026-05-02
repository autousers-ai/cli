/**
 * Tests for `autousers template duplicate`.
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
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("template duplicate", () => {
  it("POSTs to the duplicate endpoint", async () => {
    const post = vi.fn().mockResolvedValueOnce({
      data: { id: "tpl_clone", name: "Trust (Copy)" },
    });
    createClient.mockResolvedValueOnce({ post });
    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "template",
      "duplicate",
      "tpl_orig",
    ]);
    expect(post).toHaveBeenCalledWith(
      "/api/v1/templates/tpl_orig/duplicate",
      {}
    );
  });
});
