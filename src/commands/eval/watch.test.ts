/**
 * Tests for `autousers eval watch <id>`.
 *
 * The command opens an SSE stream and emits JSONL — we mock fetch to
 * return a canned event stream and assert each line is valid JSON with
 * a known event type.
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
    readConfig: vi.fn(async () => ({ apiKey: "ak_live_test" })),
  };
});

import { createClientFromConfig } from "../../client.js";
import { buildEvalCommand } from "./index.js";

const createClient = createClientFromConfig as unknown as ReturnType<
  typeof vi.fn
>;

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

const SSE_PAYLOAD = [
  `event: snapshot\ndata: ${JSON.stringify({
    runs: [
      {
        id: "r1",
        status: "running",
        autouserId: "built-in:casual-browser",
        autouserType: "builtin",
        autouserName: "Casual Browser",
        autouserIcon: "smart_toy",
        currentStep: null,
        currentComparison: 0,
        totalComparisons: 1,
        ratingsCreated: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        error: null,
        startedAt: null,
        completedAt: null,
      },
    ],
  })}`,
  "",
  `event: run_complete\ndata: ${JSON.stringify({
    id: "r1",
    status: "completed",
    autouserId: "built-in:casual-browser",
    autouserType: "builtin",
    autouserName: "Casual Browser",
    autouserIcon: "smart_toy",
    currentStep: null,
    currentComparison: 1,
    totalComparisons: 1,
    ratingsCreated: 2,
    inputTokens: 100,
    outputTokens: 50,
    estimatedCostUsd: 0.05,
    error: null,
    startedAt: null,
    completedAt: null,
    ratingSummary: { totalRatings: 2, averageScore: 4.0 },
  })}`,
  "",
  `event: done\ndata: {"reason":"all_terminal"}`,
  "",
  "",
].join("\n");

function bodyFromString(s: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(s));
      controller.close();
    },
  });
}

beforeEach(() => {
  createClient.mockReset();
  // The watch command (and the runner it delegates to) calls fetch to
  // open the SSE stream. We mock the global fetch to return our canned
  // body, then drive the runner end-to-end.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      body: bodyFromString(SSE_PAYLOAD),
    })) as unknown as typeof fetch
  );
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`);
  }) as never);
  // resolveContext only needs `client` for `ctx.baseUrl` — the runner
  // calls fetch directly, not through the client. Stub a minimal one.
  createClient.mockResolvedValue({
    baseUrl: "https://app.autousers.ai",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("eval watch", () => {
  it("emits one JSONL line per TUIEvent and exits 0 on done", async () => {
    const cap = capture();
    const program = buildProgram();
    await expect(
      program.parseAsync(["node", "test", "eval", "watch", "eval_x"])
    ).rejects.toThrow(/process\.exit\(0\)/);

    const lines = cap.stdout.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    // Each line is valid JSON
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(typeof parsed.type).toBe("string");
      expect(typeof parsed.timestamp).toBe("string");
    }
    const types = lines.map((l) => JSON.parse(l).type as string);
    expect(types).toContain("session:result");
    expect(types).toContain("run:complete");
  });
});
