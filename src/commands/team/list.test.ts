/**
 * Tests for `autousers team list`.
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client.js")>();
  return { ...actual, createClientFromConfig: vi.fn() };
});

vi.mock("../../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config.js")>();
  return {
    ...actual,
    readConfig: vi.fn(async () => ({ activeTeamSlug: "acme" })),
    getBaseUrl: vi.fn(async () => "https://app.autousers.ai"),
  };
});

import { createClientFromConfig } from "../../client.js";
import { buildTeamCommand } from "./index.js";

const createClient = createClientFromConfig as unknown as ReturnType<
  typeof vi.fn
>;

function buildProgram(): Command {
  const program = new Command();
  program.option("--key <key>");
  program.option("--base-url <url>");
  program.option("--json");
  program.option("--no-color");
  program.setOptionValue("color", false);
  program.exitOverride();
  program.addCommand(buildTeamCommand());
  return program;
}

beforeEach(() => {
  createClient.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("team list", () => {
  it("renders the rows and marks the active team with a star", async () => {
    const get = vi.fn().mockResolvedValueOnce({
      data: [
        {
          id: "team_1",
          name: "Personal",
          isPersonal: true,
          memberCount: 1,
          userRole: "Owner",
          slug: "personal",
        },
        {
          id: "team_2",
          name: "Acme",
          isPersonal: false,
          memberCount: 4,
          userRole: "Admin",
          slug: "acme",
        },
      ],
    });
    createClient.mockResolvedValueOnce({ get });
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
      out.push(String(c));
      return true;
    });
    const program = buildProgram();
    await program.parseAsync(["node", "test", "team", "list"]);
    expect(get).toHaveBeenCalledWith("/api/v1/teams");
    const text = out.join("");
    expect(text).toContain("Personal");
    expect(text).toContain("Acme");
    // Star appears in the active row
    expect(text).toContain("★");
  });
});
