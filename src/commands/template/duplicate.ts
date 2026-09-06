/**
 * `autousers template duplicate <id>` — clone a visible template into
 * the caller's team. Wired to `POST /api/v1/templates/:id/duplicate`.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { handleError } from "../../lib/exit.js";
import { bold, green, json as jsonStringify } from "../../output.js";

interface TemplateDuplicateOpts {
  team?: string;
}

export async function templateDuplicateAction(
  id: string,
  opts: TemplateDuplicateOpts,
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);
    const body: Record<string, unknown> = {};
    if (opts.team) body.teamId = opts.team;

    const env = await ctx.client.post<{ data: { id: string; name: string } }>(
      `/api/v1/templates/${encodeURIComponent(id)}/duplicate`,
      body
    );

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }
    process.stdout.write(
      green("Duplicated template") +
        ` ${bold(env.data.name)} (${env.data.id})\n`
    );
  } catch (err) {
    handleError(err);
  }
}

export function registerTemplateDuplicateCommand(parent: Command): Command {
  return parent
    .command("duplicate <id>")
    .description("Duplicate a template (built-in or custom) into your team")
    .option("--team <id>", "target team id (defaults to active team)")
    .action(templateDuplicateAction);
}
