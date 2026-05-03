/**
 * Tests for `autousers login`.
 *
 * Most of the login flow is exercised end-to-end in `oauth.test.ts` (the
 * orchestrator) and `auth-flow.test.ts` (the TUI shim). This file's job
 * is narrow: lock in the scope set the plain-mode command requests, so a
 * future "shrink the scope list" refactor can't silently re-introduce the
 * write-scope-missing bug that 403'd every post-login mutation.
 */

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../oauth.js", () => ({
  loginWithBrowser: vi.fn(),
}));

vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>();
  return {
    ...actual,
    readConfig: vi.fn(async () => ({})),
    writeConfig: vi.fn(async () => undefined),
    getBaseUrl: vi.fn(async () => "https://app.autousers.ai"),
    clearOAuthFields: vi.fn((cfg: Record<string, unknown>) => ({ ...cfg })),
    configPath: vi.fn(() => "/tmp/.autousers/config.json"),
  };
});

import * as oauth from "../oauth.js";
import { loginCommand } from "./login.js";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loginCommand — browser flow", () => {
  it("requests the full read+write scope set", async () => {
    vi.mocked(oauth.loginWithBrowser).mockResolvedValue({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
      clientId: "mcp_client_test",
    });

    // Build a minimal commander root so optsWithGlobals() resolves the
    // way `loginCommand` expects (no `--base-url`, no `--key`). We
    // construct the subcommand directly and attach it — calling
    // `program.parse([])` would trigger the help-and-exit path because
    // commander treats "no command" as "show help" by default.
    const program = new Command();
    program.option("--base-url <url>");
    const sub = new Command("login")
      .option("--key <key>")
      .option("--no-browser");
    program.addCommand(sub);

    // Suppress success log to stdout during the test.
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await loginCommand({ browser: false }, sub);

    expect(oauth.loginWithBrowser).toHaveBeenCalledTimes(1);
    const call = vi.mocked(oauth.loginWithBrowser).mock.calls[0]![0];
    expect(call.scopes).toEqual([
      "evaluations:read",
      "evaluations:write",
      "templates:read",
      "templates:write",
      "autousers:read",
      "autousers:write",
      "ratings:read",
      "ratings:write",
    ]);
    expect(call.openBrowser).toBe(false);

    writeSpy.mockRestore();
  });
});
