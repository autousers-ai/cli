/**
 * SSE runner — subscribes to
 * `/api/v1/evaluations/:id/autouser-stream`, parses the wire format,
 * dispatches normalized {@link TUIEvent}s onto the supplied bus.
 *
 * Compared with uxrater's ~500-line `runner.ts` (which orchestrated
 * Playwright + Gemini calls locally), this module is intentionally
 * thin — the autousers server runs eval agents server-side, so the
 * CLI only needs to consume SSE.
 *
 * Implementation notes
 * --------------------
 *  - Uses native `fetch()` with a `ReadableStream` body. No
 *    `eventsource` dep — fetch + a tiny line buffer is enough.
 *  - Parses the SSE wire format manually because the server uses
 *    `event: <name>\ndata: <json>\n\n` framing with optional
 *    `: heartbeat\n\n` comments. WHATWG's EventSource doesn't expose
 *    raw event names cleanly across all Node versions and isn't on
 *    the global by default in older runtimes.
 *  - The runner stops dispatching as soon as the bus emits a
 *    `run:complete`. Callers that want to keep a long-lived
 *    connection should listen for `run:complete` themselves and
 *    dispose the runner.
 *
 * The exported `runEval` returns an `AbortController` so callers can
 * tear down the stream (e.g. when the user presses `s` to stop).
 */

import { TUIEventBus, type TUIEvent } from "./events.js";
import { SSEAdapter, type ServerEvent, type ServerRun } from "./sse-adapter.js";

export interface RunEvalOptions {
  /** Resolved bearer (`ak_live_...` or OAuth JWT). */
  bearer: string;
  /** API base URL — defaults to `https://app.autousers.ai`. */
  baseUrl?: string;
  /** Bus to dispatch translated events onto. */
  bus: TUIEventBus;
  /** Optional fetch override — tests pass a mock. */
  fetchImpl?: typeof fetch;
  /** Optional `Date.now` override — tests pass a deterministic clock. */
  now?: () => number;
}

export interface RunEvalHandle {
  controller: AbortController;
  /** Promise that resolves when the stream closes (run:complete or abort). */
  done: Promise<void>;
}

/**
 * Open the SSE stream for `evaluationId` and dispatch translated
 * events onto `bus`. Returns immediately with a handle whose `done`
 * promise resolves when the stream finishes (server's `done` event,
 * connection close, or caller abort).
 */
export function runEval(
  evaluationId: string,
  opts: RunEvalOptions
): RunEvalHandle {
  const controller = new AbortController();
  const baseUrl = (opts.baseUrl ?? "https://app.autousers.ai").replace(
    /\/+$/,
    ""
  );
  const url = `${baseUrl}/api/v1/evaluations/${encodeURIComponent(
    evaluationId
  )}/autouser-stream`;
  const fetchFn = opts.fetchImpl ?? fetch;
  const adapter = new SSEAdapter(opts.now);

  const done = consumeStream(url, opts.bearer, controller.signal, fetchFn)
    .then(async (stream) => {
      for await (const event of parseSSEStream(stream)) {
        const tuiEvents = adapter.translate(event);
        for (const t of tuiEvents) {
          opts.bus.emit(t);
          if (t.type === "run:complete") {
            // Stop dispatching further events; caller will close.
            controller.abort();
            return;
          }
        }
      }
    })
    .catch((err) => {
      // Abort errors are expected on caller-driven teardown — swallow.
      if (
        err &&
        typeof err === "object" &&
        ("name" in err ? err.name === "AbortError" : false)
      ) {
        return;
      }
      // Surface as a synthetic error event so the UI can present it.
      const message = err instanceof Error ? err.message : String(err);
      const evt: TUIEvent = {
        type: "session:error",
        sessionId: "__stream__",
        error: message,
      };
      opts.bus.emit(evt);
    });

  return { controller, done };
}

/**
 * Open the SSE response and return its body. Splits the fetch from
 * the parser so tests can substitute a fake stream without mocking
 * the entire fetch surface.
 */
async function consumeStream(
  url: string,
  bearer: string,
  signal: AbortSignal,
  fetchFn: typeof fetch
): Promise<ReadableStream<Uint8Array>> {
  const res = await fetchFn(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${bearer}`,
      Accept: "text/event-stream",
    },
    signal,
  });
  if (!res.ok) {
    throw new Error(`SSE stream returned HTTP ${res.status}`);
  }
  if (!res.body) {
    throw new Error("SSE response had no body");
  }
  return res.body;
}

/**
 * Parse an SSE byte stream into discrete `ServerEvent`s. Yields one
 * event per `\n\n`-terminated frame; `: heartbeat`-style comment
 * lines are skipped silently.
 */
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<ServerEvent> {
  const decoder = new TextDecoder("utf-8");
  const reader = stream.getReader();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Split on the SSE frame separator. The remainder (after the
      // last `\n\n`) carries over to the next read.
      let sepIdx = buffer.indexOf("\n\n");
      while (sepIdx >= 0) {
        const frame = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        const parsed = parseFrame(frame);
        if (parsed) yield parsed;
        sepIdx = buffer.indexOf("\n\n");
      }
    }
    // Flush any trailing frame (rare — server always terminates with
    // \n\n — but defensive).
    if (buffer.trim()) {
      const parsed = parseFrame(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parse one SSE frame into a `ServerEvent`. Returns `null` when the
 * frame is a heartbeat / comment / unknown event-name (we
 * intentionally ignore unknown shapes rather than throw — the server
 * may add new event types we haven't shipped a renderer for yet).
 */
function parseFrame(frame: string): ServerEvent | null {
  let eventName: string | null = null;
  let dataChunks: string[] = [];

  for (const rawLine of frame.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line) continue;
    if (line.startsWith(":")) continue; // comment / heartbeat
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataChunks.push(line.slice("data:".length).trim());
    }
  }
  if (!eventName || dataChunks.length === 0) return null;
  const dataText = dataChunks.join("\n");
  let payload: unknown;
  try {
    payload = JSON.parse(dataText);
  } catch {
    return null;
  }

  switch (eventName) {
    case "snapshot": {
      const runs = (payload as { runs?: ServerRun[] }).runs;
      if (!Array.isArray(runs)) return null;
      return { type: "snapshot", payload: { runs } };
    }
    case "run_update":
      return { type: "run_update", payload: payload as ServerRun };
    case "run_complete":
      return { type: "run_complete", payload: payload as ServerRun };
    case "done":
      return {
        type: "done",
        payload: payload as { reason: string },
      };
    default:
      return null;
  }
}

/**
 * Test helper — build a `ReadableStream` from a string of raw SSE.
 * Exported so the runner test suite can drive the parser without a
 * real network round-trip.
 */
export function readableFromString(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}
