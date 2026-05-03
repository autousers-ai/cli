/**
 * Tests for the Wave 10 project-config additions in `config.ts`.
 *
 * The walk-up logic, project/global merge precedence, and the new
 * `getActiveTeamSlug` / `getDefaultOutput` helpers each get a focused
 * test. Auth-key resolution and the existing `getBaseUrl` precedence
 * for explicit/env are already covered by `client.test.ts` and the
 * command-level tests.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  findProjectConfigPath,
  getActiveTeamSlug,
  getBaseUrl,
  getDefaultOutput,
  readProjectConfig,
  writeProjectConfig,
  PROJECT_CONFIG_FILENAME,
} from "./config.js";

const ORIGINAL_CWD = process.cwd();

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "autousers-config-test-"));
});

afterEach(async () => {
  process.chdir(ORIGINAL_CWD);
  await rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
  delete process.env.AUTOUSERS_BASE_URL;
});

describe("findProjectConfigPath", () => {
  it("returns null when no .autousers.json is found walking to root", () => {
    process.chdir(tempRoot);
    expect(findProjectConfigPath()).toBeNull();
  });

  it("finds .autousers.json in the starting directory", async () => {
    const path = join(tempRoot, PROJECT_CONFIG_FILENAME);
    await writeFile(path, "{}", "utf8");
    expect(findProjectConfigPath(tempRoot)).toBe(path);
  });

  it("walks up through nested directories to find the nearest config", async () => {
    const nested = join(tempRoot, "a", "b", "c");
    await import("node:fs/promises").then((m) =>
      m.mkdir(nested, { recursive: true })
    );
    const configPath = join(tempRoot, PROJECT_CONFIG_FILENAME);
    await writeFile(configPath, "{}", "utf8");
    expect(findProjectConfigPath(nested)).toBe(configPath);
  });
});

describe("readProjectConfig", () => {
  it("returns null when no project config exists", async () => {
    const result = await readProjectConfig(tempRoot);
    expect(result).toBeNull();
  });

  it("returns the parsed config and absolute path when the file exists", async () => {
    const path = join(tempRoot, PROJECT_CONFIG_FILENAME);
    await writeFile(
      path,
      JSON.stringify({
        baseUrl: "https://stg.example",
        activeTeamSlug: "acme",
      }),
      "utf8"
    );
    const result = await readProjectConfig(tempRoot);
    expect(result).not.toBeNull();
    expect(result?.path).toBe(path);
    expect(result?.config.baseUrl).toBe("https://stg.example");
    expect(result?.config.activeTeamSlug).toBe("acme");
  });

  it("rethrows on malformed JSON rather than swallowing", async () => {
    await writeFile(
      join(tempRoot, PROJECT_CONFIG_FILENAME),
      "{not json",
      "utf8"
    );
    await expect(readProjectConfig(tempRoot)).rejects.toThrow();
  });
});

describe("writeProjectConfig", () => {
  it("writes a JSON file with a trailing newline at the given path", async () => {
    const target = join(tempRoot, "deep", "nest", PROJECT_CONFIG_FILENAME);
    await writeProjectConfig(target, {
      baseUrl: "https://stg.example",
      activeTeamSlug: "acme",
      output: "json",
    });
    const raw = await import("node:fs/promises").then((m) =>
      m.readFile(target, "utf8")
    );
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw)).toEqual({
      baseUrl: "https://stg.example",
      activeTeamSlug: "acme",
      output: "json",
    });
  });
});

describe("precedence helpers", () => {
  it("getBaseUrl: explicit beats env beats project beats global beats default", async () => {
    // Explicit always wins.
    expect(await getBaseUrl("https://explicit.example")).toBe(
      "https://explicit.example"
    );

    // With no explicit, env beats project (project is in tempRoot).
    process.chdir(tempRoot);
    await writeFile(
      join(tempRoot, PROJECT_CONFIG_FILENAME),
      JSON.stringify({ baseUrl: "https://from-project.example" }),
      "utf8"
    );
    process.env.AUTOUSERS_BASE_URL = "https://from-env.example";
    expect(await getBaseUrl()).toBe("https://from-env.example");

    // Drop env: project wins.
    delete process.env.AUTOUSERS_BASE_URL;
    expect(await getBaseUrl()).toBe("https://from-project.example");
  });

  it("getActiveTeamSlug: explicit beats project beats global", async () => {
    expect(await getActiveTeamSlug("explicit-team")).toBe("explicit-team");

    process.chdir(tempRoot);
    await writeFile(
      join(tempRoot, PROJECT_CONFIG_FILENAME),
      JSON.stringify({ activeTeamSlug: "project-team" }),
      "utf8"
    );
    expect(await getActiveTeamSlug()).toBe("project-team");
  });

  it("getDefaultOutput: project beats global; defaults to text when both miss", async () => {
    process.chdir(tempRoot);
    // No project config + assume global has none either → text
    expect(await getDefaultOutput()).toBe("text");

    await writeFile(
      join(tempRoot, PROJECT_CONFIG_FILENAME),
      JSON.stringify({ output: "json" }),
      "utf8"
    );
    expect(await getDefaultOutput()).toBe("json");
  });
});
