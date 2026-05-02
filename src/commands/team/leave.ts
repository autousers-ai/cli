/**
 * `autousers team leave <id>` — leave a team.
 * Wired to `POST /api/v1/teams/:id/leave`.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { handleError } from "../../lib/exit.js";
import { green, json as jsonStringify } from "../../output.js";

export async function teamLeaveAction(
  id: string,
  _opts: Record<string, never>,
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);
    const env = await ctx.client.post<{ data: unknown }>(
      `/api/v1/teams/${encodeURIComponent(id)}/leave`,
      {}
    );
    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }
    process.stdout.write(green("Left team") + ` ${id}\n`);
  } catch (err) {
    handleError(err);
  }
}

export function registerTeamLeaveCommand(parent: Command): Command {
  return parent
    .command("leave <id>")
    .description("Leave a team")
    .action(teamLeaveAction);
}
