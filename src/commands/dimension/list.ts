/**
 * `autousers dimension list` — list dimensions visible to the caller.
 *
 * `Dimension` is the historical codebase noun; `Template` is the
 * product noun. Wave 9 exposes a separate dimension command tree
 * because dimensions and templates have ALMOST the same wire shape
 * but diverge enough (versioning, revert) that joining them in one
 * command surface would confuse scripted callers.
 *
 * Wired to `GET /api/v1/dimensions`.
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

interface DimensionRow {
  id: string;
  name: string;
  type: string;
  scaleType: string;
  isSystem: boolean;
  version?: number;
}

interface ListEnvelope {
  data: DimensionRow[];
  has_more: boolean;
  next_cursor?: string;
}

export async function dimensionListAction(
  opts: { limit?: string },
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);
    const limit = clampLimit(opts.limit, 20);
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    params.set("includeSystem", "true");

    const env = await ctx.client.get<ListEnvelope>(
      `/api/v1/dimensions?${params.toString()}`
    );

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }

    if (env.data.length === 0) {
      process.stdout.write(dim("No dimensions found.") + "\n");
      return;
    }

    const rows = env.data.map((r) => ({
      Source: r.isSystem ? "built-in" : "custom",
      Name: truncate(r.name, 36),
      Type: r.type,
      Scale: r.scaleType,
      Version: r.version != null ? String(r.version) : "—",
      ID: shortId(r.id),
    }));
    process.stdout.write(
      table(rows, ["Source", "Name", "Type", "Scale", "Version", "ID"]) + "\n"
    );
  } catch (err) {
    handleError(err);
  }
}

function clampLimit(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 100);
}

export function registerDimensionListCommand(parent: Command): Command {
  return parent
    .command("list")
    .description("List dimensions visible to the caller")
    .option("--limit <n>", "max rows (default 20, max 100)", "20")
    .action(dimensionListAction);
}
