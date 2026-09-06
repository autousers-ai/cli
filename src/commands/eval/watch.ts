/**
 * `autousers eval watch <id>` — tail the SSE stream and emit JSONL on
 * stdout. Designed for `jq` and shell pipelines; one event per line so
 * `autousers eval watch <id> | jq 'select(.type == "session:result")'`
 * Just Works.
 *
 * Reuses the TUI runner + sse-adapter so the wire-shape mapping is
 * single-source. The runner writes synthesized TUIEvents onto a bus;
 * we subscribe to every variant and write JSON.stringify of each event
 * (with an ISO `timestamp` field appended so post-hoc analysis has a
 * common time axis).
 *
 * Exit codes:
 *   0 — `run:complete` fired; all runs terminal
 *   1 — stream-level error (synthetic `session:error` with sessionId="__stream__")
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { handleError } from "../../lib/exit.js";
import { TUIEventBus, type TUIEvent } from "../../tui/events.js";
import { runEval } from "../../tui/runner.js";

export async function evalWatchAction(
  id: string,
  _opts: unknown,
  cmd: Command
): Promise<void> {
  // Final exit code is set inside the bus handler when the stream
  // emits a synthetic stream-level error. We hold it outside the
  // try/catch so the final `process.exit(0|1)` runs unconditionally
  // (otherwise the test-time `process.exit` spy would throw inside
  // the try and get remapped by `handleError`).
  const streamErrorRef: { message: string | null } = { message: null };
  let exitCode = 0;

  try {
    const ctx = await resolveContext(cmd);
    const { resolveBearerForRunner } = await import("../../tui/runtime.js");
    const bearer = await resolveBearerForRunner();

    const bus = new TUIEventBus();

    const writeJsonl = (event: TUIEvent): void => {
      const enriched = {
        ...event,
        timestamp: new Date().toISOString(),
      };
      process.stdout.write(JSON.stringify(enriched) + "\n");
    };

    bus.on("session:start", writeJsonl);
    bus.on("session:turn", writeJsonl);
    bus.on("session:nav-done", writeJsonl);
    bus.on("session:judging", writeJsonl);
    bus.on("session:result", writeJsonl);
    bus.on("run:progress", writeJsonl);
    bus.on("run:complete", writeJsonl);
    bus.on("session:error", (e) => {
      writeJsonl(e);
      if (e.sessionId === "__stream__") {
        exitCode = 1;
        streamErrorRef.message = e.error;
      }
    });

    const handle = runEval(id, {
      bearer,
      baseUrl: ctx.baseUrl,
      bus,
    });

    await handle.done;
  } catch (err) {
    handleError(err);
  }

  if (streamErrorRef.message) {
    process.stderr.write(`error: ${streamErrorRef.message}\n`);
  }
  process.exit(exitCode);
}

export function registerEvalWatchCommand(parent: Command): Command {
  return parent
    .command("watch <id>")
    .description("Tail the autouser SSE stream and emit JSONL to stdout")
    .action(evalWatchAction);
}
