/**
 * Tests for `autousers eval invite <id> --email`.
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

describe("eval invite", () => {
  it("POSTs /invites with the email", async () => {
    const post = vi.fn().mockResolvedValueOnce({
      data: { id: "inv1", email: "new@x.com" },
    });
    createClient.mockResolvedValueOnce({ post });
    const cap = capture();

    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "eval",
      "invite",
      "e1",
      "--email",
      "new@x.com",
    ]);

    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.mock.calls[0]!;
    expect(path).toBe("/api/v1/evaluations/e1/invites");
    expect(body).toEqual({ email: "new@x.com" });
    expect(cap.stdout).toContain("Invite sent");
  });

  it("exits 4 when --email is missing the @ sign", async () => {
    const post = vi.fn();
    createClient.mockResolvedValueOnce({ post });
    const cap = capture();

    const program = buildProgram();
    await expect(
      program.parseAsync([
        "node",
        "test",
        "eval",
        "invite",
        "e1",
        "--email",
        "invalid",
      ])
    ).rejects.toThrow(/process\.exit\(4\)/);
    expect(post).not.toHaveBeenCalled();
    expect(cap.stderr).toContain("--email");
  });

  it("emits JSON envelope in --json mode", async () => {
    const post = vi.fn().mockResolvedValueOnce({
      data: { id: "inv2", email: "n@x.com" },
    });
    createClient.mockResolvedValueOnce({ post });
    const cap = capture();

    const program = buildProgram();
    program.setOptionValue("json", true);
    await program.parseAsync([
      "node",
      "test",
      "eval",
      "invite",
      "e1",
      "--email",
      "n@x.com",
    ]);
    expect(JSON.parse(cap.stdout)).toEqual({
      data: { id: "inv2", email: "n@x.com" },
    });
  });
});
