/**
 * Tests for the Wave 7 eval-history screen.
 *
 * Coverage:
 *   1. The pure `applyHistoryFilters` helper — every filter axis +
 *      sort order, since this is the deterministic backbone of the list.
 *   2. The component renders the filter bar + a row per evaluation when
 *      seeded with a stub client returning a small list.
 *   3. Down-arrow navigation moves the selection caret.
 *   4. Pressing Enter on a row sets `selectedEvalId` and routes to
 *      `eval-results-by-id`.
 *   5. Pressing `s` opens the share modal; `Esc` closes it.
 *   6. Pressing `c` cycles the sort order.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";

import {
  EvalHistory,
  applyHistoryFilters,
  type EvalRow,
} from "./eval-history.js";
import { useTUIStore } from "../../state.js";

const ESC = String.fromCharCode(27);
const ARROW_DOWN = `${ESC}[B`;
const ENTER = "\r";
const tick = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

// Polls a predicate (e.g. asserting on the rendered frame) until it
// returns true, or `timeoutMs` elapses. Replaces fixed `await tick(...)`
// waits that race the post-keystroke async chain under concurrent
// vitest load.
async function waitFor(predicate: () => boolean, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  if (!predicate()) {
    throw new Error(
      `waitFor: predicate did not become true within ${timeoutMs}ms`
    );
  }
}

const seedRows: EvalRow[] = [
  {
    id: "e1",
    name: "Acme landing page",
    type: "SSE",
    status: "Ended",
    ratingsCount: 12,
    comparisonsCount: 3,
    createdAt: new Date(Date.now() - 1 * 86_400_000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 86_400_000).toISOString(),
    ownerLabel: "alice@example.com",
    totalCost: 0.42,
  },
  {
    id: "e2",
    name: "Beta checkout flow",
    type: "SxS",
    status: "Running",
    ratingsCount: 4,
    comparisonsCount: 2,
    createdAt: new Date(Date.now() - 60 * 86_400_000).toISOString(),
    updatedAt: new Date(Date.now() - 60 * 86_400_000).toISOString(),
    ownerLabel: "bob@example.com",
    totalCost: 1.5,
  },
  {
    id: "e3",
    name: "Gamma onboarding",
    type: "SSE",
    status: "Draft",
    ratingsCount: 0,
    comparisonsCount: 1,
    createdAt: new Date(Date.now() - 100 * 86_400_000).toISOString(),
    updatedAt: new Date(Date.now() - 100 * 86_400_000).toISOString(),
    ownerLabel: "alice@example.com",
    totalCost: 0,
  },
];

const stubEnvelope = {
  data: seedRows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    status: r.status,
    ratingsCount: r.ratingsCount,
    comparisonsCount: r.comparisonsCount,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    metadata: { totalCost: r.totalCost },
    owner: { email: r.ownerLabel },
  })),
  has_more: false,
};

const stubClient = (env: typeof stubEnvelope = stubEnvelope) => ({
  get: vi.fn().mockResolvedValue(env),
});

beforeEach(() => {
  useTUIStore.setState({
    screen: "eval-history",
    authUser: null,
    placeholderTarget: null,
    toast: null,
    selectedEvalId: null,
    historyQuery: "",
    historyFilters: { status: null, type: null, range: "all", owner: null },
    historySort: "created-desc",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("applyHistoryFilters", () => {
  it("filters by name substring (case-insensitive)", () => {
    const out = applyHistoryFilters(
      seedRows,
      "ACME",
      { status: null, type: null, range: "all", owner: null },
      "created-desc"
    );
    expect(out.map((r) => r.id)).toEqual(["e1"]);
  });

  it("filters by status / type / owner", () => {
    const status = applyHistoryFilters(
      seedRows,
      "",
      { status: "Draft", type: null, range: "all", owner: null },
      "created-desc"
    );
    expect(status.map((r) => r.id)).toEqual(["e3"]);

    const type = applyHistoryFilters(
      seedRows,
      "",
      { status: null, type: "SxS", range: "all", owner: null },
      "created-desc"
    );
    expect(type.map((r) => r.id)).toEqual(["e2"]);

    const owner = applyHistoryFilters(
      seedRows,
      "",
      { status: null, type: null, range: "all", owner: "alice" },
      "created-desc"
    );
    expect(owner.map((r) => r.id).sort()).toEqual(["e1", "e3"]);
  });

  it("filters by date range", () => {
    const out = applyHistoryFilters(
      seedRows,
      "",
      { status: null, type: null, range: "30d", owner: null },
      "created-desc"
    );
    expect(out.map((r) => r.id)).toEqual(["e1"]);
  });

  it("sorts by name and by cost-desc", () => {
    const byName = applyHistoryFilters(
      seedRows,
      "",
      { status: null, type: null, range: "all", owner: null },
      "name"
    );
    expect(byName.map((r) => r.name)).toEqual([
      "Acme landing page",
      "Beta checkout flow",
      "Gamma onboarding",
    ]);

    const byCost = applyHistoryFilters(
      seedRows,
      "",
      { status: null, type: null, range: "all", owner: null },
      "cost-desc"
    );
    expect(byCost[0]!.id).toBe("e2"); // 1.50
    expect(byCost[2]!.id).toBe("e3"); // 0
  });
});

describe("<EvalHistory>", () => {
  it("renders the filter bar and a row per evaluation", async () => {
    const client = stubClient();
    const { lastFrame } = render(
      <EvalHistory createClient={async () => client} />
    );
    await tick(50);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Browse evaluations");
    expect(frame).toContain("Filters");
    expect(frame).toContain("Acme landing page");
    expect(frame).toContain("Beta checkout flow");
    expect(frame).toContain("Gamma onboarding");
    // Row chrome shows status + type
    expect(frame).toContain("SSE");
    expect(frame).toContain("SxS");
  });

  it("moves selection on the down arrow", async () => {
    const client = stubClient();
    const { stdin, lastFrame } = render(
      <EvalHistory createClient={async () => client} />
    );
    await tick(50);
    stdin.write(ARROW_DOWN);
    await tick();
    const frame = lastFrame() ?? "";
    // Second row in default created-desc order is e1 (1d ago)
    // because seedRows[1] (e2) is 60d, seedRows[0] (e1) is 1d, seedRows[2]
    // is 100d. Sorted desc: e1 → e2 → e3. Down once = e2 highlighted.
    expect(frame).toMatch(/>\s+Beta checkout flow/);
  });

  it("Enter on a row sets selectedEvalId + routes to results-by-id", async () => {
    const client = stubClient();
    const { stdin } = render(<EvalHistory createClient={async () => client} />);
    await tick(50);
    stdin.write(ENTER);
    await tick();
    const state = useTUIStore.getState();
    expect(state.selectedEvalId).toBe("e1");
    expect(state.screen).toBe("eval-results-by-id");
  });

  it("Esc routes back to the menu", async () => {
    const client = stubClient();
    const { stdin } = render(<EvalHistory createClient={async () => client} />);
    await tick(50);
    stdin.write(ESC);
    await tick();
    expect(useTUIStore.getState().screen).toBe("menu");
  });

  it("`c` cycles the sort order", async () => {
    const client = stubClient();
    const { stdin } = render(<EvalHistory createClient={async () => client} />);
    await tick(50);
    stdin.write("c");
    await tick();
    expect(useTUIStore.getState().historySort).toBe("name");
    stdin.write("c");
    await tick();
    expect(useTUIStore.getState().historySort).toBe("cost-desc");
    stdin.write("c");
    await tick();
    expect(useTUIStore.getState().historySort).toBe("created-desc");
  });

  it("`s` opens the share modal and Esc closes it", async () => {
    const client = stubClient();
    const { stdin, lastFrame } = render(
      <EvalHistory createClient={async () => client} />
    );
    await tick(50);
    stdin.write("s");
    await tick();
    let frame = lastFrame() ?? "";
    expect(frame).toContain("Share evaluation");
    expect(frame).toContain("Acme landing page");
    // Close it
    stdin.write(ESC);
    await waitFor(() => !(lastFrame() ?? "").includes("Share evaluation —"));
    frame = lastFrame() ?? "";
    // Modal title should be gone
    expect(frame).not.toContain("Share evaluation —");
  });

  it("renders an empty-state hint when no rows match", async () => {
    const client = stubClient({ data: [], has_more: false });
    const { lastFrame } = render(
      <EvalHistory createClient={async () => client} />
    );
    await tick(50);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("No evaluations yet");
  });
});
