/**
 * Tests for `autousers autouser create`.
 *
 * Covers:
 *   - Flag-driven create (`--name --description --persona --criteria`).
 *   - --from-template clones via .../duplicate.
 *   - Missing --name surfaces a code-4 validation exit.
 */

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client.js")>();
  return {
    ...actual,
    createClientFromConfig: vi.fn(),
    getResolvedBearer: vi.fn(async () => "ak_live_test"),
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

describe("autouser create", () => {
  it("POSTs the body when --name is provided", async () => {
    const post = vi.fn().mockResolvedValueOnce({
      data: { id: "au_x", name: "PM" },
    });
    createClient.mockResolvedValueOnce({ post });
    const cap = capture();

    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "autouser",
      "create",
      "--name",
      "PM",
      "--description",
      "product manager",
      "--persona",
      "uses jargon freely",
      "--criteria",
      "- depth\n- ROI clarity",
    ]);

    expect(post).toHaveBeenCalledWith(
      "/api/v1/autousers",
      expect.objectContaining({
        name: "PM",
        description: "product manager",
        capabilities: {
          persona: "uses jargon freely",
          criteria: "- depth\n- ROI clarity",
        },
      })
    );
    expect(cap.stdout).toContain("Created autouser");
  });

  it("--from-template invokes /duplicate", async () => {
    const post = vi.fn().mockResolvedValueOnce({
      data: { id: "au_clone", name: "Power User (Copy)" },
    });
    createClient.mockResolvedValueOnce({ post });
    capture();

    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "autouser",
      "create",
      "--from-template",
      "built-in:power-user",
    ]);

    expect(post).toHaveBeenCalledWith(
      "/api/v1/autousers/built-in%3Apower-user/duplicate",
      {}
    );
  });

  it("exits 4 when no flags + non-TTY", async () => {
    // Force non-TTY so the command doesn't try to launch the TUI.
    const origIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      configurable: true,
    });
    try {
      const post = vi.fn();
      createClient.mockResolvedValueOnce({ post });
      const cap = capture();
      const program = buildProgram();
      await expect(
        program.parseAsync(["node", "test", "autouser", "create"])
      ).rejects.toThrow(/process\.exit\(4\)/);
      expect(cap.stderr).toContain("--name is required");
    } finally {
      Object.defineProperty(process.stdout, "isTTY", {
        value: origIsTTY,
        configurable: true,
      });
    }
  });
});
