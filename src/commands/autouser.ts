/**
 * `autousers autouser` — autouser (calibrated AI persona) subcommand group.
 *
 * For now, just `autouser list`. Maps 1:1 onto `/api/v1/autousers` and is
 * the CLI counterpart to the MCP `autousers_list` tool. The naming
 * collision (`autouser` is both the CLI binary AND the noun for a
 * persona) is unfortunate but matches the product vocabulary; we lean on
 * the subcommand syntax to disambiguate.
 */

import { Command } from "commander";

import { handleError } from "../lib/exit.js";
import { resolveContext } from "../lib/context.js";
import {
  dim,
  json as jsonStringify,
  relativeTime,
  shortId,
  table,
  truncate,
} from "../output.js";

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

async function autouserListAction(
  opts: AutouserListOpts,
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);

    const limit = clampLimit(opts.limit, 20);
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    // The default behavior of the API is to include system rows; passing
    // `--source custom` disables them so the user only sees their own
    // team's personas. We don't need an explicit `built-in`-only filter
    // because the list endpoint always includes them by default.
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

/** Build the `autouser` command tree. Returned for symmetry with `eval`. */
export function buildAutouserCommand(): Command {
  const cmd = new Command("autouser").description(
    "Manage autousers (calibrated AI personas)"
  );

  cmd
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

  return cmd;
}

export const autouserCommand = buildAutouserCommand;

function clampLimit(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 100);
}
