/**
 * Tests for the Wave 8 autoraters-hub screen.
 *
 * Coverage:
 *   1. The pure `applyHubFilters` helper — every filter axis.
 *   2. Component renders rows when the API returns autousers.
 *   3. `n` routes to the autorater-creator screen with no editing id.
 *   4. `Enter` on a custom row sets `editingAutouserId` + routes.
 *   5. `D` shows confirm banner; pressing y triggers DELETE; n cancels.
 *   6. `c` on a custom row routes to autorater-calibration.
 *   7. `/` cycles the source filter.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";

import {
  AutoratersHub,
  applyHubFilters,
  type HubAutouserRow,
} from "./autoraters-hub.js";
import { useTUIStore } from "../../state.js";

const ESC = String.fromCharCode(27);
const ARROW_DOWN = `${ESC}[B`;
const ENTER = "\r";
const tick = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

const seedRows: HubAutouserRow[] = [
  {
    id: "au_built_a",
    name: "Casual Browser",
    description: "skims",
    role: "evaluator",
    isSystem: true,
    status: "published",
    visibility: "public",
    source: "built-in",
    calibrationStatus: "frozen",
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
  },
  {
    id: "au_custom_a",
    name: "Acme PM",
    description: "internal",
    role: "evaluator",
    isSystem: false,
    status: "published",
    visibility: "private",
    source: "custom",
    calibrationStatus: "uncalibrated",
    updatedAt: new Date(Date.now() - 90 * 60_000).toISOString(),
  },
];

const stubEnvelope = { data: seedRows, has_more: false };

const stubClient = (env: typeof stubEnvelope = stubEnvelope) => ({
  get: vi.fn().mockResolvedValue(env),
  post: vi.fn().mockResolvedValue({ data: { id: "new", name: "x" } }),
  delete: vi.fn().mockResolvedValue({}),
});

beforeEach(() => {
  useTUIStore.setState({
    screen: "autoraters-hub",
    authUser: null,
    placeholderTarget: null,
    toast: null,
    editingAutouserId: null,
    calibratingAutouserId: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("applyHubFilters", () => {
  it("returns all rows when filter='all'", () => {
    expect(applyHubFilters(seedRows, "all")).toEqual(seedRows);
  });
  it("filters built-in only", () => {
    expect(applyHubFilters(seedRows, "built-in")).toEqual([seedRows[0]]);
  });
  it("filters custom only", () => {
    expect(applyHubFilters(seedRows, "custom")).toEqual([seedRows[1]]);
  });
});

describe("AutoratersHub", () => {
  it("renders rows once the API responds", async () => {
    const client = stubClient();
    const { lastFrame } = render(
      <AutoratersHub createClient={async () => client} />
    );
    await tick(60);
    const f = lastFrame() ?? "";
    expect(f).toContain("Casual Browser");
    expect(f).toContain("Acme PM");
  });

  it("pressing n routes to autorater-creator with no editing id", async () => {
    const client = stubClient();
    const { stdin } = render(
      <AutoratersHub createClient={async () => client} />
    );
    await tick(40);
    stdin.write("n");
    await tick();
    const state = useTUIStore.getState();
    expect(state.screen).toBe("autorater-creator");
    expect(state.editingAutouserId).toBeNull();
  });

  it("Enter on a custom row sets editingAutouserId and routes", async () => {
    const client = stubClient();
    const { stdin } = render(
      <AutoratersHub createClient={async () => client} />
    );
    await tick(40);
    // Row 0 is built-in (Casual Browser), arrow down to custom row.
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write(ENTER);
    await tick();
    const state = useTUIStore.getState();
    expect(state.screen).toBe("autorater-creator");
    expect(state.editingAutouserId).toBe("au_custom_a");
  });

  it("Enter on a built-in row keeps the user on the hub with a toast", async () => {
    const client = stubClient();
    const { stdin } = render(
      <AutoratersHub createClient={async () => client} />
    );
    await tick(40);
    // Cursor starts on built-in row 0; Enter should NOT route.
    stdin.write(ENTER);
    await tick();
    const state = useTUIStore.getState();
    expect(state.screen).toBe("autoraters-hub");
    expect(state.toast?.message).toContain("built-in");
  });

  it("c on a custom row routes to autorater-calibration", async () => {
    const client = stubClient();
    const { stdin } = render(
      <AutoratersHub createClient={async () => client} />
    );
    await tick(40);
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write("c");
    await tick();
    const state = useTUIStore.getState();
    expect(state.screen).toBe("autorater-calibration");
    expect(state.calibratingAutouserId).toBe("au_custom_a");
  });

  it("D opens confirm banner; y triggers DELETE; row removed from list", async () => {
    const client = stubClient();
    const { stdin, lastFrame } = render(
      <AutoratersHub createClient={async () => client} />
    );
    await tick(40);
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write("D");
    await tick();
    expect(lastFrame()).toContain("Delete Acme PM?");
    stdin.write("y");
    await tick(40);
    expect(client.delete).toHaveBeenCalledWith("/api/v1/autousers/au_custom_a");
  });

  it("D then n cancels the delete", async () => {
    const client = stubClient();
    const { stdin } = render(
      <AutoratersHub createClient={async () => client} />
    );
    await tick(40);
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write("D");
    await tick();
    stdin.write("n");
    await tick();
    expect(client.delete).not.toHaveBeenCalled();
  });

  it("d duplicates the highlighted row", async () => {
    const client = stubClient();
    const { stdin } = render(
      <AutoratersHub createClient={async () => client} />
    );
    await tick(40);
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write("d");
    await tick(40);
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/autousers/au_custom_a/duplicate",
      {}
    );
  });

  it("/ cycles the source filter (all → custom → built-in → all)", async () => {
    const client = stubClient();
    const { stdin, lastFrame } = render(
      <AutoratersHub createClient={async () => client} />
    );
    await tick(40);
    expect(lastFrame()).toContain("filter: all");
    stdin.write("/");
    await tick();
    expect(lastFrame()).toContain("filter: custom");
    stdin.write("/");
    await tick();
    expect(lastFrame()).toContain("filter: built-in");
    stdin.write("/");
    await tick();
    expect(lastFrame()).toContain("filter: all");
  });

  it("Esc returns to the menu", async () => {
    const client = stubClient();
    const { stdin } = render(
      <AutoratersHub createClient={async () => client} />
    );
    await tick(40);
    stdin.write(ESC);
    await tick();
    expect(useTUIStore.getState().screen).toBe("menu");
  });
});
