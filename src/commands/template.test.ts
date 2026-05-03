/**
 * Tests for `autousers template list`.
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
import { buildTemplateCommand } from "./template.js";

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
  program.addCommand(buildTemplateCommand());
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

describe("template list", () => {
  it("renders source / name / type / dimensions / id columns", async () => {
    const get = vi.fn().mockResolvedValueOnce({
      data: [
        {
          id: "cmoiTpl1",
          name: "Booking-path friction",
          type: "TEXT_SXS",
          scaleType: "SEVEN_POINT",
          isSystem: false,
          factors: ["a", "b", "c"],
          sseCriteria: null,
        },
        {
          id: "cmoiTpl2",
          name: "First impression",
          type: "TEXT_SSE",
          scaleType: "SEVEN_POINT",
          isSystem: true,
          factors: null,
          sseCriteria: ["x", "y"],
        },
      ],
      has_more: false,
    });
    createClient.mockResolvedValueOnce({ get });

    const cap = captureStdout();
    const program = buildProgram();
    await program.parseAsync(["node", "test", "template", "list"]);

    const url = get.mock.calls[0]![0] as string;
    expect(url).toContain("/api/v1/templates");
    expect(url).toContain("limit=20");

    expect(cap.text).toContain("Booking-path friction");
    expect(cap.text).toContain("First impression");
    expect(cap.text).toContain("TEXT_SXS");
    expect(cap.text).toContain("TEXT_SSE");
    // Factor count rendered: 3 from `factors`, 2 from `sseCriteria`.
    expect(cap.text).toMatch(/\b3\b/);
    expect(cap.text).toMatch(/\b2\b/);
    // Source column distinguishes built-in from custom.
    expect(cap.text).toContain("built-in");
    expect(cap.text).toContain("custom");
  });

  it("emits raw envelope in --json mode", async () => {
    const envelope = {
      data: [
        {
          id: "cmoiTpl1",
          name: "Booking",
          type: "TEXT_SXS",
          scaleType: "SEVEN_POINT",
          isSystem: false,
          factors: [],
          sseCriteria: null,
        },
      ],
      has_more: false,
    };
    const get = vi.fn().mockResolvedValueOnce(envelope);
    createClient.mockResolvedValueOnce({ get });
    const cap = captureStdout();

    const program = buildProgram();
    program.setOptionValue("json", true);
    await program.parseAsync(["node", "test", "template", "list"]);

    expect(JSON.parse(cap.text)).toEqual(envelope);
  });

  it("respects --limit", async () => {
    const get = vi.fn().mockResolvedValueOnce({ data: [], has_more: false });
    createClient.mockResolvedValueOnce({ get });
    captureStdout();

    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "template",
      "list",
      "--limit",
      "50",
    ]);

    const url = get.mock.calls[0]![0] as string;
    expect(url).toContain("limit=50");
  });
});
