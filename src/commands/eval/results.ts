/**
 * `autousers eval results <id>` — fetch + render an evaluation's
 * computed results. Wraps `GET /api/v1/evaluations/:id/results`.
 *
 * Default output is a human-readable summary (overall avg, dimension
 * means, per-comparison rows). `--json` returns the full server
 * envelope verbatim — that's the shape MCP / scripts will want.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { handleError } from "../../lib/exit.js";
import { bold, dim, json as jsonStringify } from "../../output.js";

interface ResultsEnvelope {
  evaluation: {
    id: string;
    name: string;
    type: "SxS" | "SSE";
    status: string;
    links?: { web?: string };
  };
  aggregateStats: {
    totalRatings: number;
    totalComparisons: number;
    overallAverage?: number;
    overallWinner?: "sideA" | "sideB" | "tie" | "tied";
    sideAWins?: number;
    sideBWins?: number;
    ties?: number;
    winRate?: number;
    confidence?: { level: string };
    dimensionStats?: Record<
      string,
      {
        dimensionId: string;
        dimensionName: string;
        meanRating: number;
        sideAWins?: number;
        sideBWins?: number;
        ties?: number;
        stdDev?: number;
      }
    >;
  };
  comparisonStats: Array<{
    comparisonId: string;
    label: string;
    position: number;
    validRatingsCount: number;
    overallAverage?: number;
    overallWinner?: "sideA" | "sideB" | "tie" | "tied";
    confidence?: { level: string };
  }>;
  sideALabel?: string;
  sideBLabel?: string;
  perRater?: unknown[];
  agreement?: { percentAgreement?: number; kappa?: number } | null;
}

export async function evalResultsAction(
  id: string,
  _opts: unknown,
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);
    const env = await ctx.client.get<ResultsEnvelope>(
      `/api/v1/evaluations/${encodeURIComponent(id)}/results`
    );

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }

    const isSSE = env.evaluation.type === "SSE";
    process.stdout.write(`${bold(env.evaluation.name)}\n`);
    process.stdout.write(
      `${dim("Eval")} ${env.evaluation.id} · ${env.evaluation.type} · ${env.evaluation.status}\n`
    );
    process.stdout.write("\n");

    process.stdout.write(`${bold("Overall")}\n`);
    process.stdout.write(
      `${dim("  Ratings:")} ${env.aggregateStats.totalRatings}\n`
    );
    process.stdout.write(
      `${dim("  Comparisons:")} ${env.aggregateStats.totalComparisons}\n`
    );
    if (isSSE && typeof env.aggregateStats.overallAverage === "number") {
      process.stdout.write(
        `${dim("  Avg score:")} ${env.aggregateStats.overallAverage.toFixed(2)}/5\n`
      );
    }
    if (!isSSE) {
      const winner = env.aggregateStats.overallWinner ?? "—";
      process.stdout.write(`${dim("  Winner:")} ${winner}\n`);
      if (typeof env.aggregateStats.winRate === "number") {
        process.stdout.write(
          `${dim("  Win rate:")} ${env.aggregateStats.winRate.toFixed(0)}%\n`
        );
      }
      process.stdout.write(
        `${dim("  Decisions:")} A=${env.aggregateStats.sideAWins ?? 0} B=${env.aggregateStats.sideBWins ?? 0} Ties=${env.aggregateStats.ties ?? 0}\n`
      );
    }
    if (env.aggregateStats.confidence?.level) {
      process.stdout.write(
        `${dim("  Confidence:")} ${env.aggregateStats.confidence.level}\n`
      );
    }

    // Dimension breakdown
    const dims = env.aggregateStats.dimensionStats ?? {};
    if (Object.keys(dims).length > 0) {
      process.stdout.write(`\n${bold("Dimensions")}\n`);
      for (const [dimId, ds] of Object.entries(dims)) {
        const meanLabel = isSSE
          ? `${ds.meanRating.toFixed(2)}/5`
          : `${ds.meanRating > 0 ? "+" : ""}${ds.meanRating.toFixed(2)}`;
        process.stdout.write(
          `  ${(ds.dimensionName || dimId).padEnd(24)} ${meanLabel}\n`
        );
      }
    }

    // Per-comparison
    if (env.comparisonStats.length > 0) {
      process.stdout.write(`\n${bold("Comparisons")}\n`);
      for (const cs of env.comparisonStats) {
        const value = isSSE
          ? `${(cs.overallAverage ?? 0).toFixed(1)}/5`
          : (cs.overallWinner ?? "—");
        process.stdout.write(
          `  ${cs.label.padEnd(28)} runs=${cs.validRatingsCount}  ${value}  ${dim(cs.confidence?.level ?? "")}\n`
        );
      }
    }

    if (env.agreement && typeof env.agreement.percentAgreement === "number") {
      process.stdout.write(
        `\n${bold("Agreement")}  ${env.agreement.percentAgreement.toFixed(1)}%`
      );
      if (typeof env.agreement.kappa === "number") {
        process.stdout.write(`  ${dim(`κ=${env.agreement.kappa.toFixed(3)}`)}`);
      }
      process.stdout.write("\n");
    }

    if (env.evaluation.links?.web) {
      process.stdout.write(
        `\n${dim("View in dashboard:")} ${env.evaluation.links.web}\n`
      );
    }
  } catch (err) {
    handleError(err);
  }
}

export function registerEvalResultsCommand(parent: Command): Command {
  return parent
    .command("results <id>")
    .description("Fetch the computed results for an evaluation")
    .action(evalResultsAction);
}
