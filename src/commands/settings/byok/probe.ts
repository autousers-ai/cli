/**
 * `autousers settings byok probe --key <api-key>` — validate a typed key
 * WITHOUT saving it. Used to confirm a paste worked before committing.
 * Wired to `POST /api/v1/settings/byok/probe`.
 */

import { Command } from "commander";

import { resolveContext } from "../../../lib/context.js";
import { ExitCode, handleError } from "../../../lib/exit.js";
import { green, json as jsonStringify, red } from "../../../output.js";

interface ByokProbeOpts {
  key?: string;
}

export async function byokProbeAction(
  opts: ByokProbeOpts,
  cmd: Command
): Promise<void> {
  if (!opts.key || !opts.key.trim()) {
    process.stderr.write("error: --key <api-key> is required\n");
    process.exit(ExitCode.VALIDATION);
    return;
  }

  try {
    const ctx = await resolveContext(cmd);
    const env = await ctx.client.post<{
      data: { status: string };
    }>("/api/v1/settings/byok/probe", { apiKey: opts.key.trim() });
    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }
    const status = env.data.status ?? "unknown";
    if (status === "ok") {
      process.stdout.write(green("Probe: ok") + " (key is valid)\n");
    } else {
      process.stdout.write(red(`Probe: ${status}`) + "\n");
    }
  } catch (err) {
    handleError(err);
  }
}

export function registerByokProbeCommand(parent: Command): Command {
  return parent
    .command("probe")
    .description("Validate a typed Gemini key without saving it")
    .option("--key <api-key>", "Gemini API key to probe")
    .action(byokProbeAction);
}
