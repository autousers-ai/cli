/**
 * Tests for `autousers autouser list`.
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

function captureStdout(): { text: string } {
  const cap = { text: "" };
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    cap.text += String(chunk);
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

describe("autouser list", () => {
  it("renders both built-in and custom rows by default", async () => {
    const get = vi.fn().mockResolvedValueOnce({
      data: [
        {
          id: "cmoiBuiltIn1",
          name: "Empathetic Designer",
          role: "designer",
          isSystem: true,
          status: "published",
          visibility: "public",
          source: "built-in",
          updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        },
        {
          id: "cmoiCustom1",
          name: "Acme PM",
          role: "pm",
          isSystem: false,
          status: "published",
          visibility: "private",
          source: "custom",
          updatedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        },
      ],
      has_more: false,
    });
    createClient.mockResolvedValueOnce({ get });

    const cap = captureStdout();
    const program = buildProgram();
    await program.parseAsync(["node", "test", "autouser", "list"]);

    const url = get.mock.calls[0]![0] as string;
    expect(url).toContain("/api/v1/autousers");
    expect(url).toContain("limit=20");
    // Default behavior: don't pass includeSystem (server default = true)
    expect(url).not.toContain("includeSystem=false");

    expect(cap.text).toContain("Empathetic Designer");
    expect(cap.text).toContain("Acme PM");
    expect(cap.text).toContain("built-in");
    expect(cap.text).toContain("custom");
  });

  it("appends includeSystem=false when --source custom is passed", async () => {
    const get = vi.fn().mockResolvedValueOnce({
      data: [
        {
          id: "cmoiCustom2",
          name: "Acme Designer",
          role: "designer",
          isSystem: false,
          status: "published",
          visibility: "private",
          source: "custom",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
      has_more: false,
    });
    createClient.mockResolvedValueOnce({ get });
    captureStdout();

    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "autouser",
      "list",
      "--source",
      "custom",
    ]);

    const url = get.mock.calls[0]![0] as string;
    expect(url).toContain("includeSystem=false");
  });

  it("emits raw envelope in --json mode", async () => {
    const envelope = {
      data: [
        {
          id: "cmoi1",
          name: "X",
          role: "pm",
          isSystem: false,
          status: "draft",
          visibility: "private",
          source: "custom" as const,
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
      has_more: false,
    };
    const get = vi.fn().mockResolvedValueOnce(envelope);
    createClient.mockResolvedValueOnce({ get });
    const cap = captureStdout();

    const program = buildProgram();
    program.setOptionValue("json", true);
    await program.parseAsync(["node", "test", "autouser", "list"]);

    expect(JSON.parse(cap.text)).toEqual(envelope);
  });
});
