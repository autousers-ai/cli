/**
 * `autousers eval stop <id>` — cancel pending/running autouser runs.
 *
 * Wraps POST /api/v1/evaluations/:id/stop-autousers. The server flips
 * the matched runs to `cancelled`. Confirms interactively unless
 * `--yes` is passed; non-TTY without `--yes` exits 4 (validation) so
 * CI scripts don't hang waiting for input.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { handleError, ExitCode } from "../../lib/exit.js";
import { dim, json as jsonStringify, red } from "../../output.js";

interface EvalStopOpts {
  yes?: boolean;
}

async function readLine(): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    const onData = (chunk: string): void => {
      buf += chunk;
      const idx = buf.indexOf("\n");
      if (idx >= 0) {
        process.stdin.removeListener("data", onData);
        resolve(buf.slice(0, idx));
      }
    };
    process.stdin.on("data", onData);
    process.stdin.once("error", (err) => reject(err));
  });
}

interface StopAutousersEnvelope {
  data: {
    cancelled: number;
    runs?: { id: string; status: string }[];
  };
}

export async function evalStopAction(
  id: string,
  opts: EvalStopOpts,
  cmd: Command
): Promise<void> {
  if (!opts.yes && !process.stdin.isTTY) {
    process.stderr.write(
      "error: refusing to stop runs without --yes in a non-interactive shell\n"
    );
    process.exit(ExitCode.VALIDATION);
    return;
  }

  try {
    const ctx = await resolveContext(cmd);

    if (!opts.yes) {
      process.stdout.write(
        `${red("⚠")} Stop all active autouser runs for ${id}? [y/N] `
      );
      const answer = (await readLine()).trim().toLowerCase();
      if (answer !== "y" && answer !== "yes") {
        process.stdout.write(`${dim("Aborted.")}\n`);
        return;
      }
    }

    const env = await ctx.client.post<StopAutousersEnvelope>(
      `/api/v1/evaluations/${encodeURIComponent(id)}/stop-autousers`,
      {}
    );

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }
    process.stdout.write(
      `Cancelled ${env.data.cancelled} run${env.data.cancelled === 1 ? "" : "s"} for ${id}\n`
    );
  } catch (err) {
    handleError(err);
  }
}

export function registerEvalStopCommand(parent: Command): Command {
  return parent
    .command("stop <id>")
    .description("Cancel pending/running autouser runs for an evaluation")
    .option("--yes", "skip the interactive confirmation prompt")
    .action(evalStopAction);
}
