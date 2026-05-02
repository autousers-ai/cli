/**
 * Tests for the Wave 9 teams-section screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";

import { TeamsSection } from "./teams-section.js";
import { useTUIStore } from "../../state.js";

const ESC = String.fromCharCode(27);
const ARROW_DOWN = `${ESC}[B`;
const ENTER = "\r";
const tick = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

const stubClient = () => ({
  get: vi.fn().mockResolvedValue({
    data: [
      {
        id: "team_personal",
        name: "Personal",
        description: null,
        isPersonal: true,
        memberCount: 1,
        userRole: "Owner",
        slug: "personal",
      },
      {
        id: "team_acme",
        name: "Acme",
        description: "shared",
        isPersonal: false,
        memberCount: 4,
        userRole: "Admin",
        slug: "acme",
      },
    ],
  }),
  post: vi.fn().mockResolvedValue({ data: null }),
  delete: vi.fn(),
});

beforeEach(() => {
  useTUIStore.setState({
    screen: "teams-section",
    authUser: null,
    placeholderTarget: null,
    toast: null,
    activeTeamSlug: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TeamsSection", () => {
  it("renders a row per team", async () => {
    const client = stubClient();
    const { lastFrame } = render(
      <TeamsSection
        createClient={async () => client}
        persistActiveTeam={async () => undefined}
      />
    );
    await tick(60);
    const f = lastFrame() ?? "";
    expect(f).toContain("Personal");
    expect(f).toContain("Acme");
    expect(f).toContain("Owner");
  });

  it("Enter sets the cursor row as active and persists the slug", async () => {
    const client = stubClient();
    const persist = vi.fn().mockResolvedValue(undefined);
    const { stdin } = render(
      <TeamsSection
        createClient={async () => client}
        persistActiveTeam={persist}
      />
    );
    await tick(60);
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write(ENTER);
    await tick(40);
    expect(persist).toHaveBeenCalledWith("acme");
    expect(useTUIStore.getState().activeTeamSlug).toBe("acme");
  });

  it("`l` triggers POST .../leave on the highlighted team", async () => {
    const client = stubClient();
    const { stdin } = render(
      <TeamsSection
        createClient={async () => client}
        persistActiveTeam={async () => undefined}
      />
    );
    await tick(60);
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write("l");
    await tick(40);
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/teams/team_acme/leave",
      {}
    );
  });

  it("Esc returns to settings", async () => {
    const client = stubClient();
    const { stdin } = render(
      <TeamsSection
        createClient={async () => client}
        persistActiveTeam={async () => undefined}
      />
    );
    await tick(60);
    stdin.write(ESC);
    await tick();
    expect(useTUIStore.getState().screen).toBe("settings");
  });
});
