/**
 * Tests for `autousers key create`.
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
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("key create", () => {
  it("POSTs and prints the plain key with a one-time warning", async () => {
    const post = vi.fn().mockResolvedValueOnce({
      data: {
        id: "key_1",
        name: "ci",
        keyPrefix: "ak_live_a3b9",
        scopes: ["eval:read"],
        plainKey: "ak_live_PLAINTEXTSECRETVALUE",
        expiresAt: null,
        createdAt: "2026-05-01T00:00:00Z",
      },
    });
    createClient.mockResolvedValueOnce({ post });
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
      out.push(String(c));
      return true;
    });
    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "key",
      "create",
      "--name",
      "ci",
      "--scope",
      "eval:read",
    ]);
    expect(post).toHaveBeenCalledWith(
      "/api/v1/api-keys",
      expect.objectContaining({ name: "ci", scopes: ["eval:read"] })
    );
    const text = out.join("");
    expect(text).toContain("ak_live_PLAINTEXTSECRETVALUE");
    expect(text).toContain("NEVER be shown again");
  });

  it("exits 4 without --name", async () => {
    const stderr: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => {
      stderr.push(String(c));
      return true;
    });
    const program = buildProgram();
    await expect(
      program.parseAsync(["node", "test", "key", "create"])
    ).rejects.toThrow(/process\.exit\(4\)/);
    expect(stderr.join("")).toContain("--name");
  });
});
