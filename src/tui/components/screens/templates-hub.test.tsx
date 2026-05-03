/**
 * Tests for the Wave 9 templates-hub screen. Mirrors the autoraters-hub
 * test surface — list rendering, key-driven routing, delete + duplicate
 * flows, and the source-filter cycle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";

import {
  TemplatesHub,
  applyTemplateFilters,
  type HubTemplateRow,
} from "./templates-hub.js";
import { useTUIStore } from "../../state.js";

const ESC = String.fromCharCode(27);
const ARROW_DOWN = `${ESC}[B`;
const ENTER = "\r";
const tick = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

const seedRows: HubTemplateRow[] = [
  {
    id: "dim_built_a",
    name: "First impression",
    description: "Built-in",
    type: "TEXT_SSE",
    scaleType: "SEVEN_POINT",
    isSystem: true,
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
  },
  {
    id: "dim_custom_a",
    name: "Acme trust signals",
    description: "internal",
    type: "TEXT_SSE",
    scaleType: "FIVE_POINT",
    isSystem: false,
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
    screen: "templates-hub",
    authUser: null,
    placeholderTarget: null,
    toast: null,
    editingTemplateId: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("applyTemplateFilters", () => {
  it("returns all rows when filter='all'", () => {
    expect(applyTemplateFilters(seedRows, "all")).toEqual(seedRows);
  });
  it("filters built-in only", () => {
    expect(applyTemplateFilters(seedRows, "built-in")).toEqual([seedRows[0]]);
  });
  it("filters custom only", () => {
    expect(applyTemplateFilters(seedRows, "custom")).toEqual([seedRows[1]]);
  });
});

describe("TemplatesHub", () => {
  it("renders rows once the API responds", async () => {
    const client = stubClient();
    const { lastFrame } = render(
      <TemplatesHub createClient={async () => client} />
    );
    await tick(60);
    const f = lastFrame() ?? "";
    expect(f).toContain("First impression");
    expect(f).toContain("Acme trust signals");
  });

  it("pressing n routes to template-creator with no editing id", async () => {
    const client = stubClient();
    const { stdin } = render(
      <TemplatesHub createClient={async () => client} />
    );
    await tick(40);
    stdin.write("n");
    await tick();
    const state = useTUIStore.getState();
    expect(state.screen).toBe("template-creator");
    expect(state.editingTemplateId).toBeNull();
  });

  it("Enter on a custom row sets editingTemplateId and routes", async () => {
    const client = stubClient();
    const { stdin } = render(
      <TemplatesHub createClient={async () => client} />
    );
    await tick(40);
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write(ENTER);
    await tick();
    const state = useTUIStore.getState();
    expect(state.screen).toBe("template-creator");
    expect(state.editingTemplateId).toBe("dim_custom_a");
  });

  it("Enter on a built-in row keeps the user on the hub with a toast", async () => {
    const client = stubClient();
    const { stdin } = render(
      <TemplatesHub createClient={async () => client} />
    );
    await tick(40);
    stdin.write(ENTER);
    await tick();
    const state = useTUIStore.getState();
    expect(state.screen).toBe("templates-hub");
    expect(state.toast?.message).toContain("built-in");
  });

  it("d duplicates the highlighted row", async () => {
    const client = stubClient();
    const { stdin } = render(
      <TemplatesHub createClient={async () => client} />
    );
    await tick(40);
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write("d");
    await tick(40);
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/templates/dim_custom_a/duplicate",
      {}
    );
  });

  it("D opens confirm banner; y triggers DELETE", async () => {
    const client = stubClient();
    const { stdin, lastFrame } = render(
      <TemplatesHub createClient={async () => client} />
    );
    await tick(40);
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write("D");
    await tick();
    expect(lastFrame()).toContain("Delete Acme trust signals?");
    stdin.write("y");
    await tick(40);
    expect(client.delete).toHaveBeenCalledWith(
      "/api/v1/templates/dim_custom_a"
    );
  });

  it("/ cycles the source filter (all → custom → built-in → all)", async () => {
    const client = stubClient();
    const { stdin, lastFrame } = render(
      <TemplatesHub createClient={async () => client} />
    );
    await tick(40);
    expect(lastFrame()).toContain("filter: all");
    stdin.write("/");
    await tick();
    expect(lastFrame()).toContain("filter: custom");
    stdin.write("/");
    await tick();
    expect(lastFrame()).toContain("filter: built-in");
  });

  it("Esc returns to the menu", async () => {
    const client = stubClient();
    const { stdin } = render(
      <TemplatesHub createClient={async () => client} />
    );
    await tick(40);
    stdin.write(ESC);
    await tick();
    expect(useTUIStore.getState().screen).toBe("menu");
  });
});
