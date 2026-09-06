/**
 * `autousers team use <slug>` — set the active team slug in the local
 * CLI config so subsequent commands implicitly scope to it. No server
 * call — pure config write to `~/.autousers/config.json`.
 */

import { Command } from "commander";

import { readConfig, writeConfig } from "../../config.js";
import { handleError } from "../../lib/exit.js";
import { green, json as jsonStringify } from "../../output.js";

interface TeamUseOpts {
  json?: boolean;
}

export async function teamUseAction(
  slug: string,
  opts: TeamUseOpts,
  cmd: Command
): Promise<void> {
  try {
    const cfg = (await readConfig()) ?? {};
    await writeConfig({ ...cfg, activeTeamSlug: slug });
    const useJson = Boolean(opts.json) || Boolean(cmd.parent?.opts?.().json);
    if (useJson) {
      process.stdout.write(
        jsonStringify({ activeTeamSlug: slug, persisted: true }) + "\n"
      );
      return;
    }
    process.stdout.write(green("Active team set to") + ` ${slug}\n`);
  } catch (err) {
    handleError(err);
  }
}

export function registerTeamUseCommand(parent: Command): Command {
  return parent
    .command("use <slug>")
    .description(
      "Set the active team — subsequent commands implicitly scope to it"
    )
    .option("--json", "emit machine-readable JSON")
    .action(teamUseAction);
}
