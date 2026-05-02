/**
 * `autousers autouser duplicate <id>` — clone a visible autouser into
 * the caller's team.
 *
 * Wired to `POST /api/v1/autousers/:id/duplicate`. Source can be any
 * visible autouser (team / public / built-in). Optional `--team` body
 * routes the clone into a specific team; default is the caller's
 * active team.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { handleError } from "../../lib/exit.js";
import { bold, green, json as jsonStringify } from "../../output.js";

interface AutouserDuplicateOpts {
  team?: string;
}

export async function autouserDuplicateAction(
  id: string,
  opts: AutouserDuplicateOpts,
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);
    const body: Record<string, unknown> = {};
    if (opts.team) body.teamId = opts.team;

    const env = await ctx.client.post<{
      data: { id: string; name: string };
    }>(`/api/v1/autousers/${encodeURIComponent(id)}/duplicate`, body);

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }
    process.stdout.write(
      green("Duplicated autouser") +
        ` ${bold(env.data.name)} (${env.data.id})\n`
    );
  } catch (err) {
    handleError(err);
  }
}

export function registerAutouserDuplicateCommand(parent: Command): Command {
  return parent
    .command("duplicate <id>")
    .description("Duplicate an autouser (built-in or custom) into your team")
    .option("--team <id>", "target team id (defaults to active team)")
    .action(autouserDuplicateAction);
}
