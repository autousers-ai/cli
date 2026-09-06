/**
 * `autousers settings byok test` — re-test the SAVED Gemini key.
 * Wired to `POST /api/v1/settings/byok/test`.
 */

import { Command } from "commander";

import { resolveContext } from "../../../lib/context.js";
import { handleError } from "../../../lib/exit.js";
import { green, json as jsonStringify, red } from "../../../output.js";

export async function byokTestAction(
  _opts: Record<string, never>,
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);
    const env = await ctx.client.post<{
      data: { status: string; statusCode?: number };
    }>("/api/v1/settings/byok/test", {});
    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }
    const status = env.data.status ?? "unknown";
    if (status === "ok") {
      process.stdout.write(green("BYOK test: ok") + "\n");
    } else {
      process.stdout.write(red(`BYOK test: ${status}`) + "\n");
    }
  } catch (err) {
    handleError(err);
  }
}

export function registerByokTestCommand(parent: Command): Command {
  return parent
    .command("test")
    .description("Re-test the saved Gemini key against AI Studio")
    .action(byokTestAction);
}
