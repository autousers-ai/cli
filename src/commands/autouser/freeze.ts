/**
 * `autousers autouser freeze <id>` — freeze the active rubric.
 *
 * Wired to `POST /api/v1/autousers/:id/calibration/freeze`. With
 * `--rubric <rubricId>`, freezes that specific rubric version; without,
 * the server freezes the autouser's current `activeRubricId`.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { handleError } from "../../lib/exit.js";
import { bold, green, json as jsonStringify } from "../../output.js";

interface AutouserFreezeOpts {
  rubric?: string;
}

export async function autouserFreezeAction(
  id: string,
  opts: AutouserFreezeOpts,
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);
    const body: Record<string, unknown> = {};
    if (opts.rubric) body.rubricId = opts.rubric;

    const env = await ctx.client.post<{
      data: { rubricId?: string; activeRubricId?: string };
    }>(`/api/v1/autousers/${encodeURIComponent(id)}/calibration/freeze`, body);

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }
    const rubricId = env.data.rubricId ?? env.data.activeRubricId ?? "—";
    process.stdout.write(
      green("Froze rubric") + ` ${bold(rubricId)} for autouser ${id}\n`
    );
  } catch (err) {
    handleError(err);
  }
}

export function registerAutouserFreezeCommand(parent: Command): Command {
  return parent
    .command("freeze <id>")
    .description("Freeze a rubric version on an autouser")
    .option("--rubric <id>", "rubric id to freeze (defaults to activeRubricId)")
    .action(autouserFreezeAction);
}
