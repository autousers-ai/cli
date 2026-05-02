/**
 * `autousers eval export <id> [--format json|csv|md]` — stream the
 * server's export envelope to stdout. Wraps
 * `GET /api/v1/evaluations/:id/export?format=...`.
 *
 * Output is the raw text response body (JSON / CSV / Markdown) so
 * shell redirection works naturally:
 *
 *   autousers eval export <id> --format md > report.md
 *   autousers eval export <id> --format csv > data.csv
 *
 * We use raw fetch rather than `AutousersClient.get` because the
 * client always parses JSON bodies; CSV and Markdown responses would
 * fail JSON.parse and surface as an `AutousersApiError`.
 */

import { Command } from "commander";

import { CLI_VERSION } from "../../client.js";
import { getBaseUrl } from "../../config.js";
import { handleError } from "../../lib/exit.js";
import { resolveBearerForRunner } from "../../tui/runtime.js";

const FORMATS = ["json", "csv", "md"] as const;
type ExportFormat = (typeof FORMATS)[number];

interface EvalExportOpts {
  format?: string;
}

function isExportFormat(s: unknown): s is ExportFormat {
  return typeof s === "string" && (FORMATS as readonly string[]).includes(s);
}

export async function evalExportAction(
  id: string,
  opts: EvalExportOpts,
  cmd: Command
): Promise<void> {
  try {
    const format: ExportFormat = isExportFormat(opts.format)
      ? opts.format
      : "json";

    // Read --base-url and --key from program-level flags directly. We
    // can't use `resolveContext()` because that would build a JSON-only
    // client; we want the raw response body so shell redirects work.
    let root: Command = cmd;
    while (root.parent) root = root.parent;
    const flags = root.opts() as { key?: string; baseUrl?: string };

    const baseUrl = await getBaseUrl(flags.baseUrl);
    const bearer = flags.key ?? (await resolveBearerForRunner());

    const url = `${baseUrl}/api/v1/evaluations/${encodeURIComponent(
      id
    )}/export?format=${encodeURIComponent(format)}`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept:
          format === "json"
            ? "application/json"
            : format === "csv"
              ? "text/csv"
              : "text/markdown",
        "User-Agent": `autousers-cli/${CLI_VERSION}`,
      },
    });

    if (!res.ok) {
      // Best-effort error message from the JSON envelope; fall back to
      // status text if the body isn't JSON.
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        /* ignore */
      }
      const msg =
        (body as { error?: { message?: string } } | null)?.error?.message ??
        `HTTP ${res.status} ${res.statusText}`;
      throw new Error(msg);
    }

    const text = await res.text();
    process.stdout.write(text);
    if (!text.endsWith("\n")) process.stdout.write("\n");
  } catch (err) {
    handleError(err);
  }
}

export function registerEvalExportCommand(parent: Command): Command {
  return parent
    .command("export <id>")
    .description("Export evaluation results (json|csv|md) to stdout")
    .option("--format <fmt>", "json | csv | md", "json")
    .action(evalExportAction);
}
