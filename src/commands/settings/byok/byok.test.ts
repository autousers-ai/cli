/**
 * Tests for `autousers settings byok set | test | probe | unset`.
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../client.js")>();
  return { ...actual, createClientFromConfig: vi.fn() };
});

vi.mock("../../../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../config.js")>();
  return {
    ...actual,
    getBaseUrl: vi.fn(async () => "https://app.autousers.ai"),
  };
});

import { createClientFromConfig } from "../../../client.js";
import { buildSettingsCommand } from "../index.js";

const createClient = createClientFromConfig as unknown as ReturnType<
  typeof vi.fn
>;

function buildProgram(): Command {
  const program = new Command();
  // Intentionally NOT registering `--key` as a global flag — the
  // byok subcommands accept `--key <api-key>` for the Gemini key,
  // which would clash with the program-level `--key` (used elsewhere
  // for `ak_live_*` API keys). In production the parent registers
  // `--key`; commander still routes the local flag to the subcommand
  // because subcommand parsing wins. For tests we keep it simple.
  program.option("--base-url <url>");
  program.option("--json");
  program.option("--no-color");
  program.setOptionValue("color", false);
  program.exitOverride();
  program.addCommand(buildSettingsCommand());
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

describe("settings byok set", () => {
  it("POSTs the apiKey body when --key is supplied", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ data: { configured: true, active: true } });
    createClient.mockResolvedValueOnce({ post });
    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "settings",
      "byok",
      "set",
      "--key",
      "AIzaXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    ]);
    expect(post).toHaveBeenCalledWith(
      "/api/v1/settings/byok",
      expect.objectContaining({
        apiKey: "AIzaXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      })
    );
  });

  it("exits 4 when --key is missing", async () => {
    const stderr: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => {
      stderr.push(String(c));
      return true;
    });
    const program = buildProgram();
    await expect(
      program.parseAsync(["node", "test", "settings", "byok", "set"])
    ).rejects.toThrow(/process\.exit\(4\)/);
    expect(stderr.join("")).toContain("--key");
  });
});

describe("settings byok test", () => {
  it("POSTs against the /test endpoint", async () => {
    const post = vi.fn().mockResolvedValueOnce({ data: { status: "ok" } });
    createClient.mockResolvedValueOnce({ post });
    const program = buildProgram();
    await program.parseAsync(["node", "test", "settings", "byok", "test"]);
    expect(post).toHaveBeenCalledWith("/api/v1/settings/byok/test", {});
  });
});

describe("settings byok probe", () => {
  it("POSTs the typed key against /probe without saving", async () => {
    const post = vi.fn().mockResolvedValueOnce({ data: { status: "ok" } });
    createClient.mockResolvedValueOnce({ post });
    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "settings",
      "byok",
      "probe",
      "--key",
      "AIzaXXX",
    ]);
    expect(post).toHaveBeenCalledWith("/api/v1/settings/byok/probe", {
      apiKey: "AIzaXXX",
    });
  });
});

describe("settings byok unset", () => {
  it("DELETEs the byok endpoint", async () => {
    const del = vi.fn().mockResolvedValueOnce({ data: null });
    createClient.mockResolvedValueOnce({ delete: del });
    const program = buildProgram();
    await program.parseAsync(["node", "test", "settings", "byok", "unset"]);
    expect(del).toHaveBeenCalledWith("/api/v1/settings/byok");
  });
});
