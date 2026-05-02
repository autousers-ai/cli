/**
 * `autousers autouser calibrate <id>` — start a new calibration run.
 *
 * Wired to `POST /api/v1/autousers/:id/calibration/start`. The server
 * picks the gold-set when none is supplied; `--gold-set <id>` lets the
 * caller pin a specific set of curated comparisons.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { handleError } from "../../lib/exit.js";
import { bold, green, json as jsonStringify } from "../../output.js";

interface AutouserCalibrateOpts {
  goldSet?: string;
}

export async function autouserCalibrateAction(
  id: string,
  opts: AutouserCalibrateOpts,
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);
    const body: Record<string, unknown> = {};
    if (opts.goldSet) body.goldSetId = opts.goldSet;

    const env = await ctx.client.post<{
      data: {
        id?: string;
        status?: string;
        kappa?: number;
        message?: string;
      };
    }>(`/api/v1/autousers/${encodeURIComponent(id)}/calibration/start`, body);

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }
    process.stdout.write(
      green("Calibration started") +
        ` for ${bold(id)}` +
        (env.data.status ? ` (status: ${env.data.status})` : "") +
        "\n"
    );
    if (env.data.message) {
      process.stdout.write(`${env.data.message}\n`);
    }
  } catch (err) {
    handleError(err);
  }
}

export function registerAutouserCalibrateCommand(parent: Command): Command {
  return parent
    .command("calibrate <id>")
    .description("Start a calibration run for an autouser")
    .option(
      "--gold-set <id>",
      "pin a specific gold-set (defaults to server pick)"
    )
    .action(autouserCalibrateAction);
}
