/**
 * Tests for the Connected apps section screen.
 *
 * Mirrors the assertions in `teams-section.test.tsx` so the two
 * settings sub-screens stay covered the same way:
 *   1. Renders one row per grant with name + scopes
 *   2. `R` then `y` triggers DELETE on the highlighted grant
 *   3. `R` then `n` cancels the prompt without calling DELETE
 *   4. ESC returns the user to the Settings screen via the store
 *   5. Empty list renders the "Authorise via /help/mcp" copy
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";

import { ConnectedAppsSection } from "./connected-apps-section.js";
import { useTUIStore } from "../../state.js";

const ESC = String.fromCharCode(27);
const tick = (ms = 40) => new Promise<void>((r) => setTimeout(r, ms));

const APPS = [
  {
    clientId: "mcp_client_abc123",
    clientName: "Claude.ai",
    isCimd: false,
    scopes: ["evaluations:read", "templates:read"],
    grantedAt: new Date(Date.now() - 2 * 86400 * 1000).toISOString(),
    lastUsedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    refreshTokenCount: 1,
    hasNoActiveSessions: false,
  },
  {
    clientId: "https://example.com/oauth/cb",
    clientName: "Example Host",
    isCimd: true,
    scopes: ["autousers:read"],
    grantedAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    lastUsedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    refreshTokenCount: 2,
    hasNoActiveSessions: false,
  },
];

const stubClient = (apps = APPS) => ({
  get: vi.fn().mockResolvedValue({ data: apps }),
  post: vi.fn(),
  delete: vi.fn().mockResolvedValue({
    revoked: { refreshTokenCount: 1, consentCount: 1 },
  }),
});

beforeEach(() => {
  useTUIStore.setState({
    screen: "connected-apps-section",
    authUser: null,
    placeholderTarget: null,
    toast: null,
    activeTeamSlug: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ConnectedAppsSection", () => {
  it("renders a row per grant with name + scopes", async () => {
    const client = stubClient();
    const { lastFrame } = render(
      <ConnectedAppsSection createClient={async () => client} />
    );
    await tick(60);
    const f = lastFrame() ?? "";
    expect(f).toContain("Connected apps");
    expect(f).toContain("Claude.ai");
    expect(f).toContain("Example Host");
    expect(f).toContain("evaluations:read");
    expect(f).toContain("autousers:read");
    expect(client.get).toHaveBeenCalledWith("/api/v1/oauth/connected-apps");
  });

  it("`R` then `y` issues DELETE for the highlighted grant", async () => {
    const client = stubClient();
    const { stdin } = render(
      <ConnectedAppsSection createClient={async () => client} />
    );
    await tick(60);
    stdin.write("R");
    await tick();
    stdin.write("y");
    await tick(60);
    expect(client.delete).toHaveBeenCalledTimes(1);
    expect(client.delete).toHaveBeenCalledWith(
      `/api/v1/oauth/connected-apps?client_id=${encodeURIComponent(
        APPS[0]!.clientId
      )}`
    );
  });

  it("`R` then `n` cancels and does NOT call DELETE", async () => {
    const client = stubClient();
    const { stdin, lastFrame } = render(
      <ConnectedAppsSection createClient={async () => client} />
    );
    await tick(60);
    stdin.write("R");
    await tick();
    expect(lastFrame() ?? "").toContain("Revoke Claude.ai?");
    stdin.write("n");
    await tick(40);
    expect(client.delete).not.toHaveBeenCalled();
  });

  it("ESC returns to the Settings screen", async () => {
    const client = stubClient();
    const { stdin } = render(
      <ConnectedAppsSection createClient={async () => client} />
    );
    await tick(60);
    stdin.write(ESC);
    await tick();
    expect(useTUIStore.getState().screen).toBe("settings");
  });

  it("renders the empty-state copy when there are no grants", async () => {
    const client = stubClient([]);
    const { lastFrame } = render(
      <ConnectedAppsSection createClient={async () => client} />
    );
    await tick(60);
    const f = lastFrame() ?? "";
    expect(f).toContain(
      "No connected apps. Authorise via /help/mcp on the web."
    );
  });
});
