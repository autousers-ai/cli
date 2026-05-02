/**
 * Tests for the Wave 9 settings screen — section nav, BYOK actions,
 * and API-key minting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";

import { Settings } from "./settings.js";
import { useTUIStore } from "../../state.js";

const ESC = String.fromCharCode(27);
const ARROW_DOWN = `${ESC}[B`;
const ENTER = "\r";
const tick = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

interface StubKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

const stubClient = (overrides?: { keys?: StubKeyRow[] }) => {
  const defaultKeys: StubKeyRow[] = [
    {
      id: "key_1",
      name: "Local dev",
      keyPrefix: "ak_live_xyz9",
      scopes: ["evaluations:read"],
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
    },
  ];
  const keys = overrides?.keys ?? defaultKeys;
  return {
    get: vi.fn().mockImplementation(async (url: string) => {
      if (url === "/api/v1/settings/byok") {
        return {
          data: {
            configured: true,
            active: true,
            hint: "aB12",
            addedAt: new Date().toISOString(),
          },
        };
      }
      if (url === "/api/v1/api-keys") {
        return { data: keys };
      }
      return { data: null };
    }),
    post: vi.fn().mockImplementation(async (url: string) => {
      if (url === "/api/v1/settings/byok/test") {
        return { data: { status: "ok", statusCode: 200 } };
      }
      if (url === "/api/v1/api-keys") {
        return {
          data: {
            id: "key_new",
            name: "test-key",
            keyPrefix: "ak_live_zzzz",
            scopes: [],
            plainKey: "ak_live_PLAIN_VALUE",
            expiresAt: null,
            createdAt: new Date().toISOString(),
          },
        };
      }
      return { data: null };
    }),
    patch: vi.fn().mockResolvedValue({ data: null }),
    delete: vi.fn().mockResolvedValue({ data: null }),
  };
};

beforeEach(() => {
  useTUIStore.setState({
    screen: "settings",
    authUser: {
      email: "you@autousers.ai",
      teamName: "Acme",
      plan: "Free",
    },
    placeholderTarget: null,
    toast: null,
    activeTeamSlug: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Settings", () => {
  it("loads BYOK + API-key state on mount and renders the profile section by default", async () => {
    const client = stubClient();
    const { lastFrame } = render(
      <Settings createClient={async () => client} />
    );
    await tick(60);
    const f = lastFrame() ?? "";
    expect(f).toContain("Settings");
    expect(f).toContain("Profile");
    expect(f).toContain("you@autousers.ai");
    expect(client.get).toHaveBeenCalledWith("/api/v1/settings/byok");
    expect(client.get).toHaveBeenCalledWith("/api/v1/api-keys");
  });

  it("arrow-down navigates to BYOK section and `t` triggers a test call", async () => {
    const client = stubClient();
    const { stdin, lastFrame } = render(
      <Settings createClient={async () => client} />
    );
    await tick(60);
    stdin.write(ARROW_DOWN);
    await tick(50);
    expect(lastFrame()).toContain("t test");
    stdin.write("t");
    await tick(80);
    expect(client.post).toHaveBeenCalledWith("/api/v1/settings/byok/test", {});
  });

  it("arrow-down to API keys + n + name + Enter mints a key and surfaces it once", async () => {
    const client = stubClient();
    const { stdin, lastFrame } = render(
      <Settings createClient={async () => client} />
    );
    await tick(60);
    // Profile → BYOK → API keys
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write("n");
    await tick(40);
    for (const c of "test-key") {
      stdin.write(c);
      await tick();
    }
    stdin.write(ENTER);
    await tick(60);
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/api-keys",
      expect.objectContaining({ name: "test-key" })
    );
    const f = lastFrame() ?? "";
    expect(f).toContain("ak_live_PLAIN_VALUE");
    expect(f).toContain("NEVER be shown again");
  });

  it("Enter on the Switch active team section routes to teams-section", async () => {
    const client = stubClient();
    const { stdin } = render(<Settings createClient={async () => client} />);
    await tick(60);
    // Profile → BYOK → API keys → Usage → Connected apps → Teams
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(useTUIStore.getState().screen).toBe("teams-section");
  });

  it("Esc returns to the menu", async () => {
    const client = stubClient();
    const { stdin } = render(<Settings createClient={async () => client} />);
    await tick(60);
    stdin.write(ESC);
    await tick();
    expect(useTUIStore.getState().screen).toBe("menu");
  });

  it("`r` on a highlighted key opens the rename input and PATCHes { name } on submit", async () => {
    const client = stubClient();
    const { stdin } = render(<Settings createClient={async () => client} />);
    await tick(60);
    // Profile → BYOK → API keys
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write("r");
    await tick(40);
    // The rename prompt prefills the existing name; backspace it out so
    // we can type a fresh value and assert exactly what we PATCHed.
    for (let i = 0; i < "Local dev".length; i++) {
      stdin.write("\x7f"); // DEL / backspace
      await tick();
    }
    for (const c of "renamed-key") {
      stdin.write(c);
      await tick();
    }
    stdin.write(ENTER);
    await tick(60);
    expect(client.patch).toHaveBeenCalledWith(
      "/api/v1/api-keys/key_1",
      expect.objectContaining({ name: "renamed-key" })
    );
  });

  it("`s` on a highlighted key opens the scope input and PATCHes { scopes: [...] } on submit", async () => {
    const client = stubClient();
    const { stdin } = render(<Settings createClient={async () => client} />);
    await tick(60);
    // Profile → BYOK → API keys
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write("s");
    await tick(40);
    // Clear the prefilled "evaluations:read" so the typed value is the
    // sole submission; backspace once per char.
    const prefill = "evaluations:read";
    for (let i = 0; i < prefill.length; i++) {
      stdin.write("\x7f");
      await tick();
    }
    for (const c of "evaluations:read") {
      stdin.write(c);
      await tick();
    }
    stdin.write(ENTER);
    await tick(60);
    expect(client.patch).toHaveBeenCalledWith(
      "/api/v1/api-keys/key_1",
      expect.objectContaining({ scopes: ["evaluations:read"] })
    );
  });

  it("`r` on a revoked key shows an inline error and does NOT call client.patch", async () => {
    const client = stubClient({
      keys: [
        {
          id: "key_revoked",
          name: "Old key",
          keyPrefix: "ak_live_old0",
          scopes: ["evaluations:read"],
          expiresAt: null,
          revokedAt: new Date().toISOString(),
          lastUsedAt: null,
          createdAt: new Date().toISOString(),
        },
      ],
    });
    const { stdin, lastFrame } = render(
      <Settings createClient={async () => client} />
    );
    await tick(60);
    // Profile → BYOK → API keys
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write("r");
    await tick(40);
    const f = lastFrame() ?? "";
    expect(f).toContain("Cannot rename a revoked key");
    expect(client.patch).not.toHaveBeenCalled();
  });
});
