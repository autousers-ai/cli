/**
 * Tests for the AI streaming hook used by the autorater-creator screen.
 *
 * Covered:
 *   - `chunk` events accumulate into `thinking`
 *   - `proposal` event surfaces the structured draft and flips status
 *     to "done"
 *   - `error` event surfaces a message and flips status to "error"
 *   - HTTP non-2xx surfaces as an error
 *   - reset() aborts the in-flight stream and clears state
 *   - The hook posts the prompt as JSON with the bearer attached
 *   - A configurable endpoint override hits the override URL
 *
 * The hook is exercised through a tiny harness component that captures
 * the latest result onto a ref. Same pattern as `use-results-data.test`
 * — ink-testing-library renders the harness, the hook runs inside Ink's
 * React tree, and the test inspects the ref after each tick.
 */
import { useEffect } from "react";
import { Text } from "@jrichman/ink";
import { describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";

import {
  useAiStream,
  readableFromString,
  type UseAiStreamResult,
  type UseAiStreamOptions,
} from "./use-ai-stream.js";

const tick = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

interface HarnessHandle {
  current: UseAiStreamResult | null;
}

function Harness({
  handle,
  prompt,
  ...opts
}: UseAiStreamOptions & {
  handle: HarnessHandle;
  prompt?: string;
}): JSX.Element {
  const stream = useAiStream(opts);
  handle.current = stream;
  useEffect(() => {
    if (prompt) stream.start(prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt]);
  return <Text>status: {stream.status}</Text>;
}

function fakeFetch(sse: string, status = 200): typeof fetch {
  return vi.fn(async () => {
    return new Response(readableFromString(sse), {
      status,
      headers: { "Content-Type": "text/event-stream" },
    });
  }) as unknown as typeof fetch;
}

describe("useAiStream", () => {
  it("accumulates chunk deltas into the thinking buffer", async () => {
    const sse =
      'event: chunk\ndata: {"delta":"A busy "}\n\n' +
      'event: chunk\ndata: {"delta":"parent."}\n\n' +
      "event: done\ndata: {}\n\n";
    const handle: HarnessHandle = { current: null };
    render(
      <Harness
        handle={handle}
        fetchImpl={fakeFetch(sse)}
        bearer="ak_live_test"
        prompt="describe a parent"
      />
    );
    await tick(80);
    expect(handle.current?.thinking).toContain("A busy");
    expect(handle.current?.thinking).toContain("parent");
  });

  it("surfaces a proposal event and flips status to done", async () => {
    const proposal = {
      name: "Busy Parent",
      description: "Skims marketing copy.",
      persona: "Three quotes open in tabs, impatient with jargon.",
      criteria: "- price clarity\n- jargon-free copy",
      suggestedRubrics: [],
      suggestedTemplates: [],
    };
    const sse =
      'event: chunk\ndata: {"delta":"A busy parent."}\n\n' +
      `event: proposal\ndata: ${JSON.stringify(proposal)}\n\n` +
      "event: done\ndata: {}\n\n";
    const handle: HarnessHandle = { current: null };
    render(
      <Harness
        handle={handle}
        fetchImpl={fakeFetch(sse)}
        prompt="a busy parent"
      />
    );
    await tick(80);
    expect(handle.current?.proposal).toEqual(proposal);
    expect(handle.current?.status).toBe("done");
  });

  it("surfaces server-emitted error events", async () => {
    const sse =
      'event: error\ndata: {"message":"Rate limited","code":"too_many"}\n\n';
    const handle: HarnessHandle = { current: null };
    render(<Harness handle={handle} fetchImpl={fakeFetch(sse)} prompt="hi" />);
    await tick(80);
    expect(handle.current?.status).toBe("error");
    expect(handle.current?.error).toContain("Rate limited");
  });

  it("surfaces a non-2xx HTTP response as an error", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response("nope", { status: 500 });
    }) as unknown as typeof fetch;
    const handle: HarnessHandle = { current: null };
    render(<Harness handle={handle} fetchImpl={fetchImpl} prompt="hi" />);
    await tick(80);
    expect(handle.current?.status).toBe("error");
    expect(handle.current?.error).toContain("HTTP 500");
  });

  it("posts the prompt JSON and attaches the bearer header", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(readableFromString("event: done\ndata: {}\n\n"), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const handle: HarnessHandle = { current: null };
    render(
      <Harness
        handle={handle}
        fetchImpl={fetchImpl}
        bearer="ak_live_xyz"
        prompt="a power user who skims"
      />
    );
    await tick(60);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    const init = calls[1] as RequestInit & {
      headers: Record<string, string>;
      body: string;
    };
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toBe("Bearer ak_live_xyz");
    expect(JSON.parse(init.body)).toEqual({
      prompt: "a power user who skims",
    });
  });

  it("reset() clears thinking, proposal, error and goes back to idle", async () => {
    const sse =
      'event: chunk\ndata: {"delta":"hello"}\n\n' +
      'event: proposal\ndata: {"name":"X","description":"d","persona":"p","criteria":"c"}\n\n' +
      "event: done\ndata: {}\n\n";
    const handle: HarnessHandle = { current: null };
    render(<Harness handle={handle} fetchImpl={fakeFetch(sse)} prompt="foo" />);
    await tick(80);
    expect(handle.current?.proposal).not.toBeNull();
    handle.current?.reset();
    await tick(20);
    expect(handle.current?.status).toBe("idle");
    expect(handle.current?.thinking).toBe("");
    expect(handle.current?.proposal).toBeNull();
    expect(handle.current?.error).toBeNull();
  });

  it("hits the configurable endpoint when overridden", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(readableFromString("event: done\ndata: {}\n\n"), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const handle: HarnessHandle = { current: null };
    render(
      <Harness
        handle={handle}
        fetchImpl={fetchImpl}
        endpoint="/api/v1/templates/draft-from-prompt"
        baseUrl="https://staging.autousers.ai/"
        prompt="checkout flow"
      />
    );
    await tick(40);
    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    expect(url).toBe(
      "https://staging.autousers.ai/api/v1/templates/draft-from-prompt"
    );
  });
});
