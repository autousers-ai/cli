/**
 * Tests for `autousers key list`.
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
import { buildKeyCommand } from "./index.js";

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
  program.addCommand(buildKeyCommand());
  return program;
}

beforeEach(() => {
  createClient.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("key list", () => {
  it("renders rows from the API", async () => {
    const get = vi.fn().mockResolvedValueOnce({
      data: [
        {
          id: "key_1",
          name: "Local dev",
          keyPrefix: "ak_live_xyz9",
          scopes: ["eval:read"],
          expiresAt: null,
          revokedAt: null,
          lastUsedAt: null,
          createdAt: "2026-04-30T00:00:00Z",
        },
      ],
    });
    createClient.mockResolvedValueOnce({ get });
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
      out.push(String(c));
      return true;
    });
    const program = buildProgram();
    await program.parseAsync(["node", "test", "key", "list"]);
    expect(get).toHaveBeenCalledWith("/api/v1/api-keys");
    const text = out.join("");
    expect(text).toContain("Local dev");
    expect(text).toContain("ak_live_xyz9");
    expect(text).toContain("active");
  });
});
