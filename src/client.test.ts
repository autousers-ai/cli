/**
 * Tests for `AutousersClient`'s refresh-on-401 path.
 *
 * Coverage:
 *   - Happy path: 401 → refresh succeeds → original request retries with
 *     the rotated bearer → returns 200.
 *   - Refresh failure: 401 → refresh returns 401 → throws
 *     `MissingApiKeyError` so the dispatcher prints the recovery hint.
 *   - In-flight dedupe: two concurrent requests both hit 401, only one
 *     `/oauth/token` round-trip occurs, both retry with the new bearer.
 *   - Paste-mode: no `refreshContext` → 401 throws `MissingApiKeyError`
 *     immediately (no refresh attempt).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AutousersClient } from "./client.js";
import { MissingApiKeyError } from "./errors.js";
import type { TokenSet } from "./oauth.js";

describe("AutousersClient — refresh-on-401", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("refreshes the access token on 401 and retries once", async () => {
    let persisted: TokenSet | null = null;
    const calls: { url: string; auth: string | null }[] = [];

    const fetchMock = vi.fn(
      async (input: string | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === "string" ? input : input.toString();
        const auth =
          (init?.headers as Record<string, string> | undefined)?.[
            "Authorization"
          ] ?? null;
        calls.push({ url, auth });

        if (url.includes("/oauth/token")) {
          return new Response(
            JSON.stringify({
              access_token: "new_access_jwt",
              refresh_token: "new_refresh_token",
              expires_in: 900,
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        // /api/v1/whoami — first call 401, subsequent calls 200.
        if (
          calls.filter((c) => c.url.endsWith("/api/v1/whoami")).length === 1
        ) {
          return new Response(
            JSON.stringify({ error: { message: "expired" } }),
            { status: 401, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(JSON.stringify({ ok: true, who: "ada" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new AutousersClient({
      bearer: "stale_jwt",
      baseUrl: "https://app.autousers.ai",
      refreshContext: {
        refreshToken: "old_refresh",
        clientId: "mcp_client_xyz",
        onRefresh: async (next) => {
          persisted = next;
        },
      },
    });

    const result = await client.get<{ ok: boolean; who: string }>(
      "/api/v1/whoami"
    );

    expect(result.who).toBe("ada");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // The retry must use the rotated bearer.
    const apiCalls = calls.filter((c) => c.url.endsWith("/api/v1/whoami"));
    expect(apiCalls).toHaveLength(2);
    expect(apiCalls[0]!.auth).toBe("Bearer stale_jwt");
    expect(apiCalls[1]!.auth).toBe("Bearer new_access_jwt");

    // The persistence callback was invoked with the rotated values.
    expect(persisted).not.toBeNull();
    expect(persisted!.accessToken).toBe("new_access_jwt");
    expect(persisted!.refreshToken).toBe("new_refresh_token");
    expect(persisted!.clientId).toBe("mcp_client_xyz");
  });

  it("throws MissingApiKeyError when refresh itself fails", async () => {
    const fetchMock = vi.fn(async (input: string | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/oauth/token")) {
        return new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: { message: "401" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new AutousersClient({
      bearer: "stale_jwt",
      baseUrl: "https://app.autousers.ai",
      refreshContext: {
        refreshToken: "dead_refresh",
        clientId: "mcp_client_xyz",
        onRefresh: vi.fn(),
      },
    });

    await expect(client.get("/api/v1/whoami")).rejects.toBeInstanceOf(
      MissingApiKeyError
    );
  });

  it("paste-mode (no refreshContext) throws MissingApiKeyError on 401", async () => {
    const fetchMock = vi.fn(
      async (): Promise<Response> =>
        new Response(JSON.stringify({ error: { message: "401" } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new AutousersClient({
      bearer: "ak_live_revoked",
      baseUrl: "https://app.autousers.ai",
    });

    await expect(client.get("/api/v1/whoami")).rejects.toBeInstanceOf(
      MissingApiKeyError
    );
    // No /oauth/token call — paste-mode shouldn't try to refresh.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent refreshes via in-flight Promise", async () => {
    // Two parallel requests both hit 401 simultaneously; only one
    // `/oauth/token` round-trip should occur even though both stale
    // requests need a refresh.
    const calls: { url: string }[] = [];
    let tokenCallCount = 0;

    const fetchMock = vi.fn(async (input: string | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url });

      if (url.includes("/oauth/token")) {
        tokenCallCount += 1;
        return new Response(
          JSON.stringify({
            access_token: "rotated_jwt",
            refresh_token: "rotated_refresh",
            expires_in: 900,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      // First two API calls (the two parallel ones) fail with 401.
      const apiCalls = calls.filter((c) => c.url.includes("/api/v1/")).length;
      if (apiCalls <= 2) {
        return new Response(JSON.stringify({ error: { message: "expired" } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new AutousersClient({
      bearer: "stale_jwt",
      baseUrl: "https://app.autousers.ai",
      refreshContext: {
        refreshToken: "old_refresh",
        clientId: "mcp_client_xyz",
        onRefresh: vi.fn(),
      },
    });

    const [a, b] = await Promise.all([
      client.get("/api/v1/whoami"),
      client.get("/api/v1/usage"),
    ]);

    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    // CRITICAL: only ONE token rotation, not two.
    expect(tokenCallCount).toBe(1);
  });
});

describe("AutousersClient — basic auth header", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("attaches Bearer auth header on every call", async () => {
    let capturedAuth: string | null = null;

    const fetchMock = vi.fn(
      async (_input: string | URL, init?: RequestInit): Promise<Response> => {
        capturedAuth =
          (init?.headers as Record<string, string> | undefined)?.[
            "Authorization"
          ] ?? null;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new AutousersClient({
      bearer: "ak_live_test",
      baseUrl: "https://app.autousers.ai",
    });
    await client.get("/api/v1/whoami");

    expect(capturedAuth).toBe("Bearer ak_live_test");
  });

  it("throws MissingApiKeyError if constructed with empty bearer", () => {
    expect(
      () =>
        new AutousersClient({
          bearer: "",
          baseUrl: "https://app.autousers.ai",
        })
    ).toThrow(MissingApiKeyError);
  });
});
