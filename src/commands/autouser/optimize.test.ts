/**
 * Tests for `autousers autouser optimize <id>`.
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
  return cap;
}

function buildProgram(): Command {
  const program = new Command();
  program.option("--key <key>");
  program.option("--base-url <url>");
  program.option("--json");
  program.option("--no-color");
  program.setOptionValue("color", false);
  program.exitOverride();
  program.addCommand(buildAutouserCommand());
  return program;
}

beforeEach(() => {
  createClient.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("autouser optimize", () => {
  it("POSTs to .../optimize and renders the response", async () => {
    const post = vi.fn().mockResolvedValueOnce({
      data: {
        summary: "Tighten the trust dimension wording.",
        rationale: ["disagrees on legal copy", "favors prose over icons"],
        applied: false,
      },
    });
    createClient.mockResolvedValueOnce({ post });
    const cap = capture();
    const program = buildProgram();
    await program.parseAsync(["node", "test", "autouser", "optimize", "au_x"]);
    expect(post).toHaveBeenCalledWith(
      "/api/v1/autousers/au_x/calibration/optimize",
      {}
    );
    expect(cap.stdout).toContain("Tighten the trust dimension wording");
    expect(cap.stdout).toContain("disagrees on legal copy");
  });

  it("--apply threads { apply: true }", async () => {
    const post = vi.fn().mockResolvedValueOnce({
      data: { applied: true },
    });
    createClient.mockResolvedValueOnce({ post });
    capture();
    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "autouser",
      "optimize",
      "au_x",
      "--apply",
    ]);
    expect(post).toHaveBeenCalledWith(
      "/api/v1/autousers/au_x/calibration/optimize",
      { apply: true }
    );
  });
});
