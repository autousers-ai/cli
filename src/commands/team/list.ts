/**
 * `autousers team list` — list every team the caller belongs to.
 * Wired to `GET /api/v1/teams`.
 */

import { Command } from "commander";

import { readConfig } from "../../config.js";
import { resolveContext } from "../../lib/context.js";
import { handleError } from "../../lib/exit.js";
import { dim, json as jsonStringify, table, truncate } from "../../output.js";

interface TeamRow {
  id: string;
  name: string;
  description: string | null;
  isPersonal: boolean;
  memberCount: number;
  userRole: string | null;
  slug?: string;
}

export async function teamListAction(
  _opts: Record<string, never>,
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);
    const env = await ctx.client.get<{ data: TeamRow[] }>("/api/v1/teams");

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }

    if (env.data.length === 0) {
      process.stdout.write(dim("No teams found.") + "\n");
      return;
    }

    const cfg = await readConfig();
    const activeSlug = cfg?.activeTeamSlug ?? null;

    const rows = env.data.map((r) => ({
      Active: (r.slug ?? r.id) === activeSlug ? "★" : " ",
      Name: truncate(r.name, 28),
      Slug: r.slug ?? "—",
      Role: r.userRole ?? "—",
      Members: String(r.memberCount),
      Kind: r.isPersonal ? "personal" : "shared",
    }));
    process.stdout.write(
      table(rows, ["Active", "Name", "Slug", "Role", "Members", "Kind"]) + "\n"
    );
  } catch (err) {
    handleError(err);
  }
}

export function registerTeamListCommand(parent: Command): Command {
  return parent
    .command("list")
    .description("List teams the caller belongs to")
    .action(teamListAction);
}
