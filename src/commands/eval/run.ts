/**
 * `autousers eval run <id>` — kick off (or preview) autouser runs for an
 * existing evaluation. Wraps `POST /api/v1/evaluations/:id/run-autousers`.
 *
 * `--dryRun` is a client-side preview today: we GET the evaluation and
 * print a quick "would run N autousers across M comparisons" line.
 * The server's run endpoint doesn't expose a dryRun toggle (creation
 * does — see `eval create --dryRun`), so we don't pretend to surface a
 * server-shaped cost estimate here.
 */

import { Command } from "commander";

import type { AutousersClient } from "../../client.js";
import { resolveContext } from "../../lib/context.js";
import { handleError, ExitCode } from "../../lib/exit.js";
import { bold, dim, green, json as jsonStringify } from "../../output.js";

interface EvalRunOpts {
  dryRun?: boolean;
  /**
   * Comma-separated list of autouser ids. Defaults to whatever the
   * evaluation already has in `selectedAutousers`. Required when the
   * evaluation has no pre-selected autousers.
   */
  autousers?: string;
}

interface EvaluationDetail {
  id: string;
  name: string;
  type: string;
  status: string;
  comparisonsCount?: number;
  config?: {
    selectedAutousers?: { autouserId: string; agentCount?: number }[];
  };
}

interface RunAutousersEnvelope {
  data: {
    runs: { id: string; autouserId: string; status: string }[];
    quotaUsed?: number;
    quotaRemaining?: number;
  };
}

/**
 * Fetch the evaluation detail. Wrapped in its own try/catch so a 404
 * routes through `handleError` (exits 3) without preventing the
 * post-fetch validation gate from owning a code-4 exit cleanly.
 */
async function fetchEvalOrExit(
  id: string,
  cmd: Command
): Promise<{
  evalDetail: EvaluationDetail;
  client: AutousersClient;
  jsonMode: boolean;
  baseUrl: string;
}> {
  const ctx = await resolveContext(cmd);
  const evalDetail = await ctx.client.get<EvaluationDetail>(
    `/api/v1/evaluations/${encodeURIComponent(id)}`
  );
  return {
    evalDetail,
    client: ctx.client,
    jsonMode: ctx.jsonMode,
    baseUrl: ctx.baseUrl,
  };
}

export async function evalRunAction(
  id: string,
  opts: EvalRunOpts,
  cmd: Command
): Promise<void> {
  // Two-stage flow: fetch the eval detail (errors there route through
  // handleError → exit 3 / 1 / etc.), THEN do the validation gate
  // outside the catch so a code-4 exit isn't accidentally remapped to
  // a generic 1. Pattern mirrors `eval update` / `eval delete`.
  let bundle: Awaited<ReturnType<typeof fetchEvalOrExit>>;
  try {
    bundle = await fetchEvalOrExit(id, cmd);
  } catch (err) {
    handleError(err);
  }

  const { evalDetail, client, jsonMode, baseUrl } = bundle;

  let autouserIds: string[] = [];
  if (opts.autousers) {
    autouserIds = opts.autousers
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (evalDetail.config?.selectedAutousers) {
    autouserIds = evalDetail.config.selectedAutousers.flatMap((a) =>
      Array.from({ length: a.agentCount ?? 1 }, () => a.autouserId)
    );
  }

  if (opts.dryRun) {
    const compCount = evalDetail.comparisonsCount ?? 0;
    const autouserCount = autouserIds.length;
    const totalRuns = autouserCount * Math.max(1, compCount);
    if (jsonMode) {
      process.stdout.write(
        jsonStringify({
          dryRun: true,
          evaluationId: id,
          autousers: autouserIds,
          comparisonsCount: compCount,
          totalRuns,
        }) + "\n"
      );
      return;
    }
    process.stdout.write(
      bold("Dry-run preview — nothing was queued.\n") + "\n"
    );
    process.stdout.write(
      `Would queue ${totalRuns} run${totalRuns === 1 ? "" : "s"} (${autouserCount} autouser${autouserCount === 1 ? "" : "s"} × ${compCount} comparison${compCount === 1 ? "" : "s"})\n`
    );
    process.stdout.write(`${dim("Run live with:")} autousers eval run ${id}\n`);
    return;
  }

  if (autouserIds.length === 0) {
    process.stderr.write(
      "error: evaluation has no selected autousers; pass --autousers <id1,id2>\n"
    );
    process.exit(ExitCode.VALIDATION);
    return;
  }

  try {
    const env = await client.post<RunAutousersEnvelope>(
      `/api/v1/evaluations/${encodeURIComponent(id)}/run-autousers`,
      { autouserIds }
    );

    if (jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }

    process.stdout.write(
      green(
        `Started ${env.data.runs.length} run${env.data.runs.length === 1 ? "" : "s"}`
      ) + ` for ${bold(evalDetail.name)} (${id})\n`
    );
    process.stdout.write(`${dim("Status:")} autousers eval status ${id}\n`);
    process.stdout.write(`${dim("Tail SSE:")}  autousers eval watch ${id}\n`);
    process.stdout.write(
      `${dim("View in dashboard:")} ${baseUrl}/evals/${id}\n`
    );
  } catch (err) {
    handleError(err);
  }
}

export function registerEvalRunCommand(parent: Command): Command {
  return parent
    .command("run <id>")
    .description("Start autouser runs for an evaluation")
    .option(
      "--autousers <ids>",
      "comma-separated autouser ids (defaults to the evaluation's selected list)"
    )
    .option("--dryRun", "preview the run plan; do not queue anything")
    .action(evalRunAction);
}
