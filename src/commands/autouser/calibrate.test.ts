/**
 * Tests for `autousers autouser calibrate <id>`.
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

describe("autouser calibrate", () => {
  it("POSTs to .../calibration/start", async () => {
    const post = vi.fn().mockResolvedValueOnce({
      data: { status: "calibrating" },
    });
    createClient.mockResolvedValueOnce({ post });
    const cap = capture();
    const program = buildProgram();
    await program.parseAsync(["node", "test", "autouser", "calibrate", "au_x"]);
    expect(post).toHaveBeenCalledWith(
      "/api/v1/autousers/au_x/calibration/start",
      {}
    );
    expect(cap.stdout).toContain("Calibration started");
  });

  it("threads --gold-set into the body", async () => {
    const post = vi.fn().mockResolvedValueOnce({ data: {} });
    createClient.mockResolvedValueOnce({ post });
    capture();
    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "autouser",
      "calibrate",
      "au_x",
      "--gold-set",
      "gs_42",
    ]);
    expect(post).toHaveBeenCalledWith(
      "/api/v1/autousers/au_x/calibration/start",
      { goldSetId: "gs_42" }
    );
  });
});
