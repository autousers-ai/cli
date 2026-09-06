/**
 * `autousers eval list` — list evaluations the caller can see.
 *
 * Split out of the previously monolithic `cli/src/commands/eval.ts` in
 * Wave 4, alongside `get.ts`, `create.ts`, `update.ts`, `delete.ts`.
 * Each command file only handles its own subcommand, and `index.ts`
 * stitches them into the `eval` Command tree.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { handleError } from "../../lib/exit.js";
import {
  dim,
  json as jsonStringify,
  relativeTime,
  shortId,
  table,
  truncate,
} from "../../output.js";

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

interface EvalListOpts {
  limit?: string;
  team?: string;
}

export async function evalListAction(
  opts: EvalListOpts,
  cmd: Command
): Promise<void> {
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

/** Register the `list` subcommand on the supplied parent. */
export function registerEvalListCommand(parent: Command): Command {
  return parent
    .command("list")
    .description("List evaluations the caller can see")
    .option("--limit <n>", "max rows (default 20, max 100)", "20")
    .option("--team <teamId>", "filter to a single team")
    .action(evalListAction);
}

function clampLimit(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 100);
}
