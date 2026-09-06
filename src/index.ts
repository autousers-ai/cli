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
import { buildAutouserCommand } from "./commands/autouser/index.js";
import { completionCommand } from "./commands/completion.js";
import { configureCommand } from "./commands/configure.js";
import { buildDimensionCommand } from "./commands/dimension/index.js";
import { buildEvalCommand } from "./commands/eval.js";
import { initCommand } from "./commands/init.js";
import { buildKeyCommand } from "./commands/key/index.js";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { buildSettingsCommand } from "./commands/settings/index.js";
import { buildTeamCommand } from "./commands/team/index.js";
import { buildTemplateCommand } from "./commands/template.js";
import { usageCommand } from "./commands/usage.js";
import { versionCommand } from "./commands/version.js";
import { whoamiCommand } from "./commands/whoami.js";
import { AutousersApiError, MissingApiKeyError } from "./errors.js";
import { shouldUseTUI } from "./tui/tty.js";

/** Build the command tree. Extracted so tests / smoke can reuse it. */
export function buildProgram(): Command {
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
    )
    // Output-shaping flags. Read in each subcommand via `resolveContext`.
    // Commander's built-in `--no-color` negation flips `color` to `false`.
    .option("--json", "emit machine-readable JSON instead of text")
    .option("--quiet", "suppress spinners and non-essential output")
    .option(
      "--no-color",
      "disable ANSI color even when stdout is a TTY (also: NO_COLOR=1)"
    );

  // Note: --base-url is intentionally NOT registered as a per-subcommand
  // option here; it's a global on the parent program so commander can't
  // get confused by a duplicate-name flag. login/logout read it via
  // `command.optsWithGlobals().baseUrl`.
  program
    .command("login")
    .description(
      "Sign in to Autousers (browser flow by default; --key for paste mode)"
    )
    .option(
      "--key <ak_live_...>",
      "Skip the browser; persist this API key directly"
    )
    .option(
      "--no-browser",
      "Print the auth URL instead of opening a browser tab"
    )
    .action(loginCommand);

  program
    .command("logout")
    .description("Revoke OAuth tokens server-side and clear local credentials")
    .action(logoutCommand);

  program
    .command("whoami")
    .description("Print the active user / team for the resolved API key")
    .action(whoamiCommand);

  // `eval`, `autouser`, and `template` each own their subcommand tree.
  // Adding them via `.addCommand` (rather than `.command(...).action(...)`)
  // keeps the help text under the parent route — `autousers eval --help`
  // shows `list` / `get` rather than dumping the full top-level menu.
  program.addCommand(buildEvalCommand());
  program.addCommand(buildAutouserCommand());
  program.addCommand(buildTemplateCommand());
  program.addCommand(buildDimensionCommand());
  program.addCommand(buildTeamCommand());
  program.addCommand(buildSettingsCommand());
  program.addCommand(buildKeyCommand());

  program
    .command("usage")
    .description("Show free-run pool remaining and token spend rollup")
    .option(
      "--range <window>",
      "time window: 7d | 30d | 90d (default 30d)",
      (value: string): "7d" | "30d" | "90d" => {
        if (value === "7d" || value === "30d" || value === "90d") return value;
        throw new Error(`--range must be 7d, 30d, or 90d (got "${value}")`);
      }
    )
    .action(usageCommand);

  program
    .command("version")
    .description("Print the CLI version with Node + platform context")
    .action(versionCommand);

  completionCommand(program);

  // Wave 10 — pin project-level defaults to `.autousers.json` (or, with
  // --global, into `~/.autousers/config.json`). Registered last because
  // it's a one-shot setup verb most users will run exactly once per repo.
  initCommand(program);

  // Wave 10 — interactive (line-prompt) wizard for global CLI defaults at
  // `~/.autousers/config.json`. Sibling to `init` (which writes the
  // project-local `.autousers.json`); `configure` is global-scoped and
  // never touches auth fields.
  configureCommand(program);

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
  // Bare `autousers` in a TTY (no subcommand, not CI, no --no-tui flag,
  // no --help/--version) launches the Ink TUI. Anything else falls through
  // to commander's plain-mode dispatcher. The dynamic import keeps
  // react/ink off the cold path for plain-mode invocations — a `eval list
  // --json` invocation never pays the cost of loading the TUI tree.
  if (shouldUseTUI()) {
    const { startTUI } = await import("./tui/app.js");
    const instance = startTUI();
    await instance.waitUntilExit();
    return;
  }

  const program = buildProgram();
  await program.parseAsync(process.argv);
}

main().catch(reportError);
