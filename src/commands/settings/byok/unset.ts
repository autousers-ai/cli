/**
 * `autousers settings byok unset` — clear the saved Gemini key.
 * Wired to `DELETE /api/v1/settings/byok`.
 */

import { Command } from "commander";

import { resolveContext } from "../../../lib/context.js";
import { handleError } from "../../../lib/exit.js";
import { green, json as jsonStringify } from "../../../output.js";

export async function byokUnsetAction(
  _opts: Record<string, never>,
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);
    const env = await ctx.client.delete<{ data: unknown }>(
      "/api/v1/settings/byok"
    );
    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }
    process.stdout.write(green("Cleared Gemini key.") + " BYOK is off.\n");
  } catch (err) {
    handleError(err);
  }
}

export function registerByokUnsetCommand(parent: Command): Command {
  return parent
    .command("unset")
    .description("Clear the saved Gemini key (BYOK off)")
    .action(byokUnsetAction);
}
