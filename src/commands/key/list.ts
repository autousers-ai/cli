/**
 * `autousers key list` — list API keys for the active team.
 * Wired to `GET /api/v1/api-keys`.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { handleError } from "../../lib/exit.js";
import { dim, json as jsonStringify, table, truncate } from "../../output.js";

interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export async function keyListAction(
  _opts: Record<string, never>,
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);
    const env = await ctx.client.get<{ data: ApiKeyRow[] }>("/api/v1/api-keys");

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }

    if (env.data.length === 0) {
      process.stdout.write(dim("No API keys found.") + "\n");
      return;
    }

    const rows = env.data.map((r) => ({
      Name: truncate(r.name, 24),
      Prefix: r.keyPrefix,
      Scopes: r.scopes.length > 0 ? r.scopes.join(",") : "—",
      Status: r.revokedAt ? "revoked" : "active",
      LastUsed: r.lastUsedAt ? r.lastUsedAt.slice(0, 10) : "—",
      Created: r.createdAt.slice(0, 10),
      ID: r.id,
    }));
    process.stdout.write(
      table(rows, [
        "Name",
        "Prefix",
        "Scopes",
        "Status",
        "LastUsed",
        "Created",
        "ID",
      ]) + "\n"
    );
  } catch (err) {
    handleError(err);
  }
}

export function registerKeyListCommand(parent: Command): Command {
  return parent
    .command("list")
    .description("List API keys for the active team")
    .action(keyListAction);
}
