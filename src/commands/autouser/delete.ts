/**
 * `autousers autouser delete <id>` — soft-delete an autouser.
 *
 * Wired to `DELETE /api/v1/autousers/:id`. Confirms interactively
 * unless `--yes` is passed; non-TTY invocations require `--yes` to
 * avoid hanging on a missing prompt response. Same shape as the
 * Wave-4 `eval delete` for consistency.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { ExitCode, handleError } from "../../lib/exit.js";
import { dim, json as jsonStringify, red } from "../../output.js";

interface AutouserDeleteOpts {
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

export async function autouserDeleteAction(
  id: string,
  opts: AutouserDeleteOpts,
  cmd: Command
): Promise<void> {
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
        `${red("⚠")} Delete autouser ${id}? This cannot be undone. [y/N] `
      );
      const answer = (await readLine()).trim().toLowerCase();
      if (answer !== "y" && answer !== "yes") {
        process.stdout.write(`${dim("Aborted.")}\n`);
        return;
      }
    }

    await ctx.client.delete(`/api/v1/autousers/${encodeURIComponent(id)}`);

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify({ deleted: true, id }) + "\n");
      return;
    }
    process.stdout.write(`Deleted autouser ${id}\n`);
  } catch (err) {
    handleError(err);
  }
}

export function registerAutouserDeleteCommand(parent: Command): Command {
  return parent
    .command("delete <id>")
    .description("Delete a custom autouser by id")
    .option("--yes", "skip the interactive confirmation prompt")
    .action(autouserDeleteAction);
}
