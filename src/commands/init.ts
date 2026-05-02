/**
 * `autousers init` — drop a `.autousers.json` in the current directory (or
 * `~/.autousers/config.json` with `--global`) so subsequent commands inside
 * the project pick up the same defaults — base URL, active team, output
 * format — without each developer running `team use` or exporting env
 * vars.
 *
 * Wave 10 (plain-mode polish). The companion config helpers
 * (`writeProjectConfig`, `findProjectConfigPath`, `getActiveTeamSlug`,
 * `getDefaultOutput`) already know how to read this file walking up from
 * CWD; this command's job is just to write it cleanly.
 *
 * Why a separate command rather than overloading `team use` /
 * `settings ...`?
 * --------------------------------------------------------------
 * `team use` writes the *global* config (every shell sees it). A
 * project-level pin needs a per-repo file checked in to git so a teammate
 * cloning the repo gets the same defaults without a setup ritual. That's
 * a different surface and warrants a dedicated, discoverable verb that
 * mirrors what `npm init`, `git init`, and `gh repo init` do.
 *
 * Auth (`apiKey`, `accessToken`, `refreshToken`) is intentionally NOT
 * written here — `.autousers.json` is intended to be checked in, and
 * leaking a refresh token to git history is a class-of-bug we'd rather
 * make impossible than catch in code review.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { Command } from "commander";

import {
  configPath,
  PROJECT_CONFIG_FILENAME,
  readConfig,
  writeConfig,
  writeProjectConfig,
  type CliConfig,
  type ProjectConfig,
} from "../config.js";
import { ExitCode, handleError } from "../lib/exit.js";
import { dim, green, json as jsonStringify, red } from "../output.js";

interface InitOpts {
  team?: string;
  output?: string;
  global?: boolean;
  force?: boolean;
  yes?: boolean;
}

/** Read a single line from stdin (used for the interactive prompts). */
async function readLine(): Promise<string> {
  return await new Promise<string>((resolveLine, rejectLine) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    const onData = (chunk: string): void => {
      buf += chunk;
      const idx = buf.indexOf("\n");
      if (idx >= 0) {
        process.stdin.removeListener("data", onData);
        resolveLine(buf.slice(0, idx));
      }
    };
    process.stdin.on("data", onData);
    process.stdin.once("error", (err) => rejectLine(err));
  });
}

/** Validate the `--output` flag value. Throws if invalid. */
function validateOutput(value: string): "json" | "text" {
  if (value !== "json" && value !== "text") {
    throw new Error(`--output must be "json" or "text" (got "${value}")`);
  }
  return value;
}

/**
 * Prompt the user for a value, defaulting to `def` if they hit Enter on
 * an empty line. Returns `undefined` when the user enters nothing AND no
 * default was provided — keeps the persisted config minimal (we only
 * write the keys the user actually opted into).
 */
async function promptValue(
  label: string,
  def?: string | undefined
): Promise<string | undefined> {
  const hint = def !== undefined ? ` [${def}]` : "";
  process.stdout.write(`${label}${hint}: `);
  const answer = (await readLine()).trim();
  if (answer.length === 0) return def;
  return answer;
}

export async function initAction(opts: InitOpts, cmd: Command): Promise<void> {
  // --base-url is a parent-program global (see src/index.ts:60). Reading
  // it via `optsWithGlobals()` keeps the per-subcommand flag namespace
  // unambiguous — same trick `login.ts` uses.
  const globals = cmd.optsWithGlobals?.() ?? {};
  const baseUrlFlag = (globals.baseUrl as string | undefined) ?? undefined;

  // Validate --output up front so a typo exits 4 BEFORE we touch the
  // filesystem or open stdin. Same pattern as eval/delete.ts.
  let outputMode: "json" | "text" | undefined;
  if (opts.output !== undefined) {
    try {
      outputMode = validateOutput(opts.output);
    } catch (err) {
      process.stderr.write(
        `error: ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exit(ExitCode.VALIDATION);
      return;
    }
  }

  // Determine target path. Global writes go through `writeConfig` so
  // we preserve auth tokens; project writes go to a fresh file in CWD.
  const isGlobal = Boolean(opts.global);
  const targetPath = isGlobal
    ? configPath()
    : resolve(join(process.cwd(), PROJECT_CONFIG_FILENAME));

  // Refuse to clobber an existing file unless --force or interactive
  // confirmation. For global mode the config file likely already exists
  // (login wrote it) — so we only treat existence as a conflict in the
  // project case where the user might be re-running init by accident.
  if (!isGlobal && existsSync(targetPath) && !opts.force) {
    if (process.stdin.isTTY && !opts.yes) {
      process.stdout.write(
        `${red("⚠")} ${targetPath} already exists. Overwrite? [y/N] `
      );
      const answer = (await readLine()).trim().toLowerCase();
      if (answer !== "y" && answer !== "yes") {
        process.stdout.write(`${dim("Aborted.")}\n`);
        return;
      }
    } else {
      process.stderr.write(
        `error: ${targetPath} already exists. Pass --force to overwrite.\n`
      );
      process.exit(ExitCode.VALIDATION);
      return;
    }
  }

  // Decide whether we'll prompt. We prompt only when the shell is a TTY,
  // the user didn't pass --yes, and at least one field would otherwise
  // be missing. This mirrors `npm init` / `gh repo create` UX: flags win,
  // missing fields are filled by prompts, --yes accepts every default.
  const anyFlagSet =
    opts.team !== undefined ||
    baseUrlFlag !== undefined ||
    outputMode !== undefined;
  const shouldPrompt = !opts.yes && !anyFlagSet && Boolean(process.stdin.isTTY);

  // Non-TTY without enough flags is an error — we can't prompt and we
  // refuse to silently write an empty config that does nothing useful.
  if (!shouldPrompt && !opts.yes && !anyFlagSet && !process.stdin.isTTY) {
    process.stderr.write(
      `error: refusing to run interactively in a non-TTY shell. Pass --team / --base-url / --output, or --yes to accept defaults.\n`
    );
    process.exit(ExitCode.VALIDATION);
    return;
  }

  let teamSlug = opts.team;
  let baseUrl = baseUrlFlag;
  let output = outputMode;

  if (shouldPrompt) {
    process.stdout.write(
      `${dim(
        `Configuring ${isGlobal ? "global" : "project"} defaults — leave blank to skip a field.`
      )}\n`
    );
    teamSlug = await promptValue("Active team slug", teamSlug);
    baseUrl = await promptValue(
      "Base URL",
      baseUrl ?? "https://app.autousers.ai"
    );
    const outRaw = await promptValue(
      "Default output (json|text)",
      output ?? "text"
    );
    if (outRaw !== undefined) {
      try {
        output = validateOutput(outRaw);
      } catch (err) {
        process.stderr.write(
          `error: ${err instanceof Error ? err.message : String(err)}\n`
        );
        process.exit(ExitCode.VALIDATION);
        return;
      }
    }
  }

  try {
    if (isGlobal) {
      // Merge into the existing global config so we don't clobber
      // accessToken / refreshToken / apiKey / clientId etc.
      const existing = (await readConfig()) ?? {};
      const next: CliConfig = { ...existing };
      if (teamSlug !== undefined) next.activeTeamSlug = teamSlug;
      if (baseUrl !== undefined) next.baseUrl = baseUrl;
      if (output !== undefined) next.output = output;
      await writeConfig(next);

      const useJson = Boolean(cmd.parent?.opts?.().json) || output === "json";
      if (useJson) {
        process.stdout.write(
          jsonStringify({
            path: targetPath,
            config: {
              activeTeamSlug: next.activeTeamSlug,
              baseUrl: next.baseUrl,
              output: next.output,
            },
          }) + "\n"
        );
        return;
      }
      process.stdout.write(
        `${green("OK")} Wrote global config to ${targetPath}\n`
      );
      return;
    }

    // Project mode — fresh ProjectConfig (no auth fields by design).
    const projectCfg: ProjectConfig = {};
    if (teamSlug !== undefined) projectCfg.activeTeamSlug = teamSlug;
    if (baseUrl !== undefined) projectCfg.baseUrl = baseUrl;
    if (output !== undefined) projectCfg.output = output;
    await writeProjectConfig(targetPath, projectCfg);

    const useJson = Boolean(cmd.parent?.opts?.().json) || output === "json";
    if (useJson) {
      process.stdout.write(
        jsonStringify({ path: targetPath, config: projectCfg }) + "\n"
      );
      return;
    }
    process.stdout.write(
      `${green("OK")} Wrote ${targetPath}\n` +
        `   ${dim("Commit this file so your team picks up the same defaults.")}\n`
    );
  } catch (err) {
    handleError(err);
  }
}

export function initCommand(parent: Command): Command {
  return parent
    .command("init")
    .description(
      "Pin project defaults (team, base URL, output) to .autousers.json"
    )
    .option("--team <slug>", "active team slug")
    .option("--output <mode>", "default output mode: json | text")
    .option(
      "--global",
      "write to ~/.autousers/config.json instead of ./.autousers.json"
    )
    .option("--force", "overwrite an existing file without confirmation")
    .option(
      "--yes",
      "skip interactive prompts (required in non-TTY shells when no flags are passed)"
    )
    .action(initAction);
}
