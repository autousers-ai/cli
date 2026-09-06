/**
 * `autousers eval create` — plain-mode evaluation creation.
 *
 * Three input shapes:
 *
 *   1. **Flag-driven (scripted, CI-friendly):**
 *      ```
 *      autousers eval create \
 *        --type sse --url https://acme.com \
 *        --autorater built-in:casual-browser \
 *        --dimensions trust,clarity \
 *        --count 3 --concurrency 2 --max-turns 10 \
 *        [--dryRun]    # preview cost only, exit 0 with envelope
 *        [--confirm]   # bypass interactive confirmation
 *      ```
 *   2. **JSON-on-stdin (machine-driven):**
 *      ```
 *      cat eval.json | autousers eval create --json
 *      ```
 *      Body must match `CreateEvaluationSchema`. The CLI passes it
 *      straight through to `POST /api/v1/evaluations`. `--dryRun` overrides
 *      whatever value (or absence) is on the stdin body.
 *   3. **Interactive (TTY, no flags, no stdin):** routes to the same Ink
 *      wizard the bare-`autousers` TUI uses. Brief calls this out: "TUI
 *      even in plain CLI context if TTY". When there's no TTY (CI, pipe,
 *      `--no-tui`), fall back to a flag-required error rather than
 *      hanging on prompt input.
 *
 * Exit codes:
 *   - 0    success
 *   - 4    validation (missing required flag, bad JSON on stdin)
 *   - 1+   API-error / generic — handled by `handleError`
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { handleError, ExitCode } from "../../lib/exit.js";
import {
  bold,
  dim,
  green,
  json as jsonStringify,
  yellow,
} from "../../output.js";
import { shouldUseTUI } from "../../tui/tty.js";

interface EvalCreateOpts {
  type?: string;
  url?: string;
  urlA?: string;
  urlB?: string;
  autorater?: string;
  dimensions?: string;
  count?: string;
  concurrency?: string;
  maxTurns?: string;
  dryRun?: boolean;
  confirm?: boolean;
  json?: boolean;
  name?: string;
}

/**
 * Build the request body for `POST /api/v1/evaluations` from flag input.
 * Pure — exported for tests so they can verify the wire shape without
 * spinning up commander.
 */
export function buildPayloadFromFlags(opts: EvalCreateOpts): {
  body: Record<string, unknown>;
  errors: string[];
} {
  const errors: string[] = [];
  const evalType = (opts.type ?? "sse").toLowerCase();
  if (evalType !== "sse" && evalType !== "sxs") {
    errors.push(`--type must be "sse" or "sxs" (got "${opts.type}")`);
  }
  const type: "SSE" | "SxS" = evalType === "sxs" ? "SxS" : "SSE";

  if (type === "SSE" && !opts.url) {
    errors.push("--url is required for --type sse");
  }
  if (type === "SxS" && (!opts.urlA || !opts.urlB)) {
    errors.push("--url-a and --url-b are required for --type sxs");
  }
  if (!opts.autorater) {
    errors.push(
      "--autorater is required (e.g. built-in:casual-browser, or a custom autouser cuid)"
    );
  }

  const count = parseIntOpt(opts.count, 1);
  const concurrency = parseIntOpt(opts.concurrency, 2);
  const maxTurns = parseIntOpt(opts.maxTurns, 10);
  if (count < 1) errors.push("--count must be >= 1");
  if (concurrency < 1) errors.push("--concurrency must be >= 1");
  if (maxTurns < 1) errors.push("--max-turns must be >= 1");

  const dimensions =
    opts.dimensions && opts.dimensions.length > 0
      ? opts.dimensions
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean)
      : ["overall"];

  const designUrls =
    type === "SSE"
      ? [
          {
            id: "u-0",
            url: opts.url ?? "",
            stimulusType: "URL" as const,
          },
        ]
      : [];
  const comparisonPairs =
    type === "SxS"
      ? [
          {
            id: "p-0",
            currentUrl: opts.urlA ?? "",
            variantUrl: opts.urlB ?? "",
            sideAType: "URL" as const,
            sideBType: "URL" as const,
          },
        ]
      : [];

  const body: Record<string, unknown> = {
    name: opts.name ?? "Untitled evaluation",
    type,
    status: opts.dryRun ? "Draft" : "Running",
    designUrls,
    comparisonPairs,
    selectedDimensionIds: dimensions,
    selectedAutousers: opts.autorater
      ? [{ autouserId: opts.autorater, agentCount: count }]
      : [],
    evaluationMethod: "ai",
    dryRun: Boolean(opts.dryRun),
  };

  return { body, errors };
}

function parseIntOpt(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Read the entire stdin into a string. Used by `--json` mode.
 */
async function readStdin(): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
    });
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", (err) => reject(err));
  });
}

export async function evalCreateAction(
  opts: EvalCreateOpts,
  cmd: Command
): Promise<void> {
  // Path B — interactive Ink wizard. Only when stdout is a TTY AND no
  // flags were supplied; otherwise drop through to flag-driven mode so
  // `eval create --type sse --url …` always works regardless of TTY.
  // Computed BEFORE the try/catch so a TUI launch failure surfaces with
  // its own stack rather than being remapped to a generic exit-1.
  const anyFlagSet = Boolean(
    opts.type ||
    opts.url ||
    opts.urlA ||
    opts.urlB ||
    opts.autorater ||
    opts.dimensions ||
    opts.count ||
    opts.concurrency ||
    opts.maxTurns ||
    opts.dryRun ||
    opts.confirm ||
    opts.json ||
    opts.name
  );

  // Path C-validation: build the payload up front so a missing-flags
  // exit (code 4) lands cleanly without being caught + remapped.
  if (!opts.json && anyFlagSet) {
    const { errors } = buildPayloadFromFlags(opts);
    if (errors.length > 0) {
      for (const e of errors) {
        process.stderr.write(`error: ${e}\n`);
      }
      process.exit(ExitCode.VALIDATION);
      return;
    }
  }

  try {
    const ctx = await resolveContext(cmd);

    // Path A — JSON on stdin. The body MUST be valid JSON; the server
    // does the schema enforcement. We pass through `--dryRun` only when
    // explicitly set so the caller's stdin payload's own dryRun flag is
    // respected.
    if (opts.json && !process.stdin.isTTY) {
      const raw = await readStdin();
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(raw);
      } catch (err) {
        process.stderr.write(
          `error: --json mode expects valid JSON on stdin (${err instanceof Error ? err.message : String(err)})\n`
        );
        process.exit(ExitCode.VALIDATION);
        return;
      }
      if (opts.dryRun) body.dryRun = true;
      const env = await ctx.client.post<{ data: unknown }>(
        "/api/v1/evaluations",
        body
      );
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }

    if (!anyFlagSet && shouldUseTUI()) {
      const { startTUI } = await import("../../tui/app.js");
      // Pre-route the store to the eval-creator screen before mounting so
      // the TUI lands on the wizard immediately rather than the menu.
      const { useTUIStore } = await import("../../tui/state.js");
      useTUIStore.getState().setScreen("eval-creator");
      const instance = startTUI();
      await instance.waitUntilExit();
      return;
    }

    // Path C — flag-driven scripted creation.
    const { body } = buildPayloadFromFlags(opts);

    if (opts.dryRun) {
      const env = await ctx.client.post<{
        data: {
          dryRun: true;
          wouldRun: { totalRuns: number } | null;
          costEstimate: { total: { usd: number }; basis?: string } | null;
          warnings: { code: string; message: string }[];
          note: string;
        };
      }>("/api/v1/evaluations", body);

      if (ctx.jsonMode) {
        process.stdout.write(jsonStringify(env) + "\n");
        return;
      }

      process.stdout.write(
        bold("Dry-run preview — nothing was created.\n") + "\n"
      );
      if (env.data.wouldRun) {
        process.stdout.write(
          `Would run: ${env.data.wouldRun.totalRuns} ratings\n`
        );
      }
      if (env.data.costEstimate) {
        process.stdout.write(
          `Estimated cost: $${env.data.costEstimate.total.usd.toFixed(2)}` +
            (env.data.costEstimate.basis
              ? dim(` (basis: ${env.data.costEstimate.basis})`)
              : "") +
            "\n"
        );
      }
      if (env.data.warnings.length > 0) {
        process.stdout.write("\n" + yellow("Warnings:") + "\n");
        for (const w of env.data.warnings) {
          process.stdout.write(`  · ${w.message}\n`);
        }
      }
      process.stdout.write(`\n${dim(env.data.note)}\n`);
      return;
    }

    // Live create — bypassing dryRun. `--confirm` allows skipping any
    // additional client-side prompt; today there's none, so the flag is
    // purely a hint about future-proofing scripted callers' intent.
    void opts.confirm;
    const env = await ctx.client.post<{
      data: { id: string; name: string; type: string; status: string };
    }>("/api/v1/evaluations", body);

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }

    process.stdout.write(
      green(`Created evaluation`) + ` ${bold(env.data.name)} (${env.data.id})\n`
    );
    process.stdout.write(`${dim("Status:")} ${env.data.status}\n`);
    process.stdout.write(
      `${dim("View in dashboard:")} ${ctx.baseUrl}/evals/${env.data.id}\n`
    );
  } catch (err) {
    handleError(err);
  }
}

/** Register the `create` subcommand on the supplied parent. */
export function registerEvalCreateCommand(parent: Command): Command {
  return parent
    .command("create")
    .description("Create an evaluation (interactive wizard or flag-driven)")
    .option("--type <type>", "evaluation type: sse | sxs", "sse")
    .option("--name <name>", "evaluation name")
    .option("--url <url>", "stimulus URL (required for --type sse)")
    .option("--url-a <url>", "first URL (required for --type sxs)")
    .option("--url-b <url>", "second URL (required for --type sxs)")
    .option(
      "--autorater <id>",
      "autouser id, e.g. built-in:casual-browser or a cuid"
    )
    .option(
      "--dimensions <list>",
      "comma-separated dimension ids (default: overall)"
    )
    .option("--count <n>", "agents per autouser (default 1)", "1")
    .option("--concurrency <n>", "max concurrent agent runs (default 2)", "2")
    .option("--max-turns <n>", "max turns per session (default 10)", "10")
    .option("--dryRun", "preview cost only; do not create or run")
    .option("--confirm", "skip interactive confirmation (no-op today)")
    .option("--json", "read full eval payload from stdin as JSON")
    .action(evalCreateAction);
}
