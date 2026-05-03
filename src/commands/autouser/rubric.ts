/**
 * `autousers autouser rubric <verb> <autouserId> [<rubricId>]`
 *
 * Two verbs:
 *   - `add <autouserId> --criteria <text> [--name <name>]` →
 *     `POST /api/v1/autousers/:id/rubrics`
 *   - `update <autouserId> <rubricId> --criteria <text>` →
 *     `PATCH /api/v1/autousers/:id/rubrics/:rubricId`
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { ExitCode, handleError } from "../../lib/exit.js";
import { bold, green, json as jsonStringify } from "../../output.js";

interface RubricAddOpts {
  criteria?: string;
  name?: string;
}

interface RubricUpdateOpts {
  criteria?: string;
  name?: string;
  status?: string;
}

export async function rubricAddAction(
  autouserId: string,
  opts: RubricAddOpts,
  cmd: Command
): Promise<void> {
  if (!opts.criteria) {
    process.stderr.write("error: --criteria is required\n");
    process.exit(ExitCode.VALIDATION);
    return;
  }
  try {
    const ctx = await resolveContext(cmd);
    const body: Record<string, unknown> = {
      criteriaText: opts.criteria,
    };
    if (opts.name) body.name = opts.name;

    const env = await ctx.client.post<{
      data: { id: string; version: number };
    }>(`/api/v1/autousers/${encodeURIComponent(autouserId)}/rubrics`, body);

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }
    process.stdout.write(
      green("Added rubric") + ` ${bold(env.data.id)} (v${env.data.version})\n`
    );
  } catch (err) {
    handleError(err);
  }
}

export async function rubricUpdateAction(
  autouserId: string,
  rubricId: string,
  opts: RubricUpdateOpts,
  cmd: Command
): Promise<void> {
  if (!opts.criteria && !opts.name && !opts.status) {
    process.stderr.write(
      "error: at least one of --criteria --name --status is required\n"
    );
    process.exit(ExitCode.VALIDATION);
    return;
  }
  try {
    const ctx = await resolveContext(cmd);
    const body: Record<string, unknown> = {};
    if (opts.criteria) body.criteriaText = opts.criteria;
    if (opts.name) body.name = opts.name;
    if (opts.status) body.status = opts.status;

    const env = await ctx.client.patch<{ data: { id: string } }>(
      `/api/v1/autousers/${encodeURIComponent(autouserId)}/rubrics/${encodeURIComponent(rubricId)}`,
      body
    );

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }
    process.stdout.write(green("Updated rubric") + ` ${bold(rubricId)}\n`);
  } catch (err) {
    handleError(err);
  }
}

export function registerAutouserRubricCommand(parent: Command): Command {
  const rubric = parent
    .command("rubric")
    .description("Manage rubric versions on an autouser");

  rubric
    .command("add <autouserId>")
    .description("Append a new rubric version")
    .requiredOption("--criteria <text>", "rubric criteria text (markdown)")
    .option("--name <name>", "rubric name (defaults to v<version>)")
    .action(rubricAddAction);

  rubric
    .command("update <autouserId> <rubricId>")
    .description("Update an existing rubric version")
    .option("--criteria <text>", "new criteria text")
    .option("--name <name>", "new rubric name")
    .option("--status <status>", "new status (draft / active / frozen)")
    .action(rubricUpdateAction);

  return rubric;
}
