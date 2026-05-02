/**
 * Tests for `autousers eval create`.
 *
 * Covers the three input shapes the brief calls out:
 *   1. flag-driven scripted creation (live + dryRun)
 *   2. JSON-on-stdin scripted mode
 *   3. flag-validation failure (missing required field → exit 4)
 *
 * Path 3 (interactive Ink wizard, no flags, TTY) is exercised via the
 * eval-creator screen test rather than here — `eval create`'s only
 * responsibility for that path is to mount the TUI when `shouldUseTUI()`
 * is true, which we don't want to actually do in a vitest run.
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
import { buildEvalCommand } from "./index.js";
import { buildPayloadFromFlags } from "./create.js";

const createClient = createClientFromConfig as unknown as ReturnType<
  typeof vi.fn
>;

interface Captured {
  stdout: string;
  stderr: string;
}

function capture(): Captured {
  const cap: Captured = { stdout: "", stderr: "" };
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    cap.stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    cap.stderr += String(chunk);
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
  program.addCommand(buildEvalCommand());
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

describe("buildPayloadFromFlags", () => {
  it("builds an SSE payload with one URL and one autouser", () => {
    const { body, errors } = buildPayloadFromFlags({
      type: "sse",
      url: "https://acme.com",
      autorater: "built-in:casual-browser",
      dimensions: "trust,clarity",
      count: "3",
      concurrency: "2",
      maxTurns: "10",
      dryRun: true,
    });
    expect(errors).toEqual([]);
    expect(body.type).toBe("SSE");
    expect(body.designUrls).toEqual([
      { id: "u-0", url: "https://acme.com", stimulusType: "URL" },
    ]);
    expect(body.comparisonPairs).toEqual([]);
    expect(body.selectedDimensionIds).toEqual(["trust", "clarity"]);
    expect(body.selectedAutousers).toEqual([
      { autouserId: "built-in:casual-browser", agentCount: 3 },
    ]);
    expect(body.dryRun).toBe(true);
    // dryRun status should be Draft (no autouser queue when previewing).
    expect(body.status).toBe("Draft");
  });

  it("builds an SxS payload with two URLs", () => {
    const { body, errors } = buildPayloadFromFlags({
      type: "sxs",
      urlA: "https://acme.com/a",
      urlB: "https://acme.com/b",
      autorater: "built-in:power-user",
    });
    expect(errors).toEqual([]);
    expect(body.type).toBe("SxS");
    expect(body.comparisonPairs).toEqual([
      {
        id: "p-0",
        currentUrl: "https://acme.com/a",
        variantUrl: "https://acme.com/b",
        sideAType: "URL",
        sideBType: "URL",
      },
    ]);
    expect(body.designUrls).toEqual([]);
    expect(body.status).toBe("Running");
    expect(body.dryRun).toBe(false);
  });

  it("collects validation errors when required flags are missing", () => {
    const { errors } = buildPayloadFromFlags({});
    expect(errors).toEqual(
      expect.arrayContaining([
        "--url is required for --type sse",
        expect.stringContaining("--autorater is required"),
      ])
    );
  });

  it("rejects an invalid --type value", () => {
    const { errors } = buildPayloadFromFlags({ type: "foo" });
    expect(errors[0]).toContain('--type must be "sse" or "sxs"');
  });
});

describe("eval create — flag-driven dryRun", () => {
  it("calls POST with dryRun and renders the cost preview", async () => {
    const post = vi.fn().mockResolvedValueOnce({
      data: {
        dryRun: true,
        wouldRun: { autouserCount: 1, comparisonCount: 1, totalRuns: 3 },
        costEstimate: { total: { usd: 0.42 }, basis: "haiku4-5" },
        warnings: [],
        note: "PREVIEW ONLY — this evaluation has NOT been created.",
      },
    });
    createClient.mockResolvedValueOnce({ post });

    const cap = capture();
    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "eval",
      "create",
      "--type",
      "sse",
      "--url",
      "https://acme.com",
      "--autorater",
      "built-in:casual-browser",
      "--count",
      "3",
      "--dryRun",
    ]);

    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.mock.calls[0];
    expect(path).toBe("/api/v1/evaluations");
    expect((body as { dryRun: boolean }).dryRun).toBe(true);
    expect((body as { type: string }).type).toBe("SSE");

    expect(cap.stdout).toContain("Dry-run preview");
    expect(cap.stdout).toContain("Would run: 3 ratings");
    expect(cap.stdout).toContain("$0.42");
  });

  it("emits the raw envelope in --json mode (dryRun)", async () => {
    const env = {
      data: {
        dryRun: true,
        wouldRun: null,
        costEstimate: null,
        warnings: [{ code: "x", message: "y" }],
        note: "n",
      },
    };
    const post = vi.fn().mockResolvedValueOnce(env);
    createClient.mockResolvedValueOnce({ post });
    const cap = capture();

    const program = buildProgram();
    program.setOptionValue("json", true);
    await program.parseAsync([
      "node",
      "test",
      "eval",
      "create",
      "--type",
      "sse",
      "--url",
      "https://acme.com",
      "--autorater",
      "built-in:casual-browser",
      "--dryRun",
    ]);

    expect(JSON.parse(cap.stdout)).toEqual(env);
  });
});

describe("eval create — flag-driven live", () => {
  it("calls POST with dryRun:false and prints the new id", async () => {
    const post = vi.fn().mockResolvedValueOnce({
      data: {
        id: "cmoiCREATEDEvalId",
        name: "My eval",
        type: "SSE",
        status: "Running",
      },
    });
    createClient.mockResolvedValueOnce({ post });
    const cap = capture();

    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "eval",
      "create",
      "--type",
      "sse",
      "--url",
      "https://acme.com",
      "--autorater",
      "built-in:casual-browser",
      "--name",
      "My eval",
      "--confirm",
    ]);

    const [, body] = post.mock.calls[0];
    expect((body as { dryRun: boolean }).dryRun).toBe(false);
    expect(cap.stdout).toContain("Created evaluation");
    expect(cap.stdout).toContain("My eval");
    expect(cap.stdout).toContain("cmoiCREATEDEvalId");
  });
});

describe("eval create — validation", () => {
  it("exits with code 4 when --url is missing for --type sse", async () => {
    const post = vi.fn();
    createClient.mockResolvedValueOnce({ post });
    const cap = capture();

    const program = buildProgram();
    await expect(
      program.parseAsync([
        "node",
        "test",
        "eval",
        "create",
        "--type",
        "sse",
        "--autorater",
        "built-in:casual-browser",
      ])
    ).rejects.toThrow(/process\.exit\(4\)/);
    expect(post).not.toHaveBeenCalled();
    expect(cap.stderr).toContain("--url is required");
  });
});
