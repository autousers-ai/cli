/**
 * `autousers eval transfer <id> --to <team-slug-or-id>`
 *
 * Wave 7. POSTs `/api/v1/evaluations/:id/transfer`. Mirrors MCP tool
 * `evaluations_transfer`. Transfers Owner-rights from the current team
 * to the target team. Destructive — surfaces a hint in the success
 * output reminding the caller that the previous Owner is now a regular
 * member with whatever access level the eval's `shareAccess` mode
 * implies.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { handleError, ExitCode } from "../../lib/exit.js";
import { bold, dim, green, json as jsonStringify } from "../../output.js";

interface EvalTransferOpts {
  to?: string;
}

export async function evalTransferAction(
  id: string,
  opts: EvalTransferOpts,
  cmd: Command
): Promise<void> {
  if (!opts.to || opts.to.trim().length === 0) {
    process.stderr.write("error: --to <team-slug-or-id> is required\n");
    process.exit(ExitCode.VALIDATION);
    return;
  }

  try {
    const ctx = await resolveContext(cmd);
    const env = await ctx.client.post<{
      data: { id: string; ownerTeamId: string };
    }>(`/api/v1/evaluations/${encodeURIComponent(id)}/transfer`, {
      to: opts.to.trim(),
    });

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }

    process.stdout.write(
      green("Transferred evaluation") + ` ${bold(id)} to ${opts.to}\n`
    );
    process.stdout.write(
      `${dim("Note:")} previous owner is now a regular member.\n`
    );
  } catch (err) {
    handleError(err);
  }
}

export function registerEvalTransferCommand(parent: Command): Command {
  return parent
    .command("transfer <id>")
    .description("Transfer ownership of an evaluation to another team")
    .requiredOption("--to <team>", "target team slug or id")
    .action(evalTransferAction);
}
