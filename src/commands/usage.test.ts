/**
 * Tests for `autousers usage`.
 *
 * Same mocking strategy as `whoami.test.ts`: stub the client factory,
 * intercept stdout, drive the command directly. We don't go through
 * commander parsing here because `usageCommand` is a flat function
 * (not a subcommand group) and accepting `(opts, cmd)` matches what
 * commander would hand us.
 */

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client.js")>();
  return {
    ...actual,
    createClientFromConfig: vi.fn(),
  };
});

vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>();
  return {
    ...actual,
    getBaseUrl: vi.fn(async () => "https://app.autousers.ai"),
  };
});

import { createClientFromConfig } from "../client.js";
import { usageCommand } from "./usage.js";

const createClient = createClientFromConfig as unknown as ReturnType<
  typeof vi.fn
>;

interface CapturedStdout {
  text: string;
}

function captureStdout(): CapturedStdout {
  const cap: CapturedStdout = { text: "" };
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    cap.text += String(chunk);
    return true;
  });
  return cap;
}

function buildCmd(opts: { json?: boolean } = {}): Command {
  const program = new Command();
  program.option("--key <key>");
  program.option("--base-url <url>");
  program.option("--json");
  program.option("--quiet");
  program.option("--no-color");
  if (opts.json) program.setOptionValue("json", true);
  program.setOptionValue("color", false);
  return program.command("usage");
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

describe("usage", () => {
  it("renders text mode with quota, BYOK status, and top evals", async () => {
    const get = vi.fn().mockResolvedValueOnce({
      range: "30d",
      byok: false,
      byokConfigured: false,
      freeQuota: { used: 7, limit: 25 },
      totals: {
        runs: 7,
        inputTokens: 14000,
        outputTokens: 2800,
        costUsd: 0.6,
        evaluations: 3,
        autousersUsed: 4,
      },
      byEval: [
        {
          evaluationId: "cmoiEval1",
          evaluationName: "Pricing redesign",
          runs: 4,
          tokens: 7000,
          costUsd: 0.42,
        },
      ],
      perRun: { medianCost: 0.085, meanCost: 0.085, medianTokens: 2300 },
    });
    createClient.mockResolvedValueOnce({ get });

    const cap = captureStdout();
    await usageCommand({ range: "30d" }, buildCmd());

    expect(get).toHaveBeenCalledWith("/api/v1/usage?range=30d");
    expect(cap.text).toContain("Free runs");
    expect(cap.text).toContain("7 / 25");
    expect(cap.text).toContain("BYOK");
    expect(cap.text).toContain("disabled");
    expect(cap.text).toContain("Pricing redesign");
    expect(cap.text).toContain("$0.4200");
  });

  it("emits the raw envelope in --json mode", async () => {
    const envelope = {
      range: "7d",
      byok: true,
      byokConfigured: true,
      freeQuota: { used: 3, limit: 25 },
      totals: {
        runs: 3,
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0,
        evaluations: 1,
        autousersUsed: 1,
      },
      byEval: [],
      perRun: { medianCost: 0, meanCost: 0, medianTokens: 0 },
    };
    const get = vi.fn().mockResolvedValueOnce(envelope);
    createClient.mockResolvedValueOnce({ get });

    const cap = captureStdout();
    await usageCommand({ range: "7d" }, buildCmd({ json: true }));

    expect(JSON.parse(cap.text)).toEqual(envelope);
  });

  it("renders the parked-key state with 'configured (toggle off)'", async () => {
    const get = vi.fn().mockResolvedValueOnce({
      range: "30d",
      byok: false,
      byokConfigured: true, // saved but inactive
      freeQuota: { used: 5, limit: 25 },
      totals: {
        runs: 5,
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.1234,
        evaluations: 1,
        autousersUsed: 2,
      },
      byEval: [],
      perRun: { medianCost: 0, meanCost: 0, medianTokens: 0 },
    });
    createClient.mockResolvedValueOnce({ get });

    const cap = captureStdout();
    await usageCommand({}, buildCmd());

    expect(cap.text).toContain("configured (toggle off)");
    expect(cap.text).toContain("$0.1234");
  });
});
