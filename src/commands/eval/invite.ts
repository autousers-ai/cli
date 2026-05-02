/**
 * `autousers eval invite <id> --email <addr>`
 *
 * Wave 7. POSTs `/api/v1/evaluations/:id/invites`. Mirrors MCP tool
 * `evaluations_invite`. Differs from `eval share` in that the recipient
 * is provisioned via email (i.e. they may not have an Autousers account
 * yet); the server queues a confirmation email rather than adding them
 * directly to the eval ACL.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { handleError, ExitCode } from "../../lib/exit.js";
import { bold, green, json as jsonStringify } from "../../output.js";

interface EvalInviteOpts {
  email?: string;
}

export async function evalInviteAction(
  id: string,
  opts: EvalInviteOpts,
  cmd: Command
): Promise<void> {
  if (!opts.email || !opts.email.includes("@")) {
    process.stderr.write(
      "error: --email <address> is required (must contain @)\n"
    );
    process.exit(ExitCode.VALIDATION);
    return;
  }

  try {
    const ctx = await resolveContext(cmd);
    const env = await ctx.client.post<{
      data: { id: string; email: string };
    }>(`/api/v1/evaluations/${encodeURIComponent(id)}/invites`, {
      email: opts.email,
    });

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }

    process.stdout.write(
      green("Invite sent") + ` for evaluation ${bold(id)} to ${opts.email}\n`
    );
  } catch (err) {
    handleError(err);
  }
}

export function registerEvalInviteCommand(parent: Command): Command {
  return parent
    .command("invite <id>")
    .description(
      "Invite a user (by email) to an evaluation — sends a confirmation email"
    )
    .requiredOption("--email <address>", "email address to invite")
    .action(evalInviteAction);
}
