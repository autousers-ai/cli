/**
 * Tests for the Wave 9 template-creator screen.
 *
 * Coverage:
 *   1. Renders the describe pane by default.
 *   2. ? toggles to form mode.
 *   3. Enter on a prompt fires the AI stream → review surfaces.
 *   4. `a` on the review pane POSTs to /api/v1/templates.
 *   5. Esc returns to the templates-hub.
 *   6. Edit mode loads an existing template and uses PATCH.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";

import { TemplateCreator } from "./template-creator.js";
import { readableFromString } from "../../hooks/use-ai-stream.js";
import { useTUIStore } from "../../state.js";

const ESC = String.fromCharCode(27);
const ENTER = "\r";
const tick = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

// Polls a vi.fn until it has been called `count` times, or until
// `timeoutMs` elapses. Replaces fixed `await tick(...)` waits that
// race the post-keystroke async chain (createClient + post/patch →
// state update → render) under concurrent vitest load.
async function waitForCall(
  fn: { mock: { calls: unknown[] } },
  count = 1,
  timeoutMs = 3000
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn.mock.calls.length >= count) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  if (fn.mock.calls.length < count) {
    throw new Error(
      `waitForCall: expected ${count} call(s), got ${fn.mock.calls.length} within ${timeoutMs}ms`
    );
  }
}

const PROPOSAL = {
  name: "Trust Signals",
  description: "Surfaces trust cues on a SaaS landing page.",
  suggestedDimensions: [
    {
      name: "Brand authority",
      description: "Customer logos, testimonials, awards.",
      scoringScale: {
        scaleType: "FIVE_POINT" as const,
        scaleMin: 1,
        scaleMax: 5,
      },
      rubrics: [
        { name: "Logos visible", description: "≥3 customer logos above fold" },
      ],
    },
  ],
  scoringScale: {
    scaleType: "FIVE_POINT" as const,
    scaleMin: 1,
    scaleMax: 5,
  },
};

function makeFetch(sse: string, status = 200): typeof fetch {
  return vi.fn(async () => {
    return new Response(readableFromString(sse), {
      status,
      headers: { "Content-Type": "text/event-stream" },
    });
  }) as unknown as typeof fetch;
}

const stubClient = () => ({
  get: vi.fn().mockImplementation(async (url: string) => {
    if (url === "/api/v1/auth/whoami") {
      return { data: { teamId: "team_1" } };
    }
    return {
      data: {
        id: "tpl_existing",
        name: "Existing Template",
        description: "an existing template",
      },
    };
  }),
  post: vi
    .fn()
    .mockResolvedValue({ data: { id: "tpl_new", name: "Trust Signals" } }),
  patch: vi.fn().mockResolvedValue({ data: { id: "tpl_existing" } }),
});

beforeEach(() => {
  useTUIStore.setState({
    screen: "template-creator",
    authUser: null,
    placeholderTarget: null,
    toast: null,
    editingTemplateId: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TemplateCreator", () => {
  it("renders the describe pane by default", async () => {
    const client = stubClient();
    const { lastFrame } = render(
      <TemplateCreator
        createClient={async () => client}
        bearer="ak_live_t"
        baseUrl="https://app.autousers.ai"
      />
    );
    await tick();
    const f = lastFrame() ?? "";
    expect(f).toContain("Create template");
    expect(f).toContain("describe mode");
  });

  it("toggles to form mode on ?", async () => {
    const client = stubClient();
    const { stdin, lastFrame } = render(
      <TemplateCreator
        createClient={async () => client}
        bearer="ak_live_t"
        baseUrl="https://app.autousers.ai"
      />
    );
    await tick();
    stdin.write("?");
    await tick();
    expect(lastFrame()).toContain("form mode");
  });

  it("Enter on a prompt fires the AI stream and review surfaces", async () => {
    const client = stubClient();
    const sse =
      `event: chunk\ndata: {"delta":"Thinking..."}\n\n` +
      `event: proposal\ndata: ${JSON.stringify(PROPOSAL)}\n\n` +
      `event: done\ndata: {}\n\n`;
    const { stdin, lastFrame } = render(
      <TemplateCreator
        createClient={async () => client}
        bearer="ak_live_t"
        baseUrl="https://app.autousers.ai"
        fetchImpl={makeFetch(sse)}
      />
    );
    await tick();
    // Type a 25-char prompt. The server-side schema would normally
    // require ≥10 chars; the client doesn't enforce.
    "trust signals on saas page".split("").forEach((c) => stdin.write(c));
    await tick();
    stdin.write(ENTER);
    await tick(80);
    const f = lastFrame() ?? "";
    expect(f).toContain("Trust Signals");
  });

  it("`a` on the review pane POSTs to /api/v1/templates", async () => {
    const client = stubClient();
    const sse =
      `event: proposal\ndata: ${JSON.stringify(PROPOSAL)}\n\n` +
      `event: done\ndata: {}\n\n`;
    const { stdin } = render(
      <TemplateCreator
        createClient={async () => client}
        bearer="ak_live_t"
        baseUrl="https://app.autousers.ai"
        fetchImpl={makeFetch(sse)}
      />
    );
    await tick();
    for (const c of "trust signals on saas page") {
      stdin.write(c);
    }
    await tick();
    stdin.write(ENTER);
    await tick(120);
    stdin.write("a");
    await tick(80);
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/templates",
      expect.objectContaining({
        name: "Trust Signals",
        scaleType: "FIVE_POINT",
      })
    );
  });

  it("Esc routes back to templates-hub", async () => {
    const client = stubClient();
    const { stdin } = render(
      <TemplateCreator
        createClient={async () => client}
        bearer="ak_live_t"
        baseUrl="https://app.autousers.ai"
      />
    );
    await tick();
    stdin.write(ESC);
    await tick();
    expect(useTUIStore.getState().screen).toBe("templates-hub");
  });

  it("Edit mode loads an existing template via GET and routes through PATCH on save", async () => {
    useTUIStore.setState({ editingTemplateId: "tpl_existing" });
    const client = stubClient();
    const { stdin } = render(
      <TemplateCreator
        createClient={async () => client}
        bearer="ak_live_t"
        baseUrl="https://app.autousers.ai"
      />
    );
    await tick(40);
    expect(client.get).toHaveBeenCalledWith("/api/v1/templates/tpl_existing");
    stdin.write("a");
    await waitForCall(client.patch);
    expect(client.patch).toHaveBeenCalledWith(
      "/api/v1/templates/tpl_existing",
      expect.objectContaining({ name: "Existing Template" })
    );
  });
});
