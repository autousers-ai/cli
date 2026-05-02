/**
 * `autousers eval share <id> --email <addr> [--role viewer|editor|owner]`
 *
 * Wave 7. POSTs `/api/v1/evaluations/:id/shares`. Mirrors MCP tool
 * `evaluations_share`. Used both directly by users and by scripts that
 * provision team-wide access from CI.
 *
 * Default role is `viewer`. The server validates the role enum, but we
 * front-validate so a bad value gets a code-4 exit before the network
 * call rather than a 4xx round-trip.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { handleError, ExitCode } from "../../lib/exit.js";
import { bold, dim, green, json as jsonStringify } from "../../output.js";

const VALID_ROLES = ["viewer", "editor", "owner"] as const;
type ShareRole = (typeof VALID_ROLES)[number];

interface EvalShareOpts {
  email?: string;
  role?: string;
}

export async function evalShareAction(
  id: string,
  opts: EvalShareOpts,
  cmd: Command
): Promise<void> {
  if (!opts.email || !opts.email.includes("@")) {
    process.stderr.write(
      "error: --email <address> is required (must contain @)\n"
    );
    process.exit(ExitCode.VALIDATION);
    return;
  }
  const role = (opts.role ?? "viewer") as ShareRole;
  if (!VALID_ROLES.includes(role)) {
    process.stderr.write(
      `error: --role must be one of ${VALID_ROLES.join(" | ")}\n`
    );
    process.exit(ExitCode.VALIDATION);
    return;
  }

  try {
    const ctx = await resolveContext(cmd);
    const env = await ctx.client.post<{
      data: { id: string; email: string; role: string };
    }>(`/api/v1/evaluations/${encodeURIComponent(id)}/shares`, {
      email: opts.email,
      role,
    });

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }

    process.stdout.write(
      green("Shared evaluation") + ` ${bold(id)} with ${opts.email} (${role})\n`
    );
    if (env.data?.id) {
      process.stdout.write(`${dim("Share id:")} ${env.data.id}\n`);
    }
  } catch (err) {
    handleError(err);
  }
}

export function registerEvalShareCommand(parent: Command): Command {
  return parent
    .command("share <id>")
    .description("Share an evaluation with another user by email")
    .requiredOption("--email <address>", "email to share with")
    .option(
      "--role <role>",
      `role to assign (one of ${VALID_ROLES.join(" | ")}; default viewer)`,
      "viewer"
    )
    .action(evalShareAction);
}
