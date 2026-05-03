/**
 * `autousers autouser rubrics <id>` — list rubric versions.
 *
 * Wired to `GET /api/v1/autousers/:id/rubrics`.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { handleError } from "../../lib/exit.js";
import {
  dim,
  json as jsonStringify,
  relativeTime,
  shortId,
  table,
} from "../../output.js";

interface RubricRow {
  id: string;
  version: number;
  status: string;
  createdAt: string;
}

interface RubricListEnvelope {
  data: RubricRow[];
  has_more: boolean;
  next_cursor?: string;
}

export async function autouserRubricsAction(
  id: string,
  _opts: unknown,
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);
    const env = await ctx.client.get<RubricListEnvelope>(
      `/api/v1/autousers/${encodeURIComponent(id)}/rubrics`
    );
    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }
    if (env.data.length === 0) {
      process.stdout.write(dim("No rubrics found.") + "\n");
      return;
    }
    const rows = env.data.map((r) => ({
      Ver: String(r.version),
      Status: r.status,
      ID: shortId(r.id),
      Created: relativeTime(r.createdAt),
    }));
    process.stdout.write(
      table(rows, ["Ver", "Status", "ID", "Created"]) + "\n"
    );
  } catch (err) {
    handleError(err);
  }
}

export function registerAutouserRubricsCommand(parent: Command): Command {
  return parent
    .command("rubrics <id>")
    .description("List rubric versions for an autouser")
    .action(autouserRubricsAction);
}
