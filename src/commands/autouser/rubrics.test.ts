/**
 * Tests for `autousers autouser rubrics <id>` and `autouser rubric <verb>`.
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

describe("autouser rubrics", () => {
  it("GETs /rubrics and renders a table", async () => {
    const get = vi.fn().mockResolvedValueOnce({
      data: [
        {
          id: "rb_1",
          version: 1,
          status: "draft",
          createdAt: new Date().toISOString(),
        },
      ],
      has_more: false,
    });
    createClient.mockResolvedValueOnce({ get });
    const cap = capture();
    const program = buildProgram();
    await program.parseAsync(["node", "test", "autouser", "rubrics", "au_x"]);
    expect(get).toHaveBeenCalledWith("/api/v1/autousers/au_x/rubrics");
    expect(cap.stdout).toContain("draft");
  });

  it("renders 'No rubrics' when empty", async () => {
    const get = vi.fn().mockResolvedValueOnce({ data: [], has_more: false });
    createClient.mockResolvedValueOnce({ get });
    const cap = capture();
    const program = buildProgram();
    await program.parseAsync(["node", "test", "autouser", "rubrics", "au_x"]);
    expect(cap.stdout).toContain("No rubrics found");
  });
});

describe("autouser rubric", () => {
  it("rubric add POSTs criteriaText", async () => {
    const post = vi.fn().mockResolvedValueOnce({
      data: { id: "rb_2", version: 2 },
    });
    createClient.mockResolvedValueOnce({ post });
    const cap = capture();
    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "autouser",
      "rubric",
      "add",
      "au_x",
      "--criteria",
      "be excellent",
    ]);
    expect(post).toHaveBeenCalledWith("/api/v1/autousers/au_x/rubrics", {
      criteriaText: "be excellent",
    });
    expect(cap.stdout).toContain("Added rubric");
  });

  it("rubric update PATCHes the named fields", async () => {
    const patch = vi.fn().mockResolvedValueOnce({
      data: { id: "rb_2" },
    });
    createClient.mockResolvedValueOnce({ patch });
    capture();
    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "autouser",
      "rubric",
      "update",
      "au_x",
      "rb_2",
      "--criteria",
      "rev2",
      "--status",
      "active",
    ]);
    expect(patch).toHaveBeenCalledWith("/api/v1/autousers/au_x/rubrics/rb_2", {
      criteriaText: "rev2",
      status: "active",
    });
  });

  it("rubric update exits 4 with no fields", async () => {
    const patch = vi.fn();
    createClient.mockResolvedValueOnce({ patch });
    const cap = capture();
    const program = buildProgram();
    await expect(
      program.parseAsync([
        "node",
        "test",
        "autouser",
        "rubric",
        "update",
        "au_x",
        "rb_2",
      ])
    ).rejects.toThrow(/process\.exit\(4\)/);
    expect(cap.stderr).toContain("at least one of");
  });
});
