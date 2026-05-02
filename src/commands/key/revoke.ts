/**
 * `autousers key revoke <id>` — revoke an API key.
 * Wired to `DELETE /api/v1/api-keys/:id`.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { handleError } from "../../lib/exit.js";
import { green, json as jsonStringify } from "../../output.js";

export async function keyRevokeAction(
  id: string,
  _opts: Record<string, never>,
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);
    await ctx.client.delete(`/api/v1/api-keys/${encodeURIComponent(id)}`);
    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify({ revoked: true, id }) + "\n");
      return;
    }
    process.stdout.write(green("Revoked API key") + ` ${id}\n`);
  } catch (err) {
    handleError(err);
  }
}

export function registerKeyRevokeCommand(parent: Command): Command {
  return parent
    .command("revoke <id>")
    .description("Revoke an API key by id")
    .action(keyRevokeAction);
}
