/**
 * Tests for `autousers dimension list | create | version`.
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
import { buildDimensionCommand } from "./index.js";

const createClient = createClientFromConfig as unknown as ReturnType<
  typeof vi.fn
>;

function buildProgram(): Command {
  const program = new Command();
  program.option("--key <key>");
  program.option("--base-url <url>");
  program.option("--json");
  program.option("--no-color");
  program.setOptionValue("color", false);
  program.exitOverride();
  program.addCommand(buildDimensionCommand());
  return program;
}

beforeEach(() => {
  createClient.mockReset();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dimension list", () => {
  it("GETs /api/v1/dimensions with includeSystem=true", async () => {
    const get = vi.fn().mockResolvedValueOnce({
      data: [
        {
          id: "dim_1",
          name: "Trust",
          type: "TEXT_SSE",
          scaleType: "FIVE_POINT",
          isSystem: false,
          version: 1,
        },
      ],
    });
    createClient.mockResolvedValueOnce({ get });
    const program = buildProgram();
    await program.parseAsync(["node", "test", "dimension", "list"]);
    const url = get.mock.calls[0]![0] as string;
    expect(url).toContain("/api/v1/dimensions");
    expect(url).toContain("includeSystem=true");
  });
});

describe("dimension version", () => {
  it("GETs the versions endpoint for the supplied id", async () => {
    const get = vi.fn().mockResolvedValueOnce({
      data: [
        {
          id: "ver_1",
          version: 2,
          changeType: "edited",
          changeSummary: "tweak",
          changedBy: "user_a",
          createdAt: "2026-04-30T00:00:00Z",
        },
      ],
      has_more: false,
    });
    createClient.mockResolvedValueOnce({ get });
    const program = buildProgram();
    await program.parseAsync(["node", "test", "dimension", "version", "dim_1"]);
    expect(get).toHaveBeenCalledWith("/api/v1/dimensions/dim_1/versions");
  });
});

describe("dimension version-revert", () => {
  it("POSTs to /revert with the supplied versionId", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: "dim_1", version: 1 } });
    createClient.mockResolvedValueOnce({ post });
    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "dimension",
      "version-revert",
      "dim_1",
      "ver_xyz",
    ]);
    expect(post).toHaveBeenCalledWith("/api/v1/dimensions/dim_1/revert", {
      versionId: "ver_xyz",
    });
  });
});
