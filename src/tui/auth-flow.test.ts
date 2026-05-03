/**
 * Tests for the TUI's auth-flow wrapper.
 *
 * The wrapper is a thin shim between `mode-selector` and the OAuth
 * orchestrator + the API client. Behaviour we want to lock down:
 *
 *   - On successful login, the resolved auth user is pushed into the
 *     zustand store (so the header refreshes without a screen change).
 *   - On logout, the store is cleared AND the server-side revoke is
 *     attempted before the local config is wiped.
 *   - `fetchAuthUser` returns `null` when the bearer is unavailable or
 *     the network call fails (it must NOT throw — the TUI mounts it from
 *     a useEffect and an unhandled rejection would crash render).
 *
 * Mock surface
 * ------------
 *   - `../oauth.js`: stubbed `loginWithBrowser` so we don't boot a real
 *     loopback server / spawn a browser.
 *   - `../config.js`: stubbed read/write so we don't touch the user's
 *     real `~/.autousers/config.json` during tests.
 *   - `../client.js`: stubbed `createClientFromConfig` so we can drive
 *     the whoami response without an HTTP server.
 *   - `globalThis.fetch`: stubbed so the logout `/oauth/revoke` POST
 *     is observable without a real network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../oauth.js", () => ({
  loginWithBrowser: vi.fn(),
}));

vi.mock("../config.js", () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn().mockResolvedValue(undefined),
  clearOAuthFields: vi.fn((cfg: Record<string, unknown>) => {
    const next = { ...cfg };
    delete next.accessToken;
    delete next.refreshToken;
    delete next.expiresAt;
    delete next.clientId;
    return next;
  }),
  getBaseUrl: vi.fn().mockResolvedValue("https://app.autousers.ai"),
}));

vi.mock("../client.js", () => ({
  createClientFromConfig: vi.fn(),
}));

import * as oauth from "../oauth.js";
import * as config from "../config.js";
import * as client from "../client.js";
import { fetchAuthUser, startTuiLogin, tuiLogout } from "./auth-flow.js";
import { useTUIStore } from "./state.js";

beforeEach(() => {
  vi.clearAllMocks();
  useTUIStore.setState({
    screen: "menu",
    authUser: null,
    placeholderTarget: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchAuthUser", () => {
  it("returns null when the API client throws", async () => {
    vi.mocked(client.createClientFromConfig).mockRejectedValue(
      new Error("no bearer")
    );
    const user = await fetchAuthUser();
    expect(user).toBeNull();
  });

  it("returns null when the whoami endpoint errors", async () => {
    vi.mocked(client.createClientFromConfig).mockResolvedValue({
      get: vi.fn().mockRejectedValue(new Error("HTTP 500")),
    } as unknown as Awaited<ReturnType<typeof client.createClientFromConfig>>);
    const user = await fetchAuthUser();
    expect(user).toBeNull();
  });

  it("returns null when whoami response has no email", async () => {
    vi.mocked(client.createClientFromConfig).mockResolvedValue({
      get: vi.fn().mockResolvedValue({ teams: [] }),
    } as unknown as Awaited<ReturnType<typeof client.createClientFromConfig>>);
    const user = await fetchAuthUser();
    expect(user).toBeNull();
  });

  it("maps a populated whoami response into an AuthUser", async () => {
    vi.mocked(client.createClientFromConfig).mockResolvedValue({
      get: vi.fn().mockResolvedValue({
        email: "you@autousers.ai",
        teams: [
          { id: "t_personal", name: "Personal", isPersonal: true },
          { id: "t_acme", name: "Acme", isPersonal: false },
        ],
        activeTeamId: "t_acme",
        plan: "Free",
        usage: { freeQuota: { used: 18, limit: 30 } },
      }),
    } as unknown as Awaited<ReturnType<typeof client.createClientFromConfig>>);

    const user = await fetchAuthUser();
    expect(user).toEqual({
      email: "you@autousers.ai",
      teamName: "Acme",
      plan: "Free",
      freeRunsLeft: 12,
      freeRunsTotal: 30,
    });
  });
});

describe("startTuiLogin", () => {
  it("runs the OAuth flow and pushes the resolved user into the store", async () => {
    vi.mocked(oauth.loginWithBrowser).mockResolvedValue({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      clientId: "client-123",
    });
    vi.mocked(config.readConfig).mockResolvedValue({
      baseUrl: "https://app.autousers.ai",
    });
    vi.mocked(client.createClientFromConfig).mockResolvedValue({
      get: vi.fn().mockResolvedValue({
        email: "you@autousers.ai",
        teams: [{ id: "t1", name: "Acme", isPersonal: true }],
        activeTeamId: "t1",
        plan: "Free",
        usage: { freeQuota: { used: 0, limit: 30 } },
      }),
    } as unknown as Awaited<ReturnType<typeof client.createClientFromConfig>>);

    await startTuiLogin();

    // Must persist the rotated tokens.
    expect(config.writeConfig).toHaveBeenCalledTimes(1);
    const persisted = vi.mocked(config.writeConfig).mock.calls[0][0];
    expect(persisted.accessToken).toBe("at");
    expect(persisted.refreshToken).toBe("rt");
    expect(persisted.clientId).toBe("client-123");
    // Paste-mode key wiped on browser-mode login.
    expect(persisted.apiKey).toBeUndefined();

    // Store updated via fetchAuthUser → setAuthUser.
    expect(useTUIStore.getState().authUser).toEqual({
      email: "you@autousers.ai",
      teamName: "Acme",
      plan: "Free",
      freeRunsLeft: 30,
      freeRunsTotal: 30,
    });
  });

  it("propagates OAuth errors so the caller can render an inline banner", async () => {
    vi.mocked(oauth.loginWithBrowser).mockRejectedValue(
      new Error("user denied consent")
    );
    await expect(startTuiLogin()).rejects.toThrow("user denied consent");
    // Store stays signed-out on failure.
    expect(useTUIStore.getState().authUser).toBeNull();
  });

  it("requests the full read+write scope set so TUI write-actions don't 403", async () => {
    // Regression: pre-fix the TUI requested only `*:read` scopes, so every
    // post-login mutation (eval create, autouser edit, etc.) failed with
    // "Missing required scope: …:write". Lock the broader grant in.
    vi.mocked(oauth.loginWithBrowser).mockResolvedValue({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      clientId: "client-123",
    });
    vi.mocked(config.readConfig).mockResolvedValue({});
    vi.mocked(client.createClientFromConfig).mockResolvedValue({
      get: vi.fn().mockResolvedValue({}),
    } as unknown as Awaited<ReturnType<typeof client.createClientFromConfig>>);

    await startTuiLogin();

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
  });
});

describe("tuiLogout", () => {
  it("revokes server-side, wipes the config, and clears the store", async () => {
    // Pre-populate the store as signed-in so we can prove it gets reset.
    useTUIStore.getState().setAuthUser({
      email: "you@autousers.ai",
      teamName: "Acme",
    });

    vi.mocked(config.readConfig).mockResolvedValue({
      accessToken: "at",
      refreshToken: "rt",
      clientId: "client-123",
      baseUrl: "https://app.autousers.ai",
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(null, { status: 200 }) as unknown as Response
      );

    await tuiLogout();

    // Server-side revoke happened with the right shape.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://app.autousers.ai/oauth/revoke");
    expect((init as RequestInit).method).toBe("POST");
    const body = (init as RequestInit).body as string;
    expect(body).toContain("token=rt");
    expect(body).toContain("token_type_hint=refresh_token");
    expect(body).toContain("client_id=client-123");

    // Local config wiped (OAuth fields gone, apiKey gone).
    expect(config.writeConfig).toHaveBeenCalledTimes(1);
    const persisted = vi.mocked(config.writeConfig).mock.calls[0][0];
    expect(persisted.accessToken).toBeUndefined();
    expect(persisted.refreshToken).toBeUndefined();
    expect(persisted.clientId).toBeUndefined();
    expect(persisted.apiKey).toBeUndefined();
    // Non-credential fields preserved.
    expect(persisted.baseUrl).toBe("https://app.autousers.ai");

    // Store reset.
    expect(useTUIStore.getState().authUser).toBeNull();
  });

  it("still clears the store when the server-side revoke fails", async () => {
    useTUIStore.getState().setAuthUser({ email: "you@autousers.ai" });
    vi.mocked(config.readConfig).mockResolvedValue({
      accessToken: "at",
      refreshToken: "rt",
      clientId: "client-123",
    });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    await tuiLogout();

    expect(useTUIStore.getState().authUser).toBeNull();
    expect(config.writeConfig).toHaveBeenCalledTimes(1);
  });

  it("is a no-op revoke call when no refresh token is present", async () => {
    vi.mocked(config.readConfig).mockResolvedValue({ apiKey: "ak_live_x" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await tuiLogout();

    // No /oauth/revoke without a refresh token.
    expect(fetchSpy).not.toHaveBeenCalled();
    // Local creds still wiped.
    expect(config.writeConfig).toHaveBeenCalledTimes(1);
    const persisted = vi.mocked(config.writeConfig).mock.calls[0][0];
    expect(persisted.apiKey).toBeUndefined();
  });
});
