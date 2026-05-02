/**
 * `autousers dimension update <id>` — patch a dimension by id.
 * Wired to `PATCH /api/v1/dimensions/:id`.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { ExitCode, handleError } from "../../lib/exit.js";
import { bold, green, json as jsonStringify } from "../../output.js";

interface DimensionUpdateOpts {
  name?: string;
  description?: string;
}

export async function dimensionUpdateAction(
  id: string,
  opts: DimensionUpdateOpts,
  cmd: Command
): Promise<void> {
  if (!opts.name && !opts.description) {
    process.stderr.write(
      "error: at least one of --name --description is required\n"
    );
    process.exit(ExitCode.VALIDATION);
    return;
  }

  try {
    const ctx = await resolveContext(cmd);
    const body: Record<string, unknown> = {};
    if (opts.name !== undefined) body.name = opts.name;
    if (opts.description !== undefined) body.description = opts.description;

    const env = await ctx.client.patch<{ data: { id: string; name: string } }>(
      `/api/v1/dimensions/${encodeURIComponent(id)}`,
      body
    );

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }

    process.stdout.write(
      green("Updated dimension") + ` ${bold(env.data.name)} (${env.data.id})\n`
    );
  } catch (err) {
    handleError(err);
  }
}

export function registerDimensionUpdateCommand(parent: Command): Command {
  return parent
    .command("update <id>")
    .description("Update a dimension")
    .option("--name <name>", "new display name")
    .option("--description <desc>", "new summary")
    .action(dimensionUpdateAction);
}
