/**
 * Tests for the Wave 8 autorater-creator screen.
 *
 * Coverage:
 *   1. Default mode is "describe" — user can type a prompt.
 *   2. ? toggles between describe and form modes.
 *   3. Enter on a typed prompt fires the AI stream and shows the
 *      thinking pane.
 *   4. When the stream emits a `proposal` event, the review pane
 *      surfaces the structured fields.
 *   5. `a` on the review pane POSTs to /api/v1/autousers and routes
 *      back to the hub.
 *   6. `t` resets back to the describe input.
 *   7. Edit mode loads an existing autouser via GET, populates the
 *      form, and saves via PATCH.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";

import { AutoraterCreator } from "./autorater-creator.js";
import { readableFromString } from "../../hooks/use-ai-stream.js";
import { useTUIStore } from "../../state.js";

const ESC = String.fromCharCode(27);
const ENTER = "\r";
const tick = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

// Polls a predicate (e.g. asserting on the rendered frame) until it
// returns true, or `timeoutMs` elapses. Used when the assertion is on
// the output of `lastFrame()` rather than on a mock call list.
async function waitFor(predicate: () => boolean, timeoutMs = 1000) {
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

const PROPOSAL = {
  name: "Busy Parent",
  description: "Skims marketing copy.",
  persona: "Three quotes open in tabs, impatient with jargon.",
  criteria: "- price clarity\n- jargon-free copy",
  suggestedRubrics: [],
  suggestedTemplates: [],
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
  get: vi.fn().mockResolvedValue({
    data: {
      id: "au_existing",
      name: "Existing AU",
      description: "an existing autouser",
      systemPrompt: "Be helpful.",
      capabilities: { persona: "P", criteria: "C" },
    },
  }),
  post: vi.fn().mockResolvedValue({ data: { id: "new", name: "Busy Parent" } }),
  patch: vi.fn().mockResolvedValue({ data: { id: "au_existing" } }),
});

beforeEach(() => {
  useTUIStore.setState({
    screen: "autorater-creator",
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

describe("AutoraterCreator", () => {
  it("renders the describe pane by default with an empty prompt", async () => {
    const client = stubClient();
    const { lastFrame } = render(
      <AutoraterCreator
        createClient={async () => client}
        bearer="ak_live_t"
        baseUrl="https://app.autousers.ai"
      />
    );
    await tick();
    const f = lastFrame() ?? "";
    expect(f).toContain("Create autouser");
    expect(f).toContain("describe mode");
  });

  it("toggles to form mode on ?", async () => {
    const client = stubClient();
    const { stdin, lastFrame } = render(
      <AutoraterCreator
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

  it("Enter on a typed prompt sends the AI request and surfaces a proposal", async () => {
    const client = stubClient();
    const sse =
      'event: chunk\ndata: {"delta":"thinking..."}\n\n' +
      `event: proposal\ndata: ${JSON.stringify(PROPOSAL)}\n\n` +
      "event: done\ndata: {}\n\n";
    const fetchImpl = makeFetch(sse);
    const { stdin, lastFrame } = render(
      <AutoraterCreator
        createClient={async () => client}
        bearer="ak_live_t"
        baseUrl="https://app.autousers.ai"
        fetchImpl={fetchImpl}
      />
    );
    await tick();
    // Type a tiny prompt — single char is enough to satisfy trim.
    stdin.write("a");
    await tick();
    stdin.write(ENTER);
    await waitFor(() => (lastFrame() ?? "").includes("Proposal"));
    const f = lastFrame() ?? "";
    // After streaming completes the review pane shows the proposal.
    expect(f).toContain("Proposal");
    expect(f).toContain("Busy Parent");
  });

  it("a on the review pane POSTs the autouser and routes back to the hub", async () => {
    const client = stubClient();
    const sse =
      `event: proposal\ndata: ${JSON.stringify(PROPOSAL)}\n\n` +
      "event: done\ndata: {}\n\n";
    const fetchImpl = makeFetch(sse);
    const { stdin } = render(
      <AutoraterCreator
        createClient={async () => client}
        bearer="ak_live_t"
        baseUrl="https://app.autousers.ai"
        fetchImpl={fetchImpl}
      />
    );
    await tick();
    stdin.write("a"); // type into prompt
    await tick();
    stdin.write(ENTER);
    await tick(120);
    stdin.write("a"); // accept on review pane
    await tick(60);
    expect(client.post).toHaveBeenCalledTimes(1);
    const [path, body] = client.post.mock.calls[0]!;
    expect(path).toBe("/api/v1/autousers");
    expect((body as { name: string }).name).toBe("Busy Parent");
    // Route back to hub.
    await tick(500);
    expect(useTUIStore.getState().screen).toBe("autoraters-hub");
  });

  it("Esc returns to the hub", async () => {
    const client = stubClient();
    const { stdin } = render(
      <AutoraterCreator
        createClient={async () => client}
        bearer="ak_live_t"
        baseUrl="https://app.autousers.ai"
      />
    );
    await tick();
    stdin.write(ESC);
    await tick();
    expect(useTUIStore.getState().screen).toBe("autoraters-hub");
  });

  it("edit mode loads an existing autouser via GET and shows form review", async () => {
    useTUIStore.setState({ editingAutouserId: "au_existing" });
    const client = stubClient();
    const { lastFrame } = render(
      <AutoraterCreator
        createClient={async () => client}
        bearer="ak_live_t"
        baseUrl="https://app.autousers.ai"
      />
    );
    await tick(60);
    expect(client.get).toHaveBeenCalledWith("/api/v1/autousers/au_existing");
    const f = lastFrame() ?? "";
    expect(f).toContain("Existing AU");
  });
});
