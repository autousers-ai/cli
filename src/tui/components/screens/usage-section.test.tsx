/**
 * Tests for the Usage section screen — the terminal mirror of
 * `/settings/usage`. Mocks the API client so the screen never touches a
 * real fetch, asserts the progress bar renders against deterministic
 * counts, and exercises the range hotkeys + Esc-back-to-Settings flow.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";

import { UsageSection, type UsageResponse } from "./usage-section.js";
import { useTUIStore } from "../../state.js";

const ESC = String.fromCharCode(27);
const tick = (ms = 40) => new Promise<void>((r) => setTimeout(r, ms));

/** Build a deterministic `UsageResponse` for a given range. */
function makeUsage(range: UsageResponse["range"] = "30d"): UsageResponse {
  // Daily series — one entry per day in the window. Costs vary so the
  // sparkline has actual contour rather than a flat line.
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  const daily = Array.from({ length: days }).map((_, i) => ({
    date: `2026-04-${String((i % 28) + 1).padStart(2, "0")}`,
    runs: i % 3,
    tokens: i * 100,
    costUsd: i === 0 ? 0 : Number((0.001 * (i + 1)).toFixed(6)),
  }));
  return {
    range,
    byok: false,
    byokConfigured: false,
    freeQuota: { used: 8, limit: 30 },
    totals: {
      runs: 12,
      inputTokens: 5_000,
      outputTokens: 3_500,
      costUsd: 0.4321,
      evaluations: 4,
      autousersUsed: 2,
    },
    byEval: [
      {
        evaluationId: "e1",
        evaluationName: "Checkout flow audit",
        runs: 5,
        tokens: 4000,
        costUsd: 0.2,
      },
      {
        evaluationId: "e2",
        evaluationName: "Pricing page",
        runs: 3,
        tokens: 2000,
        costUsd: 0.12,
      },
    ],
    daily,
    perRun: { medianCost: 0.03, meanCost: 0.04, medianTokens: 700 },
  };
}

const stubClient = () => {
  const get = vi.fn().mockImplementation(async (url: string) => {
    if (url.startsWith("/api/v1/usage")) {
      const m = /range=(7d|30d|90d)/.exec(url);
      const range = (m?.[1] ?? "30d") as UsageResponse["range"];
      return makeUsage(range);
    }
    return null;
  });
  return { get };
};

beforeEach(() => {
  useTUIStore.setState({
    screen: "usage-section",
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

describe("UsageSection", () => {
  it("renders the free-quota progress bar with the right counts on mount", async () => {
    const client = stubClient();
    const { lastFrame } = render(
      <UsageSection createClient={async () => client} />
    );
    await tick(80);

    const f = lastFrame() ?? "";
    // Header
    expect(f).toContain("Usage");
    // Progress bar exists and shows the labelled count.
    expect(f).toContain("8 / 30 free runs used");
    expect(f).toMatch(/\[█+░+\]/);
    // First fetch hits the default 30d range.
    expect(client.get).toHaveBeenCalledWith("/api/v1/usage?range=30d");
  });

  it("renders the cost summary, sparkline, and top evaluations", async () => {
    const client = stubClient();
    const { lastFrame } = render(
      <UsageSection createClient={async () => client} />
    );
    await tick(80);

    const f = lastFrame() ?? "";
    expect(f).toContain("Total:");
    expect(f).toContain("$0.43");
    expect(f).toContain("Runs: 12");
    expect(f).toContain("Top evaluations by cost");
    expect(f).toContain("Checkout flow audit");
    expect(f).toContain("Pricing page");
  });

  it("pressing 7 refetches with ?range=7d", async () => {
    const client = stubClient();
    const { stdin } = render(
      <UsageSection createClient={async () => client} />
    );
    await tick(80);
    expect(client.get).toHaveBeenCalledWith("/api/v1/usage?range=30d");

    stdin.write("7");
    await tick(80);
    expect(client.get).toHaveBeenCalledWith("/api/v1/usage?range=7d");
  });

  it("Esc returns to the settings screen via the state store", async () => {
    const client = stubClient();
    const { stdin } = render(
      <UsageSection createClient={async () => client} />
    );
    await tick(80);
    stdin.write(ESC);
    await tick();
    expect(useTUIStore.getState().screen).toBe("settings");
  });
});
