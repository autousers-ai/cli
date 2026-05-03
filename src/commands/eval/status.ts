/**
 * `autousers eval status <id>` — one-shot snapshot of the autouser-run
 * state for an evaluation. Wraps GET /api/v1/evaluations/:id/autouser-status.
 *
 * Useful as a polling alternative to `eval watch` for CI scripts that
 * just want to know "is it done yet?".
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { handleError } from "../../lib/exit.js";
import { bold, dim, json as jsonStringify } from "../../output.js";

interface AutouserStatusEnvelope {
  data: {
    runs: {
      id: string;
      status: string;
      autouserId: string;
      autouserName?: string;
      currentStep?: string | null;
      currentComparison?: number;
      totalComparisons?: number;
      ratingsCreated?: number;
      error?: string | null;
      estimatedCostUsd?: number;
    }[];
    summary: {
      total: number;
      pending: number;
      running: number;
      completed: number;
      failed: number;
    };
    evaluationType?: string | null;
  };
}

export async function evalStatusAction(
  id: string,
  _opts: unknown,
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);
    const env = await ctx.client.get<AutouserStatusEnvelope>(
      `/api/v1/evaluations/${encodeURIComponent(id)}/autouser-status`
    );

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }

    const { runs, summary } = env.data;
    process.stdout.write(`${bold("Evaluation")} ${id}\n`);
    process.stdout.write(
      `${dim("Runs:")} ${summary.total} total · ${summary.pending} pending · ${summary.running} running · ${summary.completed} completed · ${summary.failed} failed\n`
    );

    if (runs.length === 0) {
      process.stdout.write(`${dim("No runs queued.")}\n`);
      return;
    }

    process.stdout.write("\n");
    for (const r of runs) {
      const head = `${r.status.padEnd(9)} ${r.id.slice(0, 8)}…`;
      const name = r.autouserName ?? r.autouserId;
      const progress =
        r.currentComparison !== undefined && r.totalComparisons !== undefined
          ? ` ${r.currentComparison}/${r.totalComparisons}`
          : "";
      const step = r.currentStep ? ` [${r.currentStep}]` : "";
      const error = r.error ? ` — ${r.error}` : "";
      process.stdout.write(`${head}  ${name}${progress}${step}${error}\n`);
    }
  } catch (err) {
    handleError(err);
  }
}

export function registerEvalStatusCommand(parent: Command): Command {
  return parent
    .command("status <id>")
    .description("Show a snapshot of autouser-run progress")
    .action(evalStatusAction);
}
