/**
 * `autousers eval update <id>` — patch an evaluation.
 *
 * Wired to `PATCH /api/v1/evaluations/:id`. Surfaces the most-commonly
 * needed scalar fields (name, status, description, sharing) plus a
 * `--json` mode for arbitrary patches piped from stdin.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { handleError, ExitCode } from "../../lib/exit.js";
import { bold, dim, green, json as jsonStringify } from "../../output.js";

interface EvalUpdateOpts {
  name?: string;
  description?: string;
  status?: string;
  shareAccess?: string;
  json?: boolean;
}

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

export async function evalUpdateAction(
  id: string,
  opts: EvalUpdateOpts,
  cmd: Command
): Promise<void> {
  // Build the PATCH body before resolving the context — that way a
  // missing-fields exit (code 4) doesn't get accidentally caught by the
  // outer try/catch and remapped to a generic 1 by `handleError`. Same
  // pattern in `create.ts` / `delete.ts`.
  let body: Record<string, unknown>;
  if (opts.json && !process.stdin.isTTY) {
    const raw = await readStdin();
    try {
      body = JSON.parse(raw);
    } catch (err) {
      process.stderr.write(
        `error: --json mode expects valid JSON on stdin (${err instanceof Error ? err.message : String(err)})\n`
      );
      process.exit(ExitCode.VALIDATION);
      return; // unreachable in production; keeps TS happy through the spy throw.
    }
  } else {
    body = {};
    if (opts.name !== undefined) body.name = opts.name;
    if (opts.description !== undefined) body.description = opts.description;
    if (opts.status !== undefined) body.status = opts.status;
    if (opts.shareAccess !== undefined) body.shareAccess = opts.shareAccess;
    if (Object.keys(body).length === 0) {
      process.stderr.write(
        "error: no fields to update — pass --name / --description / --status / --share-access, or --json with stdin\n"
      );
      process.exit(ExitCode.VALIDATION);
      return;
    }
  }

  try {
    const ctx = await resolveContext(cmd);
    const env = await ctx.client.patch<{
      data: { id: string; name: string; status: string };
    }>(`/api/v1/evaluations/${encodeURIComponent(id)}`, body);

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }

    process.stdout.write(
      green("Updated evaluation") + ` ${bold(env.data.name)} (${env.data.id})\n`
    );
    process.stdout.write(`${dim("Status:")} ${env.data.status}\n`);
  } catch (err) {
    handleError(err);
  }
}

export function registerEvalUpdateCommand(parent: Command): Command {
  return parent
    .command("update <id>")
    .description("Patch an evaluation by id")
    .option("--name <name>", "rename the evaluation")
    .option("--description <text>", "set the description")
    .option(
      "--status <status>",
      "set status: Draft | Running | Ended | Archived"
    )
    .option(
      "--share-access <mode>",
      "share access: TEAM_ONLY | AUTOUSERS_LINK | ANYONE_WITH_LINK | PASSWORD_PROTECTED"
    )
    .option("--json", "read full PATCH body from stdin as JSON")
    .action(evalUpdateAction);
}
