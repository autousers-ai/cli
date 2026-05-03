/**
 * `autousers dimension duplicate <id>` — clone a dimension.
 * Wired to `POST /api/v1/dimensions/:id/duplicate`.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { handleError } from "../../lib/exit.js";
import { bold, green, json as jsonStringify } from "../../output.js";

export async function dimensionDuplicateAction(
  id: string,
  opts: { team?: string },
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);
    const body: Record<string, unknown> = {};
    if (opts.team) body.teamId = opts.team;
    const env = await ctx.client.post<{ data: { id: string; name: string } }>(
      `/api/v1/dimensions/${encodeURIComponent(id)}/duplicate`,
      body
    );
    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }
    process.stdout.write(
      green("Duplicated dimension") +
        ` ${bold(env.data.name)} (${env.data.id})\n`
    );
  } catch (err) {
    handleError(err);
  }
}

export function registerDimensionDuplicateCommand(parent: Command): Command {
  return parent
    .command("duplicate <id>")
    .description("Duplicate a dimension")
    .option("--team <id>", "target team id")
    .action(dimensionDuplicateAction);
}
