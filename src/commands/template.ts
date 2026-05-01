/**
 * `autousers template` — rating-template (a.k.a. "dimension") subcommand
 * group.
 *
 * `template` is the product noun; `dimension` is the historical codebase
 * noun. The CLI uses the public alias `/api/v1/templates` so we don't
 * inherit the deprecation header on `/api/v1/dimensions`.
 *
 * Exposes `template list` for now — the only read-only CLI workflow that
 * doesn't already have a clean MCP equivalent for terminal users.
 */

import { Command } from "commander";

import { handleError } from "../lib/exit.js";
import { resolveContext } from "../lib/context.js";
import {
  dim,
  json as jsonStringify,
  shortId,
  table,
  truncate,
} from "../output.js";

interface TemplateListItem {
  id: string;
  name: string;
  type: string;
  scaleType: string;
  isSystem: boolean;
  factors: unknown;
  sseCriteria: unknown;
}

interface TemplateListEnvelope {
  data: TemplateListItem[];
  has_more: boolean;
  next_cursor?: string;
}

interface TemplateListOpts {
  limit?: string;
}

async function templateListAction(
  opts: TemplateListOpts,
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);

    const limit = clampLimit(opts.limit, 20);
    const params = new URLSearchParams();
    params.set("limit", String(limit));

    const envelope = await ctx.client.get<TemplateListEnvelope>(
      `/api/v1/templates?${params.toString()}`
    );

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(envelope) + "\n");
      return;
    }

    if (envelope.data.length === 0) {
      process.stdout.write(dim("No templates found.") + "\n");
      return;
    }

    const rows = envelope.data.map((row) => ({
      Source: row.isSystem ? "built-in" : "custom",
      Name: truncate(row.name, 36),
      Type: row.type,
      Dimensions: String(countFactors(row)),
      ID: shortId(row.id),
    }));

    process.stdout.write(
      table(rows, ["Source", "Name", "Type", "Dimensions", "ID"]) + "\n"
    );

    if (envelope.has_more) {
      process.stdout.write(
        dim(
          `\nshowing ${envelope.data.length} — use --limit ${limit + 20} for more`
        ) + "\n"
      );
    }
  } catch (err) {
    handleError(err);
  }
}

/**
 * Count the number of "factors" — sub-dimensions inside a template. The
 * factors live in either `factors` (SxS) or `sseCriteria` (SSE) as a
 * JSON array. Whichever is populated wins; missing/null is 0. We never
 * throw for a malformed JSON shape — a count of 0 is the safe display.
 */
function countFactors(row: TemplateListItem): number {
  const candidates = [row.factors, row.sseCriteria];
  for (const c of candidates) {
    if (Array.isArray(c)) return c.length;
  }
  return 0;
}

/** Build the `template` command tree. */
export function buildTemplateCommand(): Command {
  const cmd = new Command("template").description(
    "Manage rating templates (a.k.a. dimensions)"
  );

  cmd
    .command("list")
    .description("List templates visible to the caller")
    .option("--limit <n>", "max rows (default 20, max 100)", "20")
    .action(templateListAction);

  return cmd;
}

export const templateCommand = buildTemplateCommand;

function clampLimit(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 100);
}
