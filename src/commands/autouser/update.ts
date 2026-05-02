/**
 * `autousers autouser update <id>` — patch an autouser by id.
 *
 * Wired to `PATCH /api/v1/autousers/:id`. Only the supplied fields are
 * sent — leaving a flag off means "don't touch that field". Custom
 * autousers only — built-ins are read-only and the server returns 403.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { ExitCode, handleError } from "../../lib/exit.js";
import { bold, green, json as jsonStringify } from "../../output.js";

interface AutouserUpdateOpts {
  name?: string;
  description?: string;
  persona?: string;
  criteria?: string;
}

export async function autouserUpdateAction(
  id: string,
  opts: AutouserUpdateOpts,
  cmd: Command
): Promise<void> {
  if (!opts.name && !opts.description && !opts.persona && !opts.criteria) {
    process.stderr.write(
      "error: at least one of --name --description --persona --criteria is required\n"
    );
    process.exit(ExitCode.VALIDATION);
    return;
  }

  try {
    const ctx = await resolveContext(cmd);
    const body: Record<string, unknown> = {};
    if (opts.name !== undefined) body.name = opts.name;
    if (opts.description !== undefined) body.description = opts.description;
    if (opts.persona !== undefined) body.systemPrompt = opts.persona;
    const capabilities: Record<string, unknown> = {};
    if (opts.persona !== undefined) capabilities.persona = opts.persona;
    if (opts.criteria !== undefined) capabilities.criteria = opts.criteria;
    if (Object.keys(capabilities).length > 0) {
      body.capabilities = capabilities;
    }

    const env = await ctx.client.patch<{
      data: { id: string; name: string };
    }>(`/api/v1/autousers/${encodeURIComponent(id)}`, body);

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }

    process.stdout.write(
      green("Updated autouser") + ` ${bold(env.data.name)} (${env.data.id})\n`
    );
  } catch (err) {
    handleError(err);
  }
}

export function registerAutouserUpdateCommand(parent: Command): Command {
  return parent
    .command("update <id>")
    .description("Update an autouser (custom only)")
    .option("--name <name>", "new display name")
    .option("--description <desc>", "new summary")
    .option("--persona <text>", "new persona prompt")
    .option("--criteria <text>", "new rubric criteria")
    .action(autouserUpdateAction);
}
