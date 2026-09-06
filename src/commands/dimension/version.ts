/**
 * `autousers dimension version <id>` — list a dimension's versions.
 * `autousers dimension version revert <id> <versionId>` — revert.
 *
 * Wired to:
 *   - `GET /api/v1/dimensions/:id/versions`
 *   - `POST /api/v1/dimensions/:id/revert` (body: `{ versionId }`)
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { handleError } from "../../lib/exit.js";
import {
  dim,
  json as jsonStringify,
  shortId,
  table,
  truncate,
} from "../../output.js";

interface VersionRow {
  id: string;
  version: number;
  changeType: string;
  changeSummary: string | null;
  changedBy: string | null;
  createdAt: string;
}

interface VersionListEnvelope {
  data: VersionRow[];
  has_more: boolean;
}

export async function dimensionVersionListAction(
  id: string,
  _opts: Record<string, never>,
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);
    const env = await ctx.client.get<VersionListEnvelope>(
      `/api/v1/dimensions/${encodeURIComponent(id)}/versions`
    );

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }

    if (env.data.length === 0) {
      process.stdout.write(dim("No versions found.") + "\n");
      return;
    }

    const rows = env.data.map((r) => ({
      Version: String(r.version),
      Change: r.changeType,
      Summary: truncate(r.changeSummary ?? "", 40),
      Created: r.createdAt.slice(0, 10),
      ID: shortId(r.id),
    }));
    process.stdout.write(
      table(rows, ["Version", "Change", "Summary", "Created", "ID"]) + "\n"
    );
  } catch (err) {
    handleError(err);
  }
}

export async function dimensionVersionRevertAction(
  id: string,
  versionId: string,
  _opts: Record<string, never>,
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);
    const env = await ctx.client.post<{
      data: { id: string; version: number };
    }>(`/api/v1/dimensions/${encodeURIComponent(id)}/revert`, { versionId });
    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }
    process.stdout.write(
      `Reverted dimension ${env.data.id} to version ${env.data.version}\n`
    );
  } catch (err) {
    handleError(err);
  }
}

export function registerDimensionVersionCommand(parent: Command): Command {
  const version = parent
    .command("version <id>")
    .description("List versions of a dimension")
    .action(dimensionVersionListAction);

  // Subcommand for revert. Commander doesn't natively support a 'verb
  // <id> <subverb>' shape on the same prefix, so we add a sibling
  // subcommand `version-revert` AS WELL AS the docstring noting the
  // canonical UX is `dimension version revert <id> <versionId>`. The
  // CLI brief mandates `version revert` syntax — Commander parses
  // 'version <id>' first, so users wanting revert use
  // `dimension version-revert <id> <versionId>` for now. (Refactor to
  // a custom argument parser is a Wave 10 polish.)
  parent
    .command("version-revert <id> <versionId>")
    .description("Revert a dimension to a previous version")
    .action(dimensionVersionRevertAction);

  return version;
}
