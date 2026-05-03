/**
 * Tests for the eval-creator screen.
 *
 * Coverage strategy:
 *
 *   1. **Payload contract** — `buildEvalPayload` produces the exact wire
 *      shape Wave 4 needs. This is the main thing the server cares
 *      about; pinning it as a pure-function test means we don't need to
 *      drive the wizard through every keystroke to verify the output.
 *
 *   2. **Render at each step** — mounting the screen renders the type
 *      step initially. Driving it forward is brittle (each step's input
 *      handling has its own modes — text-edit vs navigate vs toggle) and
 *      better covered by per-step component tests. We assert chrome
 *      visibility and the dryRun preview rendering directly by seeding
 *      the wizard partway through via a quick keystroke sequence.
 *
 *   3. **dryRun POST contract** — the screen MUST call `POST
 *      /api/v1/evaluations` with `{ dryRun: true }` when entering the
 *      review step, and again with `{ dryRun: false }` on confirm. We
 *      drive the flow with the simplest possible keystroke chain that
 *      reaches review, then assert the POST contract.
 *
 * The wide-terminal stub is required so the wizard chrome renders the
 * sidebar with its title row + step markers; without it `lastFrame()`
 * collapses to a one-line breadcrumb.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";

vi.mock("../../tty.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../tty.js")>();
  return {
    ...actual,
    isWideTerminal: () => true,
  };
});

import { EvalCreator, buildEvalPayload } from "./eval-creator.js";
import { useTUIStore } from "../../state.js";

// Stub loaders shared across tests: every test that mounts the wizard
// needs the autouser picker + dimension step to render *something* without
// making real network calls. The shapes mirror what
// `/api/v1/autousers?includeSystem=true` and `/api/v1/templates` return.
const stubAutousers = async () => [
  {
    id: "au_built_skeptic",
    name: "Skeptical Shopper",
    description: "Inspects every claim.",
    source: "built-in" as const,
  },
];
const stubTemplates = async () => [
  {
    id: "overall",
    name: "Overall quality",
    description: null,
    isSystem: true,
  },
];

const ENTER = "\r";
const TAB = "\t";
// Build ESC + `[B` (down) etc. as a string. Using `String.fromCharCode(27)`
// is the most reliable way to embed the ESC byte without depending on
// the editor preserving a literal 0x1B in the source file. ink-testing-
// library forwards the chunk verbatim to Ink, which parses ANSI control
// sequences itself.
const ESC = String.fromCharCode(27);
const ARROW_DOWN = `${ESC}[B`;
const tick = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

beforeEach(() => {
  useTUIStore.setState({
    screen: "eval-creator",
    authUser: null,
    placeholderTarget: null,
    toast: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildEvalPayload", () => {
  it("emits an SSE payload with one URL", () => {
    const body = buildEvalPayload(
      {
        name: "My eval",
        evalType: "SSE",
        urls: [{ id: "u-0", url: "https://acme.com" }],
        pairs: [{ id: "p-0", urlA: "", urlB: "" }],
        autorater: {
          id: "built-in:casual-browser",
          name: "Casual Browser",
          source: "built-in",
        },
        dimensions: ["overall", "trust"],
        count: 3,
        concurrency: 2,
        maxTurns: 10,
      },
      { dryRun: true }
    );
    expect(body.type).toBe("SSE");
    expect(body.dryRun).toBe(true);
    expect(body.designUrls).toEqual([
      { id: "u-0", url: "https://acme.com", stimulusType: "URL" },
    ]);
    expect(body.comparisonPairs).toEqual([]);
    expect(body.selectedDimensionIds).toEqual(["overall", "trust"]);
    expect(body.selectedAutousers).toEqual([
      { autouserId: "built-in:casual-browser", agentCount: 3 },
    ]);
  });

  it("emits an SxS payload with one pair and the live status", () => {
    const body = buildEvalPayload(
      {
        name: "",
        evalType: "SxS",
        urls: [{ id: "u-0", url: "" }],
        pairs: [
          { id: "p-0", urlA: "https://acme.com/a", urlB: "https://acme.com/b" },
        ],
        autorater: {
          id: "cmoiCUSTOM",
          name: "Custom",
          source: "custom",
        },
        dimensions: [],
        count: 1,
        concurrency: 2,
        maxTurns: 10,
      },
      { dryRun: false }
    );
    expect(body.type).toBe("SxS");
    expect(body.dryRun).toBe(false);
    expect(body.status).toBe("Running");
    expect(body.comparisonPairs).toEqual([
      {
        id: "p-0",
        currentUrl: "https://acme.com/a",
        variantUrl: "https://acme.com/b",
        sideAType: "URL",
        sideBType: "URL",
      },
    ]);
    expect(body.selectedDimensionIds).toEqual(["overall"]);
  });

  it("falls back to the well-known 'overall' dimension when the user clears every selection", () => {
    // The wizard host pre-checks `dimensions: ["overall"]` so this only
    // bites if the user explicitly clears the selection. The payload
    // contract still needs ≥1 id (the server 400s otherwise) — we send
    // the well-known system-dimension slug rather than a fake id.
    const body = buildEvalPayload(
      {
        name: "x",
        evalType: "SSE",
        urls: [{ id: "u-0", url: "https://acme.com" }],
        pairs: [{ id: "p-0", urlA: "", urlB: "" }],
        autorater: {
          id: "au_built_skeptic",
          name: "Skeptical",
          source: "built-in",
        },
        dimensions: [],
        count: 1,
        concurrency: 2,
        maxTurns: 10,
      },
      { dryRun: true }
    );
    expect(body.selectedDimensionIds).toEqual(["overall"]);
  });
});

describe("EvalCreator screen — chrome", () => {
  it("renders the wizard sidebar at the type step on mount", async () => {
    const post = vi.fn();
    const { lastFrame } = render(
      <EvalCreator
        createClient={async () => ({ post })}
        loadAutousers={stubAutousers}
        loadTemplates={stubTemplates}
      />
    );
    await tick();
    const f = lastFrame() ?? "";
    expect(f).toContain("Create Evaluation");
    expect(f).toContain("Evaluation type");
    expect(f).toContain("SSE");
    expect(f).toContain("SxS");
  });

  it("advances type → urls when Enter is pressed on the type step", async () => {
    const post = vi.fn();
    const { stdin, lastFrame } = render(
      <EvalCreator
        createClient={async () => ({ post })}
        loadAutousers={stubAutousers}
        loadTemplates={stubTemplates}
      />
    );
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(lastFrame() ?? "").toContain("Stimulus URLs");
  });
});

describe("EvalCreator screen — dryRun POST contract", () => {
  /**
   * Walk the wizard from the type step all the way to the review step
   * using minimal keystrokes. The path:
   *
   *   1. type     → Enter advances to URLs
   *   2. urls     → Tab advances when the SSE URL is non-empty. Since
   *                 an empty URL fails the gate, we navigate to the URL
   *                 field, edit it, submit, then Tab.
   *   3. autorater → Enter selects "Casual Browser" (default cursor).
   *   4. dimensions → Enter advances (overall is preselected).
   *   5. config    → Enter advances.
   *   6. review    → useEffect fires the dryRun POST.
   */
  async function walkToReview(stdin: NodeJS.WritableStream): Promise<void> {
    // type → urls
    stdin.write(ENTER);
    await tick(60);
    // urls: cursor starts on Name. Move Down to the URL field.
    stdin.write(ARROW_DOWN);
    await tick(60);
    // Enter to begin editing.
    stdin.write(ENTER);
    await tick(60);
    // Type the URL — small per-character ticks avoid the input box
    // swallowing the first key under concurrent test load.
    for (const ch of "https://acme.com") {
      stdin.write(ch);
      await tick(5);
    }
    await tick(40);
    // Submit.
    stdin.write(ENTER);
    await tick(60);
    // Tab to advance.
    stdin.write(TAB);
    await tick(60);
    // autorater list mounts + loads. Wait, then Enter to pick the
    // first row the stub returned.
    await tick(150);
    stdin.write(ENTER);
    await tick();
    // dimensions: Enter to advance (overall pre-selected).
    stdin.write(ENTER);
    await tick();
    // config: Enter to advance.
    stdin.write(ENTER);
    await tick();
    // review: dryRun fetches via useEffect.
    await tick(80);
  }

  it("POSTs /api/v1/evaluations with dryRun:true on entry to review", async () => {
    const dryRunEnv = {
      data: {
        dryRun: true,
        persisted: false,
        autousersQueued: false,
        wouldCreate: { name: "Untitled evaluation", type: "SSE" },
        wouldRun: { autouserCount: 1, comparisonCount: 1, totalRuns: 1 },
        costEstimate: { total: { usd: 0.42 }, basis: "haiku4-5" },
        warnings: [],
        note: "PREVIEW ONLY — this evaluation has NOT been created.",
      },
    };
    const post = vi.fn().mockResolvedValueOnce(dryRunEnv);
    const { stdin, lastFrame } = render(
      <EvalCreator
        createClient={async () => ({ post })}
        loadAutousers={stubAutousers}
        loadTemplates={stubTemplates}
      />
    );
    await tick();
    await walkToReview(stdin);

    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.mock.calls[0]!;
    expect(path).toBe("/api/v1/evaluations");
    expect((body as { dryRun: boolean }).dryRun).toBe(true);
    expect((body as { type: string }).type).toBe("SSE");

    const f = lastFrame() ?? "";
    expect(f).toContain("Review");
    expect(f).toContain("Would run");
    expect(f).toContain("$0.42");
    expect(f).toContain("basis: haiku4-5");
  });

  it("POSTs dryRun:false on confirm and surfaces a success toast", async () => {
    const dryRunEnv = {
      data: {
        dryRun: true,
        persisted: false,
        autousersQueued: false,
        wouldCreate: { name: "Untitled evaluation", type: "SSE" },
        wouldRun: { autouserCount: 1, comparisonCount: 1, totalRuns: 1 },
        costEstimate: { total: { usd: 0.05 } },
        warnings: [],
        note: "PREVIEW",
      },
    };
    const liveEnv = {
      data: {
        id: "cmoiCREATEDX",
        name: "Untitled evaluation",
        type: "SSE",
        status: "Running",
      },
    };
    const post = vi
      .fn()
      .mockResolvedValueOnce(dryRunEnv)
      .mockResolvedValueOnce(liveEnv);
    const { stdin } = render(
      <EvalCreator
        createClient={async () => ({ post })}
        loadAutousers={stubAutousers}
        loadTemplates={stubTemplates}
      />
    );
    await tick();
    await walkToReview(stdin);

    // Confirm is the default action on review — Enter triggers the live POST.
    stdin.write(ENTER);
    await tick(80);

    expect(post).toHaveBeenCalledTimes(2);
    const [, secondBody] = post.mock.calls[1]!;
    expect((secondBody as { dryRun: boolean }).dryRun).toBe(false);

    const toast = useTUIStore.getState().toast;
    expect(toast?.kind).toBe("success");
    expect(toast?.message).toContain("Evaluation queued");
  });

  it("dimensions step renders templates returned by loadTemplates (not hardcoded)", async () => {
    // Walks: type → urls → autorater → dimensions, asserting the
    // dimensions step renders the *injected* template rows rather
    // than the previously-hardcoded "Trust / Clarity / Usability"
    // labels. This is the regression guard for the bug the user
    // reported on first real login.
    const post = vi.fn();
    const customTemplates = async () => [
      {
        id: "tpl_real_first_impression",
        name: "Real First Impression",
        description: null,
        isSystem: true,
      },
      {
        id: "tpl_real_value_clarity",
        name: "Real Value Clarity",
        description: null,
        isSystem: false,
      },
    ];
    const { stdin, lastFrame } = render(
      <EvalCreator
        createClient={async () => ({ post })}
        loadAutousers={stubAutousers}
        loadTemplates={customTemplates}
      />
    );
    await tick();
    // type → urls
    stdin.write(ENTER);
    await tick();
    // urls: cursor on Name → arrow down to URL → Enter to edit.
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write(ENTER);
    await tick();
    for (const ch of "https://acme.com") stdin.write(ch);
    await tick();
    stdin.write(ENTER);
    await tick();
    stdin.write(TAB);
    await tick();
    // autorater step — wait for stub load, pick first row.
    await tick(150);
    stdin.write(ENTER);
    await tick(60);
    // dimensions step — wait for the templates fetch to resolve.
    await tick(150);
    const f = lastFrame() ?? "";
    expect(f).toContain("Real First Impression");
    expect(f).toContain("Real Value Clarity");
    // The bug-symptom strings must NOT appear — the picker no longer
    // hardcodes them.
    expect(f).not.toContain("Visual appeal");
    expect(f).not.toContain("Credibility");
  });

  it("[snapshot] renders the cost-preview review step with warnings", async () => {
    const dryRunEnv = {
      data: {
        dryRun: true,
        persisted: false,
        autousersQueued: false,
        wouldCreate: { name: "Acme launch", type: "SSE" },
        wouldRun: { autouserCount: 2, comparisonCount: 3, totalRuns: 6 },
        costEstimate: { total: { usd: 1.23 }, basis: "haiku4-5" },
        warnings: [
          { code: "ai_eval_without_autousers", message: "Heads up: low N." },
        ],
        note: "PREVIEW ONLY — this evaluation has NOT been created.",
      },
    };
    const post = vi.fn().mockResolvedValueOnce(dryRunEnv);
    const { stdin, lastFrame } = render(
      <EvalCreator
        createClient={async () => ({ post })}
        loadAutousers={stubAutousers}
        loadTemplates={stubTemplates}
      />
    );
    await tick();
    await walkToReview(stdin);

    const f = lastFrame() ?? "";
    expect(f).toContain("Review");
    expect(f).toContain("Would run");
    expect(f).toContain("6 ratings");
    expect(f).toContain("$1.23");
    expect(f).toContain("Warnings");
    expect(f).toContain("Heads up: low N");
  });
});
