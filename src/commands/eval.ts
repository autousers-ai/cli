/**
 * `autousers eval` — evaluation subcommand group.
 *
 * Currently exposes the two read-only views needed for "I just kicked off
 * an autouser run, what's the eval id again?" muscle memory:
 *
 *   - `eval list`  : last-N evaluations the caller can see
 *   - `eval get <id>` : details + a deep-link to the dashboard
 *
 * The mutating commands (`create`, `delete`, `run`) are deliberately out
 * of scope for this pass — their MCP equivalents already cover the
 * agentic-workflow case and the CLI surface for them needs argv-driven
 * file uploads which are a separate design exercise.
 */

import { Command } from "commander";

import { handleError } from "../lib/exit.js";
import { resolveContext } from "../lib/context.js";
import {
  bold,
  dim,
  json as jsonStringify,
  kv,
  relativeTime,
  shortId,
  table,
  truncate,
} from "../output.js";

// ───────────────────────────────────────────────────────────────────────────
// Types — mirror the `/api/v1/evaluations` envelope shape we depend on
// ───────────────────────────────────────────────────────────────────────────

interface EvaluationListItem {
  id: string;
  name: string;
  type: string;
  status: string;
  shareAccess: string;
  updatedAt: string;
  createdAt: string;
  ratingsCount: number;
  comparisonsCount: number;
  metadata?: Record<string, unknown>;
}

interface EvaluationListEnvelope {
  data: EvaluationListItem[];
  has_more: boolean;
  next_cursor?: string;
}

interface EvaluationDetail extends EvaluationListItem {
  description: string | null;
  config?: { dimensions?: string } | null;
  links?: { web?: string };
}

// ───────────────────────────────────────────────────────────────────────────
// `autousers eval list`
// ───────────────────────────────────────────────────────────────────────────

interface EvalListOpts {
  limit?: string;
  team?: string;
}

async function evalListAction(opts: EvalListOpts, cmd: Command): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);

    const limit = clampLimit(opts.limit, 20);
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    if (opts.team) params.set("teamId", opts.team);

    const envelope = await ctx.client.get<EvaluationListEnvelope>(
      `/api/v1/evaluations?${params.toString()}`
    );

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(envelope) + "\n");
      return;
    }

    if (envelope.data.length === 0) {
      process.stdout.write(dim("No evaluations yet.") + "\n");
      return;
    }

    const rows = envelope.data.map((row) => ({
      ID: shortId(row.id),
      Status: row.status,
      Type: row.type,
      Name: truncate(row.name, 40),
      Updated: relativeTime(row.updatedAt),
    }));

    process.stdout.write(
      table(rows, ["ID", "Status", "Type", "Name", "Updated"]) + "\n"
    );

    if (envelope.has_more) {
      process.stdout.write(
        dim(
          `\nshowing ${envelope.data.length} — use --limit ${limit + 20} for more`
        ) + "\n"
      );
    }
  } catch (err) {
    handleError(err);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// `autousers eval get <id>`
// ───────────────────────────────────────────────────────────────────────────

async function evalGetAction(
  id: string,
  _opts: unknown,
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);
    const data = await ctx.client.get<EvaluationDetail>(
      `/api/v1/evaluations/${encodeURIComponent(id)}`
    );

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(data) + "\n");
      return;
    }

    // Pull dimension count from `config.dimensions` (a stringified JSON
    // array) so we can show it on the human view without forcing the
    // user to read the whole envelope. Defensive parse — the field is a
    // legacy string-encoded blob and a malformed value should NOT crash
    // the renderer.
    let dimensionsCount = 0;
    const rawDims = data.config?.dimensions;
    if (typeof rawDims === "string") {
      try {
        const parsed = JSON.parse(rawDims);
        if (Array.isArray(parsed)) dimensionsCount = parsed.length;
      } catch {
        /* ignore — leave count at 0 */
      }
    }

    const lines: Record<string, string> = {
      ID: data.id,
      Name: data.name,
      Type: data.type,
      Status: data.status,
      Sharing: data.shareAccess,
      Comparisons: String(data.comparisonsCount ?? 0),
      Dimensions: String(dimensionsCount),
      Created: relativeTime(data.createdAt),
      Updated: relativeTime(data.updatedAt),
    };
    if (data.description) lines["Description"] = data.description;

    process.stdout.write(`${bold(data.name)}\n`);
    process.stdout.write(kv(lines) + "\n");

    const webLink =
      data.links?.web ?? `${ctx.baseUrl}/evals/${encodeURIComponent(data.id)}`;
    process.stdout.write(`\n${dim("View in dashboard:")} ${webLink}\n`);
  } catch (err) {
    handleError(err);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Register subcommands on a freshly minted `eval` Command.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build the `eval` command with its subcommand tree. Returned (rather than
 * directly registered in `index.ts`) so tests can introspect the subcommand
 * graph without spinning up the entire CLI.
 */
export function buildEvalCommand(): Command {
  const evalCmd = new Command("eval").description(
    "Manage evaluations (list, get)"
  );

  evalCmd
    .command("list")
    .description("List evaluations the caller can see")
    .option("--limit <n>", "max rows (default 20, max 100)", "20")
    .option("--team <teamId>", "filter to a single team")
    .action(evalListAction);

  evalCmd
    .command("get <id>")
    .description("Show a single evaluation by id")
    .action(evalGetAction);

  return evalCmd;
}

/** Backwards-compat export — `index.ts` imports the symbol by name. */
export const evalCommand = buildEvalCommand;

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function clampLimit(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 100);
}
