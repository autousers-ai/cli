/**
 * Tests for `autousers whoami`.
 *
 * Strategy: stub the program-level commander so `resolveContext` walks to
 * a root with the desired global flags, intercept the `AutousersClient`
 * constructor via `vi.mock`, and assert on captured stdout. We use the
 * real `Command` from commander rather than mocking it — it's a tiny
 * synchronous object and any divergence from the real thing would
 * defeat the purpose of the test.
 */

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock both client.ts (factory) and config.ts (getBaseUrl). The factory
// is what `resolveContext` calls — we don't care about the real OAuth
// resolution path here; we just want a stub whose `.get()` returns
// canned data.
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
import { whoamiCommand } from "./whoami.js";

const createClient = createClientFromConfig as unknown as ReturnType<
  typeof vi.fn
>;

interface CapturedStdout {
  text: string;
}

function captureStdout(): CapturedStdout {
  const cap: CapturedStdout = { text: "" };
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    cap.text += String(chunk);
    return true;
  });
  return cap;
}

function buildCmd(opts: { json?: boolean } = {}): Command {
  // Build a tiny program/cmd pair so resolveContext can walk to root.
  const program = new Command();
  program.option("--key <key>");
  program.option("--base-url <url>");
  program.option("--json");
  program.option("--quiet");
  program.option("--no-color");

  // Apply opts straight onto the program — we skip parsing argv so this
  // matches what commander would set after `--json` was passed.
  if (opts.json) program.setOptionValue("json", true);
  // Disable color in tests so assertions don't see ANSI codes.
  program.setOptionValue("color", false);

  const sub = program.command("whoami");
  return sub;
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

describe("whoami", () => {
  it("renders text mode with active team + free quota", async () => {
    const get = vi.fn();
    get.mockResolvedValueOnce({
      data: [
        {
          id: "cmoiPersonal12345",
          name: "Personal",
          isPersonal: true,
          memberCount: 1,
          userRole: "Owner",
          createdAt: "2026-01-01T00:00:00Z",
        },
        {
          id: "cmoiTeam9876",
          name: "Acme",
          isPersonal: false,
          memberCount: 4,
          userRole: "Editor",
          createdAt: "2026-02-01T00:00:00Z",
        },
      ],
      has_more: false,
    });
    get.mockResolvedValueOnce({
      range: "30d",
      byok: false,
      byokConfigured: false,
      freeQuota: { used: 3, limit: 50 },
    });

    createClient.mockResolvedValueOnce({ get });

    const cap = captureStdout();
    await whoamiCommand({}, buildCmd());

    expect(get).toHaveBeenCalledWith("/api/v1/teams");
    expect(get).toHaveBeenCalledWith("/api/v1/usage?range=30d");

    expect(cap.text).toContain("Signed in to https://app.autousers.ai");
    // Personal team is the active team because isPersonal=true.
    expect(cap.text).toContain("Personal");
    expect(cap.text).toContain("[Owner]");
    // Free runs computed as limit - used.
    expect(cap.text).toContain("47/50");
  });

  it("emits the raw envelope shape in --json mode", async () => {
    const get = vi.fn();
    get.mockResolvedValueOnce({
      data: [
        {
          id: "cmoiTeamA12345",
          name: "Personal",
          isPersonal: true,
          memberCount: 1,
          userRole: "Owner",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
      has_more: false,
    });
    get.mockResolvedValueOnce({
      range: "30d",
      byok: false,
      byokConfigured: false,
      freeQuota: { used: 0, limit: 50 },
    });

    createClient.mockResolvedValueOnce({ get });

    const cap = captureStdout();
    await whoamiCommand({}, buildCmd({ json: true }));

    const parsed = JSON.parse(cap.text);
    expect(parsed.baseUrl).toBe("https://app.autousers.ai");
    expect(parsed.activeTeamId).toBe("cmoiTeamA12345");
    expect(parsed.usage.freeQuota.limit).toBe(50);
    expect(Array.isArray(parsed.teams)).toBe(true);
    expect(parsed.teams).toHaveLength(1);
  });

  it("renders 'unlimited beta' for null free-quota limit", async () => {
    const get = vi.fn();
    get.mockResolvedValueOnce({
      data: [
        {
          id: "cmoi5",
          name: "Personal",
          isPersonal: true,
          memberCount: 1,
          userRole: "Owner",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
      has_more: false,
    });
    get.mockResolvedValueOnce({
      range: "30d",
      byok: false,
      byokConfigured: false,
      freeQuota: { used: 142, limit: null },
    });

    createClient.mockResolvedValueOnce({ get });

    const cap = captureStdout();
    await whoamiCommand({}, buildCmd());

    expect(cap.text).toContain("unlimited beta");
    expect(cap.text).toContain("142");
  });
});
