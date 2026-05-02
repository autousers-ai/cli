/**
 * Tests for `autousers autouser duplicate <id>`.
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

describe("autouser duplicate", () => {
  it("POSTs to .../duplicate", async () => {
    const post = vi.fn().mockResolvedValueOnce({
      data: { id: "au_clone", name: "Clone" },
    });
    createClient.mockResolvedValueOnce({ post });
    const cap = capture();
    const program = buildProgram();
    await program.parseAsync(["node", "test", "autouser", "duplicate", "au_x"]);
    expect(post).toHaveBeenCalledWith("/api/v1/autousers/au_x/duplicate", {});
    expect(cap.stdout).toContain("Duplicated autouser");
  });

  it("threads --team into the body", async () => {
    const post = vi.fn().mockResolvedValueOnce({
      data: { id: "au_clone", name: "Clone" },
    });
    createClient.mockResolvedValueOnce({ post });
    capture();
    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "autouser",
      "duplicate",
      "au_x",
      "--team",
      "team_acme",
    ]);
    expect(post).toHaveBeenCalledWith("/api/v1/autousers/au_x/duplicate", {
      teamId: "team_acme",
    });
  });
});
