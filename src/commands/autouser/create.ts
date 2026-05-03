/**
 * `autousers autouser create` — plain-mode autouser creation.
 *
 * Three input shapes (matches the brief):
 *
 *   1. **Flag-driven (scripted):**
 *      ```
 *      autousers autouser create --name "Power User" \
 *        --description "tech-savvy methodical" \
 *        --persona "skims headers, opens devtools" \
 *        --criteria "- depth\n- jargon ok"
 *      ```
 *
 *   2. **From an existing template / built-in:**
 *      ```
 *      autousers autouser create --from-template built-in:power-user
 *      ```
 *      (Implementation: GET the source autouser, POST a clone with
 *      `--name` swapped if provided.)
 *
 *   3. **AI-assisted (`--describe`):**
 *      ```
 *      autousers autouser create --describe "a busy parent..." --confirm
 *      ```
 *      Streams the proposal from `/api/v1/autousers/draft-from-prompt`,
 *      prints the proposal, and ONLY persists when `--confirm` is set.
 *      Without `--confirm` the JSON proposal is emitted to stdout and
 *      the command exits 0 — the caller can then re-run with
 *      `--name … --persona …` filled from that JSON.
 *
 *   4. **TUI fallback** — when stdout is a TTY and no flags are set,
 *      the command launches the AutoraterCreator screen. Matches the
 *      `eval create` shape.
 *
 * The AI streaming code is lazy-imported so plain-mode startup stays
 * fast — `autousers autouser list --json` never pays the cost of
 * loading the streaming hook.
 */

import { Command } from "commander";

import { createClientFromConfig, getResolvedBearer } from "../../client.js";
import { getBaseUrl } from "../../config.js";
import { resolveContext } from "../../lib/context.js";
import { ExitCode, handleError } from "../../lib/exit.js";
import { bold, dim, green, json as jsonStringify } from "../../output.js";
import { shouldUseTUI } from "../../tui/tty.js";

interface AutouserCreateOpts {
  name?: string;
  description?: string;
  persona?: string;
  criteria?: string;
  fromTemplate?: string;
  describe?: string;
  confirm?: boolean;
  json?: boolean;
}

interface AutouserDraftLite {
  name: string;
  description: string;
  persona: string;
  criteria: string;
}

/**
 * Lazy-loaded AI streaming helper. Returns the assembled draft without
 * a UI — for the plain-mode `--describe` flow we just need the final
 * proposal, not the streaming "thinking" rendering. Any error in
 * fetching, streaming, or JSON-parsing the proposal is rethrown.
 *
 * Lazy-imports the runner's SSE parser so a `autousers autouser list`
 * never pays the cost of loading the streaming code.
 */
async function streamDraft(opts: {
  prompt: string;
  baseUrl: string;
  bearer: string | null;
}): Promise<AutouserDraftLite> {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/api/v1/autousers/draft-from-prompt`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (opts.bearer) {
    headers.Authorization = `Bearer ${opts.bearer}`;
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt: opts.prompt }),
  });
  if (!res.ok || !res.body) {
    throw new Error(
      `Draft endpoint returned HTTP ${res.status}` +
        (res.statusText ? `: ${res.statusText}` : "")
    );
  }

  const decoder = new TextDecoder("utf-8");
  const reader = res.body.getReader();
  let buffer = "";
  let proposal: AutouserDraftLite | null = null;
  let streamError: string | null = null;

  // Lazy-import only when the AI flow is actually invoked, so
  // plain-mode subcommands aren't penalized.
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf("\n\n");
    while (idx >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const event = parseFrame(frame);
      if (event) {
        if (event.name === "proposal") {
          proposal = event.data as AutouserDraftLite;
        } else if (event.name === "error") {
          streamError =
            (event.data as { message?: string })?.message ?? "Draft failed";
        }
      }
      idx = buffer.indexOf("\n\n");
    }
  }

  if (streamError) throw new Error(streamError);
  if (!proposal) {
    throw new Error("Draft stream ended without a proposal event.");
  }
  return proposal;
}

function parseFrame(frame: string): { name: string; data: unknown } | null {
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
  try {
    const data = JSON.parse(dataChunks.join("\n"));
    return { name: eventName, data };
  } catch {
    return null;
  }
}

export async function autouserCreateAction(
  opts: AutouserCreateOpts,
  cmd: Command
): Promise<void> {
  const anyFlagSet = Boolean(
    opts.name ||
    opts.description ||
    opts.persona ||
    opts.criteria ||
    opts.fromTemplate ||
    opts.describe
  );

  // Path 4 — TUI fallback. Same gating as `eval create`.
  if (!anyFlagSet && shouldUseTUI()) {
    const { startTUI } = await import("../../tui/app.js");
    const { useTUIStore } = await import("../../tui/state.js");
    useTUIStore.getState().setScreen("autorater-creator");
    const instance = startTUI();
    await instance.waitUntilExit();
    return;
  }

  // Path 1 validation runs BEFORE the try/catch so a missing-flags
  // exit (code 4) lands cleanly without being caught + remapped.
  if (!anyFlagSet || (!opts.name && !opts.fromTemplate && !opts.describe)) {
    process.stderr.write(
      "error: --name is required (or use --from-template / --describe)\n"
    );
    process.exit(ExitCode.VALIDATION);
    return;
  }

  try {
    const ctx = await resolveContext(cmd);

    // Path 3 — AI-assisted via --describe.
    if (opts.describe) {
      const baseUrl = await getBaseUrl();
      const bearer = await getResolvedBearer({});
      if (!bearer) {
        process.stderr.write(
          "error: --describe requires authentication. Run `autousers login` first.\n"
        );
        process.exit(ExitCode.AUTH);
        return;
      }
      const draft = await streamDraft({
        prompt: opts.describe,
        baseUrl,
        bearer,
      });

      // Allow `--name` etc. to override AI fields.
      const merged: AutouserDraftLite = {
        name: opts.name ?? draft.name,
        description: opts.description ?? draft.description,
        persona: opts.persona ?? draft.persona,
        criteria: opts.criteria ?? draft.criteria,
      };

      if (!opts.confirm) {
        // Preview only — emit the merged proposal so the caller can
        // re-run with `--name --persona ...` after a sanity check.
        if (ctx.jsonMode) {
          process.stdout.write(jsonStringify({ data: merged }) + "\n");
        } else {
          process.stdout.write(
            bold("AI proposal — re-run with --confirm to persist.\n") + "\n"
          );
          process.stdout.write(`Name:        ${merged.name}\n`);
          process.stdout.write(`Description: ${merged.description}\n`);
          process.stdout.write(`Persona:\n${merged.persona}\n\n`);
          process.stdout.write(`Criteria:\n${merged.criteria}\n`);
        }
        return;
      }

      // --confirm — persist the proposal.
      const env = await ctx.client.post<{
        data: { id: string; name: string };
      }>("/api/v1/autousers", {
        name: merged.name,
        description: merged.description,
        role: "autouser",
        systemPrompt: merged.persona || merged.description,
        isSystem: false,
        status: "published",
        visibility: "private",
        capabilities: { persona: merged.persona, criteria: merged.criteria },
      });

      if (ctx.jsonMode) {
        process.stdout.write(jsonStringify(env) + "\n");
      } else {
        process.stdout.write(
          green("Created autouser") +
            ` ${bold(env.data.name)} (${env.data.id})\n`
        );
      }
      return;
    }

    // Path 2 — clone an existing autouser.
    if (opts.fromTemplate) {
      const env = await ctx.client.post<{
        data: { id: string; name: string };
      }>(
        `/api/v1/autousers/${encodeURIComponent(opts.fromTemplate)}/duplicate`,
        {}
      );
      // Optionally rename via PATCH if the user supplied --name.
      if (opts.name) {
        await ctx.client.patch(
          `/api/v1/autousers/${encodeURIComponent(env.data.id)}`,
          { name: opts.name }
        );
      }
      if (ctx.jsonMode) {
        process.stdout.write(jsonStringify(env) + "\n");
      } else {
        process.stdout.write(
          green("Duplicated autouser") +
            ` ${bold(opts.name ?? env.data.name)} (${env.data.id})\n`
        );
      }
      return;
    }

    // Path 1 — flag-driven. --name is required (validated above).
    const body: Record<string, unknown> = {
      name: opts.name,
      description: opts.description ?? "",
      role: "autouser",
      systemPrompt: opts.persona ?? opts.description ?? "",
      isSystem: false,
      status: "published",
      visibility: "private",
    };
    if (opts.persona || opts.criteria) {
      body.capabilities = {
        ...(opts.persona ? { persona: opts.persona } : {}),
        ...(opts.criteria ? { criteria: opts.criteria } : {}),
      };
    }

    const env = await ctx.client.post<{
      data: { id: string; name: string };
    }>("/api/v1/autousers", body);

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }
    process.stdout.write(
      green("Created autouser") + ` ${bold(env.data.name)} (${env.data.id})\n`
    );
    process.stdout.write(`${dim("ID:")} ${env.data.id}\n`);
  } catch (err) {
    handleError(err);
  }
  // Silence unused-imports — `createClientFromConfig` is referenced
  // here for symmetry with other create commands and so future
  // refactors that drop `resolveContext` can lift it directly.
  void createClientFromConfig;
}

export function registerAutouserCreateCommand(parent: Command): Command {
  return parent
    .command("create")
    .description("Create an autouser (flag-driven, AI-assisted, or TUI)")
    .option("--name <name>", "autouser display name")
    .option("--description <desc>", "short summary")
    .option("--persona <text>", "long-form persona prompt")
    .option("--criteria <text>", "rubric criteria (markdown)")
    .option(
      "--from-template <id>",
      "clone an existing autouser id (built-in:* or cuid)"
    )
    .option(
      "--describe <prompt>",
      "AI-assisted creation — streams a proposal from the model"
    )
    .option(
      "--confirm",
      "with --describe, persist the proposal (default: print preview only)"
    )
    .option("--json", "emit machine-readable JSON")
    .action(autouserCreateAction);
}
