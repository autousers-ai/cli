/**
 * `autousers eval get <id>` — fetch a single evaluation by id.
 *
 * Split out of the previously monolithic `cli/src/commands/eval.ts` in
 * Wave 4 for symmetry with `create.ts` / `update.ts` / `delete.ts`.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { handleError } from "../../lib/exit.js";
import {
  bold,
  dim,
  json as jsonStringify,
  kv,
  relativeTime,
} from "../../output.js";

interface EvaluationDetail {
  id: string;
  name: string;
  type: string;
  status: string;
  shareAccess: string;
  description?: string | null;
  updatedAt: string;
  createdAt: string;
  ratingsCount?: number;
  comparisonsCount?: number;
  config?: { dimensions?: string } | null;
  links?: { web?: string };
}

export async function evalGetAction(
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

/**
 * Register the `get <id>` subcommand on the supplied parent. We can't
 * `new Command("get <id>")` standalone — commander only parses the
 * positional-arg suffix when the command is created via the parent's
 * `.command(...)` factory. Same shape used by `update` and `delete`.
 */
export function registerEvalGetCommand(parent: Command): Command {
  return parent
    .command("get <id>")
    .description("Show a single evaluation by id")
    .action(evalGetAction);
}
