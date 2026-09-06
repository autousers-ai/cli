/**
 * Tests for `autousers eval transfer <id> --to`.
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

beforeEach(() => {
  createClient.mockReset();
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("eval transfer", () => {
  it("POSTs /transfer with the target slug", async () => {
    const post = vi.fn().mockResolvedValueOnce({
      data: { id: "e1", ownerTeamId: "team_123" },
    });
    createClient.mockResolvedValueOnce({ post });
    const cap = capture();

    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "eval",
      "transfer",
      "e1",
      "--to",
      "acme",
    ]);

    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.mock.calls[0]!;
    expect(path).toBe("/api/v1/evaluations/e1/transfer");
    expect(body).toEqual({ to: "acme" });
    expect(cap.stdout).toContain("Transferred evaluation");
  });

  it("emits JSON envelope in --json mode", async () => {
    const post = vi.fn().mockResolvedValueOnce({
      data: { id: "e1", ownerTeamId: "team_123" },
    });
    createClient.mockResolvedValueOnce({ post });
    const cap = capture();

    const program = buildProgram();
    program.setOptionValue("json", true);
    await program.parseAsync([
      "node",
      "test",
      "eval",
      "transfer",
      "e1",
      "--to",
      "acme",
    ]);
    expect(JSON.parse(cap.stdout)).toEqual({
      data: { id: "e1", ownerTeamId: "team_123" },
    });
  });
});
