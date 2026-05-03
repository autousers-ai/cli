/**
 * Tests for `autousers configure`.
 *
 * Strategy mirrors `init.test.ts`: drive the action via
 * `program.parseAsync` so commander option binding is exercised end-to-end,
 * mock `readConfig` / `writeConfig` so writes never touch
 * `~/.autousers/config.json`, and stub `process.exit` so the test runner
 * survives the validation-failure code paths.
 *
 * The matrix covers: flag-only happy path, --reset preserving auth,
 * --output validation, --reset + field-flag mutual exclusion, non-TTY
 * refusal, and JSON-mode output cleanliness (no auth leakage to stdout).
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>();
  return {
    ...actual,
    readConfig: vi.fn(async () => ({})),
    writeConfig: vi.fn(async () => undefined),
  };
});

import { readConfig, writeConfig } from "../config.js";
import { configureCommand } from "./configure.js";

const writeConfigMock = writeConfig as unknown as ReturnType<typeof vi.fn>;
const readConfigMock = readConfig as unknown as ReturnType<typeof vi.fn>;

interface CapturedStreams {
  stdout: string;
  stderr: string;
}

function captureStreams(): CapturedStreams {
  const cap: CapturedStreams = { stdout: "", stderr: "" };
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    cap.stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    cap.stderr += String(chunk);
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
  configureCommand(program);
  return program;
}

beforeEach(() => {
  writeConfigMock.mockReset().mockResolvedValue(undefined);
  readConfigMock.mockReset().mockResolvedValue({});
  // process.exit must throw so the action terminates synchronously inside
  // the test instead of killing the vitest worker. The thrown message
  // encodes the exit code so assertions can inspect it.
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("configure — flag mode", () => {
  it("writes the merged config when all field flags + --yes are supplied", async () => {
    readConfigMock.mockResolvedValueOnce({
      apiKey: "ak_live_keep",
      accessToken: "tok_keep",
    });

    const program = buildProgram();
    captureStreams();

    await program.parseAsync([
      "node",
      "test",
      "configure",
      "--base-url",
      "https://staging.example",
      "--team",
      "acme",
      "--output",
      "json",
      "--yes",
    ]);

    expect(writeConfigMock).toHaveBeenCalledTimes(1);
    const written = writeConfigMock.mock.calls[0]![0];
    // Preference fields landed.
    expect(written.baseUrl).toBe("https://staging.example");
    expect(written.activeTeamSlug).toBe("acme");
    expect(written.output).toBe("json");
    // Auth fields preserved through the merge.
    expect(written.apiKey).toBe("ak_live_keep");
    expect(written.accessToken).toBe("tok_keep");
  });

  it("merges partial flag updates over existing config (only changes what's passed)", async () => {
    readConfigMock.mockResolvedValueOnce({
      baseUrl: "https://old.example",
      activeTeamSlug: "old-team",
      output: "text",
      apiKey: "ak_live_keep",
    });

    const program = buildProgram();
    captureStreams();

    await program.parseAsync([
      "node",
      "test",
      "configure",
      "--team",
      "new-team",
      "--yes",
    ]);

    const written = writeConfigMock.mock.calls[0]![0];
    expect(written.activeTeamSlug).toBe("new-team");
    // Untouched fields retain their previous value.
    expect(written.baseUrl).toBe("https://old.example");
    expect(written.output).toBe("text");
    expect(written.apiKey).toBe("ak_live_keep");
  });
});

describe("configure — --reset", () => {
  it("strips baseUrl / activeTeamSlug / output but preserves auth fields", async () => {
    readConfigMock.mockResolvedValueOnce({
      baseUrl: "https://old.example",
      activeTeamSlug: "old-team",
      output: "json",
      apiKey: "ak_live_keep",
      accessToken: "tok_keep",
      refreshToken: "ref_keep",
      expiresAt: "2099-01-01T00:00:00Z",
      clientId: "client_keep",
    });

    const program = buildProgram();
    captureStreams();

    await program.parseAsync(["node", "test", "configure", "--reset", "--yes"]);

    expect(writeConfigMock).toHaveBeenCalledTimes(1);
    const written = writeConfigMock.mock.calls[0]![0];
    // Preference fields gone.
    expect(written).toEqual(
      expect.not.objectContaining({
        baseUrl: expect.anything(),
        activeTeamSlug: expect.anything(),
        output: expect.anything(),
      })
    );
    // Auth fields preserved.
    expect(written).toEqual(
      expect.objectContaining({
        apiKey: "ak_live_keep",
        accessToken: "tok_keep",
        refreshToken: "ref_keep",
        expiresAt: "2099-01-01T00:00:00Z",
        clientId: "client_keep",
      })
    );
  });

  it("exits 4 when --reset is combined with --team (mutually exclusive)", async () => {
    const program = buildProgram();
    const cap = captureStreams();

    await expect(
      program.parseAsync([
        "node",
        "test",
        "configure",
        "--reset",
        "--team",
        "acme",
        "--yes",
      ])
    ).rejects.toThrow("process.exit(4)");

    expect(cap.stderr).toContain("--reset cannot be combined");
    expect(writeConfigMock).not.toHaveBeenCalled();
  });
});

describe("configure — validation", () => {
  it("rejects --output values other than json|text with exit code 4", async () => {
    const program = buildProgram();
    const cap = captureStreams();

    await expect(
      program.parseAsync([
        "node",
        "test",
        "configure",
        "--output",
        "bad",
        "--yes",
      ])
    ).rejects.toThrow("process.exit(4)");

    expect(cap.stderr).toContain("--output must be");
    expect(writeConfigMock).not.toHaveBeenCalled();
  });

  it("exits 4 in non-TTY when no field flags and no --reset are supplied", async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      get: () => undefined,
    });

    try {
      const program = buildProgram();
      const cap = captureStreams();

      await expect(
        program.parseAsync(["node", "test", "configure"])
      ).rejects.toThrow("process.exit(4)");

      expect(cap.stderr).toContain("nothing to do");
      expect(writeConfigMock).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        get: () => originalIsTTY,
      });
    }
  });
});

describe("configure — JSON output", () => {
  it("emits a JSON envelope with only preference fields (no auth leak)", async () => {
    readConfigMock.mockResolvedValueOnce({
      apiKey: "ak_live_secret",
      accessToken: "tok_secret",
      refreshToken: "ref_secret",
    });

    const program = buildProgram();
    const cap = captureStreams();

    await program.parseAsync([
      "node",
      "test",
      "--json",
      "configure",
      "--base-url",
      "https://staging.example",
      "--team",
      "acme",
      "--output",
      "json",
      "--yes",
    ]);

    const parsed = JSON.parse(cap.stdout.trim());
    expect(parsed.persisted).toBe(true);
    expect(parsed.config).toEqual({
      baseUrl: "https://staging.example",
      activeTeamSlug: "acme",
      output: "json",
    });
    // Auth fields must NEVER appear in stdout — even after secret
    // serialization to disk, the stdout envelope is intentionally
    // preference-only so this output is safe to paste into shared logs.
    expect(cap.stdout).not.toContain("ak_live_secret");
    expect(cap.stdout).not.toContain("tok_secret");
    expect(cap.stdout).not.toContain("ref_secret");
  });
});
