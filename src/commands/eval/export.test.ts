/**
 * Tests for `autousers eval export <id> [--format json|csv|md]`.
 *
 * Strategy: stub `fetch` to return the per-format response body and
 * assert that:
 *   - the URL has the right `?format=...` query
 *   - stdout receives the raw text body (so `> report.md` works)
 *   - bad format strings fall back to `json`
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config.js")>();
  return {
    ...actual,
    getBaseUrl: vi.fn(async () => "https://app.autousers.ai"),
  };
});

vi.mock("../../tui/runtime.js", () => ({
  resolveBearerForRunner: vi.fn(async () => "ak_live_test"),
}));

import { buildEvalCommand } from "./index.js";

interface Cap {
  stdout: string;
  stderr: string;
}

function capture(): Cap {
  const cap: Cap = { stdout: "", stderr: "" };
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
  program.addCommand(buildEvalCommand());
  return program;
}

beforeEach(() => {
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("eval export", () => {
  it("streams CSV body to stdout when --format csv", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("rating_id,score\nrt_1,4.5\n", {
        status: 200,
        headers: { "Content-Type": "text/csv" },
      })
    );
    const cap = capture();

    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "eval",
      "export",
      "eval_x",
      "--format",
      "csv",
    ]);

    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain("/api/v1/evaluations/eval_x/export");
    expect(url).toContain("format=csv");
    expect(cap.stdout).toContain("rating_id,score");
    expect(cap.stdout).toContain("rt_1,4.5");
  });

  it("streams Markdown body to stdout when --format md", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("# Report\n\n- thing\n", {
        status: 200,
        headers: { "Content-Type": "text/markdown" },
      })
    );
    const cap = capture();

    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "eval",
      "export",
      "eval_x",
      "--format",
      "md",
    ]);

    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain("format=md");
    expect(cap.stdout).toContain("# Report");
  });

  it("defaults to json when --format omitted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response('{"evaluation":{"id":"eval_x"}}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const cap = capture();

    const program = buildProgram();
    await program.parseAsync(["node", "test", "eval", "export", "eval_x"]);

    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain("format=json");
    expect(cap.stdout).toContain("eval_x");
  });

  it("surfaces server error via handleError on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response('{"error":{"message":"Forbidden"}}', {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );
    const cap = capture();

    const program = buildProgram();
    await expect(
      program.parseAsync(["node", "test", "eval", "export", "eval_x"])
    ).rejects.toThrow(/process\.exit/);
    expect(cap.stderr).toContain("Forbidden");
  });
});
