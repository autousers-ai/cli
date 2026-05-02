/**
 * `autousers key create --name <n> [--scope eval:read,...]` — mint a
 * new API key.
 *
 * The plain key is printed ONCE — the server never returns it again.
 * Output makes the warning loud (red banner + the key on its own
 * line). `--json` mode emits the standard envelope for scripted
 * pickup; the warning is plumbed through the response shape too.
 *
 * Wired to `POST /api/v1/api-keys`.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { ExitCode, handleError } from "../../lib/exit.js";
import { bold, dim, green, json as jsonStringify, red } from "../../output.js";

interface KeyCreateOpts {
  name?: string;
  scope?: string;
  expiresAt?: string;
}

export async function keyCreateAction(
  opts: KeyCreateOpts,
  cmd: Command
): Promise<void> {
  if (!opts.name || !opts.name.trim()) {
    process.stderr.write("error: --name <n> is required\n");
    process.exit(ExitCode.VALIDATION);
    return;
  }

  const scopes = opts.scope
    ? opts.scope
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  try {
    const ctx = await resolveContext(cmd);
    const env = await ctx.client.post<{
      data: {
        id: string;
        name: string;
        keyPrefix: string;
        scopes: string[];
        plainKey: string;
        expiresAt: string | null;
        createdAt: string;
      };
    }>("/api/v1/api-keys", {
      name: opts.name.trim(),
      scopes,
      ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
    });

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }

    process.stdout.write(green("Minted API key") + ` ${bold(env.data.name)}\n`);
    process.stdout.write(
      red("⚠  Save this key NOW — it will NEVER be shown again:\n")
    );
    process.stdout.write(`\n  ${bold(env.data.plainKey)}\n\n`);
    process.stdout.write(`${dim("ID:")}      ${env.data.id}\n`);
    process.stdout.write(`${dim("Prefix:")}  ${env.data.keyPrefix}\n`);
    if (env.data.scopes.length > 0) {
      process.stdout.write(`${dim("Scopes:")}  ${env.data.scopes.join(",")}\n`);
    }
  } catch (err) {
    handleError(err);
  }
}

export function registerKeyCreateCommand(parent: Command): Command {
  return parent
    .command("create")
    .description(
      "Mint a new API key (the plain key is shown ONCE — save it immediately)"
    )
    .option("--name <n>", "key name (required)")
    .option(
      "--scope <list>",
      "comma-separated scopes, e.g. eval:read,templates:write"
    )
    .option("--expires-at <iso>", "ISO-8601 expiry timestamp")
    .action(keyCreateAction);
}
