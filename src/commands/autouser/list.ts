/**
 * `autousers autouser list` — list autousers visible to the caller.
 *
 * Wired to `GET /api/v1/autousers`. Mirrors the MCP `autousers_list`
 * tool. Originally lived in `cli/src/commands/autouser.ts`; Wave 8
 * split each verb into its own file.
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
  truncate,
} from "../../output.js";

interface AutouserListItem {
  id: string;
  name: string;
  role: string;
  isSystem: boolean;
  status: string;
  visibility: string;
  source: "built-in" | "custom";
  updatedAt: string;
}

interface AutouserListEnvelope {
  data: AutouserListItem[];
  has_more: boolean;
  next_cursor?: string;
}

interface AutouserListOpts {
  limit?: string;
  source?: "built-in" | "custom";
}

function clampLimit(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 100);
}

export async function autouserListAction(
  opts: AutouserListOpts,
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);

    const limit = clampLimit(opts.limit, 20);
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    if (opts.source === "custom") {
      params.set("includeSystem", "false");
    }

    const envelope = await ctx.client.get<AutouserListEnvelope>(
      `/api/v1/autousers?${params.toString()}`
    );

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(envelope) + "\n");
      return;
    }

    const filtered =
      opts.source === "built-in"
        ? envelope.data.filter((r) => r.source === "built-in")
        : envelope.data;

    if (filtered.length === 0) {
      process.stdout.write(dim("No autousers found.") + "\n");
      return;
    }

    const rows = filtered.map((row) => ({
      Source: row.source,
      Name: truncate(row.name, 40),
      ID: shortId(row.id),
      Updated: relativeTime(row.updatedAt),
    }));

    process.stdout.write(
      table(rows, ["Source", "Name", "ID", "Updated"]) + "\n"
    );

    if (envelope.has_more) {
      process.stdout.write(
        dim(
          `\nshowing ${filtered.length} — use --limit ${limit + 20} for more`
        ) + "\n"
      );
    }
  } catch (err) {
    handleError(err);
  }
}

export function registerAutouserListCommand(parent: Command): Command {
  return parent
    .command("list")
    .description("List autousers visible to the caller")
    .option("--limit <n>", "max rows (default 20, max 100)", "20")
    .option(
      "--source <source>",
      "filter by source: built-in | custom",
      (value: string): "built-in" | "custom" => {
        if (value === "built-in" || value === "custom") return value;
        throw new Error(
          `--source must be "built-in" or "custom" (got "${value}")`
        );
      }
    )
    .action(autouserListAction);
}
