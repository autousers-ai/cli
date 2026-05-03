/**
 * `autousers autouser optimize <id>` — model-driven rubric refinement.
 *
 * Wired to `POST /api/v1/autousers/:id/calibration/optimize`. The
 * server reviews recent disagreements and proposes a rubric diff;
 * surfaces the summary + rationale on stdout.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { handleError } from "../../lib/exit.js";
import { bold, dim, green, json as jsonStringify } from "../../output.js";

interface AutouserOptimizeOpts {
  apply?: boolean;
}

export async function autouserOptimizeAction(
  id: string,
  opts: AutouserOptimizeOpts,
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);
    const body: Record<string, unknown> = {};
    if (opts.apply) body.apply = true;

    const env = await ctx.client.post<{
      data: {
        summary?: string;
        rubric_diff?: string;
        rationale?: string[];
        bias_assessment?: string;
        caveats?: string[];
        estimated_improvement?: string;
        applied?: boolean;
      };
    }>(
      `/api/v1/autousers/${encodeURIComponent(id)}/calibration/optimize`,
      body
    );

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }
    const data = env.data;
    process.stdout.write(green("Optimization complete\n"));
    if (data.summary) {
      process.stdout.write(`\n${bold("Summary:")} ${data.summary}\n`);
    }
    if (data.rationale && data.rationale.length > 0) {
      process.stdout.write(`\n${bold("Rationale:")}\n`);
      for (const r of data.rationale) {
        process.stdout.write(`  · ${r}\n`);
      }
    }
    if (data.bias_assessment) {
      process.stdout.write(
        `\n${bold("Bias assessment:")} ${data.bias_assessment}\n`
      );
    }
    if (data.estimated_improvement) {
      process.stdout.write(
        `\n${bold("Estimated improvement:")} ${data.estimated_improvement}\n`
      );
    }
    if (!data.applied) {
      process.stdout.write(
        `\n${dim("Diff was not applied. Re-run with --apply to commit.")}\n`
      );
    }
  } catch (err) {
    handleError(err);
  }
}

export function registerAutouserOptimizeCommand(parent: Command): Command {
  return parent
    .command("optimize <id>")
    .description(
      "Run a model-driven optimization pass on the autouser's rubric"
    )
    .option("--apply", "commit the optimization (default: dry-run)")
    .action(autouserOptimizeAction);
}
