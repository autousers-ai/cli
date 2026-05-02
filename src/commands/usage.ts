/**
 * `autousers usage` — render the `/api/v1/usage` rollup.
 *
 * Same data the dashboard's /settings/usage page consumes, formatted for
 * a 80-col terminal:
 *
 *   - Free quota (used / limit) when `freeQuota.limit` is a number
 *   - "unlimited beta" notice when `freeQuota.limit === null`
 *   - Total cost in the selected window
 *   - BYOK status flag (active / configured-but-off / disabled)
 *   - Top-3 evals by cost
 *
 * `--json` echoes the raw envelope verbatim for shell scripts that want
 * to feed it into `jq` — same contract the MCP `usage_get` tool relies on.
 */

import type { Command } from "commander";

import { handleError } from "../lib/exit.js";
import { resolveContext } from "../lib/context.js";
import { bold, dim, json as jsonStringify, kv, truncate } from "../output.js";

interface UsageEnvelope {
  range: "7d" | "30d" | "90d";
  byok: boolean;
  byokConfigured: boolean;
  freeQuota: { used: number; limit: number | null };
  totals: {
    runs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    evaluations: number;
    autousersUsed: number;
  };
  byEval: Array<{
    evaluationId: string;
    evaluationName: string;
    runs: number;
    tokens: number;
    costUsd: number;
  }>;
  perRun: { medianCost: number; meanCost: number; medianTokens: number };
}

interface UsageOpts {
  range?: "7d" | "30d" | "90d";
}

export async function usageCommand(
  opts: UsageOpts,
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);
    const range = opts.range ?? "30d";

    const data = await ctx.client.get<UsageEnvelope>(
      `/api/v1/usage?range=${encodeURIComponent(range)}`
    );

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(data) + "\n");
      return;
    }

    const limit = data.freeQuota.limit;
    const used = data.freeQuota.used;

    const lines: Record<string, string> = {};
    if (limit === null) {
      lines["Free runs"] = `unlimited beta (${used} used)`;
    } else {
      lines["Free runs"] = `${used} / ${limit}    (resets monthly)`;
    }

    lines[`Spent (${range})`] = formatUsd(data.totals.costUsd);

    if (data.byok) {
      lines["BYOK"] = "active";
    } else if (data.byokConfigured) {
      lines["BYOK"] = "configured (toggle off)";
    } else {
      lines["BYOK"] = "disabled";
    }

    process.stdout.write(`${bold(`Usage — last ${range}`)}\n`);
    process.stdout.write(kv(lines) + "\n");

    if (data.byEval.length > 0) {
      process.stdout.write(`\n${bold("Top evals:")}\n`);
      data.byEval.slice(0, 5).forEach((row, idx) => {
        // The eval-cost row uses fixed-width formatting — no full table
        // because two columns is overkill for a 3-5 row list.
        const num = `${idx + 1}.`.padEnd(3);
        const name = truncate(row.evaluationName, 30).padEnd(32);
        process.stdout.write(`  ${num} ${name}  ${formatUsd(row.costUsd)}\n`);
      });
    } else {
      process.stdout.write(`\n${dim("No runs in window.")}\n`);
    }
  } catch (err) {
    handleError(err);
  }
}

/** Format a number as USD with a leading `$`. Matches the dashboard. */
function formatUsd(n: number): string {
  // 4 decimals because individual run costs can be fractions of a cent.
  // The dashboard uses 4 too, so there's no surprise when comparing.
  return `$${n.toFixed(4)}`;
}
