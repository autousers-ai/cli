/**
 * `autousers template list` — list rating templates.
 *
 * Wave 1 originally landed this in a single-file `cli/src/commands/template.ts`.
 * Wave 9 splits the template tree into a folder (matches the eval/ and
 * autouser/ shapes) and the list action moves here unchanged. The
 * description / list shape is byte-identical with v0.9 so existing
 * scripts keep working.
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

export async function templateListAction(
  opts: TemplateListOpts,
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);

    const limit = clampLimit(opts.limit, 20);
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    params.set("includeSystem", "true");

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

function countFactors(row: TemplateListItem): number {
  const candidates = [row.factors, row.sseCriteria];
  for (const c of candidates) {
    if (Array.isArray(c)) return c.length;
  }
  return 0;
}

function clampLimit(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 100);
}

export function registerTemplateListCommand(parent: Command): Command {
  return parent
    .command("list")
    .description("List templates visible to the caller")
    .option("--limit <n>", "max rows (default 20, max 100)", "20")
    .action(templateListAction);
}
