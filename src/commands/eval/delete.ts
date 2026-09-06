/**
 * `autousers eval delete <id>` — remove an evaluation.
 *
 * Wired to `DELETE /api/v1/evaluations/:id`. Confirms interactively
 * unless `--yes` is passed; non-TTY invocations require `--yes` to
 * avoid hanging on a missing prompt response.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { handleError, ExitCode } from "../../lib/exit.js";
import { dim, json as jsonStringify, red } from "../../output.js";

interface EvalDeleteOpts {
  yes?: boolean;
}

/** Read a single line from stdin (used for the y/N confirm prompt). */
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

export async function evalDeleteAction(
  id: string,
  opts: EvalDeleteOpts,
  cmd: Command
): Promise<void> {
  // Validation gates run BEFORE the try/catch so a code-4 exit isn't
  // accidentally remapped to a generic 1 by `handleError`. See update.ts
  // for the same pattern.
  if (!opts.yes && !process.stdin.isTTY) {
    process.stderr.write(
      "error: refusing to delete without --yes in a non-interactive shell\n"
    );
    process.exit(ExitCode.VALIDATION);
    return;
  }

  try {
    const ctx = await resolveContext(cmd);

    if (!opts.yes) {
      process.stdout.write(
        `${red("⚠")} Delete evaluation ${id}? This cannot be undone. [y/N] `
      );
      const answer = (await readLine()).trim().toLowerCase();
      if (answer !== "y" && answer !== "yes") {
        process.stdout.write(`${dim("Aborted.")}\n`);
        return;
      }
    }

    await ctx.client.delete(`/api/v1/evaluations/${encodeURIComponent(id)}`);

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify({ deleted: true, id }) + "\n");
      return;
    }
    process.stdout.write(`Deleted evaluation ${id}\n`);
  } catch (err) {
    handleError(err);
  }
}

export function registerEvalDeleteCommand(parent: Command): Command {
  return parent
    .command("delete <id>")
    .description("Delete an evaluation by id")
    .option("--yes", "skip the interactive confirmation prompt")
    .action(evalDeleteAction);
}
