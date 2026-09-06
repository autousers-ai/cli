/**
 * Tests for the OAuth browser-flow orchestrator.
 *
 * Coverage:
 *   - PKCE pair: verifier produces a challenge that round-trips through
 *     SHA-256 + base64url decode equal to the verifier.
 *   - State token: 32 hex characters, distinct between calls.
 *   - openUrl: spawns the platform-appropriate command without throwing.
 *   - Callback server: kernel-assigned port; resolves on a valid
 *     code+state hit; rejects on state mismatch; closes after first hit.
 *   - loginWithBrowser end-to-end: mocks fetch for /oauth/register and
 *     /oauth/token, drives a real loopback server.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

import { OAuthError } from "./errors.js";
import {
  generatePkcePair,
  generateState,
  loginWithBrowser,
  openUrl,
  startCallbackServer,
} from "./oauth.js";

describe("PKCE generation", () => {
  it("produces a verifier whose SHA-256 base64url equals the challenge", () => {
    const { verifier, challenge } = generatePkcePair();

    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    // base64url(32 bytes) = 43 chars (no padding, RFC 7636 §4.1 minimum)
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);

    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(expected);
  });

  it("returns a fresh pair on every call", () => {
    const a = generatePkcePair();
    const b = generatePkcePair();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
  });
});

describe("state generation", () => {
  it("returns 32 hex characters", () => {
    const s = generateState();
    expect(s).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is distinct between calls (CSPRNG sanity)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(generateState());
    expect(seen.size).toBe(50);
  });
});

describe("openUrl", () => {
  it("does not throw and is a no-op under VITEST (no Chrome tab)", () => {
    // openUrl short-circuits when process.env.VITEST is set, which vitest
    // populates automatically. We just verify it's safe to call.
    expect(process.env.VITEST).toBeTruthy();
    expect(() => openUrl("https://example.invalid/")).not.toThrow();
  });
});

describe("startCallbackServer", () => {
  it("binds to an ephemeral 127.0.0.1 port and resolves on a valid callback", async () => {
    const expectedState = "abc123";
    const { server, port, result } = await startCallbackServer(expectedState);

    try {
      expect(port).toBeGreaterThan(0);

      // Hit the callback in parallel with the result-await.
      const fetched = fetch(
        `http://127.0.0.1:${port}/callback?code=THE_CODE&state=${expectedState}`
      );

      const callbackResult = await result;
      const res = await fetched;

      expect(callbackResult.code).toBe("THE_CODE");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("logged in");
    } finally {
      if (server.listening) server.close();
    }
  });

  it("rejects on state mismatch (CSRF defence)", async () => {
    const { server, port, result } = await startCallbackServer("expected");
    // Attach the rejection handler BEFORE issuing the fetch so the promise
    // can't be flagged as an unhandled rejection.
    const assertion = expect(result).rejects.toBeInstanceOf(OAuthError);

    try {
      await fetch(`http://127.0.0.1:${port}/callback?code=X&state=different`);
      await assertion;
    } finally {
      if (server.listening) server.close();
    }
  });

  it("rejects when the AS bounces back ?error=...", async () => {
    const { server, port, result } = await startCallbackServer("s");
    const assertion = expect(result).rejects.toMatchObject({
      message: expect.stringContaining("access_denied"),
    });

    try {
      await fetch(
        `http://127.0.0.1:${port}/callback?error=access_denied&error_description=user%20rejected&state=s`
      );
      await assertion;
    } finally {
      if (server.listening) server.close();
    }
  });
});

describe("loginWithBrowser", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("orchestrates DCR + callback + token exchange end-to-end", async () => {
    // The test drives the callback in response to the /oauth/register
    // mock firing — that's the moment we know the loopback server is
    // listening on a port we can reach. We extract the state from the
    // outbound /oauth/authorize URL by sniffing the openUrl path; we
    // pass `openBrowser: false` so the orchestrator instead logs the
    // URL — and we read it off the log sink.

    let capturedAuthorizeUrl: string | null = null;
    const realFetch = originalFetch.bind(globalThis);

    fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/oauth/register")) {
        const body = JSON.parse(init?.body as string) as {
          redirect_uris: string[];
        };
        const redirectUri = body.redirect_uris[0] ?? "";

        // Schedule the callback fetch for AFTER the orchestrator has
        // returned from registerClient, built the authorize URL, and
        // started awaiting the callback Promise. `setImmediate` queues
        // a microtask after the current call stack unwinds.
        setImmediate(() => {
          // The authorize URL captured by `log` will contain the state.
          const driveCallback = (): void => {
            if (!capturedAuthorizeUrl) {
              setImmediate(driveCallback);
              return;
            }
            const u = new URL(capturedAuthorizeUrl);
            const state = u.searchParams.get("state") ?? "";
            const cbUrl = `${redirectUri}?code=THE_CODE&state=${state}`;
            // Use the REAL fetch (not the mock) so the loopback server
            // actually receives the GET.
            void realFetch(cbUrl);
          };
          driveCallback();
        });

        return new Response(
          JSON.stringify({
            client_id: "mcp_client_test123",
            redirect_uris: body.redirect_uris,
            client_name: "Autousers CLI",
          }),
          { status: 201, headers: { "content-type": "application/json" } }
        );
      }

      if (url.endsWith("/oauth/token")) {
        const text =
          typeof init?.body === "string"
            ? init.body
            : (init?.body ?? "").toString();
        expect(text).toContain("grant_type=authorization_code");
        expect(text).toContain("code=THE_CODE");
        expect(text).toContain("client_id=mcp_client_test123");
        return new Response(
          JSON.stringify({
            access_token: "jwt.access.token",
            refresh_token: "rt_secret_value",
            expires_in: 900,
            token_type: "Bearer",
            scope: "evaluations:read",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Capture the authorize URL the orchestrator logs — it contains the
    // state token we need to drive the callback successfully.
    const log = (m: string): void => {
      const match = m.match(/(http[^\s]+)/);
      if (match && match[1]?.includes("/oauth/authorize")) {
        capturedAuthorizeUrl = match[1];
      }
    };

    const tokens = await loginWithBrowser({
      baseUrl: "http://localhost:3000",
      // Mirror the full first-party scope set the CLI ships with so this
      // end-to-end test also exercises the multi-scope serialisation path
      // (space-joined on the wire, registered verbatim in DCR).
      scopes: [
        "evaluations:read",
        "evaluations:write",
        "templates:read",
        "templates:write",
        "autousers:read",
        "autousers:write",
        "ratings:read",
        "ratings:write",
      ],
      openBrowser: false,
      log,
    });

    expect(tokens.accessToken).toBe("jwt.access.token");
    expect(tokens.refreshToken).toBe("rt_secret_value");
    expect(tokens.clientId).toBe("mcp_client_test123");
    expect(new Date(tokens.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // Sanity check: register + token were both called.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The /oauth/register POST body MUST include all 8 scopes space-joined,
    // and the /oauth/authorize URL MUST repeat them verbatim — the server
    // gates the issued JWT's `scope` claim on what was registered AND what
    // the user consented to, so missing one anywhere becomes a 403 later.
    const registerCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).endsWith("/oauth/register")
    );
    expect(registerCall).toBeDefined();
    const registerBody = JSON.parse(
      (registerCall![1] as RequestInit).body as string
    ) as { scope?: string };
    expect(registerBody.scope).toBe(
      "evaluations:read evaluations:write templates:read templates:write autousers:read autousers:write ratings:read ratings:write"
    );
    expect(capturedAuthorizeUrl).toBeTruthy();
    const authorizeUrl = new URL(capturedAuthorizeUrl!);
    expect(authorizeUrl.searchParams.get("scope")).toBe(registerBody.scope);
  });

  it("rejects when DCR returns an error envelope", async () => {
    fetchMock = vi.fn(async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/oauth/register")) {
        return new Response(
          JSON.stringify({
            error: "invalid_redirect_uri",
            error_description: "redirect_uris must be https://...",
          }),
          { status: 400, headers: { "content-type": "application/json" } }
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      loginWithBrowser({
        baseUrl: "http://localhost:3000",
        scopes: ["evaluations:read"],
        openBrowser: false,
        log: () => undefined,
      })
    ).rejects.toBeInstanceOf(OAuthError);
  });
});
