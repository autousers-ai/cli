/**
 * `autousers settings byok set --key <api-key>` — save a Gemini API key.
 *
 * NO `--provider` flag — the Wave 9 audit established the User schema
 * is hard-coded to a single `geminiApiKey` column. Multi-provider
 * support is a Wave 11+ refactor.
 *
 * Wired to `POST /api/v1/settings/byok`.
 */

import { Command } from "commander";

import { resolveContext } from "../../../lib/context.js";
import { ExitCode, handleError } from "../../../lib/exit.js";
import { green, json as jsonStringify } from "../../../output.js";

interface ByokSetOpts {
  key?: string;
}

export async function byokSetAction(
  opts: ByokSetOpts,
  cmd: Command
): Promise<void> {
  if (!opts.key || !opts.key.trim()) {
    process.stderr.write("error: --key <api-key> is required\n");
    process.exit(ExitCode.VALIDATION);
    return;
  }

  try {
    const ctx = await resolveContext(cmd);
    const env = await ctx.client.post<{ data: unknown }>(
      "/api/v1/settings/byok",
      { apiKey: opts.key.trim() }
    );
    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }
    process.stdout.write(
      green("Saved Gemini key.") + " BYOK is now active for this user.\n"
    );
  } catch (err) {
    handleError(err);
  }
}

export function registerByokSetCommand(parent: Command): Command {
  return parent
    .command("set")
    .description("Save a Gemini API key (BYOK)")
    .option("--key <api-key>", "Gemini API key (starts with AIza)")
    .action(byokSetAction);
}
