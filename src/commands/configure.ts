/**
 * `autousers configure` — interactive (line-prompt) wizard for global CLI
 * defaults stored at `~/.autousers/config.json`.
 *
 * Wave 10's "plain-mode polish" wizard. Touches ONLY preference fields —
 * `baseUrl`, `activeTeamSlug`, `output` — never auth (`apiKey`,
 * `accessToken`, `refreshToken`, `expiresAt`, `clientId`). Auth lives behind
 * `login` / `logout` and must survive a `configure` round-trip so a user
 * can tweak their default team without being booted out.
 *
 * Modes
 * -----
 *   - Flag mode: `configure --base-url … --team … --output … --yes`
 *     non-interactive write-through. Used by scripts and CI.
 *   - Interactive mode: bare `configure` in a TTY prompts for each field
 *     showing the current value as the `[default]`. Empty input keeps it.
 *   - Reset mode: `configure --reset` strips the three preference fields
 *     back to undefined; auth is preserved.
 *
 * Why a plain readLine() prompt rather than Ink/TUI?
 * --------------------------------------------------
 * The rest of Wave 10 is plain-mode hardening; an Ink wizard for three
 * fields would balloon the cold-path dependency surface and break
 * `--no-tui` parity. The same readLine() pattern as `eval delete` keeps
 * the dep budget at zero.
 */

import { Command } from "commander";

import {
  configPath,
  readConfig,
  writeConfig,
  type CliConfig,
} from "../config.js";
import { ExitCode, handleError } from "../lib/exit.js";
import { dim, green, json as jsonStringify } from "../output.js";

interface ConfigureOpts {
  team?: string;
  output?: string;
  reset?: boolean;
  yes?: boolean;
}

/** Read a single line from stdin (same pattern as eval delete's confirm). */
async function readLine(): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    const onData = (chunk: string): void => {
      buf += chunk;
      const idx = buf.indexOf("\n");
      if (idx >= 0) {
        process.stdin.removeListener("data", onData);
        resolve(buf.slice(0, idx));
      }
    };
    process.stdin.on("data", onData);
    process.stdin.once("error", (err) => reject(err));
  });
}

/** Render a value for the `[bracket]` default in a prompt; empty → "(unset)". */
function defaultLabel(value: string | undefined): string {
  return value && value.length > 0 ? value : "(unset)";
}

/** Validate `--output`; throws to trigger the VALIDATION exit path. */
function parseOutput(raw: string): "json" | "text" {
  if (raw === "json" || raw === "text") return raw;
  throw new Error(`--output must be "json" or "text" (got "${raw}")`);
}

export async function configureAction(
  opts: ConfigureOpts,
  cmd: Command
): Promise<void> {
  // --base-url is a parent-program global (see src/index.ts). Reading it
  // via `optsWithGlobals()` keeps the per-subcommand flag namespace
  // unambiguous — same trick `init.ts` uses.
  const globals = cmd.optsWithGlobals?.() ?? {};
  const baseUrlFlag = (globals.baseUrl as string | undefined) ?? undefined;

  // Mutual-exclusion gate runs BEFORE try/catch so the VALIDATION exit
  // isn't remapped to GENERIC by handleError. Same pattern as eval/delete.
  if (
    opts.reset &&
    (baseUrlFlag !== undefined ||
      opts.team !== undefined ||
      opts.output !== undefined)
  ) {
    process.stderr.write(
      "error: --reset cannot be combined with --base-url / --team / --output\n"
    );
    process.exit(ExitCode.VALIDATION);
    return;
  }

  // Validate --output locally before any I/O so a typo fails fast.
  let parsedOutput: "json" | "text" | undefined;
  if (opts.output !== undefined) {
    try {
      parsedOutput = parseOutput(opts.output);
    } catch (err) {
      process.stderr.write(
        `error: ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exit(ExitCode.VALIDATION);
      return;
    }
  }

  const useJson = Boolean(globals.json);
  const hasFieldFlag =
    baseUrlFlag !== undefined ||
    opts.team !== undefined ||
    opts.output !== undefined;
  const isTty = Boolean(process.stdin.isTTY);

  // Non-TTY with no field flags and no --reset: nothing safe to do.
  if (!opts.reset && !hasFieldFlag && (!isTty || opts.yes)) {
    process.stderr.write(
      "error: nothing to do; pass at least one field flag (--base-url, --team, --output) or use --reset\n"
    );
    process.exit(ExitCode.VALIDATION);
    return;
  }

  try {
    const existing: CliConfig = (await readConfig()) ?? {};

    let next: CliConfig;

    if (opts.reset) {
      // Strip prefs while preserving auth. Spread + delete (vs explicit
      // pick) keeps any future fields we add to CliConfig safe — only the
      // three preference fields are intentionally dropped.
      next = { ...existing };
      delete next.baseUrl;
      delete next.activeTeamSlug;
      delete next.output;
    } else if (hasFieldFlag) {
      // Flag mode — partial update from whatever was passed.
      next = { ...existing };
      if (baseUrlFlag !== undefined) next.baseUrl = baseUrlFlag;
      if (opts.team !== undefined) next.activeTeamSlug = opts.team;
      if (parsedOutput !== undefined) next.output = parsedOutput;
    } else {
      // Interactive mode — prompt for each field. Empty input keeps current.
      process.stdout.write(
        `${dim("Configure Autousers CLI defaults. Press Enter to keep the current value.")}\n\n`
      );

      process.stdout.write(`Base URL [${defaultLabel(existing.baseUrl)}]: `);
      const baseUrlAnswer = (await readLine()).trim();

      process.stdout.write(
        `Active team slug [${defaultLabel(existing.activeTeamSlug)}]: `
      );
      const teamAnswer = (await readLine()).trim();

      process.stdout.write(
        `Default output (json|text) [${defaultLabel(existing.output)}]: `
      );
      const outputAnswerRaw = (await readLine()).trim();

      let outputAnswer: "json" | "text" | undefined;
      if (outputAnswerRaw.length > 0) {
        try {
          outputAnswer = parseOutput(outputAnswerRaw);
        } catch (err) {
          process.stderr.write(
            `error: ${err instanceof Error ? err.message : String(err)}\n`
          );
          process.exit(ExitCode.VALIDATION);
          return;
        }
      }

      next = { ...existing };
      if (baseUrlAnswer.length > 0) next.baseUrl = baseUrlAnswer;
      if (teamAnswer.length > 0) next.activeTeamSlug = teamAnswer;
      if (outputAnswer !== undefined) next.output = outputAnswer;
    }

    // Confirmation summary (skipped with --yes). Shows the resulting
    // preference fields only — auth is intentionally absent from the
    // summary even though it's preserved on disk.
    if (!opts.yes) {
      process.stdout.write(`\n${dim("New defaults:")}\n`);
      process.stdout.write(`  baseUrl:        ${defaultLabel(next.baseUrl)}\n`);
      process.stdout.write(
        `  activeTeamSlug: ${defaultLabel(next.activeTeamSlug)}\n`
      );
      process.stdout.write(`  output:         ${defaultLabel(next.output)}\n`);
      process.stdout.write(`\nWrite to ${configPath()}? [y/N] `);
      const confirm = (await readLine()).trim().toLowerCase();
      if (confirm !== "y" && confirm !== "yes") {
        process.stdout.write(`${dim("Aborted.")}\n`);
        return;
      }
    }

    await writeConfig(next);

    if (useJson) {
      // Emit only the preference fields — auth must NEVER leak into stdout
      // (this output may be piped into shared CI logs).
      process.stdout.write(
        jsonStringify({
          persisted: true,
          path: configPath(),
          config: {
            baseUrl: next.baseUrl,
            activeTeamSlug: next.activeTeamSlug,
            output: next.output,
          },
        }) + "\n"
      );
      return;
    }

    if (opts.reset) {
      process.stdout.write(
        `${green("Reset CLI defaults")} (auth preserved) — ${configPath()}\n`
      );
      return;
    }
    process.stdout.write(`${green("Saved CLI defaults to")} ${configPath()}\n`);
  } catch (err) {
    handleError(err);
  }
}

export function configureCommand(parent: Command): Command {
  // Note: --base-url is NOT registered here — it's a parent-program global
  // (see src/index.ts), and reading it via `optsWithGlobals()` keeps the
  // flag namespace consistent with `init`, `login`, and the rest of the
  // CLI. Same trick those commands use.
  return parent
    .command("configure")
    .description(
      "Set CLI defaults (baseUrl / active team / output). Interactive in a TTY; flag-driven otherwise. Never touches auth."
    )
    .option("--team <slug>", "set the active team slug")
    .option("--output <mode>", 'default output: "json" or "text"')
    .option(
      "--reset",
      "wipe baseUrl / active team / output back to defaults (auth preserved)"
    )
    .option("--yes", "skip the confirmation prompt and any further questions")
    .action(configureAction);
}
