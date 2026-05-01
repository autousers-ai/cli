#!/usr/bin/env node
/**
 * Autousers CLI — bin entrypoint and command dispatcher.
 *
 * The CLI is a thin Node.js client over the Autousers REST API at
 * `/api/v1/*`. Auth is `Authorization: Bearer ak_live_*` — the same key
 * minted at `https://app.autousers.ai/settings/api-keys` that the MCP
 * package uses. No OAuth, no browser flow, no bespoke `/api/cli/*` routes.
 *
 * Why commander?
 * --------------
 * The competing options are `yargs` (heavier, more features we don't need)
 * and hand-rolled `process.argv` parsing (would have us reinventing
 * subcommand help, option negation, and version banners). Commander hits
 * the install-size sweet spot (~80 KB), is the de-facto standard among
 * popular Node CLIs (`vercel`, `supabase`, `expo`), and supports the
 * subcommand pattern we want without ceremony.
 *
 * Why a dispatcher rather than a `bin` per command?
 * -------------------------------------------------
 * One bin keeps the install footprint tiny (`autousers` is the only thing
 * dropped on `$PATH`) and matches what every MCP host / shell user expects.
 * Subcommand dispatch is delegated to commander; each command lives in its
 * own file under `src/commands/` so editing one doesn't touch the others.
 */

import { Command } from "commander";

import { CLI_VERSION } from "./client.js";
import { evalCommand } from "./commands/eval.js";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { usageCommand } from "./commands/usage.js";
import { versionCommand } from "./commands/version.js";
import { whoamiCommand } from "./commands/whoami.js";
import { AutousersApiError, MissingApiKeyError } from "./errors.js";

/** Build the command tree. Extracted so tests / smoke can reuse it. */
function buildProgram(): Command {
  const program = new Command();

  program
    .name("autousers")
    .description(
      "Official CLI for Autousers — UX evaluation, autousers, and calibration."
    )
    .version(CLI_VERSION, "-v, --version", "print the CLI version and exit")
    // Global options surfaced on every subcommand. Resolution order in
    // `config.ts` is `--key` > AUTOUSERS_API_KEY > ~/.autousers/config.json.
    .option("--key <ak_live_...>", "Autousers API key (overrides env / config)")
    .option(
      "--base-url <url>",
      "Override the API host (defaults to https://app.autousers.ai)"
    );

  program
    .command("login")
    .description("Save your Autousers API key to ~/.autousers/config.json")
    .action(loginCommand);

  program
    .command("logout")
    .description("Remove the saved API key from ~/.autousers/config.json")
    .action(logoutCommand);

  program
    .command("whoami")
    .description("Print the active user / team for the resolved API key")
    .action(whoamiCommand);

  program
    .command("eval")
    .description("Manage evaluations (list, get, create, results, ...)")
    .action(evalCommand);

  program
    .command("usage")
    .description("Show free-run pool remaining and token spend rollup")
    .action(usageCommand);

  program
    .command("version")
    .description("Print the CLI version with Node + platform context")
    .action(versionCommand);

  return program;
}

/** Convert a thrown error into a single line + exit code. */
function reportError(err: unknown): never {
  if (err instanceof MissingApiKeyError) {
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  }
  if (err instanceof AutousersApiError) {
    const trailer = err.requestId ? ` (request_id: ${err.requestId})` : "";
    process.stderr.write(`HTTP ${err.status}: ${err.message}${trailer}\n`);
    process.exit(1);
  }
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(process.argv);
}

main().catch(reportError);
