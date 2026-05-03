/**
 * Ink-friendly SSE consumer for the AI-assisted autouser draft endpoint.
 *
 * Why a custom hook instead of `@ai-sdk/react`'s `useChat`?
 * --------------------------------------------------------
 * `@ai-sdk/react` ships React hooks designed for the DOM — they wire
 * `EventSource` / `fetch` streaming through browser-only primitives
 * (`AbortSignal.timeout`, `ReadableStream` + `Response.body.getReader`
 * inside a React effect). Ink renders to a terminal, not the DOM, and
 * its build target is Node — pulling in `@ai-sdk/react` adds ~500 KB
 * for hooks that don't fit our event shape (we want raw `chunk` /
 * `proposal` SSE events, not the package's `Message[]` abstraction).
 *
 * This hook is the same pattern as Wave 5's `runner.ts`: open a fetch,
 * pipe the body through `parseSSEStream` line-by-line, fan event
 * types into typed state, and expose a tiny imperative API the screen
 * uses to start / cancel a draft.
 *
 * Wire format (matches `POST /api/v1/autousers/draft-from-prompt`):
 *
 *   event: chunk     data: { delta: "<token text>" }
 *   event: proposal  data: { name, description, persona, criteria, ... }
 *   event: done      data: {}
 *   event: error     data: { message: string, code?: string }
 *
 * Status semantics:
 *   - `idle`       — initial / reset
 *   - `streaming`  — fetch sent, receiving chunk events
 *   - `done`       — proposal arrived (still set even after `done` event)
 *   - `error`      — an `error` SSE event fired or the fetch threw
 */

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shape of the `proposal` event the server emits. Mirrors
 * `AutouserDraftSchema` in `lib/schemas` — kept loose here because the
 * CLI consumes these and forwards them to the server's create endpoint
 * which re-validates strictly. We only require the fields the review
 * pane needs to render.
 */
export interface AutouserDraft {
  name: string;
  description: string;
  persona: string;
  criteria: string;
  suggestedRubrics?: Array<{
    name: string;
    criteriaText: string;
    rationale?: string;
  }>;
  suggestedTemplates?: string[];
}

/**
 * Wave 9 template draft — proposal shape returned by
 * `POST /api/v1/templates/draft-from-prompt`. Mirrors the
 * `TemplateDraftSchema` zod definition in `lib/schemas/template.ts` —
 * kept loose here because the CLI consumes these and forwards them to
 * the server's create endpoint which re-validates strictly.
 */
export interface TemplateDraftProposal {
  name: string;
  description: string;
  suggestedDimensions: Array<{
    name: string;
    description: string;
    scoringScale?: {
      scaleType: "THREE_POINT" | "FIVE_POINT" | "SEVEN_POINT";
      scaleMin: number;
      scaleMax: number;
      scaleLabels?: Record<string, string>;
    };
    rubrics?: Array<{ name: string; description: string }>;
  }>;
  suggestedRubrics?: Array<{ name: string; description: string }>;
  scoringScale?: {
    scaleType: "THREE_POINT" | "FIVE_POINT" | "SEVEN_POINT";
    scaleMin: number;
    scaleMax: number;
    scaleLabels?: Record<string, string>;
  };
}

export type AiStreamStatus = "idle" | "streaming" | "done" | "error";

export interface UseAiStreamResult<TProposal = AutouserDraft> {
  status: AiStreamStatus;
  /** Accumulated `chunk` deltas — the "thinking" pane content. */
  thinking: string;
  /** The final proposal envelope, present once `proposal` fires. */
  proposal: TProposal | null;
  /** Surface any error (network or `error` SSE event). */
  error: string | null;
  /** Kick off the request. Replaces any in-flight stream. */
  start: (prompt: string) => void;
  /** Cancel an in-flight stream and reset back to idle. */
  reset: () => void;
}

export interface UseAiStreamOptions<TProposal = AutouserDraft> {
  /** Resolved API base URL (defaults to https://app.autousers.ai). */
  baseUrl?: string;
  /** Resolved bearer (`ak_live_*` or OAuth JWT). */
  bearer?: string | null;
  /** Optional `fetch` override — tests substitute a mock. */
  fetchImpl?: typeof fetch;
  /**
   * Endpoint path. Defaults to the autouser draft route; Wave 9's
   * template creator passes `/api/v1/templates/draft-from-prompt` to
   * reuse the same hook against a different proposal shape.
   */
  endpoint?: string;
  /**
   * Type guard for the `proposal` event payload. Defaults to the
   * autouser-draft validator; Wave 9's template creator passes a
   * template-draft validator. Same hook, different shape.
   */
  validateProposal?: (value: unknown) => value is TProposal;
}

/**
 * Hook entry point. Returns inert state until `start` is called; safe
 * to mount inside a creator screen and only kick the stream once the
 * user has typed a prompt and pressed Enter.
 */
export function useAiStream<TProposal = AutouserDraft>(
  opts: UseAiStreamOptions<TProposal> = {}
): UseAiStreamResult<TProposal> {
  const [status, setStatus] = useState<AiStreamStatus>("idle");
  const [thinking, setThinking] = useState("");
  const [proposal, setProposal] = useState<TProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const fetchImpl = opts.fetchImpl ?? fetch;
  const endpoint = opts.endpoint ?? "/api/v1/autousers/draft-from-prompt";
  const baseUrl = (opts.baseUrl ?? "https://app.autousers.ai").replace(
    /\/+$/,
    ""
  );
  const validateProposal =
    opts.validateProposal ??
    (isAutouserDraft as unknown as (v: unknown) => v is TProposal);

  const reset = useCallback((): void => {
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
    setStatus("idle");
    setThinking("");
    setProposal(null);
    setError(null);
  }, []);

  // Tear down on unmount so a streaming request doesn't outlive the
  // mounting screen — the abort signal flows through to the server.
  useEffect(() => {
    return () => {
      if (controllerRef.current) {
        controllerRef.current.abort();
        controllerRef.current = null;
      }
    };
  }, []);

  const start = useCallback(
    (prompt: string): void => {
      // Replace any in-flight stream — the user hit "try again" or
      // pasted a fresh prompt before the previous one finished.
      if (controllerRef.current) {
        controllerRef.current.abort();
      }
      const controller = new AbortController();
      controllerRef.current = controller;

      setStatus("streaming");
      setThinking("");
      setProposal(null);
      setError(null);

      const url = `${baseUrl}${endpoint}`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      };
      if (opts.bearer) {
        headers.Authorization = `Bearer ${opts.bearer}`;
      }

      // We use a dedicated draft-event parser (`parseDraftSSE`) rather
      // than `runner.ts`'s `parseSSEStream` because the runner's
      // parser is wired to dashboard event names and ignores
      // `chunk` / `proposal` / `done` / `error`. Keeping the two
      // parsers separate means `runner.ts` stays focused on its
      // dashboard event vocabulary.
      void (async () => {
        try {
          const res = await fetchImpl(url, {
            method: "POST",
            headers,
            body: JSON.stringify({ prompt }),
            signal: controller.signal,
          });
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(
              `Draft endpoint returned HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`
            );
          }
          if (!res.body) {
            throw new Error("Draft response had no body");
          }
          for await (const event of parseDraftSSE(res.body)) {
            if (controller.signal.aborted) return;
            switch (event.name) {
              case "chunk":
                if (typeof event.data?.delta === "string") {
                  setThinking((prev) => prev + event.data.delta);
                }
                break;
              case "proposal":
                if (validateProposal(event.data)) {
                  setProposal(event.data);
                  setStatus("done");
                }
                break;
              case "done":
                // Proposal sets status. If for some reason we get a
                // bare done without a preceding proposal, mark idle
                // so the UI drops the streaming spinner.
                setStatus((prev) => (prev === "streaming" ? "idle" : prev));
                break;
              case "error": {
                const msg =
                  typeof event.data?.message === "string"
                    ? event.data.message
                    : "Draft request failed";
                setError(msg);
                setStatus("error");
                break;
              }
              default:
                // Unknown server event — ignore so future server
                // versions adding richer events stay forward-compat.
                break;
            }
          }
        } catch (err) {
          if ((err as { name?: string } | null)?.name === "AbortError") {
            return;
          }
          setError(err instanceof Error ? err.message : String(err));
          setStatus("error");
        }
      })();
    },
    [baseUrl, endpoint, fetchImpl, opts.bearer, validateProposal]
  );

  return { status, thinking, proposal, error, start, reset };
}

/**
 * Type guard for the template-draft `proposal` event payload —
 * exported so Wave 9's template creator can pass it to `useAiStream`
 * via the `validateProposal` option without re-deriving the shape.
 */
export function isTemplateDraftProposal(
  value: unknown
): value is TemplateDraftProposal {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string" || typeof v.description !== "string") {
    return false;
  }
  if (!Array.isArray(v.suggestedDimensions)) return false;
  // Accept empty arrays — the server's zod schema rejects empty
  // suggestedDimensions but mid-stream proposals during error states
  // can still surface here. The downstream create call re-validates.
  for (const dim of v.suggestedDimensions) {
    if (!dim || typeof dim !== "object") return false;
    const d = dim as Record<string, unknown>;
    if (typeof d.name !== "string" || typeof d.description !== "string") {
      return false;
    }
  }
  return true;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

interface DraftSseEvent {
  name: string;
  data: Record<string, unknown> & { delta?: string; message?: string };
}

/**
 * Parse an SSE byte stream into named draft events. Same wire format as
 * `runner.ts` but yields raw event-name strings (chunk / proposal /
 * done / error) rather than mapping into the dashboard event union.
 */
async function* parseDraftSSE(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<DraftSseEvent> {
  const decoder = new TextDecoder("utf-8");
  const reader = stream.getReader();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sepIdx = buffer.indexOf("\n\n");
      while (sepIdx >= 0) {
        const frame = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        const parsed = parseDraftFrame(frame);
        if (parsed) yield parsed;
        sepIdx = buffer.indexOf("\n\n");
      }
    }
    if (buffer.trim()) {
      const parsed = parseDraftFrame(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseDraftFrame(frame: string): DraftSseEvent | null {
  let eventName: string | null = null;
  const dataChunks: string[] = [];
  for (const rawLine of frame.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line) continue;
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataChunks.push(line.slice("data:".length).trim());
    }
  }
  if (!eventName || dataChunks.length === 0) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(dataChunks.join("\n"));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") {
    return { name: eventName, data: {} };
  }
  return {
    name: eventName,
    data: payload as DraftSseEvent["data"],
  };
}

/** Type guard for the `proposal` event payload. */
function isAutouserDraft(value: unknown): value is AutouserDraft {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === "string" &&
    typeof v.description === "string" &&
    typeof v.persona === "string" &&
    typeof v.criteria === "string"
  );
}

/** Test helper — build a `ReadableStream` from a string of raw SSE. */
export function readableFromString(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}
