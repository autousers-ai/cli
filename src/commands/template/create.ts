/**
 * `autousers template create` — plain-mode template creation.
 *
 * Three input shapes (mirrors `autouser create`):
 *
 *   1. **Flag-driven (scripted):**
 *      ```
 *      autousers template create --name "Trust Signals" \
 *        --description "..." --scale FIVE_POINT
 *      ```
 *
 *   2. **AI-assisted (`--describe`):**
 *      ```
 *      autousers template create --describe "checkout friction" --confirm
 *      ```
 *      Streams the proposal from `/api/v1/templates/draft-from-prompt`,
 *      prints the proposal, ONLY persists when `--confirm` is set.
 *      Without `--confirm` the JSON proposal is emitted to stdout.
 *
 *   3. **TUI fallback** — when stdout is a TTY and no flags are set,
 *      launches the TemplateCreator screen.
 *
 * The AI streaming code is lazy-imported — `autousers template list`
 * never pays the cost of loading it.
 */

import { Command } from "commander";

import { getResolvedBearer } from "../../client.js";
import { getBaseUrl } from "../../config.js";
import { resolveContext } from "../../lib/context.js";
import { ExitCode, handleError } from "../../lib/exit.js";
import { bold, dim, green, json as jsonStringify } from "../../output.js";
import { shouldUseTUI } from "../../tui/tty.js";

interface TemplateCreateOpts {
  name?: string;
  description?: string;
  scale?: string;
  describe?: string;
  confirm?: boolean;
  json?: boolean;
}

interface TemplateDraftLite {
  name: string;
  description: string;
  suggestedDimensions: Array<{
    name: string;
    description: string;
  }>;
  scoringScale?: {
    scaleType: "THREE_POINT" | "FIVE_POINT" | "SEVEN_POINT";
    scaleMin: number;
    scaleMax: number;
  };
}

async function streamDraft(opts: {
  prompt: string;
  baseUrl: string;
  bearer: string | null;
}): Promise<TemplateDraftLite> {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/api/v1/templates/draft-from-prompt`;
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
  let proposal: TemplateDraftLite | null = null;
  let streamError: string | null = null;

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
          proposal = event.data as TemplateDraftLite;
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

function normalizeScale(value: string | undefined): {
  scaleType: "THREE_POINT" | "FIVE_POINT" | "SEVEN_POINT";
  scaleMin: number;
  scaleMax: number;
} {
  const v = (value ?? "FIVE_POINT").toUpperCase();
  if (v === "THREE_POINT" || v === "3" || v === "THREE") {
    return { scaleType: "THREE_POINT", scaleMin: 1, scaleMax: 3 };
  }
  if (v === "SEVEN_POINT" || v === "7" || v === "SEVEN") {
    return { scaleType: "SEVEN_POINT", scaleMin: 1, scaleMax: 7 };
  }
  return { scaleType: "FIVE_POINT", scaleMin: 1, scaleMax: 5 };
}

export async function templateCreateAction(
  opts: TemplateCreateOpts,
  cmd: Command
): Promise<void> {
  const anyFlagSet = Boolean(
    opts.name || opts.description || opts.scale || opts.describe
  );

  if (!anyFlagSet && shouldUseTUI()) {
    const { startTUI } = await import("../../tui/app.js");
    const { useTUIStore } = await import("../../tui/state.js");
    useTUIStore.getState().setScreen("template-creator");
    const instance = startTUI();
    await instance.waitUntilExit();
    return;
  }

  if (!anyFlagSet || (!opts.name && !opts.describe)) {
    process.stderr.write("error: --name is required (or use --describe)\n");
    process.exit(ExitCode.VALIDATION);
    return;
  }

  try {
    const ctx = await resolveContext(cmd);

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

      const scale = draft.scoringScale ?? normalizeScale(opts.scale);
      const merged = {
        name: opts.name ?? draft.name,
        description: opts.description ?? draft.description,
        scoringScale: scale,
        suggestedDimensions: draft.suggestedDimensions,
      };

      if (!opts.confirm) {
        if (ctx.jsonMode) {
          process.stdout.write(jsonStringify({ data: merged }) + "\n");
        } else {
          process.stdout.write(
            bold("AI proposal — re-run with --confirm to persist.\n") + "\n"
          );
          process.stdout.write(`Name:        ${merged.name}\n`);
          process.stdout.write(`Description: ${merged.description}\n`);
          process.stdout.write(
            `Scale:       ${merged.scoringScale.scaleType} (${merged.scoringScale.scaleMin}–${merged.scoringScale.scaleMax})\n`
          );
          process.stdout.write(`Dimensions:\n`);
          for (const d of merged.suggestedDimensions) {
            process.stdout.write(`  - ${d.name}: ${d.description}\n`);
          }
        }
        return;
      }

      let teamId: string | undefined;
      try {
        const me = await ctx.client.get<{ data: { teamId?: string } }>(
          "/api/v1/auth/whoami"
        );
        teamId = me.data.teamId;
      } catch {
        // ignore; server will surface
      }

      const env = await ctx.client.post<{ data: { id: string; name: string } }>(
        "/api/v1/templates",
        {
          teamId,
          name: merged.name,
          description: merged.description,
          type: "rating",
          icon: "📋",
          scaleType: merged.scoringScale.scaleType,
          scaleMin: merged.scoringScale.scaleMin,
          scaleMax: merged.scoringScale.scaleMax,
          isPrimary: false,
          openTextEnabled: false,
        }
      );
      if (ctx.jsonMode) {
        process.stdout.write(jsonStringify(env) + "\n");
      } else {
        process.stdout.write(
          green("Created template") +
            ` ${bold(env.data.name)} (${env.data.id})\n`
        );
      }
      return;
    }

    // Path 1 — flag-driven.
    const scale = normalizeScale(opts.scale);
    let teamId: string | undefined;
    try {
      const me = await ctx.client.get<{ data: { teamId?: string } }>(
        "/api/v1/auth/whoami"
      );
      teamId = me.data.teamId;
    } catch {
      // ignore
    }

    const env = await ctx.client.post<{ data: { id: string; name: string } }>(
      "/api/v1/templates",
      {
        teamId,
        name: opts.name,
        description: opts.description ?? "",
        type: "rating",
        icon: "📋",
        scaleType: scale.scaleType,
        scaleMin: scale.scaleMin,
        scaleMax: scale.scaleMax,
        isPrimary: false,
        openTextEnabled: false,
      }
    );

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }
    process.stdout.write(
      green("Created template") + ` ${bold(env.data.name)} (${env.data.id})\n`
    );
    process.stdout.write(`${dim("ID:")} ${env.data.id}\n`);
  } catch (err) {
    handleError(err);
  }
}

export function registerTemplateCreateCommand(parent: Command): Command {
  return parent
    .command("create")
    .description("Create a template (flag-driven, AI-assisted, or TUI)")
    .option("--name <name>", "template display name")
    .option("--description <desc>", "short summary")
    .option(
      "--scale <type>",
      "scoring scale: THREE_POINT | FIVE_POINT | SEVEN_POINT"
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
    .action(templateCreateAction);
}
