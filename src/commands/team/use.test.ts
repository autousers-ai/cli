/**
 * Tests for `autousers team use <slug>`.
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config.js")>();
  return {
    ...actual,
    readConfig: vi.fn(async () => ({})),
    writeConfig: vi.fn(async () => undefined),
    getBaseUrl: vi.fn(async () => "https://app.autousers.ai"),
  };
});

import { readConfig, writeConfig } from "../../config.js";
import { buildTeamCommand } from "./index.js";

const writeConfigMock = writeConfig as unknown as ReturnType<typeof vi.fn>;
const readConfigMock = readConfig as unknown as ReturnType<typeof vi.fn>;

function buildProgram(): Command {
  const program = new Command();
  program.option("--json");
  program.option("--no-color");
  program.setOptionValue("color", false);
  program.exitOverride();
  program.addCommand(buildTeamCommand());
  return program;
}

beforeEach(() => {
  writeConfigMock.mockReset();
  readConfigMock.mockReset().mockResolvedValue({});
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("team use", () => {
  it("persists the slug to ~/.autousers/config.json via writeConfig", async () => {
    const program = buildProgram();
    await program.parseAsync(["node", "test", "team", "use", "acme"]);
    expect(writeConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({ activeTeamSlug: "acme" })
    );
  });
});
