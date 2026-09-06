/**
 * `autousers eval ratings <id>` — list every rating submitted for an
 * evaluation. Wraps `GET /api/v1/evaluations/:id/ratings`.
 *
 * `--json` returns the raw envelope (default for piping into `jq` etc).
 * The default human-readable output prints one line per rating with
 * rater id, comparison id, and average score.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { handleError } from "../../lib/exit.js";
import { bold, dim, json as jsonStringify } from "../../output.js";

interface RatingItem {
  id: string;
  raterType: "ai" | "human";
  userId?: string | null;
  autouserId?: string | null;
  comparisonId: string;
  comparison?: { label?: string };
  user?: { name?: string | null; email?: string | null } | null;
  autouser?: { name?: string | null } | null;
  dimensionRatings?: Record<string, unknown> | null;
  justification?: string | null;
  createdAt: string;
}

interface RatingsEnvelope {
  data: RatingItem[];
  has_more: boolean;
  total_count?: number;
}

function averageRating(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const dims = raw as Record<string, unknown>;
  const scores: number[] = [];
  for (const [k, v] of Object.entries(dims)) {
    if (k.startsWith("_")) continue;
    if (typeof v === "number" && Number.isFinite(v)) {
      scores.push(v);
    } else if (
      v &&
      typeof v === "object" &&
      "rating" in (v as Record<string, unknown>)
    ) {
      const r = (v as { rating: unknown }).rating;
      if (typeof r === "number" && Number.isFinite(r)) scores.push(r);
    }
  }
  if (scores.length === 0) return null;
  return scores.reduce((s, n) => s + n, 0) / scores.length;
}

export async function evalRatingsAction(
  id: string,
  _opts: unknown,
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);
    const env = await ctx.client.get<RatingsEnvelope>(
      `/api/v1/evaluations/${encodeURIComponent(id)}/ratings`
    );

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }

    process.stdout.write(
      `${bold("Ratings")} ${dim(`for ${id}`)} — ${env.data.length} total\n`
    );
    if (env.data.length === 0) {
      process.stdout.write(`${dim("No ratings submitted yet.")}\n`);
      return;
    }
    process.stdout.write("\n");

    for (const r of env.data) {
      const raterId =
        r.raterType === "ai"
          ? `ai:${r.autouser?.name ?? r.autouserId ?? "unknown"}`
          : `human:${r.user?.name ?? r.user?.email ?? r.userId ?? "anonymous"}`;
      const avg = averageRating(r.dimensionRatings);
      const avgLabel = avg === null ? "—" : avg.toFixed(2);
      const compLabel = r.comparison?.label ?? r.comparisonId.slice(0, 8) + "…";
      process.stdout.write(
        `${raterId.padEnd(40)} ${dim(compLabel.padEnd(24))} ${avgLabel}\n`
      );
    }
  } catch (err) {
    handleError(err);
  }
}

export function registerEvalRatingsCommand(parent: Command): Command {
  return parent
    .command("ratings <id>")
    .description("List ratings recorded for an evaluation")
    .action(evalRatingsAction);
}
