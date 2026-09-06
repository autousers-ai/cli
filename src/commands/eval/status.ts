/**
 * `autousers eval status <id>` — one-shot snapshot of the autouser-run
 * state for an evaluation. Wraps GET /api/v1/evaluations/:id/autouser-status.
 *
 * Useful as a polling alternative to `eval watch` for CI scripts that
 * just want to know "is it done yet?".
 *
 * ─────────────────────────────────────────────────────────────────
 * A ROW IS A UNIT OF WORK. A RATER MAY BE SEVERAL ROWS. THIS COMMAND SAYS
 * WHICH OF THE TWO EACH NUMBER IS.
 *
 * An evaluation too large to finish inside one pod's deadline is split into
 * several runs over disjoint designs, and those runs are ONE autouser. The
 * route answers in both registers — `summary` counts RATERS, `chunks` counts
 * the run rows — and this command used to print `summary` under the label
 * "Runs:". That is the mislabelling the whole payload exists to prevent: three
 * chunks each truthfully reporting 4/4 add up to a rater at 12/30, and a
 * caller that reads a rater count as a row count (or the reverse) is off by
 * the fan-out factor.
 *
 * IT ALSO DROPPED `partial`. A rater whose chunks did not all finish is
 * neither completed nor failed — no run row can hold that state — and totals
 * printed without it do not add up to `total`, which is how a gap becomes
 * invisible. It is printed even at zero, so a reader can see the state exists.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { handleError } from "../../lib/exit.js";
import { bold, dim, json as jsonStringify } from "../../output.js";

/** Counts by state. Shape is shared by `summary` (raters) and `chunks` (rows). */
interface StatusCounts {
  total: number;
  pending: number;
  running: number;
  completed: number;
  /**
   * Raters whose chunks did not all finish. Only ever present on `summary` —
   * a single run row cannot be partial — and absent from a server older than
   * the fan-out release, which is why it is optional here.
   */
  partial?: number;
  failed: number;
  cancelled?: number;
}

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
      /** "Part 2 of 3", or null/absent when this run is not a chunk. */
      chunkLabel?: string | null;
    }[];
    /**
     * Counts by state. COUNTS RATERS on any server that also sends `chunks`;
     * counts run ROWS on one that does not. See `countsRaters` below — the CLI
     * ships separately from the server and can meet either.
     */
    summary: StatusCounts;
    /**
     * The logical autousers, each assembled from one or more run rows. Absent
     * from a server older than the fan-out release.
     */
    raters?: {
      key: string;
      autouserId: string;
      autouserName?: string;
      status: string;
      runIds?: string[];
      chunkCount?: number;
      missingChunks?: number;
      failedChunks?: number;
      currentComparison?: number;
      totalComparisons?: number;
      ratingsCreated?: number;
      /** Designs this rater will not deliver, counted once it has stopped. */
      missingDesigns?: number;
    }[];
    /** The raw run-row counts — pods, not autousers. */
    chunks?: StatusCounts;
    evaluationType?: string | null;
  };
}

/** `a total · b pending · …`, skipping the states this envelope does not carry. */
function countsLine(counts: StatusCounts): string {
  const parts = [
    `${counts.total} total`,
    `${counts.pending} pending`,
    `${counts.running} running`,
    `${counts.completed} completed`,
  ];
  // Printed whenever the server knows the state at all, including at zero: a
  // reader who never sees the word cannot know a rater can be partial.
  if (counts.partial !== undefined) parts.push(`${counts.partial} partial`);
  parts.push(`${counts.failed} failed`);
  if (counts.cancelled !== undefined) {
    parts.push(`${counts.cancelled} cancelled`);
  }
  return parts.join(" · ");
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

    const { runs, summary, raters, chunks } = env.data;
    process.stdout.write(`${bold("Evaluation")} ${id}\n`);

    // WHICH THING `summary` COUNTS is decided by the payload, not assumed.
    // `chunks` is the field that arrived with the change of meaning, so its
    // presence is the one honest signal that `summary` moved from rows to
    // raters. Guessing instead — and printing "Autousers" over an old
    // server's row counts — would relabel a true number as a different true
    // number, which is the same defect in the other direction.
    const countsRaters = chunks !== undefined;
    process.stdout.write(
      `${dim(countsRaters ? "Autousers:" : "Runs:")} ${countsLine(summary)}\n`
    );
    // Only worth a line when it says something `summary` does not. On the
    // ordinary unchunked evaluation the two counts are identical and a second
    // identical row is noise.
    if (chunks && chunks.total !== summary.total) {
      process.stdout.write(`${dim("Runs (pods):")} ${countsLine(chunks)}\n`);
    }

    if (runs.length === 0) {
      process.stdout.write(`${dim("No runs queued.")}\n`);
      return;
    }

    // The rater block is what "how far along is my evaluation" means. Printed
    // only when a rater really is several rows, so the ordinary evaluation
    // keeps the run list it has always had and gains nothing to scroll past.
    if (raters && chunks && chunks.total !== summary.total) {
      process.stdout.write("\n");
      for (const r of raters) {
        const head = `${r.status.padEnd(9)} ${r.autouserName ?? r.autouserId}`;
        const progress =
          r.currentComparison !== undefined && r.totalComparisons !== undefined
            ? ` ${r.currentComparison}/${r.totalComparisons}`
            : "";
        const parts =
          r.chunkCount !== undefined && r.chunkCount > 1
            ? ` ${dim(`(${r.chunkCount} parts)`)}`
            : "";
        // The gap, in the same line as the progress it contradicts. A rater
        // reading 22/30 with a chunk gone is not "in progress"; it is done and
        // short, and the two numbers only make sense together.
        const missing =
          r.missingDesigns !== undefined && r.missingDesigns > 0
            ? ` — ${r.missingDesigns} designs not rated`
            : "";
        process.stdout.write(`${head}${progress}${parts}${missing}\n`);
      }
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
      // Without this, three rows of one persona each reporting their own
      // fraction read as three autousers disagreeing about their progress.
      const part = r.chunkLabel ? ` ${dim(`(${r.chunkLabel})`)}` : "";
      process.stdout.write(
        `${head}  ${name}${part}${progress}${step}${error}\n`
      );
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
