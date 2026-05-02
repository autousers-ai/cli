/**
 * Tests for `autousers init`.
 *
 * Strategy: drive the action via `program.parseAsync` so commander option
 * binding (boolean negation, --output validation, default values) is
 * exercised end-to-end. Each test runs in a fresh temp dir so writes to
 * `.autousers.json` are isolated; `process.chdir` is restored in
 * afterEach.
 */
import { existsSync, realpathSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>();
  return {
    ...actual,
    // Default to no-op for global mode tests; tests that exercise the
    // global path override these per-case via mockResolvedValueOnce.
    readConfig: vi.fn(async () => ({})),
    writeConfig: vi.fn(async () => undefined),
  };
});

import { readConfig, writeConfig } from "../config.js";
import { initCommand } from "./init.js";

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
  initCommand(program);
  return program;
}

let originalCwd: string;
let tmpDir: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  // realpathSync resolves the macOS /var → /private/var symlink so paths
  // computed from process.cwd() inside the action match the tmpDir we
  // assert against.
  tmpDir = realpathSync(await mkdtemp(join(tmpdir(), "autousers-init-")));
  process.chdir(tmpDir);
  writeConfigMock.mockReset().mockResolvedValue(undefined);
  readConfigMock.mockReset().mockResolvedValue({});
  // process.exit must throw so the action terminates synchronously inside
  // the test instead of killing the vitest worker. The thrown message
  // encodes the exit code so assertions can inspect it.
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`);
  }) as never);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("init — project mode", () => {
  it("writes .autousers.json with the supplied flags when --yes is set", async () => {
    const program = buildProgram();
    captureStreams();

    await program.parseAsync([
      "node",
      "test",
      "init",
      "--team",
      "acme",
      "--base-url",
      "https://staging.example",
      "--output",
      "json",
      "--yes",
    ]);

    const target = join(tmpDir, ".autousers.json");
    expect(existsSync(target)).toBe(true);
    const parsed = JSON.parse(await readFile(target, "utf8"));
    expect(parsed).toEqual({
      activeTeamSlug: "acme",
      baseUrl: "https://staging.example",
      output: "json",
    });
  });

  it("rejects --output values other than json|text with exit code 4", async () => {
    const program = buildProgram();
    const cap = captureStreams();

    await expect(
      program.parseAsync([
        "node",
        "test",
        "init",
        "--team",
        "acme",
        "--output",
        "bad",
        "--yes",
      ])
    ).rejects.toThrow("process.exit(4)");

    expect(cap.stderr).toContain("--output must be");
    expect(existsSync(join(tmpDir, ".autousers.json"))).toBe(false);
  });

  it("accepts --output text without complaint", async () => {
    const program = buildProgram();
    captureStreams();

    await program.parseAsync([
      "node",
      "test",
      "init",
      "--team",
      "acme",
      "--output",
      "text",
      "--yes",
    ]);

    const parsed = JSON.parse(
      await readFile(join(tmpDir, ".autousers.json"), "utf8")
    );
    expect(parsed.output).toBe("text");
  });

  it("refuses to overwrite an existing .autousers.json without --force in non-TTY", async () => {
    // Pre-existing file the test wants to protect.
    const target = join(tmpDir, ".autousers.json");
    await writeFile(target, JSON.stringify({ baseUrl: "https://old" }));

    // Force non-TTY by stubbing stdin.isTTY to undefined for this test.
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      get: () => undefined,
    });

    try {
      const program = buildProgram();
      const cap = captureStreams();

      await expect(
        program.parseAsync(["node", "test", "init", "--team", "acme", "--yes"])
      ).rejects.toThrow("process.exit(4)");

      expect(cap.stderr).toContain("already exists");
      // The original content should be unchanged.
      const stillThere = JSON.parse(await readFile(target, "utf8"));
      expect(stillThere.baseUrl).toBe("https://old");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        get: () => originalIsTTY,
      });
    }
  });

  it("overwrites an existing .autousers.json when --force is passed", async () => {
    const target = join(tmpDir, ".autousers.json");
    await writeFile(target, JSON.stringify({ baseUrl: "https://old" }));

    const program = buildProgram();
    captureStreams();

    await program.parseAsync([
      "node",
      "test",
      "init",
      "--team",
      "acme",
      "--force",
      "--yes",
    ]);

    const parsed = JSON.parse(await readFile(target, "utf8"));
    expect(parsed).toEqual({ activeTeamSlug: "acme" });
  });

  it("exits 4 in non-TTY when no flags and no --yes are supplied", async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      get: () => undefined,
    });

    try {
      const program = buildProgram();
      const cap = captureStreams();

      await expect(
        program.parseAsync(["node", "test", "init"])
      ).rejects.toThrow("process.exit(4)");

      expect(cap.stderr).toContain("non-TTY");
      expect(existsSync(join(tmpDir, ".autousers.json"))).toBe(false);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        get: () => originalIsTTY,
      });
    }
  });

  it("emits a JSON envelope when the global --json flag is set", async () => {
    const program = buildProgram();
    const cap = captureStreams();

    await program.parseAsync([
      "node",
      "test",
      "--json",
      "init",
      "--team",
      "acme",
      "--base-url",
      "https://staging.example",
      "--output",
      "text",
      "--yes",
    ]);

    const target = join(tmpDir, ".autousers.json");
    const parsed = JSON.parse(cap.stdout.trim());
    expect(parsed).toEqual({
      path: target,
      config: {
        activeTeamSlug: "acme",
        baseUrl: "https://staging.example",
        output: "text",
      },
    });
  });
});

describe("init — global mode", () => {
  it("calls writeConfig (not writeProjectConfig) and merges over existing global config", async () => {
    // Existing global config has auth tokens we MUST preserve.
    readConfigMock.mockResolvedValueOnce({
      accessToken: "secret-token",
      refreshToken: "secret-refresh",
      apiKey: "ak_live_keep",
      baseUrl: "https://old",
    });

    const program = buildProgram();
    captureStreams();

    await program.parseAsync([
      "node",
      "test",
      "init",
      "--global",
      "--team",
      "acme",
      "--base-url",
      "https://staging.example",
      "--output",
      "json",
      "--yes",
    ]);

    expect(writeConfigMock).toHaveBeenCalledTimes(1);
    const written = writeConfigMock.mock.calls[0]![0];
    // Auth fields must survive the merge.
    expect(written.accessToken).toBe("secret-token");
    expect(written.refreshToken).toBe("secret-refresh");
    expect(written.apiKey).toBe("ak_live_keep");
    // New fields land.
    expect(written.activeTeamSlug).toBe("acme");
    expect(written.baseUrl).toBe("https://staging.example");
    expect(written.output).toBe("json");

    // No project-level file should have been created.
    expect(existsSync(join(tmpDir, ".autousers.json"))).toBe(false);
  });
});
